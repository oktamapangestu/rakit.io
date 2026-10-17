// Package pagecheck membuka halaman website project di Chromium headless dan melaporkan error JavaScript, error
// Alpine, request yang gagal, dan halaman yang lebih lebar dari layar HP. Dipakai tool check_page AI Builder
// (internal/ai/lab.go); padanan deploy/agent/cek-halaman.cjs di container mode Agen.
//
// Satu proses Chromium dipakai bersama semua job (satu tab per pemeriksaan, jumlahnya dibatasi), dinyalakan saat
// pertama dipakai dan dimatikan lagi setelah menganggur. Halaman dilayani dari server lokal milik paket ini di
// http://<token>.localhost:<port> (origin baru setiap pemeriksaan, jadi localStorage tidak terbawa).
//
// Jaringan browser: semua request diarahkan ke proxy yang langsung menutup koneksi, kecuali server lokal tadi
// dan CDN umum (allowedHosts). Jadi kode halaman tidak bisa menjangkau jaringan internal server (127.0.0.1 port
// lain, metadata cloud, …); request ke luar yang diblokir disebut di laporan sebagai catatan, bukan masalah.
package pagecheck

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/chromedp"
)

// allowedHosts: host di luar yang boleh dimuat halaman saat diperiksa (library & font & gambar contoh).
var allowedHosts = []string{
	"cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com", "cdn.tailwindcss.com", "code.jquery.com",
	"ajax.googleapis.com", "fonts.googleapis.com", "fonts.gstatic.com", "esm.sh", "cdn.skypack.dev", "ga.jspm.io",
	"images.unsplash.com", "plus.unsplash.com", "picsum.photos", "fastly.picsum.photos", "placehold.co",
	"via.placeholder.com", "i.pravatar.cc", "ui-avatars.com", "api.dicebear.com",
}

const (
	MobileWidth  = 390
	mobileHeight = 844
	pageTimeout  = 20 * time.Second // memuat satu halaman
	settleMax    = 6 * time.Second  // menunggu request susulan (fetch data, Alpine) selesai
	settleQuiet  = 600 * time.Millisecond
)

type Options struct {
	Path          string        // file Chromium/Chrome/headless shell; kosong = cari otomatis (Find)
	MaxConcurrent int           // tab yang boleh terbuka bersamaan (sisanya menunggu)
	NoSandbox     bool          // --no-sandbox (server yang menjalankan rakit sebagai root)
	Idle          time.Duration // browser dimatikan setelah menganggur selama ini
}

// Report: hasil satu halaman.
type Report struct {
	Path     string
	Status   int      // status HTTP halaman (0 = gagal dimuat)
	Problems []string // error JS/Alpine/console, request gagal, HTTP ≥ 400, halaman melebar
	Blocked  []string // host luar yang tidak dimuat saat pemeriksaan (bukan masalah)
	Dialogs  []string // alert/confirm/prompt yang muncul (ditutup otomatis)
	Missing  []string // gambar website sendiri yang tidak ada (404) — diunggah pengguna, bukan masalah kode
}

type Checker struct {
	exec string
	opts Options
	sem  chan struct{}

	mu      sync.Mutex
	browser context.Context // nil = belum menyala
	stop    func()
	port    string
	sites   map[string]http.Handler // token → website yang sedang diperiksa
	active  int
	idle    *time.Timer
}

// New: nil bila tidak ada browser (pemeriksaan halaman tidak tersedia).
func New(o Options) *Checker {
	path := Find(o.Path)
	if path == "" {
		return nil
	}
	if o.MaxConcurrent < 1 {
		o.MaxConcurrent = 1
	}
	if o.Idle <= 0 {
		o.Idle = 3 * time.Minute
	}
	return &Checker{exec: path, opts: o, sem: make(chan struct{}, o.MaxConcurrent), sites: map[string]http.Handler{}}
}

// Exec: file browser yang dipakai.
func (c *Checker) Exec() string { return c.exec }

// Find mencari browser: path yang diberikan ("off" = tidak ada), headless shell Playwright, lalu Chrome/Chromium.
func Find(path string) string {
	switch path {
	case "off", "0", "false":
		return ""
	case "":
	default:
		if p, err := exec.LookPath(path); err == nil {
			return p
		}
		return ""
	}
	var caches []string
	if dir := os.Getenv("PLAYWRIGHT_BROWSERS_PATH"); dir != "" {
		caches = append(caches, dir)
	}
	if home, err := os.UserHomeDir(); err == nil {
		caches = append(caches, filepath.Join(home, ".cache", "ms-playwright"), filepath.Join(home, "Library", "Caches", "ms-playwright"))
	}
	for _, dir := range caches {
		var found []string
		for _, pattern := range []string{"chromium_headless_shell-*/*/chrome-headless-shell", "chromium_headless_shell-*/*/headless_shell"} {
			list, _ := filepath.Glob(filepath.Join(dir, pattern))
			found = append(found, list...)
		}
		if len(found) > 0 {
			sort.Strings(found)
			return found[len(found)-1] // versi terbaru
		}
	}
	for _, name := range []string{"chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome", "headless_shell"} {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	for _, p := range []string{"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// Check membuka setiap path dari website site dan melaporkan masalahnya. Menunggu giliran bila tab sedang penuh.
func (c *Checker) Check(ctx context.Context, site http.Handler, paths []string) ([]Report, error) {
	select {
	case c.sem <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer func() { <-c.sem }()

	browser, origin, release, err := c.acquire(site)
	if err != nil {
		return nil, err
	}
	defer release()
	var out []Report
	for _, p := range paths {
		r, err := c.checkPage(ctx, browser, origin, p)
		if err != nil {
			return out, err
		}
		out = append(out, r)
	}
	return out, nil
}

// acquire: browser yang menyala dan origin untuk site (didaftarkan di server lokal sampai release).
func (c *Checker) acquire(site http.Handler) (context.Context, string, func(), error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.idle != nil {
		c.idle.Stop()
		c.idle = nil
	}
	if c.browser != nil && c.browser.Err() != nil { // browser mati sendiri (crash)
		c.stop()
		c.browser = nil
	}
	if c.browser == nil {
		if err := c.start(); err != nil {
			return nil, "", nil, err
		}
	}
	buf := make([]byte, 8)
	rand.Read(buf)
	token := "c" + hex.EncodeToString(buf)
	c.sites[token] = site
	c.active++
	browser := c.browser
	release := func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		delete(c.sites, token)
		c.active--
		if c.active == 0 && c.browser != nil {
			c.idle = time.AfterFunc(c.opts.Idle, c.shutdownIfIdle)
		}
	}
	return browser, fmt.Sprintf("http://%s.localhost:%s", token, c.port), release, nil
}

func (c *Checker) shutdownIfIdle() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.active == 0 && c.browser != nil {
		c.stop()
		c.browser = nil
	}
}

// Close mematikan browser (server berhenti).
func (c *Checker) Close() {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.browser != nil {
		c.stop()
		c.browser = nil
	}
}

// start menyalakan server lokal, proxy penolak, dan browser. Dipanggil dengan c.mu terkunci.
func (c *Checker) start() error {
	siteL, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	_, port, _ := net.SplitHostPort(siteL.Addr().String())
	srv := &http.Server{ReadHeaderTimeout: 10 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, _ := net.SplitHostPort(r.Host)
		token, _ := strings.CutSuffix(host, ".localhost")
		c.mu.Lock()
		site := c.sites[token]
		c.mu.Unlock()
		if site == nil {
			http.Error(w, "pemeriksaan sudah selesai", http.StatusGone)
			return
		}
		site.ServeHTTP(w, r)
	})}
	go srv.Serve(siteL)

	// Proxy penolak: setiap koneksi langsung ditutup, jadi request yang tidak dikecualikan gagal.
	deny, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		srv.Close()
		return err
	}
	go func() {
		for {
			conn, err := deny.Accept()
			if err != nil {
				return
			}
			conn.Close()
		}
	}()

	bypass := append([]string{"<-loopback>", "*.localhost:" + port}, allowedHosts...)
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(c.exec),
		chromedp.Flag("proxy-server", "http://"+deny.Addr().String()),
		chromedp.Flag("proxy-bypass-list", strings.Join(bypass, ";")),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("mute-audio", true),
		chromedp.Flag("hide-scrollbars", true),
		chromedp.Flag("disable-component-update", true),
		chromedp.Flag("disable-domain-reliability", true),
		chromedp.Flag("no-pings", true),
		chromedp.WindowSize(MobileWidth, mobileHeight),
	)
	if c.opts.NoSandbox {
		opts = append(opts, chromedp.NoSandbox)
	}
	allocCtx, cancelAlloc := chromedp.NewExecAllocator(context.Background(), opts...)
	browser, cancelBrowser := chromedp.NewContext(allocCtx)
	stop := func() {
		cancelBrowser()
		cancelAlloc()
		srv.Close()
		deny.Close()
	}
	// Run pertama menyalakan browser; konteksnya tidak boleh turunan dengan batas waktu (pembatalannya ikut
	// mematikan browser), jadi batas waktu menyala dipasang terpisah.
	slow := time.AfterFunc(30*time.Second, cancelBrowser)
	err = chromedp.Run(browser)
	slow.Stop()
	if err != nil {
		stop()
		return fmt.Errorf("menyalakan browser %s: %w", c.exec, err)
	}
	c.browser, c.stop, c.port = browser, stop, port
	return nil
}

// pageState: event satu tab.
type pageState struct {
	mu       sync.Mutex
	origin   string
	problems []string
	blocked  map[string]bool
	dialogs  []string
	missing  []string
	requests map[network.RequestID]string // id → "METHOD url"
	inflight map[network.RequestID]bool
	lastNet  time.Time
}

func (s *pageState) add(line string) {
	if !slices.Contains(s.problems, line) {
		s.problems = append(s.problems, line)
	}
}

func (s *pageState) external(raw string) (host string, outside bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "data" || u.Scheme == "blob" {
		return "", false
	}
	if strings.HasPrefix(raw, s.origin+"/") || raw == s.origin {
		return "", false
	}
	host = u.Hostname()
	return host, !slices.Contains(allowedHosts, host)
}

// short: URL untuk laporan — path saja bila dari website sendiri.
func (s *pageState) short(raw string) string {
	if rest, ok := strings.CutPrefix(raw, s.origin); ok {
		return rest
	}
	if len(raw) > 150 {
		return raw[:150] + "…"
	}
	return raw
}

func (s *pageState) listen(ev any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e := ev.(type) {
	case *runtime.EventExceptionThrown:
		d := e.ExceptionDetails
		text := d.Text
		if d.Exception != nil && d.Exception.Description != "" {
			text = strings.SplitN(d.Exception.Description, "\n", 2)[0]
		}
		where := ""
		if d.URL != "" {
			where = fmt.Sprintf(" (%s:%d)", s.short(d.URL), d.LineNumber+1)
		}
		s.add("error JavaScript: " + text + where)
	case *runtime.EventConsoleAPICalled:
		if e.Type != runtime.APITypeError && e.Type != runtime.APITypeWarning {
			return
		}
		var parts []string
		for _, a := range e.Args {
			switch {
			case len(a.Value) > 0:
				var str string
				if json.Unmarshal(a.Value, &str) == nil {
					parts = append(parts, str)
				} else {
					parts = append(parts, string(a.Value))
				}
			case a.Description != "":
				parts = append(parts, strings.SplitN(a.Description, "\n", 2)[0])
			}
		}
		text := strings.Join(parts, " ")
		// Pesan bawaan browser untuk setiap HTTP ≥ 400 — sudah dilaporkan beserta URL-nya (EventResponseReceived).
		if strings.HasPrefix(text, "Failed to load resource") {
			return
		}
		if e.Type == runtime.APITypeWarning && !strings.Contains(strings.ToLower(text), "alpine") {
			return
		}
		if len([]rune(text)) > 300 {
			text = string([]rune(text)[:300]) + "…"
		}
		s.add(fmt.Sprintf("console.%s: %s", e.Type, text))
	case *network.EventRequestWillBeSent:
		s.requests[e.RequestID] = e.Request.Method + " " + e.Request.URL
		s.inflight[e.RequestID] = true
		s.lastNet = time.Now()
	case *network.EventResponseReceived:
		// favicon 404 bukan masalah halaman: Chromium memintanya sendiri meski HTML tidak
		// merujuknya, dan project rakit jarang punya favicon. Dicatat sebagai missing (jika
		// gambar) atau diabaikan, tidak pernah masuk Problems.
		isFavicon := strings.HasSuffix(strings.ToLower(e.Response.URL), "/favicon.ico")
		if e.Response.Status == 404 && isFavicon && strings.HasPrefix(e.Response.URL, s.origin+"/") {
			return
		}
		if e.Response.Status == 404 && e.Type == network.ResourceTypeImage && strings.HasPrefix(e.Response.URL, s.origin+"/") {
			if p := s.short(e.Response.URL); !slices.Contains(s.missing, p) {
				s.missing = append(s.missing, p)
			}
			return
		}
		if e.Response.Status >= 400 {
			method, _, _ := strings.Cut(s.requests[e.RequestID], " ")
			s.add(fmt.Sprintf("HTTP %d: %s %s", int(e.Response.Status), method, s.short(e.Response.URL)))
		}
	case *network.EventLoadingFinished:
		delete(s.inflight, e.RequestID)
		s.lastNet = time.Now()
	case *network.EventLoadingFailed:
		delete(s.inflight, e.RequestID)
		s.lastNet = time.Now()
		req := s.requests[e.RequestID]
		method, u, _ := strings.Cut(req, " ")
		if host, outside := s.external(u); outside {
			s.blocked[host] = true
			return
		}
		if e.Canceled || u == "" {
			return
		}
		s.add(fmt.Sprintf("request gagal: %s %s (%s)", method, s.short(u), e.ErrorText))
	}
}

// overflowJS: lebar halaman yang melewati layar dan elemen terlebar penyebabnya.
const overflowJS = `(() => {
  const w = document.documentElement.clientWidth;
  const extra = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - w;
  if (extra <= 2) return null;
  let worst = null, right = w;
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.right > right + 1) { right = r.right; worst = el; }
  }
  let name = '';
  if (worst) {
    name = worst.tagName.toLowerCase() + (worst.id ? '#' + worst.id : '') +
      (typeof worst.className === 'string' && worst.className.trim() ? '.' + worst.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
  }
  return { extra: Math.round(extra), el: name };
})()`

func (c *Checker) checkPage(ctx context.Context, browser context.Context, origin, path string) (Report, error) {
	rep := Report{Path: path}
	tab, closeTab := chromedp.NewContext(browser)
	defer closeTab()
	// Batas waktu & Stop dari job: dihubungkan ke konteks tab (turunan browser, bukan ctx job).
	tctx, cancel := context.WithTimeout(tab, pageTimeout+settleMax+5*time.Second)
	defer cancel()
	stopWatch := context.AfterFunc(ctx, cancel)
	defer stopWatch()

	st := &pageState{origin: origin, blocked: map[string]bool{}, requests: map[network.RequestID]string{},
		inflight: map[network.RequestID]bool{}, lastNet: time.Now()}
	chromedp.ListenTarget(tctx, func(ev any) {
		// Dialog menahan halaman sampai dijawab: tutup otomatis (prompt dijawab kosong), catat di laporan.
		if d, ok := ev.(*page.EventJavascriptDialogOpening); ok {
			go chromedp.Run(tctx, page.HandleJavaScriptDialog(false))
			st.mu.Lock()
			st.dialogs = append(st.dialogs, fmt.Sprintf("%s(%q)", d.Type, d.Message))
			st.mu.Unlock()
			return
		}
		st.listen(ev)
	})
	err := chromedp.Run(tctx,
		network.Enable(),
		runtime.Enable(),
		emulation.SetDeviceMetricsOverride(MobileWidth, mobileHeight, 2, true),
		emulation.SetTouchEmulationEnabled(true),
	)
	if err != nil {
		return rep, c.browserErr(err)
	}
	navCtx, cancelNav := context.WithTimeout(tctx, pageTimeout)
	resp, navErr := chromedp.RunResponse(navCtx, chromedp.Navigate(origin+path))
	cancelNav()
	if resp != nil {
		rep.Status = int(resp.Status)
	}
	if navErr != nil && ctx.Err() == nil && browser.Err() == nil {
		st.mu.Lock()
		st.add("halaman tidak selesai dimuat: " + strings.SplitN(navErr.Error(), "\n", 2)[0])
		st.mu.Unlock()
	}
	if ctx.Err() != nil {
		return rep, ctx.Err()
	}
	if browser.Err() != nil {
		return rep, c.browserErr(browser.Err())
	}
	// Tunggu request susulan (data dari /api/db, komponen Alpine) sampai jaringan tenang.
	deadline := time.Now().Add(settleMax)
	for time.Now().Before(deadline) {
		st.mu.Lock()
		quiet := len(st.inflight) == 0 && time.Since(st.lastNet) >= settleQuiet
		st.mu.Unlock()
		if quiet {
			break
		}
		select {
		case <-time.After(100 * time.Millisecond):
		case <-tctx.Done():
		}
		if tctx.Err() != nil {
			break
		}
	}
	if navErr == nil && rep.Status < 400 {
		var over *struct {
			Extra int    `json:"extra"`
			El    string `json:"el"`
		}
		if err := chromedp.Run(tctx, chromedp.Evaluate(overflowJS, &over)); err == nil && over != nil {
			line := fmt.Sprintf("halaman lebih lebar dari layar HP (%dpx) sebanyak %dpx — pengunjung harus menggeser ke samping", MobileWidth, over.Extra)
			if over.El != "" {
				line += "; elemen paling lebar: " + over.El
			}
			st.mu.Lock()
			st.add(line)
			st.mu.Unlock()
		}
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if rep.Status >= 400 {
		st.problems = slices.DeleteFunc(st.problems, func(p string) bool { return strings.HasSuffix(p, " "+path) })
		st.problems = append([]string{fmt.Sprintf("halaman %s → HTTP %d", path, rep.Status)}, st.problems...)
	}
	rep.Problems, rep.Dialogs, rep.Missing = st.problems, st.dialogs, st.missing
	for host := range st.blocked {
		rep.Blocked = append(rep.Blocked, host)
	}
	sort.Strings(rep.Blocked)
	return rep, nil
}

func (c *Checker) browserErr(err error) error {
	return errors.Join(errors.New("browser pemeriksa berhenti"), err)
}

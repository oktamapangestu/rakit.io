package api

// /api/cloud: hanya di aplikasi desktop (DESKTOP=1). Server lokal menjadi perantara antara editor dan rakit.io
// (cfg.CloudURL, rute /api/sync di sana): login opsional dengan akun rakit.io, daftar project di server, unduh
// project ke komputer, dan publikasikan project lokal ke rakit.io.
//
// Token akun rakit.io dan pasangan project lokal <-> project server disimpan di tabel settings lokal (kunci
// "cloud"); token tidak pernah dikirim ke webview.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"rakit.io/server/internal/bundle"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/i18n"
	"rakit.io/server/internal/store"
	"rakit.io/server/internal/userdb"
)

const cloudKey = "cloud"

// cloudConfig: disimpan di settings lokal.
type cloudConfig struct {
	Server string            `json:"server"`
	Token  string            `json:"token"`
	User   *publicUser       `json:"user,omitempty"`
	Links  map[string]string `json:"links"` // id project lokal -> slug project di server
}

type cloudLogin struct {
	deviceCode string
	UserCode   string    `json:"userCode"`
	VerifyURL  string    `json:"verifyUrl"`
	Expires    time.Time `json:"expiresAt"`
	interval   time.Duration
	cancel     context.CancelFunc
}

// cloudState: login yang sedang menunggu persetujuan di browser.
type cloudState struct {
	mu      sync.Mutex
	pending *cloudLogin
	lastErr string
}

var cloudClient = &http.Client{Timeout: 10 * time.Minute}

func (h *Handler) cloudConfig() *cloudConfig {
	c := &cloudConfig{}
	if raw, ok := h.db.Setting(cloudKey); ok {
		json.Unmarshal([]byte(raw), c)
	}
	if c.Links == nil {
		c.Links = map[string]string{}
	}
	// Server diganti (RAKIT_CLOUD_URL): token & pasangan project lama tidak berlaku.
	if c.Server != h.cfg.CloudURL {
		c = &cloudConfig{Server: h.cfg.CloudURL, Links: map[string]string{}}
	}
	return c
}

func (h *Handler) saveCloud(c *cloudConfig) error {
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	return h.db.SetSetting(cloudKey, string(raw))
}

// errCloudAuth: token ditolak server (dicabut/kedaluwarsa); token lokal dibuang.
// Bukan 401: editor menganggap 401 sebagai sesi lokal berakhir.
var errCloudAuth = &httpx.Error{Status: 409, Code: "cloud_auth", Message: "Sesi akun rakit.io berakhir. Masuk lagi."}

// remote mengirim request ke server rakit. Jawaban bukan 2xx menjadi *httpx.Error dengan pesan dari server.
func (h *Handler) remote(q *request, method, path string, body io.Reader, contentType string, auth bool) (*http.Response, error) {
	req, err := http.NewRequestWithContext(q.r.Context(), method, h.cfg.CloudURL+path, body)
	if err != nil {
		return nil, err
	}
	if f, ok := body.(*os.File); ok {
		if info, err := f.Stat(); err == nil {
			req.ContentLength = info.Size()
		}
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("User-Agent", "rakit-desktop")
	req.AddCookie(&http.Cookie{Name: i18n.Cookie, Value: q.lang()}) // bahasa pesan dari server
	var cfg *cloudConfig
	if auth {
		cfg = h.cloudConfig()
		if cfg.Token == "" {
			return nil, errCloudAuth
		}
		req.Header.Set("Authorization", "Bearer "+cfg.Token)
	}
	res, err := cloudClient.Do(req)
	if err != nil {
		log.Printf("cloud: %s %s: %v", method, path, err)
		return nil, httpx.Errorf(502, "Tidak bisa terhubung ke %s. Periksa koneksi internet.", h.cfg.CloudURL)
	}
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return res, nil
	}
	defer res.Body.Close()
	var out struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&out)
	if res.StatusCode == 401 && auth {
		cfg.Token, cfg.User = "", nil
		h.saveCloud(cfg)
		return nil, errCloudAuth
	}
	if out.Error == "" {
		out.Error = fmt.Sprintf("Server rakit.io menjawab %d", res.StatusCode)
	}
	status := res.StatusCode
	if status >= 500 {
		status = 502
	}
	return nil, &httpx.Error{Status: status, Code: out.Code, Message: out.Error}
}

func (h *Handler) remoteJSON(q *request, method, path string, in any, auth bool, out any) (int, error) {
	var body io.Reader
	ctype := ""
	if in != nil {
		raw, err := json.Marshal(in)
		if err != nil {
			return 0, err
		}
		body, ctype = strings.NewReader(string(raw)), "application/json"
	}
	res, err := h.remote(q, method, path, body, ctype, auth)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if out != nil {
		if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(out); err != nil {
			return 0, httpx.Errorf(502, "Jawaban server rakit.io tidak dikenali")
		}
	}
	return res.StatusCode, nil
}

func (h *Handler) cloudRoutes(q *request) error {
	if !h.cfg.Desktop {
		return errNotFound
	}
	if err := h.requireAuth(q); err != nil {
		return err
	}
	switch {
	case q.is("GET"):
		return q.json(200, h.cloudStatus())
	case q.is("POST", "login"):
		return h.cloudLoginStart(q)
	case q.is("POST", "login", "cancel"):
		h.cloudStopLogin("")
		return q.json(200, h.cloudStatus())
	case q.is("POST", "logout"):
		h.cloudStopLogin("")
		cfg := h.cloudConfig()
		if cfg.Token != "" {
			if _, err := h.remoteJSON(q, "POST", "/api/sync/logout", nil, true, nil); err != nil {
				log.Printf("cloud: keluar di server: %v", err) // token lokal tetap dibuang
			}
		}
		cfg = h.cloudConfig()
		cfg.Token, cfg.User = "", nil
		if err := h.saveCloud(cfg); err != nil {
			return err
		}
		return q.json(200, h.cloudStatus())
	case q.is("GET", "projects"):
		return h.cloudProjects(q)
	case q.is("POST", "projects", ":", "download"):
		return h.cloudDownload(q, strings.ToLower(q.rest[1]))
	case q.is("GET", "link"):
		project, err := h.loadProject(q)
		if err != nil {
			return err
		}
		return q.json(200, map[string]any{"link": h.cloudLink(project)})
	case q.is("POST", "unlink"):
		project, err := h.loadProject(q)
		if err != nil {
			return err
		}
		cfg := h.cloudConfig()
		delete(cfg.Links, strconv.FormatInt(project.ID, 10))
		if err := h.saveCloud(cfg); err != nil {
			return err
		}
		return q.json(200, map[string]any{"link": nil})
	case q.is("POST", "publish"):
		return h.cloudPublish(q)
	}
	return errNotFound
}

// ---------- Status & login ----------

func (h *Handler) cloudStatus() map[string]any {
	cfg := h.cloudConfig()
	out := map[string]any{"server": h.cfg.CloudURL, "connected": cfg.Token != "", "user": cfg.User}
	st := h.cloud
	st.mu.Lock()
	if st.pending != nil {
		out["pending"] = st.pending
	}
	if st.lastErr != "" {
		out["error"] = st.lastErr
	}
	st.mu.Unlock()
	return out
}

func (h *Handler) cloudStopLogin(errMsg string) {
	st := h.cloud
	st.mu.Lock()
	if st.pending != nil {
		st.pending.cancel()
		st.pending = nil
	}
	st.lastErr = errMsg
	st.mu.Unlock()
}

// openBrowser membuka alamat di browser bawaan komputer (server berjalan di komputer pengguna).
func openBrowser(u string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", u)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	default:
		cmd = exec.Command("xdg-open", u)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("cloud: membuka browser: %v", err)
		return
	}
	go cmd.Wait()
}

func (h *Handler) cloudLoginStart(q *request) error {
	var start struct {
		DeviceCode string `json:"deviceCode"`
		UserCode   string `json:"userCode"`
		VerifyURL  string `json:"verifyUrl"`
		ExpiresIn  int    `json:"expiresIn"`
		Interval   int    `json:"interval"`
	}
	host, _ := os.Hostname()
	name := "rakit desktop"
	if host != "" {
		name += " · " + host
	}
	if _, err := h.remoteJSON(q, "POST", "/api/sync/device", map[string]string{"name": name}, false, &start); err != nil {
		return err
	}
	// Hanya buka alamat di server yang dipakai (jawaban server tidak boleh membuka program lain).
	if !strings.HasPrefix(start.VerifyURL, h.cfg.CloudURL+"/") {
		return httpx.Errorf(502, "Jawaban server rakit.io tidak dikenali")
	}
	h.cloudStopLogin("")
	ctx, cancel := context.WithCancel(context.Background())
	login := &cloudLogin{
		deviceCode: start.DeviceCode, UserCode: start.UserCode, VerifyURL: start.VerifyURL,
		Expires: time.Now().Add(time.Duration(start.ExpiresIn) * time.Second), interval: time.Duration(max(start.Interval, 1)) * time.Second,
		cancel: cancel,
	}
	h.cloud.mu.Lock()
	h.cloud.pending = login
	h.cloud.mu.Unlock()
	go h.cloudPoll(ctx, login, q.lang())
	openBrowser(login.VerifyURL)
	return q.json(200, h.cloudStatus())
}

// cloudPoll menunggu pengguna menekan Izinkan di browser, lalu menyimpan tokennya.
func (h *Handler) cloudPoll(ctx context.Context, login *cloudLogin, lang string) {
	finish := func(errMsg string) {
		h.cloud.mu.Lock()
		if h.cloud.pending == login {
			h.cloud.pending = nil
			h.cloud.lastErr = errMsg
		}
		h.cloud.mu.Unlock()
	}
	body, _ := json.Marshal(map[string]string{"deviceCode": login.deviceCode})
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(login.interval):
		}
		if time.Now().After(login.Expires) {
			finish(i18n.T(lang, "Kode login sudah tidak berlaku. Coba masuk lagi."))
			return
		}
		req, _ := http.NewRequestWithContext(ctx, "POST", h.cfg.CloudURL+"/api/sync/device/token", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "rakit-desktop")
		req.AddCookie(&http.Cookie{Name: i18n.Cookie, Value: lang})
		res, err := cloudClient.Do(req)
		if err != nil {
			continue // jaringan putus sebentar: coba lagi sampai kode kedaluwarsa
		}
		var out struct {
			Token string     `json:"token"`
			User  publicUser `json:"user"`
			Error string     `json:"error"`
		}
		json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&out)
		res.Body.Close()
		switch {
		case res.StatusCode == 202:
			continue
		case res.StatusCode == 200 && out.Token != "":
			cfg := h.cloudConfig()
			cfg.Token, cfg.User = out.Token, &out.User
			if err := h.saveCloud(cfg); err != nil {
				finish(err.Error())
				return
			}
			finish("")
			return
		case res.StatusCode == 429 || res.StatusCode >= 500:
			continue
		default:
			if out.Error == "" {
				out.Error = i18n.T(lang, "Kode login sudah tidak berlaku. Coba masuk lagi.")
			}
			finish(out.Error)
			return
		}
	}
}

// ---------- Project ----------

type cloudLinkInfo struct {
	Slug    string `json:"slug"`
	SiteURL string `json:"siteUrl"`
}

// remoteSiteURL: alamat website project di server, dari pola alamat server (https://<slug>.rakit.io).
func (h *Handler) remoteSiteURL(slug string) string {
	u, err := url.Parse(h.cfg.CloudURL)
	if err != nil {
		return ""
	}
	u.Host = slug + "." + u.Host
	return u.String()
}

func (h *Handler) cloudLink(p *store.Project) *cloudLinkInfo {
	cfg := h.cloudConfig()
	slug := cfg.Links[strconv.FormatInt(p.ID, 10)]
	if slug == "" {
		return nil
	}
	return &cloudLinkInfo{Slug: slug, SiteURL: h.remoteSiteURL(slug)}
}

type remoteProjects struct {
	User     publicUser       `json:"user"`
	Projects []map[string]any `json:"projects"`
	Limit    int              `json:"limit"`
}

func (h *Handler) cloudProjects(q *request) error {
	var out remoteProjects
	if _, err := h.remoteJSON(q, "GET", "/api/sync/me", nil, true, &out); err != nil {
		return err
	}
	// Tandai project yang sudah ada di komputer ini.
	local := map[string]string{} // slug server -> slug lokal
	cfg := h.cloudConfig()
	all, err := h.db.ProjectsOf(q.user.ID)
	if err != nil {
		return err
	}
	for _, p := range all {
		if remote := cfg.Links[strconv.FormatInt(p.ID, 10)]; remote != "" {
			local[remote] = p.Slug
		}
	}
	for _, p := range out.Projects {
		slug, _ := p["slug"].(string)
		if l := local[slug]; l != "" {
			p["local"] = l
		}
	}
	if cfg.User == nil || *cfg.User != out.User {
		cfg.User = &out.User
		h.saveCloud(cfg)
	}
	return q.json(200, map[string]any{"user": out.User, "projects": out.Projects, "limit": out.Limit, "server": h.cfg.CloudURL})
}

// cloudDownload membuat project lokal baru dari project di server (file, upload gambar, dan database lengkap).
func (h *Handler) cloudDownload(q *request, remoteSlug string) error {
	cfg := h.cloudConfig()
	all, err := h.db.ProjectsOf(q.user.ID)
	if err != nil {
		return err
	}
	for _, p := range all {
		if cfg.Links[strconv.FormatInt(p.ID, 10)] == remoteSlug {
			return &httpx.Error{Status: 409, Code: "exists", Message: fmt.Sprintf("Project ini sudah ada di komputer (%s)", p.Slug)}
		}
	}
	if len(all) >= h.cfg.MaxProjects {
		return httpx.Errorf(403, "Maksimal %d project per akun. Hapus project lama untuk membuat yang baru.", h.cfg.MaxProjects)
	}
	res, err := h.remote(q, "GET", "/api/sync/projects/"+url.PathEscape(remoteSlug)+"/bundle", nil, "", true)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	limits := h.plans.StorageFor(remoteSlug)
	if err := os.MkdirAll(h.syncTmp(), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(h.syncTmp(), "download-*.zip")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	maxZip := limits.TotalSize + 2*limits.DBBytes + bundleOverhead
	n, err := io.Copy(tmp, io.LimitReader(res.Body, maxZip+1))
	if err != nil {
		return httpx.Errorf(502, "Unduhan dari server rakit.io terputus. Coba lagi.")
	}
	if n > maxZip {
		return httpx.Errorf(413, "Request terlalu besar")
	}
	opened, err := bundle.Read(tmp, n, h.syncTmp(), limits, true, true)
	if err != nil {
		return err
	}
	defer opened.Close()

	name := opened.Meta.Name
	if name == "" {
		name = remoteSlug
	}
	project, err := h.accounts().CreateProject(q.user, remoteSlug, name, q.lang())
	if err != nil {
		var he *httpx.Error
		if errors.As(err, &he) && (he.Status == 409 || he.Status == 403 || he.Status == 400) {
			project, err = h.accounts().CreateProject(q.user, "", name, q.lang()) // alamat acak
		}
		if err != nil {
			return err
		}
	}
	ctx := q.r.Context()
	if err := bundle.Install(opened.Files, h.cfg.SiteRoot(project.Slug), false); err != nil {
		return err
	}
	if opened.DB != "" {
		if err := h.userdb.ReplaceFromFile(ctx, project.Slug, opened.DB); err != nil {
			return err
		}
	}
	cfg = h.cloudConfig()
	cfg.Links[strconv.FormatInt(project.ID, 10)] = remoteSlug
	if err := h.saveCloud(cfg); err != nil {
		return err
	}
	h.versions.Checkpoint(project, q.user.ID, i18n.T(q.lang(), "Diunduh dari rakit.io"))
	return q.json(201, map[string]any{"project": h.public(project), "link": h.cloudLink(project)})
}

// cloudPublish mengirim project lokal (X-Project) ke server: file + struktur tabel. Project yang belum punya
// pasangan di server dibuatkan dulu (alamat pilihan body.slug, atau acak).
func (h *Handler) cloudPublish(q *request) error {
	project, err := h.loadProject(q)
	if err != nil {
		return err
	}
	if err := q.load(); err != nil {
		return err
	}
	cfg := h.cloudConfig()
	if cfg.Token == "" {
		return errCloudAuth
	}
	key := strconv.FormatInt(project.ID, 10)
	remoteSlug := cfg.Links[key]
	created := false
	if remoteSlug == "" {
		var out struct {
			Project struct {
				Slug string `json:"slug"`
			} `json:"project"`
		}
		in := map[string]string{"name": project.Name, "slug": strings.ToLower(strings.TrimSpace(q.text("slug")))}
		if _, err := h.remoteJSON(q, "POST", "/api/sync/projects", in, true, &out); err != nil {
			return err
		}
		remoteSlug, created = out.Project.Slug, true
		cfg = h.cloudConfig()
		cfg.Links[key] = remoteSlug
		if err := h.saveCloud(cfg); err != nil {
			return err
		}
	}

	ctx := q.r.Context()
	tables := []*userdb.TableInfo{}
	if h.userdb.HasDatabase(project.Slug) {
		if tables, err = h.userdb.ListTables(ctx, project.Slug); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(h.syncTmp(), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(h.syncTmp(), "publish-*.zip")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	meta := bundle.Meta{Name: project.Name, Slug: project.Slug, Tables: tables}
	if err := bundle.Write(tmp, meta, h.cfg.SiteRoot(project.Slug), false, ""); err != nil {
		return err
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return err
	}
	res, err := h.remote(q, "PUT", "/api/sync/projects/"+url.PathEscape(remoteSlug)+"/bundle", tmp, "application/zip", true)
	if err != nil {
		var he *httpx.Error
		if errors.As(err, &he) && he.Status == 404 {
			// Project di server sudah dihapus: lepaskan pasangannya, publikasi berikutnya membuat project baru.
			cfg = h.cloudConfig()
			delete(cfg.Links, key)
			h.saveCloud(cfg)
			return &httpx.Error{Status: 409, Code: "unlinked", Message: "Project pasangannya di rakit.io sudah tidak ada. Tekan Publikasikan lagi untuk membuat project baru."}
		}
		return err
	}
	defer res.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&out); err != nil {
		return httpx.Errorf(502, "Jawaban server rakit.io tidak dikenali")
	}
	out["link"] = h.cloudLink(project)
	out["created"] = created
	return q.json(200, out)
}

// Package sites menyajikan website project di <slug>.rakit.io: file .html/.css/.js dan gambar dari
// data/sites/<slug>. Padanan src/sites.js.
package sites

import (
	"crypto/sha256"
	_ "embed"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"

	"rakit.io/server/internal/config"
	"rakit.io/server/internal/files"
	"rakit.io/server/internal/store"
	"rakit.io/server/internal/userdb"
)

// Projects: yang dibutuhkan dari database.
type Projects interface {
	ProjectBySlug(slug string) (*store.Project, error)
}

// Target: versi website yang disajikan untuk satu subdomain.
type Target struct {
	Project *store.Project
	Dev     bool   // <slug>--dev: versi dev project dengan publikasi manual
	Root    string // folder file yang disajikan
	DBKey   string // kunci database untuk /api/db
	Minify  bool   // kirim .html/.css/.js versi minify (lihat minify.go)
}

// Resolve menerjemahkan subdomain ("toko" atau "toko--dev") menjadi versi website yang disajikan.
// nil = tidak ada (project tidak ada, atau versi dev diminta untuk project yang langsung tayang).
func (h *Handler) Resolve(sub string) (*Target, error) {
	slug, dev := strings.CutSuffix(sub, config.DevSuffix)
	p, err := h.projects.ProjectBySlug(slug)
	if err != nil || p == nil || (dev && !p.Manual()) {
		return nil, err
	}
	switch {
	case dev:
		return &Target{Project: p, Dev: true, Root: h.cfg.SiteRoot(slug), DBKey: slug}, nil
	case p.Manual():
		return &Target{Project: p, Root: h.cfg.PublishedRoot(slug), DBKey: userdb.ProdKey(slug), Minify: h.cfg.SiteMinify}, nil
	}
	return &Target{Project: p, Root: h.cfg.SiteRoot(slug), DBKey: slug, Minify: h.cfg.SiteMinify}, nil
}

type Handler struct {
	cfg      *config.Config
	projects Projects
}

func New(cfg *config.Config, projects Projects) *Handler {
	return &Handler{cfg: cfg, projects: projects}
}

// siteFile: file yang akan disajikan. Dibaca lewat open() (files.OpenRegular): symlink tidak pernah disajikan dan
// folder symlink tidak diikuti ke luar root — salinan kerja mode Agen bisa berisi symlink buatan agen.
type siteFile struct {
	root  string
	rel   string
	abs   string // kunci cache minify
	info  os.FileInfo
	ctype string
}

func (f *siteFile) open() (*os.File, error) {
	file, _, err := files.OpenRegular(f.root, f.rel)
	return file, err
}

func (f *siteFile) read() ([]byte, error) { return files.ReadRegular(f.root, f.rel, 0) }

func findFile(root, rel string) *siteFile {
	clean, err := files.CleanPath(rel)
	if err != nil {
		return nil
	}
	ctype := files.ContentType(clean)
	if ctype == "" {
		return nil
	}
	abs, err := files.ResolveIn(root, clean)
	if err != nil {
		return nil
	}
	f, info, err := files.OpenRegular(root, clean)
	if err != nil {
		return nil
	}
	f.Close()
	return &siteFile{root: root, rel: clean, abs: abs, info: info, ctype: ctype}
}

func isDir(root, rel string) bool {
	clean, err := files.CleanPath(rel)
	return err == nil && files.IsDirIn(root, clean)
}

// Pemilih blok untuk preview di editor (lihat picker.js). Hanya disisipkan ke halaman HTML yang dimuat
// di dalam iframe; skripnya diam sampai editor di origin aplikasi mengaktifkannya.
//
//go:embed picker.js
var pickerJS string

func inFrame(r *http.Request) bool { return r.Header.Get("Sec-Fetch-Dest") == "iframe" }

// Penangkap log untuk tab Console di editor (lihat console.js).
//
//go:embed console.js
var consoleJS string

// Alamat skrip sistem di domain website (/api/ di domain website dicadangkan untuk sistem).
const (
	ConsolePath = "/api/_console.js"
	PickerPath  = "/api/_picker.js"
)

var (
	consoleVersion = fmt.Sprintf("%x", sha256.Sum256([]byte(consoleJS)))[:12]
	pickerFileVer  = fmt.Sprintf("%x", sha256.Sum256([]byte(pickerJS)))[:12]
)

// pickerVersion masuk ke ETag halaman versi iframe: tanpanya, setelah server diperbarui browser tetap
// mendapat 304 dan memakai halaman dari cache yang masih membawa skrip pemilih/console lama.
var pickerVersion = fmt.Sprintf("%x", sha256.Sum256([]byte(pickerJS+consoleVersion)))[:12]

// pageETag: ETag file website. picker = versi iframe (disisipi skrip pemilih & console).
func pageETag(info os.FileInfo, picker bool) string {
	if picker {
		return fmt.Sprintf(`W/"%x-%x-p%s"`, info.Size(), info.ModTime().UnixNano(), pickerVersion)
	}
	return fmt.Sprintf(`W/"%x-%x"`, info.Size(), info.ModTime().UnixNano())
}

// IsSystemScript: alamat skrip console/pemilih yang dilayani ServeScript.
func IsSystemScript(path string) bool { return path == ConsolePath || path == PickerPath }

// ServeScript mengirim skrip console atau pemilih. Alamatnya memuat versi isi (?v=), jadi boleh di-cache lama.
func ServeScript(w http.ResponseWriter, r *http.Request) {
	body, version := consoleJS, consoleVersion
	if r.URL.Path == PickerPath {
		body, version = pickerJS, pickerFileVer
	}
	hd := w.Header()
	hd.Set("Content-Type", "text/javascript; charset=utf-8")
	hd.Set("X-Content-Type-Options", "nosniff")
	if r.URL.Query().Get("v") == version {
		hd.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		hd.Set("Cache-Control", "no-cache")
	}
	io.WriteString(w, body)
}

// Tempat skrip sistem: setelah tag pembuka <head>, atau <html>, atau doctype (yang pertama ada, dalam
// urutan itu). Tidak pernah sebelum doctype: browser bisa masuk quirks mode.
var headPositions = []*regexp.Regexp{
	regexp.MustCompile(`(?i)<head(?:\s[^>]*)?>`),
	regexp.MustCompile(`(?i)<html(?:\s[^>]*)?>`),
	regexp.MustCompile(`(?i)<!doctype[^>]*>`),
}

func headEnd(page []byte) int {
	start := page[:min(len(page), 8192)]
	for _, re := range headPositions {
		if loc := re.FindIndex(start); loc != nil {
			return loc[1]
		}
	}
	return 0
}

// withPicker menyisipkan skrip console & pemilih di awal halaman, dalam satu baris (nomor baris error di
// halaman tidak bergeser). Console berjalan paling awal, sebelum skrip website, supaya log-nya ikut
// tertangkap; pemilih memakai defer sehingga baru berjalan setelah seluruh halaman dibaca. Keduanya sengaja
// tidak ditaruh di akhir: HTML yang sedang diketik (mis. "</h" yang belum selesai, <textarea> yang belum
// ditutup) bisa menelan tag <script> di akhir halaman, dan isi skripnya tampil sebagai teks di preview.
func (h *Handler) withPicker(page []byte) []byte {
	app := html.EscapeString(h.cfg.AppOrigin)
	scripts := `<script src="` + ConsolePath + `?v=` + consoleVersion + `" data-app="` + app + `"></script>` +
		`<script defer src="` + PickerPath + `?v=` + pickerFileVer + `" data-app="` + app + `"></script>`
	head := headEnd(page)
	out := make([]byte, 0, len(page)+len(scripts))
	out = append(append(out, page[:head]...), scripts...)
	return append(out, page[head:]...)
}

func (h *Handler) sendFile(w http.ResponseWriter, r *http.Request, target *Target, file *siteFile, status int) {
	picker := strings.HasPrefix(file.ctype, "text/html") && inFrame(r)
	small := !picker && wantMinify(r, target, file)
	etag := pageETag(file.info, picker)
	if small {
		etag = strings.TrimSuffix(etag, `"`) + `-m"`
	}
	hd := w.Header()
	hd.Set("Content-Type", file.ctype)
	hd.Set("Cache-Control", "no-cache") // selalu revalidasi, supaya preview langsung ter-update
	hd.Set("ETag", etag)
	hd.Set("X-Content-Type-Options", "nosniff")
	if strings.HasPrefix(file.ctype, "text/html") {
		hd.Set("Vary", "Sec-Fetch-Dest") // versi iframe (dengan pemilih blok) beda dari versi biasa
	}
	if picker && target.Minify {
		setPreviewCookie(w)
	}
	if status == http.StatusOK && r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if small {
		if body, ok := minifiedFile(file); ok {
			hd.Set("Content-Length", strconv.Itoa(len(body)))
			w.WriteHeader(status)
			if r.Method != http.MethodHead {
				w.Write(body)
			}
			return
		}
	}
	if picker {
		page, err := file.read()
		if err != nil {
			http.Error(w, "Not found", http.StatusNotFound)
			return
		}
		page = h.withPicker(page)
		hd.Set("Content-Length", strconv.Itoa(len(page)))
		w.WriteHeader(status)
		if r.Method != http.MethodHead {
			w.Write(page)
		}
		return
	}
	f, err := file.open()
	if err != nil {
		// File terhapus di antara pengecekan dan pembacaan.
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	hd.Set("Content-Length", strconv.FormatInt(file.info.Size(), 10))
	w.WriteHeader(status)
	if r.Method == http.MethodHead {
		return
	}
	io.CopyN(w, f, file.info.Size())
}

const notFoundTemplate = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>%s</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff8e7;color:#5a5347;
       font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px;box-sizing:border-box}
  main{text-align:center;max-width:420px}
  h1{display:inline-block;font-size:64px;line-height:1;margin:0 0 8px;color:#1a1320;font-family:ui-monospace,Menlo,monospace;
     background:linear-gradient(transparent 60%%,#ffca54 60%%);padding:0 .1em}
  strong{color:#1a1320}
  a{display:inline-block;margin-top:4px;padding:10px 18px;border-radius:10px;background:#ffca54;color:#17150e;font-weight:700;text-decoration:none}
  a:hover{background:#ffd97e}
</style></head>
<body><main><h1>404</h1><p><strong>%s</strong><br>%s</p>
<p><a href="%s">Buat website gratis di %s</a></p></main></body></html>`

func (h *Handler) notFoundPage(w http.ResponseWriter, r *http.Request, title, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	if r.Method != http.MethodHead {
		fmt.Fprintf(w, notFoundTemplate, title, title, message, h.cfg.AppOrigin, h.cfg.BaseDomain)
	}
}

var stripUnsafe = strings.NewReplacer("<", "", ">", "", "&", "", `"`, "")

// Serve menyajikan satu request untuk website di subdomain `sub` (mis. "toko" atau "toko--dev").
func (h *Handler) Serve(w http.ResponseWriter, r *http.Request, sub string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	target, err := h.Resolve(sub)
	if err != nil {
		log.Printf("sites: cek project %q: %v", sub, err)
		http.Error(w, "Terjadi kesalahan di server", http.StatusInternalServerError)
		return
	}
	if target == nil {
		if slug, dev := strings.CutSuffix(sub, config.DevSuffix); dev {
			h.notFoundPage(w, r, "Versi dev tidak aktif", h.cfg.SiteHost(slug)+" tidak memakai publikasi manual.")
		} else {
			h.notFoundPage(w, r, "Situs tidak ditemukan", h.cfg.SiteHost(sub)+" belum dipakai siapa pun.")
		}
		return
	}
	h.ServeTarget(w, r, target)
}

// ServeTarget menyajikan file website dari target.Root — juga dipakai mode Agen untuk menyajikan salinan kerja agen.
func (h *Handler) ServeTarget(w http.ResponseWriter, r *http.Request, target *Target) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if target.Dev {
		// Versi dev (draft) jangan sampai diindeks mesin pencari.
		w.Header().Set("X-Robots-Tag", "noindex")
	}

	root := target.Root
	pathname, err := decodedPathname(r.URL.EscapedPath())
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	rel := strings.TrimLeft(pathname, "/")
	if rel == "" || strings.HasSuffix(rel, "/") {
		rel += "index.html"
	}
	// Kode fungsi serverless tidak pernah disajikan sebagai file (isinya logika & pemanggilan rahasia).
	if hidden(rel) {
		h.notFoundPage(w, r, "Halaman tidak ditemukan", "File <code>"+stripUnsafe.Replace(pathname)+"</code> tidak ada.")
		return
	}

	file := findFile(root, rel)
	// URL bersih: /about -> about.html
	if file == nil && path.Ext(rel) == "" {
		file = findFile(root, rel+".html")
	}
	if file != nil {
		h.sendFile(w, r, target, file, http.StatusOK)
		return
	}

	if !strings.HasSuffix(pathname, "/") && isDir(root, rel) {
		location := (&url.URL{Path: pathname + "/"}).EscapedPath()
		http.Redirect(w, r, location, http.StatusMovedPermanently)
		return
	}
	if custom := findFile(root, "404.html"); custom != nil {
		h.sendFile(w, r, target, custom, http.StatusNotFound)
		return
	}
	h.notFoundPage(w, r, "Halaman tidak ditemukan", "File <code>"+stripUnsafe.Replace(pathname)+"</code> tidak ada.")
}

// ResolvePage: file HTML yang disajikan untuk pathname halaman di website project (mis. "/" ->
// index.html, "/about" -> about.html), sama seperti Serve; "" bila bukan halaman HTML yang ada.
func (h *Handler) ResolvePage(slug, pathname string) string {
	root := h.cfg.SiteRoot(slug)
	pathname, err := decodedPathname((&url.URL{Path: pathname}).EscapedPath())
	if err != nil {
		return ""
	}
	rel := strings.TrimLeft(pathname, "/")
	if rel == "" || strings.HasSuffix(rel, "/") {
		rel += "index.html"
	}
	file := findFile(root, rel)
	if file == nil && path.Ext(rel) == "" {
		file, rel = findFile(root, rel+".html"), rel+".html"
	}
	if file == nil || !strings.HasPrefix(file.ctype, "text/html") {
		return ""
	}
	clean, err := files.CleanPath(rel)
	if err != nil {
		return ""
	}
	return clean
}

// hidden: folder functions/ (lihat internal/fn) tidak disajikan. Dibandingkan tanpa membedakan huruf
// besar/kecil, supaya tidak lolos di sistem file yang tidak peka huruf (mis. macOS).
func hidden(rel string) bool {
	rel = strings.ToLower(rel)
	return rel == "functions" || strings.HasPrefix(rel, "functions/")
}

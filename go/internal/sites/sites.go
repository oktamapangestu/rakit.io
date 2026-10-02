// Package sites menyajikan website project di <slug>.rakit.io: file .html/.css/.js dan gambar dari
// data/sites/<slug>. Padanan src/sites.js.
package sites

import (
	"bytes"
	_ "embed"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
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
		return &Target{p, true, h.cfg.SiteRoot(slug), slug}, nil
	case p.Manual():
		return &Target{p, false, h.cfg.PublishedRoot(slug), userdb.ProdKey(slug)}, nil
	}
	return &Target{p, false, h.cfg.SiteRoot(slug), slug}, nil
}

type Handler struct {
	cfg      *config.Config
	projects Projects
}

func New(cfg *config.Config, projects Projects) *Handler {
	return &Handler{cfg: cfg, projects: projects}
}

type siteFile struct {
	abs   string
	info  os.FileInfo
	ctype string
}

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
	// Lstat: symlink tidak pernah disajikan.
	info, err := os.Lstat(abs)
	if err != nil || !info.Mode().IsRegular() {
		return nil
	}
	return &siteFile{abs: abs, info: info, ctype: ctype}
}

func isDir(root, rel string) bool {
	clean, err := files.CleanPath(rel)
	if err != nil {
		return false
	}
	abs, err := files.ResolveIn(root, clean)
	if err != nil {
		return false
	}
	info, err := os.Lstat(abs)
	return err == nil && info.IsDir()
}

// Pemilih blok untuk preview di editor (lihat picker.js). Hanya disisipkan ke halaman HTML yang dimuat
// di dalam iframe; skripnya diam sampai editor di origin aplikasi mengaktifkannya.
//
//go:embed picker.js
var pickerJS string

func inFrame(r *http.Request) bool { return r.Header.Get("Sec-Fetch-Dest") == "iframe" }

// withPicker menyisipkan skrip pemilih sebelum </body> terakhir (atau di akhir dokumen).
func (h *Handler) withPicker(page []byte) []byte {
	tag := []byte(`<script data-app="` + html.EscapeString(h.cfg.AppOrigin) + `">` + pickerJS + `</script>`)
	at := bytes.LastIndex(bytes.ToLower(page), []byte("</body>"))
	if at < 0 {
		return append(page, tag...)
	}
	out := make([]byte, 0, len(page)+len(tag))
	return append(append(append(out, page[:at]...), tag...), page[at:]...)
}

func (h *Handler) sendFile(w http.ResponseWriter, r *http.Request, file *siteFile, status int) {
	picker := strings.HasPrefix(file.ctype, "text/html") && inFrame(r)
	etag := fmt.Sprintf(`W/"%x-%x"`, file.info.Size(), file.info.ModTime().UnixNano())
	if picker {
		etag = fmt.Sprintf(`W/"%x-%x-p"`, file.info.Size(), file.info.ModTime().UnixNano())
	}
	hd := w.Header()
	hd.Set("Content-Type", file.ctype)
	hd.Set("Cache-Control", "no-cache") // selalu revalidasi, supaya preview langsung ter-update
	hd.Set("ETag", etag)
	hd.Set("X-Content-Type-Options", "nosniff")
	if strings.HasPrefix(file.ctype, "text/html") {
		hd.Set("Vary", "Sec-Fetch-Dest") // versi iframe (dengan pemilih blok) beda dari versi biasa
	}
	if status == http.StatusOK && r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if picker {
		page, err := os.ReadFile(file.abs)
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
	f, err := os.Open(file.abs)
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
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1117;color:#c9d1d9;
       font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px;box-sizing:border-box}
  main{text-align:center;max-width:420px}
  h1{font-size:64px;margin:0;color:#58a6ff;font-family:ui-monospace,Menlo,monospace}
  a{color:#58a6ff}
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
		h.sendFile(w, r, file, http.StatusOK)
		return
	}

	if !strings.HasSuffix(pathname, "/") && isDir(root, rel) {
		location := (&url.URL{Path: pathname + "/"}).EscapedPath()
		http.Redirect(w, r, location, http.StatusMovedPermanently)
		return
	}
	if custom := findFile(root, "404.html"); custom != nil {
		h.sendFile(w, r, custom, http.StatusNotFound)
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

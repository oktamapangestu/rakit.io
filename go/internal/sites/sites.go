// Package sites menyajikan website project di <slug>.rakit.icu: file .html/.css/.js dan gambar dari
// data/sites/<slug>. Padanan src/sites.js.
package sites

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"

	"rakit.icu/server/internal/config"
)

// Projects: yang dibutuhkan dari database.
type Projects interface {
	ProjectExists(slug string) (bool, error)
}

type Handler struct {
	cfg      *config.Config
	projects Projects
}

func New(cfg *config.Config, projects Projects) *Handler {
	return &Handler{cfg: cfg, projects: projects}
}

type siteFile struct {
	abs  string
	info os.FileInfo
	ext  string
}

func findFile(root, rel string) *siteFile {
	clean, err := cleanPath(rel)
	if err != nil {
		return nil
	}
	ext := extOf(clean)
	if _, ok := mimeTypes[ext]; !ok {
		return nil
	}
	abs, err := resolveIn(root, clean)
	if err != nil {
		return nil
	}
	// Lstat: symlink tidak pernah disajikan.
	info, err := os.Lstat(abs)
	if err != nil || !info.Mode().IsRegular() {
		return nil
	}
	return &siteFile{abs: abs, info: info, ext: ext}
}

func isDir(root, rel string) bool {
	clean, err := cleanPath(rel)
	if err != nil {
		return false
	}
	abs, err := resolveIn(root, clean)
	if err != nil {
		return false
	}
	info, err := os.Lstat(abs)
	return err == nil && info.IsDir()
}

func sendFile(w http.ResponseWriter, r *http.Request, file *siteFile, status int) {
	etag := fmt.Sprintf(`W/"%x-%x"`, file.info.Size(), file.info.ModTime().UnixNano())
	h := w.Header()
	h.Set("Content-Type", mimeTypes[file.ext])
	h.Set("Cache-Control", "no-cache") // selalu revalidasi, supaya preview langsung ter-update
	h.Set("ETag", etag)
	h.Set("X-Content-Type-Options", "nosniff")
	if status == http.StatusOK && r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	f, err := os.Open(file.abs)
	if err != nil {
		// File terhapus di antara pengecekan dan pembacaan.
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	h.Set("Content-Length", strconv.FormatInt(file.info.Size(), 10))
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

// Serve menyajikan satu request untuk website project `slug`.
func (h *Handler) Serve(w http.ResponseWriter, r *http.Request, slug string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	exists, err := h.projects.ProjectExists(slug)
	if err != nil {
		log.Printf("sites: cek project %q: %v", slug, err)
		http.Error(w, "Terjadi kesalahan di server", http.StatusInternalServerError)
		return
	}
	if !exists {
		h.notFoundPage(w, r, "Situs tidak ditemukan", h.cfg.SiteHost(slug)+" belum dipakai siapa pun.")
		return
	}

	root := h.cfg.SiteRoot(slug)
	pathname, err := decodedPathname(r.URL.EscapedPath())
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	rel := strings.TrimLeft(pathname, "/")
	if rel == "" || strings.HasSuffix(rel, "/") {
		rel += "index.html"
	}

	file := findFile(root, rel)
	// URL bersih: /about -> about.html
	if file == nil && path.Ext(rel) == "" {
		file = findFile(root, rel+".html")
	}
	if file != nil {
		sendFile(w, r, file, http.StatusOK)
		return
	}

	if !strings.HasSuffix(pathname, "/") && isDir(root, rel) {
		location := (&url.URL{Path: pathname + "/"}).EscapedPath()
		http.Redirect(w, r, location, http.StatusMovedPermanently)
		return
	}
	if custom := findFile(root, "404.html"); custom != nil {
		sendFile(w, r, custom, http.StatusNotFound)
		return
	}
	h.notFoundPage(w, r, "Halaman tidak ditemukan", "File <code>"+stripUnsafe.Replace(pathname)+"</code> tidak ada.")
}

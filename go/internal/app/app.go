// Package app menyajikan halaman aplikasi (/, /editor, /admin, /panduan) dan aset statis di domain
// utama. Padanan bagian halaman di src/server.js.
package app

import (
	"bytes"
	"compress/gzip"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"rakit.io/server/internal/auth"
	"rakit.io/server/internal/config"
)

type Handler struct {
	cfg  *config.Config
	auth *auth.Auth

	mu       sync.Mutex
	versions map[string]assetVersion // path relatif aset -> hash isi
	gz       map[string][]byte       // kunci (path + versi) -> isi ter-gzip, supaya tiap versi cukup dikompres sekali
}

type assetVersion struct {
	modTime time.Time
	hash    string
}

func New(cfg *config.Config, a *auth.Auth) *Handler {
	return &Handler{cfg: cfg, auth: a, versions: map[string]assetVersion{}}
}

// Cache-busting aset: hash dihitung dari isi berkas, di-cache di memori, dan dihitung ulang saat
// berkas berubah (mtime). Dengan begitu aset boleh di-cache immutable 1 tahun.
func (h *Handler) assetVersion(rel string) string {
	abs := filepath.Join(h.cfg.PublicDir, filepath.FromSlash(rel))
	info, err := os.Stat(abs)
	if err != nil {
		return ""
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if cached, ok := h.versions[rel]; ok && cached.modTime.Equal(info.ModTime()) {
		return cached.hash
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return ""
	}
	sum := sha1.Sum(data)
	hash := hex.EncodeToString(sum[:])[:10]
	h.versions[rel] = assetVersion{modTime: info.ModTime(), hash: hash}
	return hash
}

// Referensi aset lokal di /js/..., /css/..., dan /logo.svg (tanpa protokol/host), di dalam tanda kutip.
var assetRefRE = regexp.MustCompile(`(["'])/((?:js|css)/[^"'?#]+|logo\.svg)(?:[?#][^"']*)?(["'])`)

// withAssetVersions mengubah /js/editor.js menjadi /js/editor.js?v=ab12cd34ef.
func (h *Handler) withAssetVersions(html []byte) []byte {
	return assetRefRE.ReplaceAllFunc(html, func(m []byte) []byte {
		g := assetRefRE.FindSubmatch(m)
		if !bytes.Equal(g[1], g[3]) {
			return m
		}
		v := h.assetVersion(string(g[2]))
		if v == "" {
			return m
		}
		return []byte(fmt.Sprintf("%s/%s?v=%s%s", g[1], g[2], v, g[1]))
	})
}

// Teks (HTML, JS, CSS, SVG, JSON) dikirim ter-gzip bila browser mendukungnya: editor.js & editor.css
// mengecil ±70%. Berkas kecil tidak sepadan dikompres.
const gzipMin = 1024

func compressible(ctype string) bool {
	return strings.HasPrefix(ctype, "text/") || strings.Contains(ctype, "javascript") || strings.Contains(ctype, "json") || strings.Contains(ctype, "svg")
}

func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		if name, params, _ := strings.Cut(strings.TrimSpace(part), ";"); strings.EqualFold(strings.TrimSpace(name), "gzip") {
			q := strings.ReplaceAll(params, " ", "")
			return q != "q=0" && q != "q=0.0" // "gzip;q=0" = ditolak
		}
	}
	return false
}

// gzipped mengembalikan data ter-gzip dari cache (kunci harus berubah bila isi berubah).
func (h *Handler) gzipped(key string, data []byte) []byte {
	h.mu.Lock()
	out, ok := h.gz[key]
	h.mu.Unlock()
	if ok {
		return out
	}
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	zw.Write(data)
	zw.Close()
	out = buf.Bytes()
	h.mu.Lock()
	if h.gz == nil || len(h.gz) > 256 { // versi lama tidak dipakai lagi: buang semuanya sesekali
		h.gz = map[string][]byte{}
	}
	h.gz[key] = out
	h.mu.Unlock()
	return out
}

// serveBytes: kirim isi (ter-gzip bila bisa) dengan ETag yang berbeda per encoding.
func (h *Handler) serveBytes(w http.ResponseWriter, r *http.Request, key, etag string, mod time.Time, data []byte) {
	w.Header().Add("Vary", "Accept-Encoding")
	if len(data) >= gzipMin && compressible(w.Header().Get("Content-Type")) && acceptsGzip(r) {
		data = h.gzipped(key, data)
		w.Header().Set("Content-Encoding", "gzip")
		etag = strings.TrimSuffix(etag, `"`) + `-gz"`
	}
	w.Header().Set("ETag", etag)
	http.ServeContent(w, r, "", mod, bytes.NewReader(data))
}

func securityHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("X-Frame-Options", "DENY")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
}

func (h *Handler) sendHTML(w http.ResponseWriter, r *http.Request, file, cacheControl string) {
	raw, err := os.ReadFile(filepath.Join(h.cfg.PublicDir, file))
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	html := h.withAssetVersions(raw)
	sum := sha1.Sum(html)
	etag := `W/"` + hex.EncodeToString(sum[:])[:27] + `"`
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", cacheControl)
	h.serveBytes(w, r, file+"@"+etag, etag, time.Time{}, html)
}

func redirect(w http.ResponseWriter, r *http.Request, to string) {
	http.Redirect(w, r, to, http.StatusFound)
}

var contentTypes = map[string]string{
	".html": "text/html; charset=utf-8",
	".css":  "text/css; charset=utf-8",
	".js":   "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg":  "image/svg+xml",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".ico":  "image/x-icon",
	".webp": "image/webp",
	".txt":  "text/plain; charset=utf-8",
}

// serveStatic menyajikan berkas dari public/ bila ada. false = bukan aset; biarkan penanganan berikutnya.
func (h *Handler) serveStatic(w http.ResponseWriter, r *http.Request) bool {
	p := r.URL.Path
	// Path yang tidak rapi (.., //, dotfile, \) tidak pernah disajikan dari sini.
	if !strings.HasPrefix(p, "/") || path.Clean(p) != p || strings.Contains(p, "/.") || strings.ContainsAny(p, "\\\x00") {
		return false
	}
	abs := filepath.Join(h.cfg.PublicDir, filepath.FromSlash(p))
	info, err := os.Stat(abs)
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	ext := strings.ToLower(path.Ext(p))
	ctype := contentTypes[ext]
	if ctype == "" {
		if ctype = mime.TypeByExtension(ext); ctype == "" {
			ctype = "application/octet-stream"
		}
	}
	securityHeaders(w)
	w.Header().Set("Content-Type", ctype)
	// Nama berkas ber-versi (?v=hash) dari sendHTML, jadi aman di-cache panjang + immutable.
	// HTML tetap no-cache agar selalu segar.
	if ext == ".html" {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	etag := fmt.Sprintf(`W/"%x-%x"`, info.Size(), info.ModTime().UnixMilli())
	if compressible(ctype) && info.Size() >= gzipMin && acceptsGzip(r) {
		data, err := os.ReadFile(abs)
		if err != nil {
			return false
		}
		h.serveBytes(w, r, p+"@"+etag, etag, info.ModTime(), data)
		return true
	}
	f, err := os.Open(abs)
	if err != nil {
		return false
	}
	defer f.Close()
	w.Header().Add("Vary", "Accept-Encoding")
	w.Header().Set("ETag", etag)
	http.ServeContent(w, r, "", info.ModTime(), f)
	return true
}

// NotFound: jawaban untuk path di domain utama yang bukan halaman, aset, maupun API.
func (h *Handler) NotFound(w http.ResponseWriter) {
	securityHeaders(w)
	http.Error(w, "Not found", http.StatusNotFound)
}

// Serve menangani halaman & aset di domain utama. false = tidak ada halaman/aset untuk request ini.
func (h *Handler) Serve(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	// Seperti router Express: tidak peka huruf besar/kecil dan garis miring di akhir.
	route := strings.ToLower(r.URL.Path)
	if len(route) > 1 {
		route = strings.TrimSuffix(route, "/")
	}
	switch route {
	case "/":
		securityHeaders(w)
		if h.auth.User(r) != nil {
			redirect(w, r, "/editor")
		} else {
			h.sendHTML(w, r, "index.html", "no-cache")
		}
	case "/editor":
		securityHeaders(w)
		if h.auth.User(r) == nil {
			redirect(w, r, "/")
		} else {
			h.sendHTML(w, r, "editor.html", "no-store")
		}
	case "/admin":
		securityHeaders(w)
		user := h.auth.User(r)
		switch {
		case user == nil:
			redirect(w, r, "/")
		case !h.cfg.IsAdmin(user.Email):
			redirect(w, r, "/editor")
		default:
			h.sendHTML(w, r, "admin.html", "no-store")
		}
	case "/panduan":
		// Panduan publik: dokumentasi fitur & cheat sheet prompt untuk AI Builder (tanpa perlu login).
		securityHeaders(w)
		h.sendHTML(w, r, "panduan.html", "public, max-age=3600")
	default:
		return h.serveStatic(w, r)
	}
	return true
}

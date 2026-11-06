// Package desktop: mode aplikasi desktop (DESKTOP=1, lihat desktop/ di akar repo). Server berjalan di komputer
// pengguna sebagai sidecar aplikasi Tauri: hanya mendengarkan 127.0.0.1, satu akun lokal, project disimpan di
// folder data aplikasi, dan AI memakai AI pribadi pengguna (tab Provider AI).
//
//   - GET /desktop/start?token=…: aplikasi membuka alamat ini sekali saat menyala. Token acak dari aplikasi
//     (DESKTOP_TOKEN) mencegah halaman lain di komputer yang sama masuk ke akun lokal. Akun "lokal" dibuat bila
//     belum ada, sesi dipasang, lalu dialihkan ke editor.
//   - Proxy: webview macOS tidak mengenal <slug>.localhost, jadi aplikasi mengarahkan webview ke server ini
//     sebagai proxy HTTP. Request ke host rakit (localhost, *.localhost) dilayani biasa; host lain (CDN Monaco,
//     font, API) diteruskan apa adanya, termasuk HTTPS lewat CONNECT.
package desktop

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"rakit.io/server/internal/accounts"
	"rakit.io/server/internal/auth"
	"rakit.io/server/internal/config"
	"rakit.io/server/internal/i18n"
	"rakit.io/server/internal/store"
)

// LocalUser: username akun lokal di aplikasi desktop (project pertamanya = lokal.localhost).
const LocalUser = "lokal"

type Handler struct {
	cfg  *config.Config
	db   *store.Store
	auth *auth.Auth
}

func New(cfg *config.Config, db *store.Store, a *auth.Auth) *Handler {
	return &Handler{cfg: cfg, db: db, auth: a}
}

// Matches: path masuk otomatis aplikasi desktop.
func Matches(path string) bool { return path == "/desktop/start" }

// Start memasukkan aplikasi ke akun lokal.
func (h *Handler) Start(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if h.cfg.DesktopToken == "" || subtle.ConstantTimeCompare([]byte(token), []byte(h.cfg.DesktopToken)) != 1 {
		http.Error(w, "Token aplikasi desktop tidak valid", http.StatusForbidden)
		return
	}
	user, err := h.localUser(r)
	if err != nil {
		log.Printf("desktop: menyiapkan akun lokal: %v", err)
		http.Error(w, "Gagal menyiapkan akun lokal", http.StatusInternalServerError)
		return
	}
	if err := h.auth.Login(w, user.ID); err != nil {
		http.Error(w, "Gagal masuk", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, i18n.Path(i18n.FromRequest(r), "/editor"), http.StatusFound)
}

func (h *Handler) localUser(r *http.Request) (*store.User, error) {
	if u, err := h.db.UserByUsername(LocalUser); err != nil || u != nil {
		return u, err
	}
	b := make([]byte, 24)
	rand.Read(b)
	hash, err := auth.HashPassword(hex.EncodeToString(b)) // tidak dipakai: masuk selalu lewat token aplikasi
	if err != nil {
		return nil, err
	}
	id, err := h.db.InsertUser(LocalUser, LocalUser+"@desktop.local", hash)
	if err != nil {
		return nil, err
	}
	user := &store.User{ID: id, Username: LocalUser, Email: LocalUser + "@desktop.local"}
	if _, err := accounts.New(h.cfg, h.db).CreateProject(user, LocalUser, "Project pertama", i18n.FromRequest(r)); err != nil {
		return nil, err
	}
	return user, nil
}

// ---------- Proxy (webview macOS) ----------

// ours: host:port yang dilayani server ini sendiri (localhost / *.localhost di port server). Host yang sama di port
// lain, mis. Ollama di localhost:11434, diteruskan seperti host luar.
func (h *Handler) ours(hostport string) bool {
	host, port, err := net.SplitHostPort(strings.ToLower(hostport))
	if err != nil {
		host, port = strings.ToLower(hostport), "80"
	}
	return port == h.cfg.Port && (host == h.cfg.BaseDomain || strings.HasSuffix(host, "."+h.cfg.BaseDomain))
}

// ServeProxy menangani request proxy ke host luar; false = request biasa (dilayani handler utama).
func (h *Handler) ServeProxy(w http.ResponseWriter, r *http.Request) bool {
	switch {
	case r.Method == http.MethodConnect:
		if h.ours(r.Host) {
			http.Error(w, "CONNECT ke server sendiri tidak didukung", http.StatusBadRequest)
			return true
		}
		h.tunnel(w, r)
		return true
	case r.URL.IsAbs() && !h.ours(r.URL.Host):
		h.forward(w, r)
		return true
	}
	return false
}

// tunnel: HTTPS lewat CONNECT — sambungkan dua arah tanpa membaca isinya.
func (h *Handler) tunnel(w http.ResponseWriter, r *http.Request) {
	dst, err := net.DialTimeout("tcp", r.Host, 15*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		dst.Close()
		http.Error(w, "proxy tidak didukung", http.StatusInternalServerError)
		return
	}
	src, buf, err := hj.Hijack()
	if err != nil {
		dst.Close()
		return
	}
	src.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))
	go func() {
		if buf.Reader.Buffered() > 0 {
			io.CopyN(dst, buf, int64(buf.Reader.Buffered()))
		}
		io.Copy(dst, src)
		dst.Close()
	}()
	io.Copy(src, dst)
	src.Close()
}

var hopHeaders = []string{"Connection", "Proxy-Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization", "Te", "Trailer", "Transfer-Encoding", "Upgrade"}

var proxyClient = &http.Client{
	Timeout:       2 * time.Minute,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// forward: HTTP biasa ke host luar.
func (h *Handler) forward(w http.ResponseWriter, r *http.Request) {
	out, err := http.NewRequestWithContext(r.Context(), r.Method, r.URL.String(), r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	out.Header = r.Header.Clone()
	for _, k := range hopHeaders {
		out.Header.Del(k)
	}
	res, err := proxyClient.Do(out)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer res.Body.Close()
	for _, k := range hopHeaders {
		res.Header.Del(k)
	}
	for k, v := range res.Header {
		w.Header()[k] = v
	}
	w.WriteHeader(res.StatusCode)
	io.Copy(w, res.Body)
}

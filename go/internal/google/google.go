// Package google: masuk/daftar dengan Google (OAuth 2.0 authorization code + PKCE).
// Di Google Cloud Console, daftarkan redirect URI: <APP_ORIGIN>/auth/google/callback
// Padanan src/google.js.
package google

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"rakit.io/server/internal/accounts"
	"rakit.io/server/internal/auth"
	"rakit.io/server/internal/config"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/store"
)

const (
	authURL = "https://accounts.google.com/o/oauth2/v2/auth"
	flowTTL = 10 * time.Minute
)

type Handler struct {
	cfg      *config.Config
	db       *store.Store
	auth     *auth.Auth
	accounts *accounts.Service
	limiter  *httpx.RateLimiter
	cookie   string
}

func New(cfg *config.Config, db *store.Store, a *auth.Auth) *Handler {
	cookie := "rakit_oauth"
	if cfg.SecureCookies {
		cookie = "__Host-rakit_oauth"
	}
	return &Handler{cfg: cfg, db: db, auth: a, accounts: accounts.New(cfg, db), limiter: httpx.NewRateLimiter(15*time.Minute, 60, ""), cookie: cookie}
}

// Matches: /auth/google dan semua di bawahnya.
func Matches(p string) bool {
	const prefix = "/auth/google"
	return len(p) >= len(prefix) && strings.EqualFold(p[:len(prefix)], prefix) && (len(p) == len(prefix) || p[len(prefix)] == '/')
}

func (h *Handler) redirectURI() string { return h.cfg.AppOrigin + "/auth/google/callback" }

func randomB64(n int) string {
	buf := make([]byte, n)
	rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)
}

// Seperti encodeURIComponent: spasi menjadi %20.
func encodeComponent(s string) string { return strings.ReplaceAll(url.QueryEscape(s), "+", "%20") }

func fail(w http.ResponseWriter, r *http.Request, message string) {
	http.Redirect(w, r, "/?error="+encodeComponent(message), http.StatusFound)
}

func (h *Handler) flowCookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{Name: h.cookie, Value: value, Path: "/", HttpOnly: true, Secure: h.cfg.SecureCookies, SameSite: http.SameSiteLaxMode, MaxAge: maxAge}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	hd := w.Header()
	hd.Set("X-Frame-Options", "DENY")
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	if !h.limiter.Allow(w, httpx.ClientIP(r)) {
		return
	}
	isGet := r.Method == http.MethodGet || r.Method == http.MethodHead
	switch rest := strings.ToLower(strings.TrimSuffix(r.URL.Path[len("/auth/google"):], "/")); {
	case isGet && rest == "":
		h.start(w, r)
	case isGet && rest == "/callback":
		h.callback(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (h *Handler) start(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.GoogleEnabled {
		fail(w, r, "Login dengan Google belum diaktifkan")
		return
	}
	state, verifier := randomB64(24), randomB64(32)
	challenge := sha256.Sum256([]byte(verifier))
	// Cookie Lax ikut terkirim saat Google mengarahkan kembali (navigasi GET tingkat atas).
	c := h.flowCookie(state+"."+verifier, int(flowTTL.Seconds()))
	c.Expires = time.Now().Add(flowTTL)
	http.SetCookie(w, c)
	params := url.Values{
		"client_id":             {h.cfg.GoogleClientID},
		"redirect_uri":          {h.redirectURI()},
		"response_type":         {"code"},
		"scope":                 {"openid email profile"},
		"state":                 {state},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(challenge[:])},
		"code_challenge_method": {"S256"},
		"prompt":                {"select_account"},
	}
	http.Redirect(w, r, authURL+"?"+params.Encode(), http.StatusFound)
}

func randomInt(min, max int64) int64 {
	n, _ := rand.Int(rand.Reader, big.NewInt(max-min))
	return min + n.Int64()
}

var (
	notSlugRE   = regexp.MustCompile(`[^a-z0-9-]+`)
	dashesRE    = regexp.MustCompile(`-+`)
	edgeDashRE  = regexp.MustCompile(`^-|-$`)
	trailDashRE = regexp.MustCompile(`-$`)
)

// usernameFromEmail: username otomatis dari email (juga jadi subdomain project pertama), dibuat unik bila perlu.
func (h *Handler) usernameFromEmail(email string) (string, error) {
	base := strings.ToLower(strings.SplitN(email, "@", 2)[0])
	base = edgeDashRE.ReplaceAllString(dashesRE.ReplaceAllString(notSlugRE.ReplaceAllString(base, "-"), "-"), "")
	if len(base) < 3 {
		base = (base + "web")[:3]
	}
	if len(base) > 24 {
		base = base[:24]
	}
	base = trailDashRE.ReplaceAllString(base, "")
	free := func(name string) (bool, error) {
		if accounts.UsernameError(name) != "" {
			return false, nil
		}
		taken, err := h.accounts.SlugTaken(name)
		return !taken, err
	}
	if ok, err := free(base); err != nil || ok {
		return base, err
	}
	for i := 0; i < 20; i++ {
		candidate := fmt.Sprintf("%s-%d", base, randomInt(100, 10000))
		if ok, err := free(candidate); err != nil || ok {
			return candidate, err
		}
	}
	return fmt.Sprintf("web-%d", randomInt(100000, 1000000)), nil
}

type claims struct {
	Iss           string  `json:"iss"`
	Aud           string  `json:"aud"`
	Sub           string  `json:"sub"`
	Exp           float64 `json:"exp"`
	Email         string  `json:"email"`
	EmailVerified any     `json:"email_verified"`
	Name          string  `json:"name"`
}

// exchange menukar kode dengan token langsung ke Google (lewat HTTPS), jadi id_token bisa dipercaya
// tanpa verifikasi tanda tangan terpisah; klaim tetap dicek pemanggil.
func (h *Handler) exchange(ctx context.Context, code, verifier string) (*claims, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	form := url.Values{
		"code":          {code},
		"client_id":     {h.cfg.GoogleClientID},
		"client_secret": {h.cfg.GoogleClientSecret},
		"redirect_uri":  {h.redirectURI()},
		"grant_type":    {"authorization_code"},
		"code_verifier": {verifier},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.cfg.GoogleTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var token struct {
		IDToken          string `json:"id_token"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if err := json.NewDecoder(res.Body).Decode(&token); err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 || token.IDToken == "" {
		return nil, fmt.Errorf("HTTP %d %s %s", res.StatusCode, token.Error, token.ErrorDescription)
	}
	parts := strings.Split(token.IDToken, ".")
	if len(parts) < 2 {
		return nil, fmt.Errorf("id_token tidak valid")
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return nil, err
	}
	c := &claims{}
	return c, json.Unmarshal(payload, c)
}

func (h *Handler) callback(w http.ResponseWriter, r *http.Request) {
	flow, _ := url.QueryUnescape(auth.ReadCookie(r, h.cookie))
	http.SetCookie(w, h.flowCookie("", -1))
	if !h.cfg.GoogleEnabled {
		fail(w, r, "Login dengan Google belum diaktifkan")
		return
	}
	query := r.URL.Query()
	if query.Get("error") != "" {
		fail(w, r, "Login dengan Google dibatalkan")
		return
	}
	state, verifier, _ := strings.Cut(flow, ".")
	if state == "" || verifier == "" || subtle.ConstantTimeCompare([]byte(query.Get("state")), []byte(state)) != 1 {
		fail(w, r, "Sesi login Google kedaluwarsa. Coba lagi.")
		return
	}

	c, err := h.exchange(r.Context(), query.Get("code"), verifier)
	if err != nil {
		log.Printf("Google OAuth: %v", err)
		fail(w, r, "Gagal masuk dengan Google. Coba lagi.")
		return
	}
	validIssuer := c.Iss == "accounts.google.com" || c.Iss == "https://accounts.google.com"
	if !validIssuer || c.Aud != h.cfg.GoogleClientID || int64(c.Exp*1000) < time.Now().UnixMilli() || c.Sub == "" {
		fail(w, r, "Token Google tidak valid")
		return
	}
	if c.Email == "" || c.EmailVerified != true {
		fail(w, r, "Email Google kamu belum terverifikasi")
		return
	}
	email := strings.ToLower(c.Email)

	user, err := h.db.UserByGoogle(c.Sub)
	if err == nil && user == nil {
		var existing *store.User
		if existing, err = h.db.UserByEmail(email); err == nil && existing != nil {
			// Jangan tautkan otomatis: pendaftaran dengan password tidak memverifikasi email, jadi akun itu
			// bisa saja dibuat orang lain memakai email ini (lalu ikut menguasai akun setelah ditautkan).
			fail(w, r, "Email ini sudah terdaftar dengan password. Silakan masuk memakai username/email dan password.")
			return
		}
		if err == nil {
			user, err = h.createUser(c, email)
		}
	}
	if err == nil {
		err = h.auth.Login(w, user.ID)
	}
	if err != nil {
		httpx.Fail(w, err)
		return
	}
	http.Redirect(w, r, "/editor", http.StatusFound)
}

func (h *Handler) createUser(c *claims, email string) (*store.User, error) {
	username, err := h.usernameFromEmail(email)
	if err != nil {
		return nil, err
	}
	// password_hash kosong = akun hanya bisa masuk lewat Google.
	id, err := h.db.InsertUser(username, email, "")
	if err != nil {
		return nil, err
	}
	if err := h.db.LinkGoogle(c.Sub, id); err != nil {
		return nil, err
	}
	user := &store.User{ID: id, Username: username, Email: email}
	name := c.Name
	if name == "" {
		name = username
	}
	_, err = h.accounts.CreateProject(user, username, name)
	return user, err
}

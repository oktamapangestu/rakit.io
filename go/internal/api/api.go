// Package api: API aplikasi di domain utama (/api/...) yang sudah dipindah ke Go — akun, project,
// file, riwayat versi, editor database, dan diagram. Padanan src/api.js, src/projects.js,
// src/database.js, src/diagrams.js, dan rute di src/versions.js.
// plus AI, kredit, pembayaran, dan asisten website. Hanya dashboard owner (/api/admin) yang masih
// diteruskan ke Node.
package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"

	"rakit.icu/server/internal/ai"
	"rakit.icu/server/internal/aimodels"
	"rakit.icu/server/internal/assistant"
	"rakit.icu/server/internal/auth"
	"rakit.icu/server/internal/billing"
	"rakit.icu/server/internal/config"
	"rakit.icu/server/internal/credits"
	"rakit.icu/server/internal/httpx"
	"rakit.icu/server/internal/jsconv"
	"rakit.icu/server/internal/plans"
	"rakit.icu/server/internal/store"
	"rakit.icu/server/internal/userdb"
	"rakit.icu/server/internal/versions"
)

const jsonLimit = 1024 * 1024

// Services: layanan yang dipakai rute API.
type Services struct {
	Plans     *plans.Plans
	UserDB    *userdb.DB
	Versions  *versions.Service
	Credits   *credits.Service
	Billing   *billing.Service
	AI        *ai.Service
	AIModels  *aimodels.Service
	Assistant *assistant.Service
}

type Handler struct {
	cfg      *config.Config
	db       *store.Store
	auth     *auth.Auth
	plans    *plans.Plans
	userdb   *userdb.DB
	versions *versions.Service
	svc      Services

	// Batas per akun (atau per IP bila belum login) supaya satu pengguna tidak bisa membanjiri server.
	// Auto-save normal hanya ±60 penulisan/menit.
	reads, writes *httpx.RateLimiter
	authLimiter   *httpx.RateLimiter
	dummyHash     string // supaya waktu respons login sama walau user tidak ada
}

func New(cfg *config.Config, db *store.Store, a *auth.Auth, svc Services) (*Handler, error) {
	dummy, err := auth.HashPassword("dummy-password")
	if err != nil {
		return nil, err
	}
	const busy = "Terlalu banyak permintaan dalam waktu singkat. Tunggu sebentar lalu coba lagi."
	return &Handler{
		cfg: cfg, db: db, auth: a, plans: svc.Plans, userdb: svc.UserDB, versions: svc.Versions, svc: svc,
		reads:       httpx.NewRateLimiter(time.Minute, 1200, busy),
		writes:      httpx.NewRateLimiter(time.Minute, 300, busy),
		authLimiter: httpx.NewRateLimiter(15*time.Minute, 30, ""),
		dummyHash:   dummy,
	}, nil
}

// request: satu request API beserta hal yang sudah diketahui tentangnya.
type request struct {
	w    http.ResponseWriter
	r    *http.Request
	user *store.User // nil bila belum login
	rest []string    // segmen path setelah grup rute, sudah di-decode

	body       map[string]any
	raw        []byte // body JSON mentah (untuk yang butuh urutan kunci)
	bodyLimit  int64  // 0 = batas bawaan
	bodyLoaded bool
}

var errNotFound = httpx.Errorf(404, "Endpoint tidak ditemukan")

func reading(r *http.Request) bool { return r.Method == http.MethodGet || r.Method == http.MethodHead }

// segments memecah path setelah /api menjadi segmen yang sudah di-decode. Seperti router Express:
// garis miring di akhir diabaikan.
func segments(r *http.Request) ([]string, bool) {
	rest := strings.Trim(r.URL.EscapedPath()[len("/api"):], "/")
	if rest == "" {
		return nil, true
	}
	parts := strings.Split(rest, "/")
	for i, p := range parts {
		decoded, err := url.PathUnescape(p)
		if err != nil {
			return nil, false
		}
		parts[i] = decoded
	}
	return parts, true
}

var groups = map[string]bool{
	"config": true, "register": true, "login": true, "logout": true, "me": true, "projects": true, "files": true,
	"versions": true, "database": true, "diagrams": true, "ai": true, "billing": true, "assistant": true,
}

// Matches: apakah path /api ini sudah ditangani Go. Dari dashboard owner baru pengaturan model AI
// (keadaannya ada di memori server ini); sisanya masih di Node.
func Matches(r *http.Request) bool {
	parts, ok := segments(r)
	if !ok || len(parts) == 0 {
		return false
	}
	group := strings.ToLower(parts[0])
	if group == "admin" {
		return len(parts) > 1 && strings.EqualFold(parts[1], "ai-models")
	}
	return groups[group]
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	hd := w.Header()
	hd.Set("X-Frame-Options", "DENY")
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Referrer-Policy", "strict-origin-when-cross-origin")

	parts, _ := segments(r)
	// Webhook Kasera: body mentah (untuk verifikasi tanda tangan), tanpa sesi & tanpa cek Origin.
	if r.Method == http.MethodPost && len(parts) == 2 && strings.EqualFold(parts[0], "billing") && strings.EqualFold(parts[1], "webhook") {
		h.svc.Billing.Webhook(w, r)
		return
	}

	// Semua *.rakit.icu dianggap "same-site" oleh browser, jadi SameSite=Lax saja tidak cukup untuk
	// mencegah website user mengirim request ke API. Wajibkan Origin = origin aplikasi.
	if !reading(r) && r.Method != http.MethodOptions {
		ok := r.Header.Get("Sec-Fetch-Site") == "same-origin"
		if origin := r.Header.Get("Origin"); origin != "" {
			ok = origin == h.cfg.AppOrigin
		}
		if !ok {
			httpx.Fail(w, httpx.Errorf(403, "Origin tidak diizinkan"))
			return
		}
	}

	req := &request{w: w, r: r, user: h.auth.User(r)}
	who := httpx.ClientIP(r)
	if req.user != nil {
		who = "u" + jsconv.String(float64(req.user.ID))
	}
	limiter, prefix := h.writes, "w:"
	if reading(r) {
		limiter, prefix = h.reads, "r:"
	}
	if !limiter.Allow(w, prefix+who) {
		return
	}

	req.rest = parts[1:]
	var err error
	switch strings.ToLower(parts[0]) {
	case "config":
		err = h.config(req)
	case "register":
		err = h.register(req)
	case "login":
		err = h.login(req)
	case "logout":
		err = h.logout(req)
	case "me":
		err = h.me(req)
	case "projects":
		err = h.projects(req)
	case "files":
		err = h.files(req)
	case "versions":
		err = h.versionRoutes(req)
	case "database":
		err = h.database(req)
	case "diagrams":
		err = h.diagrams(req)
	case "ai":
		err = h.ai(req)
	case "billing":
		err = h.billing(req)
	case "assistant":
		err = h.assistant(req)
	case "admin":
		err = h.adminModels(req)
	}
	if err != nil {
		httpx.Fail(w, err)
	}
}

// ---------- Perkakas request ----------

func (q *request) is(method string, rest ...string) bool {
	m := q.r.Method
	if m == http.MethodHead {
		m = http.MethodGet
	}
	if m != method || len(q.rest) != len(rest) {
		return false
	}
	for i, want := range rest {
		// ":" = parameter; selain itu dicocokkan tanpa membedakan huruf besar/kecil.
		if want != ":" && !strings.EqualFold(q.rest[i], want) {
			return false
		}
	}
	return true
}

func (q *request) json(status int, v any) error {
	httpx.JSON(q.w, status, v)
	return nil
}

func isJSON(r *http.Request) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return err == nil && mediaType == "application/json"
}

func readLimited(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	tooLarge := httpx.Errorf(413, "Request terlalu besar")
	if r.ContentLength > limit {
		return nil, tooLarge
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return nil, tooLarge
		}
		return nil, httpx.Errorf(400, "Request tidak lengkap")
	}
	return data, nil
}

// load membaca body JSON (bila Content-Type-nya JSON). Body yang bukan objek dianggap kosong.
func (q *request) load() error {
	if q.bodyLoaded {
		return nil
	}
	q.bodyLoaded = true
	q.body = map[string]any{}
	if !isJSON(q.r) {
		return nil
	}
	limit := int64(jsonLimit)
	if q.bodyLimit > 0 {
		limit = q.bodyLimit
	}
	raw, err := readLimited(q.w, q.r, limit)
	if err != nil {
		return err
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return nil
	}
	// Seperti express.json() mode strict: hanya objek atau array.
	var parsed any
	if (raw[0] != '{' && raw[0] != '[') || json.Unmarshal(raw, &parsed) != nil {
		return httpx.Errorf(400, "JSON tidak valid")
	}
	q.raw = raw
	if obj, ok := parsed.(map[string]any); ok {
		q.body = obj
	}
	return nil
}

// text meniru String(body[key] ?? ”).
func (q *request) text(key string) string { return jsconv.String(q.body[key]) }

// param: nilai pertama parameter query, dan apakah ada.
func (q *request) param(key string) (string, bool) {
	values, ok := q.r.URL.Query()[key]
	if !ok || len(values) == 0 {
		return "", false
	}
	return values[0], true
}

func (h *Handler) requireAuth(q *request) error {
	if q.user == nil {
		return httpx.Errorf(401, "Silakan masuk terlebih dahulu")
	}
	return nil
}

// loadProject menentukan project aktif dari header X-Project (atau project pertama milik user).
// Project milik orang lain selalu ditolak 404.
func (h *Handler) loadProject(q *request) (*store.Project, error) {
	wanted := strings.ToLower(strings.TrimSpace(q.r.Header.Get("X-Project")))
	if wanted != "" {
		p, err := h.db.ProjectBySlug(wanted)
		if err != nil {
			return nil, err
		}
		if p == nil || p.UserID != q.user.ID {
			return nil, httpx.Errorf(404, "Project tidak ditemukan")
		}
		return p, nil
	}
	all, err := h.db.ProjectsOf(q.user.ID)
	if err != nil {
		return nil, err
	}
	if len(all) == 0 {
		return nil, httpx.Errorf(409, "Kamu belum punya project. Buat project baru dulu.")
	}
	return all[0], nil
}

type publicProject struct {
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	SiteURL   string `json:"siteUrl"`
	SiteHost  string `json:"siteHost"`
	CreatedAt int64  `json:"createdAt"`
}

func (h *Handler) public(p *store.Project) publicProject {
	return publicProject{Slug: p.Slug, Name: p.Name, SiteURL: h.cfg.SiteURL(p.Slug), SiteHost: h.cfg.SiteHost(p.Slug), CreatedAt: p.CreatedAt}
}

func (h *Handler) publicAll(list []*store.Project) []publicProject {
	out := make([]publicProject, 0, len(list))
	for _, p := range list {
		out = append(out, h.public(p))
	}
	return out
}

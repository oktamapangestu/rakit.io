// Package fn: fungsi serverless pengguna. Kode di functions/<nama>.js pada project, dipanggil lewat
// https://<slug>.rakit.io/api/fn/<nama> (versi dev: <slug>--dev). Fungsi berjalan di sandbox (engine.go)
// dengan akses ke database project (sebagai pemilik), rahasia project (env), dan fetch ke internet publik.
package fn

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"rakit.io/server/internal/config"
	"rakit.io/server/internal/files"
	"rakit.io/server/internal/fnai"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/plans"
	"rakit.io/server/internal/store"
	"rakit.io/server/internal/userdb"
)

const (
	Dir           = "functions" // folder fungsi di project; tidak pernah disajikan sebagai file statis
	timeout       = 10 * time.Second
	maxCode       = 256 << 10
	maxBody       = 1 << 20
	maxConcurrent = 8 // eksekusi bersamaan di seluruh server
	maxSecrets    = 30
	maxSecretSize = 4 << 10
)

// DailyLimit: eksekusi fungsi per akun per hari.
const DailyLimit = 20_000

var (
	NameRE   = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,39}$`)
	secretRE = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,39}$`)
)

type Service struct {
	cfg    *config.Config
	store  *store.Store
	db     *sql.DB
	userdb *userdb.DB
	plans  *plans.Plans
	client *http.Client
	// aiClient: untuk provider AI (ai.*); penjaga alamat internal sama dengan fetch.
	aiClient *http.Client

	slots             chan struct{}
	perProject, perIP *httpx.RateLimiter
}

func New(cfg *config.Config, db *store.Store, udb *userdb.DB, p *plans.Plans) *Service {
	// Hanya untuk test lokal (server tiruan di 127.0.0.1); jangan pernah dinyalakan di produksi.
	allowPrivate := os.Getenv("FN_ALLOW_PRIVATE_FETCH") == "1"
	return &Service{
		cfg: cfg, store: db, db: db.DB(), userdb: udb, plans: p,
		client: newClient(allowPrivate, fetchTimeout), aiClient: newClient(allowPrivate, aiCallTimeout),
		slots:      make(chan struct{}, maxConcurrent),
		perProject: httpx.NewRateLimiter(time.Minute, 120, "Fungsi website ini sedang ramai. Coba lagi sebentar lagi."),
		perIP:      httpx.NewRateLimiter(time.Minute, 60, "Terlalu banyak permintaan. Coba lagi sebentar lagi."),
	}
}

// Matches: /api/fn atau /api/fn/... (tidak peka huruf besar/kecil).
func Matches(p string) bool {
	const prefix = "/api/fn"
	return len(p) >= len(prefix) && strings.EqualFold(p[:len(prefix)], prefix) && (len(p) == len(prefix) || p[len(prefix)] == '/')
}

// Hidden: path di website yang tidak boleh disajikan sebagai file (kode fungsi).
func Hidden(rel string) bool {
	rel = strings.ToLower(strings.TrimPrefix(rel, "/"))
	return rel == Dir || strings.HasPrefix(rel, Dir+"/")
}

// ---------- Kuota ----------

func today() string {
	day, _ := plans.WIBDay(time.Now().UnixMilli())
	return day
}

// take memakai satu jatah eksekusi hari ini; false bila sudah habis.
func (s *Service) take(userID int64) (bool, error) {
	limit := DailyLimit
	res, err := s.db.Exec(`
		INSERT INTO fn_usage (user_id, day, count) VALUES (?, ?, 1)
		ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 WHERE count < ?`, userID, today(), limit)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

func (s *Service) usedToday(userID int64) (n int) {
	s.db.QueryRow("SELECT count FROM fn_usage WHERE user_id = ? AND day = ?", userID, today()).Scan(&n)
	return n
}

// ---------- Rahasia ----------

func (s *Service) secrets(projectID int64) (map[string]string, error) {
	rows, err := s.db.Query("SELECT name, value FROM fn_secrets WHERE project_id = ?", projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// SetSecret menyimpan (atau mengganti) satu rahasia project. Nilainya tidak pernah dikirim balik.
func (s *Service) SetSecret(p *store.Project, name, value string) error {
	name = strings.TrimSpace(name)
	if !secretRE.MatchString(name) {
		return httpx.Errorf(400, "Nama rahasia: huruf besar, angka, dan _, diawali huruf (mis. TELEGRAM_TOKEN)")
	}
	if value == "" || len(value) > maxSecretSize {
		return httpx.Errorf(400, "Isi rahasia 1–4096 karakter")
	}
	var n int
	s.db.QueryRow("SELECT COUNT(*) FROM fn_secrets WHERE project_id = ? AND name != ?", p.ID, name).Scan(&n)
	if n >= maxSecrets {
		return httpx.Errorf(409, "Maksimal %d rahasia per project", maxSecrets)
	}
	_, err := s.db.Exec(`
		INSERT INTO fn_secrets (project_id, name, value, updated_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (project_id, name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		p.ID, name, value, time.Now().UnixMilli())
	return err
}

func (s *Service) DeleteSecret(p *store.Project, name string) error {
	res, err := s.db.Exec("DELETE FROM fn_secrets WHERE project_id = ? AND name = ?", p.ID, name)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return httpx.Errorf(404, "Rahasia tidak ditemukan")
	}
	return nil
}

// SecretNames: nama rahasia project (untuk konteks AI; isinya tidak pernah ikut).
func (s *Service) SecretNames(slug string) []string {
	rows, err := s.db.Query("SELECT f.name FROM fn_secrets f JOIN projects p ON p.id = f.project_id WHERE p.slug = ? ORDER BY f.name", slug)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		if rows.Scan(&name) == nil {
			out = append(out, name)
		}
	}
	return out
}

// ---------- Daftar untuk editor ----------

type Info struct {
	Name     string    `json:"name"`
	Path     string    `json:"path"`
	URL      string    `json:"url"`
	Schedule *Schedule `json:"schedule"`
}

type SecretInfo struct {
	Name      string `json:"name"`
	UpdatedAt int64  `json:"updatedAt"`
}

type Overview struct {
	Functions []Info       `json:"functions"`
	Secrets   []SecretInfo `json:"secrets"`
	// Library AI: provider yang dipasang (tanpa API key) dan jenis yang bisa dipilih.
	AIProviders []ProviderInfo    `json:"aiProviders"`
	AIKinds     map[string]string `json:"aiKinds"`
	Usage       struct {
		Today int `json:"today"`
		Limit int `json:"limit"`
	} `json:"usage"`
	Limits struct {
		TimeoutSeconds int `json:"timeoutSeconds"`
		MemoryMB       int `json:"memoryMb"`
	} `json:"limits"`
	// Jadwal: 0 = paket tanpa jadwal; selain itu jarak minimal (menit).
	Cron struct {
		MinMinutes int `json:"minMinutes"`
	} `json:"cron"`
}

// Overview: fungsi di project (versi yang diedit), nama rahasia, dan kuota hari ini.
func (s *Service) Overview(p *store.Project) (*Overview, error) {
	out := &Overview{Functions: []Info{}, Secrets: []SecretInfo{}}
	entries, err := os.ReadDir(filepath.Join(s.cfg.SiteRoot(p.Slug), Dir))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	base := s.cfg.SiteURL(p.Slug)
	if p.Manual() {
		base = s.cfg.DevURL(p.Slug)
	}
	schedules, err := s.schedules(p)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		name, ok := strings.CutSuffix(e.Name(), ".js")
		if ok && e.Type().IsRegular() && NameRE.MatchString(name) {
			out.Functions = append(out.Functions, Info{name, Dir + "/" + e.Name(), base + "/api/fn/" + name, schedules[name]})
		}
	}
	out.Cron.MinMinutes = CronMinutes
	rows, err := s.db.Query("SELECT name, updated_at FROM fn_secrets WHERE project_id = ? ORDER BY name", p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var si SecretInfo
		if err := rows.Scan(&si.Name, &si.UpdatedAt); err != nil {
			return nil, err
		}
		out.Secrets = append(out.Secrets, si)
	}
	if out.AIProviders, err = s.ProviderInfos(p); err != nil {
		return nil, err
	}
	out.AIKinds = map[string]string{}
	for k, v := range fnai.Kinds {
		out.AIKinds[k] = v.Label
	}
	out.Usage.Today = s.usedToday(p.UserID)
	out.Usage.Limit = DailyLimit
	out.Limits.TimeoutSeconds, out.Limits.MemoryMB = int(timeout/time.Second), memoryPages*64/1024
	return out, rows.Err()
}

// ---------- Eksekusi ----------

// Target: versi website tempat fungsi dijalankan.
type Target struct {
	Project *store.Project
	Root    string // folder file (kode fungsi dibaca dari Root/functions)
	DBKey   string // database yang dipakai db.*
	Dev     bool   // versi dev/editor: pesan kesalahan ditampilkan lengkap
}

func (s *Service) loadCode(root, name string) (string, error) {
	if !NameRE.MatchString(name) {
		return "", httpx.Errorf(404, "Fungsi tidak ditemukan")
	}
	// ReadRegular: folder symlink di salinan kerja mode Agen tidak diikuti ke luar root (mis. fungsi project lain).
	code, err := files.ReadRegular(root, Dir+"/"+name+".js", maxCode)
	if errors.Is(err, files.ErrTooLarge) {
		return "", httpx.Errorf(413, "Kode fungsi maksimal 256 KB")
	}
	if err != nil {
		return "", httpx.Errorf(404, "Fungsi tidak ditemukan")
	}
	return string(code), nil
}

// Outcome: hasil satu eksekusi, juga untuk uji coba di editor.
type Outcome struct {
	Status   int               `json:"status"`
	Headers  map[string]string `json:"headers"`
	Body     string            `json:"body"`
	Logs     string            `json:"logs"`
	Error    string            `json:"error,omitempty"`
	Duration int64             `json:"ms"`
}

// execute menjalankan fungsi `name` di target. Kuota, antrean, dan batas waktu ditegakkan di sini;
// setiap eksekusi dicatat di log (trigger: http | cron | test).
func (s *Service) execute(parent context.Context, t Target, name string, req Request, trigger string) (*Outcome, error) {
	code, err := s.loadCode(t.Root, name)
	if err != nil {
		return nil, err
	}
	if ok, err := s.take(t.Project.UserID); err != nil {
		return nil, err
	} else if !ok {
		return nil, &httpx.Error{Status: 429, Code: "fn_quota", Message: fmt.Sprintf("Kuota fungsi hari ini sudah habis (%d eksekusi/hari).", DailyLimit)}
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-time.After(3 * time.Second):
		return nil, httpx.Errorf(503, "Server fungsi sedang penuh. Coba lagi sebentar lagi.")
	case <-parent.Done():
		return nil, parent.Err()
	}
	env, err := s.secrets(t.Project.ID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	clk := newClock(timeout, cancel)
	defer clk.stop()

	fetches, aiCalls := 0, 0
	host := func(ctx context.Context, op string, args []json.RawMessage) (any, error) {
		switch {
		case op == "fetch":
			if fetches++; fetches > maxFetches {
				return nil, fmt.Errorf("fetch: maksimal %d panggilan per eksekusi", maxFetches)
			}
			return s.fetch(ctx, args)
		case strings.HasPrefix(op, "ai."):
			if op != "ai.providers" {
				if aiCalls++; aiCalls > maxAICalls {
					return nil, fmt.Errorf("ai: maksimal %d panggilan per eksekusi", maxAICalls)
				}
			}
			// Menunggu provider AI tidak dihitung ke batas waktu fungsi (tiap panggilan dibatasi aiCallTimeout).
			clk.pause()
			defer clk.resume()
			return s.aiOp(ctx, t, op, args)
		}
		return s.dbOp(ctx, t.DBKey, op, args)
	}
	start := time.Now()
	res, logs, err := Run(ctx, code, req, env, host, Dir+"/"+name+".js")
	out := &Outcome{Logs: logs, Duration: time.Since(start).Milliseconds(), Headers: map[string]string{}}
	switch {
	case errors.Is(err, ErrTimeout):
		out.Status, out.Error = 504, fmt.Sprintf("Fungsi melebihi batas waktu %d detik", int(timeout/time.Second))
	case errors.Is(err, ErrMemory):
		out.Status, out.Error = 500, fmt.Sprintf("Fungsi kehabisan memori (maks. %d MB)", memoryPages*64/1024)
	case err != nil:
		out.Status, out.Error = 500, "Fungsi gagal: "+err.Error()
	default:
		out.Status, out.Body = res.Status, res.Body
		if out.Status < 200 || out.Status > 599 {
			out.Status = 200
		}
		for k, v := range res.Headers {
			if k = strings.ToLower(strings.TrimSpace(k)); allowedHeader(k) {
				out.Headers[k] = v
			}
		}
		if out.Headers["content-type"] == "" {
			out.Headers["content-type"] = "text/plain; charset=utf-8"
			if res.JSON {
				out.Headers["content-type"] = "application/json; charset=utf-8"
			}
		}
	}
	s.record(t, name, trigger, out)
	return out, nil
}

// allowedHeader: header jawaban yang boleh diatur fungsi. Set-Cookie tidak: subdomain bisa memasang
// cookie untuk seluruh rakit.io (termasuk sesi aplikasi).
func allowedHeader(k string) bool {
	switch k {
	case "content-type", "cache-control", "location", "content-disposition", "etag", "last-modified", "vary",
		"access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "access-control-max-age":
		return true
	}
	return strings.HasPrefix(k, "x-") && k != "x-frame-options" && k != "x-content-type-options"
}

// requestOf membaca request HTTP untuk fungsi (body maks. 1 MB; JSON dibaca bila Content-Type JSON).
func requestOf(w http.ResponseWriter, r *http.Request, name string) (Request, error) {
	req := Request{Method: r.Method, Path: r.URL.Path, Query: map[string]string{}, Headers: map[string]string{}}
	for k, v := range r.URL.Query() {
		req.Query[k] = v[0]
	}
	for k, v := range r.Header {
		switch k = strings.ToLower(k); k {
		case "cookie", "connection", "x-real-ip", "x-forwarded-proto", "x-forwarded-host":
			continue
		}
		req.Headers[k] = strings.Join(v, ", ")
	}
	req.Headers["x-client-ip"] = httpx.ClientIP(r)
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		return req, httpx.Errorf(413, "Request maksimal 1 MB")
	}
	req.Text = string(raw)
	req.Body = req.Text
	if strings.Contains(strings.ToLower(r.Header.Get("Content-Type")), "json") && len(raw) > 0 {
		var parsed any
		if json.Unmarshal(raw, &parsed) == nil {
			req.Body = parsed
		}
	}
	return req, nil
}

// Serve menjawab https://<slug>.rakit.io/api/fn/<nama>.
func (s *Service) Serve(w http.ResponseWriter, r *http.Request, t *Target) {
	w.Header().Set("Cache-Control", "no-store")
	if t == nil {
		httpx.Fail(w, httpx.Errorf(404, "Situs tidak ditemukan"))
		return
	}
	name := strings.ToLower(strings.Trim(r.URL.Path[len("/api/fn"):], "/"))
	key := t.Project.Slug
	if !s.perProject.Allow(w, "fn:"+key) || !s.perIP.Allow(w, "fn:"+key+":"+httpx.ClientIP(r)) {
		return
	}
	req, err := requestOf(w, r, name)
	if err != nil {
		httpx.Fail(w, err)
		return
	}
	out, err := s.execute(r.Context(), *t, name, req, "http")
	if err != nil {
		httpx.Fail(w, err)
		return
	}
	if out.Error != "" {
		msg := out.Error
		if !t.Dev && out.Status == 500 && strings.HasPrefix(msg, "Fungsi gagal:") {
			msg = "Fungsi gagal dijalankan" // detail kesalahan kode hanya di versi dev/editor
			log.Printf("fn %s/%s: %s", key, name, out.Error)
		}
		httpx.JSON(w, out.Status, map[string]string{"error": msg})
		return
	}
	for k, v := range out.Headers {
		w.Header().Set(k, v)
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(out.Status)
	if r.Method != http.MethodHead {
		io.WriteString(w, out.Body)
	}
}

// Try: uji coba dari editor, di versi yang sedang diedit (dev bila publikasi manual).
func (s *Service) Try(ctx context.Context, p *store.Project, name, method, query, body string) (*Outcome, error) {
	method = strings.ToUpper(strings.TrimSpace(method))
	if method == "" {
		method = http.MethodGet
	}
	req := Request{Method: method, Path: "/api/fn/" + name, Query: map[string]string{}, Headers: map[string]string{}, Body: body, Text: body}
	if vals, err := parseQuery(query); err == nil {
		req.Query = vals
	}
	if strings.TrimSpace(body) != "" {
		var parsed any
		if json.Unmarshal([]byte(body), &parsed) == nil {
			req.Body = parsed
			req.Headers["content-type"] = "application/json"
		}
	}
	return s.execute(ctx, Target{Project: p, Root: s.cfg.SiteRoot(p.Slug), DBKey: p.Slug, Dev: true}, name, req, "test")
}

func parseQuery(q string) (map[string]string, error) {
	out := map[string]string{}
	for _, pair := range strings.Split(strings.TrimPrefix(q, "?"), "&") {
		if pair == "" {
			continue
		}
		k, v, _ := strings.Cut(pair, "=")
		out[k] = v
	}
	return out, nil
}

// ---------- db.* ----------

func str(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var n json.Number
	if json.Unmarshal(raw, &n) == nil {
		return n.String()
	}
	return ""
}

// dbOp: db.list/get/insert/update/delete pada database versi target, sebagai pemilik (tanpa aturan
// akses publik; kolom privat ikut terbaca).
func (s *Service) dbOp(ctx context.Context, key, op string, args []json.RawMessage) (any, error) {
	arg := func(i int) json.RawMessage {
		if i < len(args) {
			return args[i]
		}
		return json.RawMessage("null")
	}
	table := str(arg(0))
	switch op {
	case "db.list":
		var opts struct {
			Limit, Offset any
			Sort          string
			Filter        map[string]any
		}
		json.Unmarshal(arg(1), &opts)
		lo := userdb.ListOptions{Limit: anyString(opts.Limit), Offset: anyString(opts.Offset), Sort: opts.Sort}
		keys := make([]string, 0, len(opts.Filter))
		for k := range opts.Filter {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			lo.Filters = append(lo.Filters, userdb.Field{Key: k, Value: anyString(opts.Filter[k])})
		}
		return s.userdb.ListRows(ctx, key, table, lo)
	case "db.get":
		return s.userdb.GetRow(ctx, key, table, str(arg(1)), false, nil)
	case "db.insert", "db.update":
		dataArg := arg(1)
		if op == "db.update" {
			dataArg = arg(2)
		}
		fields, isObject, err := userdb.DecodeObject(dataArg)
		if err != nil || !isObject {
			return nil, errors.New("data harus berupa objek, mis. { nama: 'Ani' }")
		}
		if op == "db.insert" {
			return s.userdb.InsertRow(ctx, key, table, fields, true, false)
		}
		return s.userdb.UpdateRow(ctx, key, table, str(arg(1)), fields, true, false)
	case "db.delete":
		if err := s.userdb.DeleteRow(ctx, key, table, str(arg(1))); err != nil {
			return nil, err
		}
		return map[string]bool{"ok": true}, nil
	}
	return nil, fmt.Errorf("operasi %q tidak dikenal", op)
}

func anyString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(t)
	}
	b, _ := json.Marshal(v)
	return string(b)
}

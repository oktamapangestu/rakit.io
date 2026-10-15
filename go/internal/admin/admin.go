// Package admin: dashboard pemilik platform — statistik pengguna, AI, pendapatan, dan penyimpanan,
// serta harga langganan & kredit gratis. Akses dibatasi ke email di ADMIN_EMAILS (diperiksa di paket
// api). Padanan src/admin.js.
package admin

import (
	"database/sql"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"rakit.io/server/internal/aimodels"
	"rakit.io/server/internal/aiqueue"
	"rakit.io/server/internal/config"
	"rakit.io/server/internal/credits"
	"rakit.io/server/internal/plans"
	"rakit.io/server/internal/store"
)

const (
	dayMs    = plans.DayMs
	wibMs    = 7 * 60 * 60 * 1000
	tzOffset = "+7 hours" // statistik harian dihitung dalam WIB
	// Subdomain project pertama milik user (untuk link "lihat situs").
	primarySlug = "(SELECT p.slug FROM projects p WHERE p.user_id = u.id ORDER BY p.created_at, p.id LIMIT 1)"
)

type Service struct {
	cfg    *config.Config
	store  *store.Store
	db     *sql.DB
	plans  *plans.Plans
	models *aimodels.Service
	queue  *aiqueue.Queue

	mu      sync.Mutex
	storage *Storage // dihitung ulang paling sering 5 menit sekali
	storeAt time.Time
}

func New(cfg *config.Config, db *store.Store, p *plans.Plans, models *aimodels.Service, queue *aiqueue.Queue) *Service {
	return &Service{cfg: cfg, store: db, db: db.DB(), plans: p, models: models, queue: queue}
}

// ---------- Harga langganan ----------

type Limits struct {
	MinPrice     int `json:"minPrice"`
	MaxPrice     int `json:"maxPrice"`
	MaxQuota     int `json:"maxQuota"`
	FreeDailyMax int `json:"freeDailyMax"`
	FreeBonusMax int `json:"freeBonusMax"`
}

type Usage struct {
	Prompts   int64 `json:"prompts"`
	AvgTokens int64 `json:"avgTokens"`
	MaxTokens int64 `json:"maxTokens"`
}

type PlansView struct {
	Plans            []plans.AdminPlan `json:"plans"`
	Limits           Limits            `json:"limits"`
	ModelCost        float64           `json:"modelCost"`
	FreeDaily        int               `json:"freeDaily"`
	FreeBonus        int               `json:"freeBonus"`
	Usage            Usage             `json:"usage"`
	CreditsPerPrompt int               `json:"creditsPerPrompt"`
}

func (s *Service) PlansView() (*PlansView, error) {
	// Rata-rata token per prompt yang berhasil (30 hari), untuk memperkirakan biaya per paket.
	var usage Usage
	var avg float64
	err := s.db.QueryRow(`
		SELECT COUNT(*), COALESCE(AVG(input_tokens + output_tokens), 0), COALESCE(MAX(input_tokens + output_tokens), 0)
		FROM ai_requests WHERE status = 'ok' AND created_at >= ?`, time.Now().UnixMilli()-30*dayMs).Scan(&usage.Prompts, &avg, &usage.MaxTokens)
	if err != nil {
		return nil, err
	}
	usage.AvgTokens = int64(math.Floor(avg + 0.5))
	return &PlansView{
		Plans:            s.plans.AdminPlans(),
		Limits:           Limits{plans.MinPrice, plans.MaxPrice, plans.MaxQuota, plans.FreeDailyMax, plans.FreeBonusMax},
		ModelCost:        s.plans.ModelCost(),
		FreeDaily:        s.plans.FreeDailyCredits(),
		FreeBonus:        s.plans.FreeBonusCredits(),
		Usage:            usage,
		CreditsPerPrompt: s.cfg.AI.CreditsPerPrompt,
	}, nil
}

// SavePlans menyimpan harga/kuota paket, biaya model, dan kredit gratis sekaligus: satu bagian gagal,
// tidak ada yang tersimpan. Bagian yang tidak ada di body tidak diubah.
func (s *Service) SavePlans(body map[string]any) error {
	input := map[string]map[string]any{}
	list, _ := body["plans"].([]any)
	for _, item := range list {
		p, _ := item.(map[string]any)
		if id, ok := p["id"].(string); ok && s.plans.Get(id) != nil {
			input[id] = p
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := s.plans.SavePlans(tx, input); err != nil {
		return err
	}
	if v, ok := body["modelCost"]; ok {
		if err := s.plans.SaveModelCost(tx, v); err != nil {
			return err
		}
	}
	if v, ok := body["freeDaily"]; ok {
		if err := s.plans.SaveFreeDailyCredits(tx, v); err != nil {
			return err
		}
	}
	if v, ok := body["freeBonus"]; ok {
		if err := s.plans.SaveFreeBonusCredits(tx, v); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ---------- Ukuran penyimpanan ----------

type Storage struct {
	SiteBytes            int64  `json:"siteBytes"`
	SiteFiles            int64  `json:"siteFiles"`
	DBBytes              int64  `json:"dbBytes"`
	ProjectsWithDatabase int    `json:"projectsWithDatabase"`
	ComputedAt           string `json:"computedAt"`
}

// dirSize: total ukuran & jumlah file biasa di dalam folder (symlink tidak diikuti).
func dirSize(dir string) (bytes, files int64) {
	items, err := os.ReadDir(dir)
	if err != nil {
		return 0, 0
	}
	for _, item := range items {
		abs := filepath.Join(dir, item.Name())
		switch {
		case item.IsDir():
			b, f := dirSize(abs)
			bytes, files = bytes+b, files+f
		case item.Type().IsRegular():
			if info, err := item.Info(); err == nil {
				bytes += info.Size()
				files++
			}
		}
	}
	return bytes, files
}

func (s *Service) storageStats() *Storage {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.storage != nil && time.Since(s.storeAt) < 5*time.Minute {
		return s.storage
	}
	siteBytes, siteFiles := dirSize(filepath.Join(s.cfg.DataDir, "sites"))
	dbBytes, _ := dirSize(filepath.Join(s.cfg.DataDir, "db"))
	databases := 0
	entries, _ := os.ReadDir(filepath.Join(s.cfg.DataDir, "db"))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".db") {
			databases++
		}
	}
	s.storage = &Storage{SiteBytes: siteBytes, SiteFiles: siteFiles, DBBytes: dbBytes, ProjectsWithDatabase: databases, ComputedAt: plans.ISO(time.Now().UnixMilli())}
	s.storeAt = time.Now()
	return s.storage
}

// ---------- Statistik ----------

// lastDays: tanggal 'YYYY-MM-DD' (WIB) untuk N hari terakhir, termasuk hari ini.
func lastDays(now int64, days int) []string {
	out := make([]string, days)
	for i := range out {
		out[i] = time.UnixMilli(now + wibMs - int64(days-1-i)*dayMs).UTC().Format("2006-01-02")
	}
	return out
}

// Day: satu baris grafik harian; field yang tidak ada di hari itu bernilai 0.
type Day map[string]any

// fillDays meniru fillDays di admin.js: tiap tanggal dalam daftar mendapat baris, kosong = 0.
func (s *Service) fillDays(days []string, fields []string, query string, args ...any) ([]Day, error) {
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byDate := map[string][]int64{}
	for rows.Next() {
		var date sql.NullString
		values := make([]sql.NullInt64, len(fields))
		dest := []any{&date}
		for i := range values {
			dest = append(dest, &values[i])
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		nums := make([]int64, len(fields))
		for i, v := range values {
			nums[i] = v.Int64
		}
		byDate[date.String] = nums
	}
	out := make([]Day, len(days))
	for i, date := range days {
		row := Day{"date": date}
		nums := byDate[date]
		for j, f := range fields {
			if nums != nil {
				row[f] = nums[j]
			} else {
				row[f] = 0
			}
		}
		out[i] = row
	}
	return out, rows.Err()
}

func (s *Service) count(query string, args ...any) (n int64, err error) {
	err = s.db.QueryRow(query, args...).Scan(&n)
	return n, err
}

type Users struct {
	Total          int64 `json:"total"`
	Projects       int64 `json:"projects"`
	InPeriod       int64 `json:"inPeriod"`
	Today          int64 `json:"today"`
	ActiveSessions int64 `json:"activeSessions"`
}

type ModelRequests struct {
	Model    string `json:"model"`
	Requests int64  `json:"requests"`
}

// CodeQuality: hasil pemeriksaan kode otomatis job Builder per model (ai_requests.checks, lihat ai.buildStats).
// Problems = job yang kodenya sempat bermasalah; Left = job yang selesai dengan masalah tersisa; Found = berapa
// kali tiap jenis masalah dikembalikan ke model.
type CodeQuality struct {
	Model    string           `json:"model"`
	Builds   int64            `json:"builds"`
	Problems int64            `json:"problems"`
	Left     int64            `json:"left"`
	Rounds   int64            `json:"rounds"`
	Found    map[string]int64 `json:"found"`
}

type AI struct {
	Requests     int64            `json:"requests"`
	TokensIn     int64            `json:"tokensIn"`
	TokensOut    int64            `json:"tokensOut"`
	Users        int64            `json:"users"`
	ByStatus     map[string]int64 `json:"byStatus"`
	ByDay        []Day            `json:"byDay"`
	Models       []ModelRequests  `json:"models"`
	CurrentModel string           `json:"currentModel"`
	CodeQuality  []CodeQuality    `json:"codeQuality"`
}

type Credits struct {
	UsedToday            int64 `json:"usedToday"`
	PurchasedOutstanding int64 `json:"purchasedOutstanding"`
	FreePerUser          int   `json:"freePerUser"`
	FreeBonus            int   `json:"freeBonus"`
}

type Revenue struct {
	AllTime     int64 `json:"allTime"`
	InPeriod    int64 `json:"inPeriod"`
	PaidCount   int64 `json:"paidCount"`
	CreditsSold int64 `json:"creditsSold"`
	PayingUsers int64 `json:"payingUsers"`
	Pending     int64 `json:"pending"`
	Livemode    bool  `json:"livemode"`
}

type Payment struct {
	CreatedAt int64   `json:"createdAt"`
	PaidAt    *string `json:"paidAt"`
	Status    string  `json:"status"`
	PackageID string  `json:"packageId"`
	Credits   int64   `json:"credits"`
	Amount    int64   `json:"amount"`
	Livemode  bool    `json:"livemode"`
	Username  string  `json:"username"`
}

type TopUser struct {
	Username   string  `json:"username"`
	CreatedAt  int64   `json:"createdAt"`
	Slug       *string `json:"slug"`
	AIRequests int64   `json:"aiRequests"`
	Tokens     int64   `json:"tokens"`
	Spent      int64   `json:"spent"`
	SiteURL    string  `json:"siteUrl"`
}

type RecentUser struct {
	Username  string  `json:"username"`
	Email     string  `json:"email"`
	CreatedAt int64   `json:"createdAt"`
	Slug      *string `json:"slug"`
	Projects  int64   `json:"projects"`
	SiteURL   string  `json:"siteUrl"`
}

// CreditUser: kredit & token per pengguna — bonus awal, jatah gratis hari ini, saldo beli, total
// tersedia, dan token.
type CreditUser struct {
	Username       string  `json:"username"`
	Email          string  `json:"email"`
	Used           int64   `json:"used"`
	FreeLimit      int64   `json:"freeLimit"`
	FreeRemaining  int64   `json:"freeRemaining"`
	BonusLimit     int64   `json:"bonusLimit"`
	BonusUsed      int64   `json:"bonusUsed"`
	BonusRemaining int64   `json:"bonusRemaining"`
	Purchased      int64   `json:"purchased"`
	Remaining      int64   `json:"remaining"`
	AIRequests     int64   `json:"aiRequests"`
	InTokens       int64   `json:"inTokens"`
	OutTokens      int64   `json:"outTokens"`
	Tokens         int64   `json:"tokens"`
	LastAt         *string `json:"lastAt"`
	SiteURL        string  `json:"siteUrl"`
}

// TokenUser: satu baris ranking pemakaian token dalam periode — AI editor (input/output) dan asisten
// website milik pengguna (semua project-nya).
type TokenUser struct {
	Username          string `json:"username"`
	Email             string `json:"email"`
	AIRequests        int64  `json:"aiRequests"`
	InTokens          int64  `json:"inTokens"`
	OutTokens         int64  `json:"outTokens"`
	AssistantTokens   int64  `json:"assistantTokens"`
	AssistantMessages int64  `json:"assistantMessages"`
	Tokens            int64  `json:"tokens"`
	Spent             int64  `json:"spent"`
	SiteURL           string `json:"siteUrl"`
}

// TokenAction: satu request AI editor beserta aksinya (Builder/Plan/diagram), untuk ranking per aksi.
type TokenAction struct {
	At         string  `json:"at"`
	Username   string  `json:"username"`
	Email      string  `json:"email"`
	SiteURL    string  `json:"siteUrl"`
	Action     string  `json:"action"` // build | plan | diagram | "" (tercatat sebelum aksi dicatat)
	Detail     string  `json:"detail"`
	Project    *string `json:"project"`
	ProjectURL *string `json:"projectUrl"`
	Model      string  `json:"model"`
	Status     string  `json:"status"`
	InTokens   int64   `json:"inTokens"`
	OutTokens  int64   `json:"outTokens"`
}

type TokenRanking struct {
	EditorTokens    int64       `json:"editorTokens"`
	AssistantTokens int64       `json:"assistantTokens"`
	Users           []TokenUser `json:"users"`
	// Actions: gabungan 20 request teratas menurut total, input, dan output token (maks. 60 baris), supaya
	// dashboard bisa mengurutkan menurut ketiganya tanpa meminta ulang.
	Actions []TokenAction `json:"actions"`
}

// ActiveUser: akun yang terakhir aktif — waktu terakhir memakai aplikasi (users.last_seen_at), request AI,
// atau menyimpan versi file, mana yang paling baru.
type ActiveUser struct {
	Username   string  `json:"username"`
	Email      string  `json:"email"`
	LastSeenAt string  `json:"lastSeenAt"`
	LastAIAt   *string `json:"lastAiAt"`
	Projects   int64   `json:"projects"`
	Plan       *string `json:"plan"`
	SiteURL    string  `json:"siteUrl"`
}

type ActiveUsers struct {
	Day   int64        `json:"day"`  // aktif dalam 24 jam terakhir
	Week  int64        `json:"week"` // aktif dalam 7 hari terakhir
	Users []ActiveUser `json:"users"`
}

// activitySQL: waktu aktif terakhir per akun (ms; 0 = belum pernah tercatat).
const activitySQL = `
	SELECT u.id, MAX(COALESCE(u.last_seen_at, 0), COALESCE(ai.lastAt, 0), COALESCE(v.lastAt, 0)) AS seenAt, ai.lastAt AS lastAiAt
	FROM users u
	LEFT JOIN (SELECT user_id, MAX(created_at) AS lastAt FROM ai_requests GROUP BY user_id) ai ON ai.user_id = u.id
	LEFT JOIN (SELECT user_id, MAX(created_at) AS lastAt FROM versions GROUP BY user_id) v ON v.user_id = u.id`

type Stats struct {
	GeneratedAt    string           `json:"generatedAt"`
	Days           int              `json:"days"`
	Users          Users            `json:"users"`
	SignupsByDay   []Day            `json:"signupsByDay"`
	AI             AI               `json:"ai"`
	Credits        Credits          `json:"credits"`
	Subscribers    map[string]int64 `json:"subscribers"`
	CreditUsers    []CreditUser     `json:"creditUsers"`
	Revenue        Revenue          `json:"revenue"`
	RevenueByDay   []Day            `json:"revenueByDay"`
	RecentPayments []Payment        `json:"recentPayments"`
	TopUsers       []TopUser        `json:"topUsers"`
	TokenRanking   TokenRanking     `json:"tokenRanking"`
	RecentUsers    []RecentUser     `json:"recentUsers"`
	ActiveUsers    ActiveUsers      `json:"activeUsers"`
	Storage        *Storage         `json:"storage"`
	Queue          aiqueue.Stats    `json:"queue"`
}

// siteURL: alamat website project pertama user, atau <username> bila belum punya project.
func (s *Service) siteURL(slug *string, username string) string {
	if slug != nil {
		return s.cfg.SiteURL(*slug)
	}
	return s.cfg.SiteURL(username)
}

// Stats: statistik `days` hari terakhir (7, 30, atau 90).
func (s *Service) Stats(days int) (*Stats, error) {
	now := time.Now().UnixMilli()
	dayList := lastDays(now, days)
	since := now - int64(days)*dayMs
	sinceISO := plans.ISO(since)
	today := dayList[len(dayList)-1]
	localDay := func(col string) string { return "date(" + col + " / 1000, 'unixepoch', '" + tzOffset + "')" }
	out := &Stats{GeneratedAt: plans.ISO(now), Days: days}

	// Tiap query mencatat kesalahan pertamanya; hasilnya dikembalikan di akhir.
	var firstErr error
	count := func(query string, args ...any) int64 {
		n, err := s.count(query, args...)
		if err != nil && firstErr == nil {
			firstErr = err
		}
		return n
	}
	keep := func(err error) {
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}

	// Pengguna
	out.Users = Users{
		Total:          count("SELECT COUNT(*) FROM users"),
		Projects:       count("SELECT COUNT(*) FROM projects"),
		InPeriod:       count("SELECT COUNT(*) FROM users WHERE created_at >= ?", since),
		Today:          count("SELECT COUNT(*) FROM users WHERE "+localDay("created_at")+" = ?", today),
		ActiveSessions: count("SELECT COUNT(DISTINCT user_id) FROM sessions WHERE expires_at > ?", now),
	}
	var err error
	out.SignupsByDay, err = s.fillDays(dayList, []string{"count"}, `
		SELECT `+localDay("created_at")+` AS date, COUNT(*) FROM users WHERE created_at >= ? GROUP BY date`, since-dayMs)
	keep(err)

	// AI
	ai := &out.AI
	keep(s.db.QueryRow(`
		SELECT COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COUNT(DISTINCT user_id)
		FROM ai_requests WHERE created_at >= ?`, since).Scan(&ai.Requests, &ai.TokensIn, &ai.TokensOut, &ai.Users))
	ai.ByStatus = map[string]int64{}
	keep(s.each(func(rows *sql.Rows) error {
		var status string
		var n int64
		err := rows.Scan(&status, &n)
		ai.ByStatus[status] = n
		return err
	}, "SELECT status, COUNT(*) AS n FROM ai_requests WHERE created_at >= ? GROUP BY status ORDER BY n DESC", since))
	ai.ByDay, err = s.fillDays(dayList, []string{"requests", "failed", "tokens"}, `
		SELECT `+localDay("created_at")+` AS date, COUNT(*),
		       SUM(CASE WHEN status = 'ok' THEN 0 ELSE 1 END),
		       COALESCE(SUM(input_tokens + output_tokens), 0)
		FROM ai_requests WHERE created_at >= ? GROUP BY date`, since-dayMs)
	keep(err)
	ai.Models = []ModelRequests{}
	keep(s.each(func(rows *sql.Rows) error {
		var m ModelRequests
		err := rows.Scan(&m.Model, &m.Requests)
		ai.Models = append(ai.Models, m)
		return err
	}, "SELECT model, COUNT(*) AS requests FROM ai_requests WHERE created_at >= ? GROUP BY model ORDER BY requests DESC", since))
	ai.CurrentModel = s.models.Get().Model
	ai.CodeQuality, err = s.codeQuality(since)
	keep(err)

	// Kredit
	out.Credits = Credits{
		UsedToday:            count("SELECT COALESCE(SUM(used), 0) FROM ai_usage WHERE period = ?", credits.FreePeriod()),
		PurchasedOutstanding: count("SELECT COALESCE(SUM(balance), 0) FROM credit_balance"),
		FreePerUser:          s.plans.FreeDailyCredits(),
		FreeBonus:            s.plans.FreeBonusCredits(),
	}

	// Langganan yang masih aktif, per paket
	out.Subscribers = map[string]int64{}
	keep(s.each(func(rows *sql.Rows) error {
		var plan string
		var n int64
		err := rows.Scan(&plan, &n)
		out.Subscribers[plan] = n
		return err
	}, "SELECT plan, COUNT(*) FROM subscriptions WHERE expires_at > ? GROUP BY plan", now))

	// Pendapatan (hanya pembayaran berhasil)
	out.Revenue = Revenue{
		AllTime:     count("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'succeeded'"),
		InPeriod:    count("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'succeeded' AND paid_at >= ?", sinceISO),
		PaidCount:   count("SELECT COUNT(*) FROM payments WHERE status = 'succeeded' AND paid_at >= ?", sinceISO),
		CreditsSold: count("SELECT COALESCE(SUM(credits), 0) FROM payments WHERE status = 'succeeded' AND paid_at >= ?", sinceISO),
		PayingUsers: count("SELECT COUNT(DISTINCT user_id) FROM payments WHERE status = 'succeeded'"),
		Pending:     count("SELECT COUNT(*) FROM payments WHERE status = 'pending' AND provider_id IS NOT NULL"),
		Livemode:    s.cfg.Billing.Livemode,
	}
	out.RevenueByDay, err = s.fillDays(dayList, []string{"amount", "count"}, `
		SELECT date(paid_at, '`+tzOffset+`') AS date, SUM(amount), COUNT(*)
		FROM payments WHERE status = 'succeeded' AND paid_at >= ? GROUP BY date`, plans.ISO(since-dayMs))
	keep(err)
	out.RecentPayments = []Payment{}
	keep(s.each(func(rows *sql.Rows) error {
		var p Payment
		var livemode int
		err := rows.Scan(&p.CreatedAt, &p.PaidAt, &p.Status, &p.PackageID, &p.Credits, &p.Amount, &livemode, &p.Username)
		p.Livemode = livemode != 0
		out.RecentPayments = append(out.RecentPayments, p)
		return err
	}, `
		SELECT p.created_at, p.paid_at, p.status, p.package_id, p.credits, p.amount, p.livemode, u.username
		FROM payments p JOIN users u ON u.id = p.user_id
		ORDER BY p.created_at DESC LIMIT 10`))

	// Pengguna teraktif (AI) dan pendaftar terbaru
	out.TopUsers = []TopUser{}
	keep(s.each(func(rows *sql.Rows) error {
		var u TopUser
		err := rows.Scan(&u.Username, &u.CreatedAt, &u.Slug, &u.AIRequests, &u.Tokens, &u.Spent)
		u.SiteURL = s.siteURL(u.Slug, u.Username)
		out.TopUsers = append(out.TopUsers, u)
		return err
	}, `
		SELECT u.username, u.created_at, `+primarySlug+`,
		       COUNT(r.id) AS aiRequests,
		       COALESCE(SUM(r.input_tokens + r.output_tokens), 0) AS tokens,
		       (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.user_id = u.id AND p.status = 'succeeded')
		FROM users u JOIN ai_requests r ON r.user_id = u.id AND r.created_at >= ?
		GROUP BY u.id ORDER BY aiRequests DESC, tokens DESC LIMIT 10`, since))
	// Ranking token: AI editor + asisten website (assistant_usage.day = tanggal WIB) dalam periode.
	rank := &out.TokenRanking
	rank.EditorTokens = ai.TokensIn + ai.TokensOut
	rank.AssistantTokens = count("SELECT COALESCE(SUM(tokens), 0) FROM assistant_usage WHERE day >= ?", dayList[0])
	rank.Users = []TokenUser{}
	keep(s.each(func(rows *sql.Rows) error {
		var u TokenUser
		var slug *string
		err := rows.Scan(&u.Username, &u.Email, &slug, &u.AIRequests, &u.InTokens, &u.OutTokens, &u.AssistantTokens, &u.AssistantMessages, &u.Spent)
		u.Tokens = u.InTokens + u.OutTokens + u.AssistantTokens
		u.SiteURL = s.siteURL(slug, u.Username)
		rank.Users = append(rank.Users, u)
		return err
	}, `
		SELECT u.username, u.email, `+primarySlug+`,
		       COALESCE(e.requests, 0), COALESCE(e.inTokens, 0), COALESCE(e.outTokens, 0),
		       COALESCE(a.tokens, 0), COALESCE(a.messages, 0),
		       (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.user_id = u.id AND p.status = 'succeeded')
		FROM users u
		LEFT JOIN (
			SELECT user_id, COUNT(*) AS requests, SUM(input_tokens) AS inTokens, SUM(output_tokens) AS outTokens
			FROM ai_requests WHERE created_at >= ? GROUP BY user_id
		) e ON e.user_id = u.id
		LEFT JOIN (
			SELECT p.user_id, SUM(au.tokens) AS tokens, SUM(au.messages) AS messages
			FROM assistant_usage au JOIN projects p ON p.id = au.project_id
			WHERE au.day >= ? GROUP BY p.user_id
		) a ON a.user_id = u.id
		WHERE COALESCE(e.inTokens, 0) + COALESCE(e.outTokens, 0) + COALESCE(a.tokens, 0) > 0
		ORDER BY COALESCE(e.inTokens, 0) + COALESCE(e.outTokens, 0) + COALESCE(a.tokens, 0) DESC, u.username
		LIMIT 20`, since, dayList[0]))
	rank.Actions = []TokenAction{}
	keep(s.each(func(rows *sql.Rows) error {
		var a TokenAction
		var at int64
		var userSlug, projectSlug *string
		err := rows.Scan(&at, &a.Username, &a.Email, &userSlug, &a.Action, &a.Detail, &a.Model, &a.Status, &a.InTokens, &a.OutTokens, &a.Project, &projectSlug)
		a.At = plans.ISO(at)
		a.SiteURL = s.siteURL(userSlug, a.Username)
		if projectSlug != nil {
			url := s.cfg.SiteURL(*projectSlug)
			a.ProjectURL = &url
		}
		rank.Actions = append(rank.Actions, a)
		return err
	}, `
		SELECT r.created_at, u.username, u.email, `+primarySlug+`, r.action, r.detail, r.model, r.status,
		       r.input_tokens, r.output_tokens, p.name, p.slug
		FROM ai_requests r JOIN users u ON u.id = r.user_id LEFT JOIN projects p ON p.id = r.project_id
		WHERE r.input_tokens + r.output_tokens > 0 AND r.id IN (
			SELECT id FROM (SELECT id FROM ai_requests WHERE created_at >= ? ORDER BY input_tokens + output_tokens DESC, id DESC LIMIT 20)
			UNION SELECT id FROM (SELECT id FROM ai_requests WHERE created_at >= ? ORDER BY input_tokens DESC, id DESC LIMIT 20)
			UNION SELECT id FROM (SELECT id FROM ai_requests WHERE created_at >= ? ORDER BY output_tokens DESC, id DESC LIMIT 20))
		ORDER BY r.input_tokens + r.output_tokens DESC, r.id DESC`, since, since, since))

	out.RecentUsers = []RecentUser{}
	keep(s.each(func(rows *sql.Rows) error {
		var u RecentUser
		err := rows.Scan(&u.Username, &u.Email, &u.CreatedAt, &u.Slug, &u.Projects)
		u.SiteURL = s.siteURL(u.Slug, u.Username)
		out.RecentUsers = append(out.RecentUsers, u)
		return err
	}, `
		SELECT username, email, created_at, `+primarySlug+`,
		       (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id)
		FROM users u ORDER BY created_at DESC LIMIT 10`))

	active := &out.ActiveUsers
	keep(s.db.QueryRow(`
		SELECT COALESCE(SUM(seenAt >= ?), 0), COALESCE(SUM(seenAt >= ?), 0) FROM (`+activitySQL+`)`,
		now-dayMs, now-7*dayMs).Scan(&active.Day, &active.Week))
	active.Users = []ActiveUser{}
	keep(s.each(func(rows *sql.Rows) error {
		var u ActiveUser
		var slug *string
		var seenAt int64
		var lastAI sql.NullInt64
		err := rows.Scan(&u.Username, &u.Email, &slug, &seenAt, &lastAI, &u.Projects, &u.Plan)
		u.LastSeenAt = plans.ISO(seenAt)
		if lastAI.Valid {
			iso := plans.ISO(lastAI.Int64)
			u.LastAIAt = &iso
		}
		u.SiteURL = s.siteURL(slug, u.Username)
		active.Users = append(active.Users, u)
		return err
	}, `
		SELECT u.username, u.email, `+primarySlug+`, a.seenAt, a.lastAiAt,
		       (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id),
		       (SELECT plan FROM subscriptions sub WHERE sub.user_id = u.id AND sub.expires_at > ?)
		FROM (`+activitySQL+`) a JOIN users u ON u.id = a.id
		WHERE a.seenAt > 0
		ORDER BY a.seenAt DESC, u.username LIMIT 20`, now))

	freeLimit := int64(s.plans.FreeDailyCredits())
	bonusLimit := int64(s.plans.FreeBonusCredits())
	out.CreditUsers = []CreditUser{}
	keep(s.each(func(rows *sql.Rows) error {
		var id int64
		var slug *string
		var lastAt sql.NullInt64
		u := CreditUser{FreeLimit: freeLimit, BonusLimit: bonusLimit}
		err := rows.Scan(&id, &u.Username, &u.Email, &slug, &u.Used, &u.BonusUsed, &u.Purchased, &u.InTokens, &u.OutTokens, &u.AIRequests, &lastAt)
		u.FreeRemaining = max(0, freeLimit-u.Used)
		u.BonusRemaining = max(0, bonusLimit-u.BonusUsed)
		u.Remaining = u.FreeRemaining + u.BonusRemaining + u.Purchased
		u.Tokens = u.InTokens + u.OutTokens
		if lastAt.Valid {
			iso := plans.ISO(lastAt.Int64)
			u.LastAt = &iso
		}
		u.SiteURL = s.siteURL(slug, u.Username)
		out.CreditUsers = append(out.CreditUsers, u)
		return err
	}, `
		SELECT u.id, u.username, u.email, `+primarySlug+`,
		       COALESCE(usage.used, 0),
		       COALESCE(bonus.used, 0),
		       COALESCE(bal.balance, 0),
		       COALESCE(agg.inTokens, 0),
		       COALESCE(agg.outTokens, 0),
		       COALESCE(agg.requests, 0),
		       agg.lastAt
		FROM users u
		LEFT JOIN ai_usage usage ON usage.user_id = u.id AND usage.period = ?
		LEFT JOIN ai_usage bonus ON bonus.user_id = u.id AND bonus.period = '`+credits.BonusPeriod+`'
		LEFT JOIN credit_balance bal ON bal.user_id = u.id
		LEFT JOIN (
			SELECT user_id,
			       SUM(input_tokens) AS inTokens,
			       SUM(output_tokens) AS outTokens,
			       COUNT(*) AS requests,
			       MAX(created_at) AS lastAt
			FROM ai_requests GROUP BY user_id
		) agg ON agg.user_id = u.id
		ORDER BY (COALESCE(usage.used, 0) + COALESCE(bal.balance, 0)) DESC,
		         (COALESCE(agg.inTokens, 0) + COALESCE(agg.outTokens, 0)) DESC, u.username`, credits.FreePeriod()))

	if firstErr != nil {
		return nil, firstErr
	}
	out.Storage = s.storageStats()
	out.Queue = s.queue.Stats()
	return out, nil
}

// each menjalankan query dan memanggil fn untuk tiap baris.
func (s *Service) each(fn func(*sql.Rows) error, query string, args ...any) error {
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := fn(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}

// codeQuality: ringkasan pemeriksaan kode job Builder per model sejak since, urut jumlah job terbanyak.
func (s *Service) codeQuality(since int64) ([]CodeQuality, error) {
	byModel := map[string]*CodeQuality{}
	err := s.each(func(rows *sql.Rows) error {
		var model, raw string
		if err := rows.Scan(&model, &raw); err != nil {
			return err
		}
		var c struct {
			Found  map[string]int64 `json:"found"`
			Left   map[string]int64 `json:"left"`
			Rounds int64            `json:"rounds"`
		}
		if json.Unmarshal([]byte(raw), &c) != nil {
			return nil
		}
		q := byModel[model]
		if q == nil {
			q = &CodeQuality{Model: model, Found: map[string]int64{}}
			byModel[model] = q
		}
		q.Builds++
		q.Rounds += c.Rounds
		if len(c.Found) > 0 || len(c.Left) > 0 {
			q.Problems++
		}
		if len(c.Left) > 0 {
			q.Left++
		}
		for kind, n := range c.Found {
			q.Found[kind] += n
		}
		return nil
	}, "SELECT model, checks FROM ai_requests WHERE action = 'build' AND status = 'ok' AND checks != '' AND created_at >= ?", since)
	out := make([]CodeQuality, 0, len(byModel))
	for _, q := range byModel {
		out = append(out, *q)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Builds != out[j].Builds {
			return out[i].Builds > out[j].Builds
		}
		return out[i].Model < out[j].Model
	})
	return out, err
}

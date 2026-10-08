// Package assistant: asisten AI untuk website pengguna, memakai AI dari rakit.io dan dibayar dari
// "Saldo Asisten" (Rupiah). Pengunjung website memanggil https://<slug>.rakit.io/api/ai/chat; API key
// provider tidak pernah sampai ke browser. Biaya dihitung dari token yang benar-benar terpakai × harga
// model (diatur owner).
//
// Uang disimpan dalam milirupiah (mRp, 1/1000 Rupiah) supaya pecahan per pesan tetap akurat.
// Sumber dana dipakai berurutan: jatah asisten dari langganan (per siklus 30 hari) → saldo (percobaan
// + isi ulang). Padanan src/assistant.js.
package assistant

import (
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"time"

	"rakit.io/server/internal/aimodels"
	"rakit.io/server/internal/config"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/plans"
	"rakit.io/server/internal/store"
)

const (
	mrp              = 1000
	maxMessages      = 20 // riwayat percakapan yang dikirim pengunjung
	maxMessageChars  = 2000
	maxTotalChars    = 12_000
	maxReplyTokens   = 800
	maxInstructions  = 4000
	typicalTokens    = 1500 // untuk perkiraan "≈ Rp per pesan" yang ditampilkan ke pemilik
	chatTimeout      = 90 * time.Second
	defaultTrial     = 500 // Rupiah, saldo percobaan sekali per akun
	defaultGreeting  = "Halo! Ada yang bisa saya bantu?"
	defaultDailyCap  = 5000
	defaultAssistant = "Asisten"
)

// Model: satu model yang bisa dipilih pemilik website. Cost = Rupiah per 1 juta token dari provider.
type Model struct {
	Key     string  `json:"key"`
	Name    string  `json:"name"`
	Tier    string  `json:"tier"`
	Model   string  `json:"model"`
	Cost    float64 `json:"cost"`
	Markup  float64 `json:"markup"`
	Enabled bool    `json:"enabled"`
}

var defaultModels = []Model{
	{Key: "flash", Name: "DeepSeek V4.1 Flash", Tier: "Hemat", Model: "deepseek-v4.1-flash", Cost: 150, Markup: 3, Enabled: true},
	// deepseek-v4.1-pro belum tersedia di gateway; pakai v4-pro sampai ada.
	{Key: "pro", Name: "DeepSeek V4 Pro", Tier: "Pintar", Model: "deepseek-v4-pro", Cost: 431, Markup: 3, Enabled: true},
}

type Service struct {
	cfg   *config.Config
	store *store.Store
	db    *sql.DB
	plans *plans.Plans

	slots    chan struct{} // antrean kecil khusus asisten, terpisah dari AI Builder
	waiting  chan struct{}
	visitors *httpx.RateLimiter
	sites    *httpx.RateLimiter

	// Providers: provider AI & penerjemah "model@provider" (paket aimodels). Dipasang di main.go.
	Providers *aimodels.Service
}

func New(cfg *config.Config, db *store.Store, p *plans.Plans) *Service {
	return &Service{
		cfg: cfg, store: db, db: db.DB(), plans: p,
		slots:    make(chan struct{}, maxActive),
		waiting:  make(chan struct{}, maxWaiting),
		visitors: httpx.NewRateLimiter(time.Hour, 30, "Kamu sudah banyak bertanya dalam satu jam terakhir. Coba lagi nanti ya."),
		sites:    httpx.NewRateLimiter(time.Minute, 60, "Asisten sedang ramai. Coba lagi sebentar lagi."),
	}
}

// ---------- Model & pengaturan owner platform ----------

// Models: semua model (termasuk yang nonaktif).
func (s *Service) Models() []Model {
	raw, ok := s.store.Setting("assistant_models")
	if !ok {
		return defaultModels
	}
	var models []Model
	if json.Unmarshal([]byte(raw), &models) != nil {
		return defaultModels
	}
	return models
}

func (s *Service) enabledModels() []Model {
	var out []Model
	for _, m := range s.Models() {
		if m.Enabled {
			out = append(out, m)
		}
	}
	return out
}

func (s *Service) trialAmount() int64 {
	raw, ok := s.store.Setting("assistant_trial")
	if !ok {
		return defaultTrial
	}
	var n float64
	if json.Unmarshal([]byte(raw), &n) != nil {
		return defaultTrial
	}
	return int64(n)
}

// pricePerToken: harga jual per token (mRp).
func pricePerToken(m Model) float64 { return m.Cost * m.Markup * mrp / 1e6 }

func round(x float64) float64 { return math.Floor(x + 0.5) }

// perMessage: perkiraan per pesan (Rupiah) untuk ditampilkan.
func perMessage(m Model) float64 { return round(typicalTokens*m.Cost*m.Markup/1e6*100) / 100 }

type PublicModel struct {
	Key        string  `json:"key"`
	Name       string  `json:"name"`
	Tier       string  `json:"tier"`
	PerMessage float64 `json:"perMessage"`
	Per1k      float64 `json:"per1k"`
}

func (s *Service) publicModels() []PublicModel {
	out := []PublicModel{}
	for _, m := range s.enabledModels() {
		out = append(out, PublicModel{m.Key, m.Name, m.Tier, perMessage(m), round(perMessage(m) * 1000)})
	}
	return out
}

// ---------- Saldo ----------

func (s *Service) ensureWallet(q store.Q, userID int64) (balance int64, err error) {
	// Saldo percobaan diberikan sekali, saat dompet pertama kali dibuat (akun lama pun mendapatkannya).
	if _, err := q.Exec("INSERT INTO assistant_wallet (user_id, balance, trial_granted) VALUES (?, ?, 1) ON CONFLICT DO NOTHING", userID, s.trialAmount()*mrp); err != nil {
		return 0, err
	}
	return balance, q.QueryRow("SELECT balance FROM assistant_wallet WHERE user_id = ?", userID).Scan(&balance)
}

type allowance struct {
	period    string
	limit     int64
	spent     int64
	remaining int64
	resetsAt  int64
	plan      string
}

// allowanceOf: jatah per siklus dari paket langganan, atau nil.
func (s *Service) allowanceOf(q store.Q, userID int64) *allowance {
	plan := s.plans.Active(userID)
	if plan == nil || plan.Assistant == 0 {
		return nil
	}
	cycle := plans.CycleOf(plan)
	a := &allowance{period: "asst:" + cycle.Key, limit: int64(plan.Assistant) * mrp, resetsAt: min(cycle.ResetsAt, plan.ExpiresAt), plan: plan.Name}
	q.QueryRow("SELECT spent FROM assistant_allowance WHERE user_id = ? AND period = ?", userID, a.period).Scan(&a.spent)
	a.remaining = max(0, a.limit-a.spent)
	return a
}

type AllowanceInfo struct {
	Plan      string  `json:"plan"`
	Limit     float64 `json:"limit"`
	Remaining float64 `json:"remaining"`
	ResetsAt  string  `json:"resetsAt"`
}

type WalletInfo struct {
	Balance   float64        `json:"balance"`
	Allowance *AllowanceInfo `json:"allowance"`
	Available float64        `json:"available"`
}

// mRp -> Rupiah (2 desimal, dibulatkan ke bawah).
func rupiahDown(m int64) float64 { return math.Floor(float64(m)/10) / 100 }

// mRp -> Rupiah (2 desimal, dibulatkan).
func rupiahRound(m int64) float64 { return round(float64(m)/10) / 100 }

func (s *Service) walletInfo(userID int64) (*WalletInfo, error) {
	balance, err := s.ensureWallet(s.db, userID)
	if err != nil {
		return nil, err
	}
	info := &WalletInfo{Balance: rupiahDown(balance), Available: rupiahDown(balance)}
	if a := s.allowanceOf(s.db, userID); a != nil {
		info.Allowance = &AllowanceInfo{Plan: a.plan, Limit: rupiahDown(a.limit), Remaining: rupiahDown(a.remaining), ResetsAt: plans.ISO(a.resetsAt)}
		info.Available = rupiahDown(balance + a.remaining)
	}
	return info, nil
}

func (s *Service) transaction(fn func(tx *sql.Tx) error) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func changed(res sql.Result, err error) bool {
	if err != nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n == 1
}

// hold: dana yang dicadangkan untuk satu pesan.
type hold struct {
	fromAllowance, fromBalance int64
	period                     string
}

func takeAllowance(tx *sql.Tx, userID int64, a *allowance, amount int64) bool {
	tx.Exec("INSERT INTO assistant_allowance (user_id, period, spent) VALUES (?, ?, 0) ON CONFLICT DO NOTHING", userID, a.period)
	return changed(tx.Exec("UPDATE assistant_allowance SET spent = spent + ? WHERE user_id = ? AND period = ? AND spent + ? <= ?", amount, userID, a.period, amount, a.limit))
}

// reserve mencadangkan dana sebesar perkiraan biaya maksimal.
func (s *Service) reserve(userID, amount int64) (*hold, error) {
	if _, err := s.ensureWallet(s.db, userID); err != nil {
		return nil, err
	}
	h := &hold{}
	err := s.transaction(func(tx *sql.Tx) error {
		if a := s.allowanceOf(tx, userID); a != nil {
			h.period = a.period
			if a.remaining > 0 {
				if h.fromAllowance = min(a.remaining, amount); !takeAllowance(tx, userID, a, h.fromAllowance) {
					h.fromAllowance = 0
				}
			}
		}
		h.fromBalance = amount - h.fromAllowance
		if h.fromBalance > 0 && !changed(tx.Exec("UPDATE assistant_wallet SET balance = balance - ? WHERE user_id = ? AND balance >= ?", h.fromBalance, userID, h.fromBalance)) {
			return httpx.Errorf(402, "Saldo asisten website ini habis.")
		}
		return nil
	})
	return h, err
}

const addBalanceSQL = `
	INSERT INTO assistant_wallet (user_id, balance, trial_granted) VALUES (?, ?, 0)
	ON CONFLICT (user_id) DO UPDATE SET balance = balance + excluded.balance`

// settle menyelesaikan tagihan: kembalikan sisa cadangan (ke saldo dulu, lalu ke jatah langganan),
// atau tagih kekurangannya bila biaya sebenarnya lebih besar dari perkiraan.
func (s *Service) settle(userID int64, h *hold, actual int64) {
	held := h.fromAllowance + h.fromBalance
	if actual > held {
		s.transaction(func(tx *sql.Tx) error {
			extra := actual - held
			// Kekurangan diambil dari jatah langganan dulu (kalau masih ada), sisanya dari saldo.
			if a := s.allowanceOf(tx, userID); a != nil && a.remaining > 0 {
				if part := min(extra, a.remaining); takeAllowance(tx, userID, a, part) {
					extra -= part
				}
			}
			if extra > 0 {
				// Biaya sebenarnya melebihi cadangan (jarang): tetap ditagih walau saldo jadi sedikit minus.
				tx.Exec("UPDATE assistant_wallet SET balance = balance - ? WHERE user_id = ?", extra, userID)
			}
			return nil
		})
		return
	}
	refund := held - actual
	s.transaction(func(tx *sql.Tx) error {
		if toBalance := min(refund, h.fromBalance); toBalance > 0 {
			tx.Exec(addBalanceSQL, userID, toBalance)
			refund -= toBalance
		}
		if refund > 0 && h.period != "" {
			tx.Exec("UPDATE assistant_allowance SET spent = MAX(0, spent - ?) WHERE user_id = ? AND period = ?", refund, userID, h.period)
		}
		return nil
	})
}

// AddBalance menambah saldo dari pembayaran isi ulang (dipanggil di dalam transaksi pembayaran).
func (s *Service) AddBalance(q store.Q, userID int64, rupiah int) error {
	if _, err := s.ensureWallet(q, userID); err != nil {
		return err
	}
	_, err := q.Exec(addBalanceSQL, userID, int64(rupiah)*mrp)
	return err
}

// ---------- Pengaturan per website ----------

type Settings struct {
	Enabled       bool   `json:"enabled"`
	Blocked       bool   `json:"blocked"`
	ModelKey      string `json:"modelKey"`
	ModelFallback bool   `json:"modelFallback"`
	Name          string `json:"name"`
	Greeting      string `json:"greeting"`
	Instructions  string `json:"instructions"`
	DailyCap      int64  `json:"dailyCap"`
}

func (s *Service) siteSettings(projectID int64) (*Settings, error) {
	out := &Settings{Name: defaultAssistant, Greeting: defaultGreeting, DailyCap: defaultDailyCap}
	var enabled, blocked int
	var modelKey, name, greeting string
	err := s.db.QueryRow("SELECT enabled, blocked, model_key, name, greeting, instructions, daily_cap FROM assistant_sites WHERE project_id = ?", projectID).
		Scan(&enabled, &blocked, &modelKey, &name, &greeting, &out.Instructions, &out.DailyCap)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	out.Enabled, out.Blocked = enabled != 0, blocked != 0
	if name != "" {
		out.Name = name
	}
	if greeting != "" {
		out.Greeting = greeting
	}
	models := s.enabledModels()
	// Model pilihan dinonaktifkan/dihapus admin: pakai model aktif pertama supaya website tetap bisa menjawab.
	for _, m := range models {
		if m.Key == modelKey {
			out.ModelKey = m.Key
		}
	}
	if out.ModelKey == "" && len(models) > 0 {
		out.ModelKey = models[0].Key
		out.ModelFallback = modelKey != ""
	}
	return out, nil
}

type usageDay struct {
	Day      string  `json:"day"`
	Spent    float64 `json:"spent"`
	Messages int64   `json:"messages"`
}

// OwnerView: pengaturan, saldo, dan pemakaian 7 hari untuk pemilik website.
func (s *Service) OwnerView(user *store.User, project *store.Project) (any, error) {
	now := time.Now().UnixMilli()
	days := make([]usageDay, 7)
	index := map[string]int{}
	for i := range days {
		days[i].Day, _ = plans.WIBDay(now - int64(6-i)*plans.DayMs)
		index[days[i].Day] = i
	}
	rows, err := s.db.Query("SELECT day, spent, messages FROM assistant_usage WHERE project_id = ? AND day >= ? ORDER BY day", project.ID, days[0].Day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var day string
		var spent, messages int64
		if err := rows.Scan(&day, &spent, &messages); err != nil {
			return nil, err
		}
		if i, ok := index[day]; ok {
			days[i].Spent, days[i].Messages = rupiahRound(spent), messages
		}
	}
	settings, err := s.siteSettings(project.ID)
	if err != nil {
		return nil, err
	}
	wallet, err := s.walletInfo(user.ID)
	if err != nil {
		return nil, err
	}
	packages := []config.AssistantPackage{}
	if s.cfg.Billing.Enabled {
		packages = s.cfg.Assistant.Packages
	}
	return map[string]any{
		"available": s.Providers.Enabled(),
		"settings":  settings,
		"models":    s.publicModels(),
		"wallet":    wallet,
		"usage":     days,
		"packages":  packages,
		"siteUrl":   s.cfg.SiteURL(project.Slug),
	}, rows.Err()
}

// text meniru String(body[key] ?? bawaan).
func text(body map[string]any, key, fallback string) string {
	if v, ok := body[key]; ok && v != nil {
		return jsconv.String(v)
	}
	return fallback
}

// Save menyimpan pengaturan asisten website dari pemiliknya.
func (s *Service) Save(user *store.User, project *store.Project, body map[string]any) (any, error) {
	current, err := s.siteSettings(project.ID)
	if err != nil {
		return nil, err
	}
	modelKey := text(body, "modelKey", current.ModelKey)
	known := false
	for _, m := range s.enabledModels() {
		known = known || m.Key == modelKey
	}
	if !known {
		return nil, httpx.Errorf(400, "Model tidak tersedia")
	}
	name := jsconv.Slice(strings.TrimSpace(text(body, "name", current.Name)), 40)
	if name == "" {
		name = defaultAssistant
	}
	greeting := jsconv.Slice(strings.TrimSpace(text(body, "greeting", current.Greeting)), 200)
	if greeting == "" {
		greeting = defaultGreeting
	}
	instructions := jsconv.Slice(text(body, "instructions", current.Instructions), maxInstructions)
	dailyCap := float64(current.DailyCap)
	if v, ok := body["dailyCap"]; ok && v != nil {
		switch t := v.(type) {
		case float64:
			dailyCap = t
		case string:
			dailyCap = jsconv.Number(t)
		case bool:
			dailyCap = 0
			if t {
				dailyCap = 1
			}
		default:
			dailyCap = math.NaN()
		}
	}
	if !jsconv.IsInteger(dailyCap) || dailyCap < 100 || dailyCap > 10_000_000 {
		return nil, httpx.Errorf(400, "Batas harian minimal Rp100 (bilangan bulat)")
	}
	enabled := current.Enabled
	if v, ok := body["enabled"]; ok {
		enabled = jsconv.Truthy(v)
	}
	_, err = s.db.Exec(`
		INSERT INTO assistant_sites (project_id, enabled, model_key, name, greeting, instructions, daily_cap, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (project_id) DO UPDATE SET enabled = excluded.enabled, model_key = excluded.model_key, name = excluded.name,
			greeting = excluded.greeting, instructions = excluded.instructions, daily_cap = excluded.daily_cap, updated_at = excluded.updated_at`,
		project.ID, enabled, modelKey, name, greeting, instructions, int64(dailyCap), time.Now().UnixMilli())
	if err != nil {
		return nil, err
	}
	return s.OwnerView(user, project)
}

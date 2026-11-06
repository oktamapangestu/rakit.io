// Package credits: kuota AI. Sumbernya dipakai berurutan:
//   - gratis: jatah prompt harian per akun (mis. 20), reset 00.00 WIB, tidak menumpuk. Satu prompt (dengan gambar
//     pun) = 1 dari jatah ini.
//   - dibeli: saldo kredit dari isi ulang, tidak hangus, dipakai setelah jatah harian habis (prompt bergambar
//     memakai lebih banyak kredit).
package credits

import (
	"database/sql"
	"strconv"
	"strings"
	"time"

	"rakit.io/server/internal/config"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/plans"
	"rakit.io/server/internal/store"
)

type Service struct {
	cfg   *config.Config
	db    *sql.DB
	plans *plans.Plans
	// Hooks: saldo asisten yang ikut dikreditkan saat pembayaran lunas, dan penentu apakah lampiran gambar
	// tersedia. Diisi saat perakitan di main.
	AddAssistantBalance func(q store.Q, userID int64, rupiah int) error
	VisionEnabled       func() bool
	AIEnabled           func() bool                                   // ada provider AI (.env atau dashboard); nil = menurut .env
	AgentEngines        func() any                                    // mesin mode Agen yang aktif; kosong = mode Agen tidak ditampilkan
	PersonalModel       func(userID int64) (model string, agent bool) // AI pribadi yang aktif ("" = AI platform); agent = bisa mode Agen
}

func New(cfg *config.Config, db *store.Store, p *plans.Plans) *Service {
	return &Service{cfg: cfg, db: db.DB(), plans: p}
}

// FreePeriod: baris ai_usage untuk jatah prompt hari ini (WIB).
func FreePeriod() string {
	date, _ := plans.WIBDay(time.Now().UnixMilli())
	return "free:" + date
}

func (s *Service) used(userID int64, period string) int {
	var used int
	s.db.QueryRow("SELECT used FROM ai_usage WHERE user_id = ? AND period = ?", userID, period).Scan(&used)
	return used
}

func (s *Service) purchased(userID int64) int {
	var balance int
	s.db.QueryRow("SELECT balance FROM credit_balance WHERE user_id = ?", userID).Scan(&balance)
	return balance
}

type ImageInfo struct {
	Cost int `json:"cost"`
	Max  int `json:"max"`
}

type Info struct {
	Enabled       bool `json:"enabled"`
	TopupEnabled  bool `json:"topupEnabled"`
	Limit         int  `json:"limit"` // prompt gratis per hari
	Used          int  `json:"used"`  // prompt gratis terpakai hari ini
	FreeRemaining int  `json:"freeRemaining"`
	Purchased     int  `json:"purchased"` // saldo kredit yang dibeli
	// Remaining: sisa kredit yang dibeli (jatah harian dihitung dalam prompt, lihat FreeRemaining).
	Remaining     int        `json:"remaining"`
	CostPerPrompt int        `json:"costPerPrompt"`
	Images        *ImageInfo `json:"images"`           // lampiran gambar di prompt (null = tidak tersedia)
	ResetsAt      string     `json:"resetsAt"`         // jatah harian terisi lagi 00.00 WIB
	Agents        any        `json:"agents,omitempty"` // mesin mode Agen yang aktif (lihat ai.AgentEngines)
	ContextWindow int        `json:"contextWindow"`    // jendela konteks model (token), untuk indikator konteks editor
	// Personal: model AI pribadi yang aktif. Selama terisi, prompt tidak memotong jatah/kredit.
	Personal string `json:"personal,omitempty"`
}

func (s *Service) Info(userID int64) *Info {
	limit := s.plans.DailyPrompts()
	used := s.used(userID, FreePeriod())
	purchased := s.purchased(userID)
	_, resetsAt := plans.WIBDay(time.Now().UnixMilli())
	info := &Info{
		Enabled: s.cfg.AI.Enabled || (s.AIEnabled != nil && s.AIEnabled()), TopupEnabled: s.cfg.Billing.Enabled,
		Limit: limit, Used: used, FreeRemaining: max(0, limit-used),
		Purchased: purchased, Remaining: purchased, CostPerPrompt: s.cfg.AI.CreditsPerPrompt, ResetsAt: plans.ISO(resetsAt),
		ContextWindow: s.cfg.AI.ContextWindow,
	}
	if s.VisionEnabled != nil && s.VisionEnabled() {
		info.Images = &ImageInfo{Cost: s.cfg.AI.ImagePromptCredits, Max: s.cfg.AI.MaxImages}
	}
	if s.AgentEngines != nil {
		info.Agents = s.AgentEngines()
	}
	if s.PersonalModel != nil {
		model, agent := s.PersonalModel(userID)
		if info.Personal = model; model != "" {
			info.Enabled = true
			if !agent {
				info.Agents = nil // tanpa endpoint format Anthropic: permintaan Agen dikerjakan Builder
			}
		}
	}
	return info
}

// Part: kuota yang dipotong dari satu sumber.
type Part struct {
	Source string `json:"source"` // free | purchased (job lama: plan | bonus)
	Period string `json:"period"`
	Cost   int    `json:"cost"`
}

// Reservation: catatan pemotongan kuota, disimpan bersama job supaya bisa dikembalikan walau server sempat
// restart. Bagian pertama di field utama — bentuk JSON lama tetap terbaca — dan sisanya di More.
type Reservation struct {
	Part
	More []Part `json:"more,omitempty"`
}

// Parts: semua bagian reservasi.
func (r *Reservation) Parts() []Part {
	if r == nil || r.Cost <= 0 {
		return nil
	}
	return append([]Part{r.Part}, r.More...)
}

// Reserve memotong kuota sebelum memanggil AI: 1 prompt dari jatah harian bila masih ada, selain itu `cost`
// kredit dari saldo yang dibeli. Dalam satu transaksi, jadi dua prompt bersamaan tidak bisa melewati batas.
func (s *Service) Reserve(userID int64, cost int) (*Reservation, error) {
	if cost <= 0 { // AI gratis (AI_CREDITS_PER_PROMPT=0): tidak ada yang dipotong
		return &Reservation{}, nil
	}
	// Pengaturan dibaca sebelum transaksi, supaya kunci tulis dipegang sesingkat mungkin.
	limit, period := s.plans.DailyPrompts(), FreePeriod()

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var part Part
	res, err := tx.Exec(`
		INSERT INTO ai_usage (user_id, period, used) SELECT ?, ?, 1 WHERE ? > 0
		ON CONFLICT (user_id, period) DO UPDATE SET used = used + 1 WHERE used < ?`, userID, period, limit, limit)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 1 {
		part = Part{"free", period, 1}
	} else {
		res, err := tx.Exec("UPDATE credit_balance SET balance = balance - ? WHERE user_id = ? AND balance >= ?", cost, userID, cost)
		if err != nil {
			return nil, err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return nil, s.noCredits(cost)
		}
		part = Part{"purchased", period, cost}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &Reservation{Part: part}, nil
}

func (s *Service) noCredits(cost int) error {
	limit := s.plans.DailyPrompts()
	var message string
	switch {
	case s.cfg.Billing.Enabled && cost > s.cfg.AI.CreditsPerPrompt:
		message = "Jatah prompt hari ini habis, dan prompt dengan gambar butuh " + strconv.Itoa(cost) + " kredit. Kirim tanpa gambar, atau isi ulang kredit."
	case s.cfg.Billing.Enabled:
		message = "Jatah " + strconv.Itoa(limit) + " prompt hari ini sudah habis. Terisi lagi besok pukul 00.00 WIB, atau isi ulang kredit untuk lanjut sekarang."
	default:
		message = "Jatah " + strconv.Itoa(limit) + " prompt hari ini sudah habis. Terisi lagi besok pukul 00.00 WIB."
	}
	return &httpx.Error{Status: 402, Message: message, Code: "no_credits"}
}

// Refund mengembalikan setiap bagian reservasi ke sumbernya.
func (s *Service) Refund(userID int64, r *Reservation) {
	for _, p := range r.Parts() {
		switch p.Source {
		case "free", "plan", "bonus":
			s.db.Exec("UPDATE ai_usage SET used = MAX(0, used - ?) WHERE user_id = ? AND period = ?", p.Cost, userID, p.Period)
		default:
			addBalance(s.db, userID, p.Cost)
		}
	}
}

func addBalance(q store.Q, userID int64, credits int) error {
	_, err := q.Exec(`
		INSERT INTO credit_balance (user_id, balance) VALUES (?, ?)
		ON CONFLICT (user_id) DO UPDATE SET balance = balance + excluded.balance`, userID, credits)
	return err
}

// Payment: yang dibutuhkan dari satu baris pembayaran untuk mengkreditkannya.
type Payment struct {
	ID        string
	UserID    int64
	PackageID string
	Credits   int
	Amount    int
}

// CreditPayment menambah saldo sekali per pembayaran; aman dipanggil
// berulang (webhook at-least-once + polling). Mengembalikan true bila baru saja dikreditkan.
func (s *Service) CreditPayment(p *Payment, paidAt string) (bool, error) {
	if paidAt == "" {
		paidAt = plans.ISO(time.Now().UnixMilli())
	}
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	// Hanya berhasil sekali per pembayaran -> kredit tidak pernah ditambahkan dua kali.
	res, err := tx.Exec("UPDATE payments SET status = 'succeeded', paid_at = ? WHERE id = ? AND status != 'succeeded'", paidAt, p.ID)
	if err != nil {
		return false, err
	}
	changed, _ := res.RowsAffected()
	if changed == 1 {
		switch {
		case strings.HasPrefix(p.PackageID, "plan:"):
			// Tagihan langganan lama (paket sudah dihapus): tercatat lunas, tidak menambah apa pun.
		case strings.HasPrefix(p.PackageID, "asst:"):
			err = s.AddAssistantBalance(tx, p.UserID, p.Amount)
		default:
			err = addBalance(tx, p.UserID, p.Credits)
		}
		if err != nil {
			return false, err
		}
	}
	return changed == 1, tx.Commit()
}

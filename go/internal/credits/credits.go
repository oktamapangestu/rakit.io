// Package credits: kredit AI. Sumbernya dipakai berurutan:
//   - langganan: kuota Pro per siklus 30 hari, atau batas harian Unlimited (lihat paket plans)
//   - bonus: sekali untuk akun baru (mis. 20), habis pakai & tidak kembali; user lama ikut dapat
//   - gratis: jatah harian, reset 00.00 WIB, tidak menumpuk (sisa hari ini hangus)
//   - dibeli: saldo dari isi ulang, tidak hangus, dipakai setelah jatah gratis habis
//
// Padanan src/credits.js.
package credits

import (
	"database/sql"
	"strconv"
	"strings"
	"time"

	"rakit.icu/server/internal/config"
	"rakit.icu/server/internal/httpx"
	"rakit.icu/server/internal/plans"
	"rakit.icu/server/internal/store"
)

// BonusPeriod: satu baris per user, period tetap (bukan per-hari) sehingga tak menumpuk & tak kembali.
const BonusPeriod = "free:bonus"

type Service struct {
	cfg   *config.Config
	db    *sql.DB
	plans *plans.Plans
	// Hooks: paket lain yang ikut dikreditkan saat pembayaran lunas (saldo asisten), dan penentu
	// apakah lampiran gambar tersedia. Diisi saat perakitan di main.
	AddAssistantBalance func(q store.Q, userID int64, rupiah int) error
	VisionEnabled       func() bool
}

func New(cfg *config.Config, db *store.Store, p *plans.Plans) *Service {
	return &Service{cfg: cfg, db: db.DB(), plans: p}
}

// FreePeriod: baris ai_usage untuk jatah gratis hari ini (WIB).
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

// quota: kuota langganan yang berlaku sekarang (Unlimited: per hari · Pro: per siklus), atau nil.
type quota struct {
	plans.Period
	limit int
}

func planQuota(plan *plans.Plan) *quota {
	switch {
	case plan == nil:
		return nil
	case plan.ID == "unlimited":
		return &quota{plans.DayOf(), plan.DailyLimit}
	}
	return &quota{plans.CycleOf(plan), plan.Credits}
}

type PlanInfo struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	ExpiresAt      string `json:"expiresAt"`
	Quota          int    `json:"quota"` // Pro: kredit per siklus 30 hari · Unlimited: prompt per hari
	QuotaUsed      int    `json:"quotaUsed"`
	QuotaRemaining int    `json:"quotaRemaining"`
	QuotaResetsAt  string `json:"quotaResetsAt"`
}

type ImageInfo struct {
	Cost int `json:"cost"`
	Max  int `json:"max"`
}

type Info struct {
	Enabled       bool `json:"enabled"`
	TopupEnabled  bool `json:"topupEnabled"`
	Limit         int  `json:"limit"` // kredit gratis per hari
	Used          int  `json:"used"`
	FreeRemaining int  `json:"freeRemaining"`
	// Bonus awal: masa perkenalan sebelum jatah harian. Sekali habis, tidak kembali.
	BonusLimit     int        `json:"bonusLimit"`
	BonusRemaining int        `json:"bonusRemaining"`
	BonusUsed      int        `json:"bonusUsed"`
	Purchased      int        `json:"purchased"`
	Remaining      int        `json:"remaining"`
	CostPerPrompt  int        `json:"costPerPrompt"`
	Images         *ImageInfo `json:"images"`   // lampiran gambar di prompt (null = tidak tersedia)
	ResetsAt       string     `json:"resetsAt"` // jatah gratis terisi lagi 00.00 WIB
	Plan           *PlanInfo  `json:"plan"`
}

func (s *Service) Info(userID int64) *Info {
	freeLimit := s.plans.FreeDailyCredits()
	used := s.used(userID, FreePeriod())
	freeRemaining := max(0, freeLimit-used)
	purchased := s.purchased(userID)

	bonusLimit := s.plans.FreeBonusCredits()
	bonusLeft := 0
	if bonusLimit > 0 {
		bonusLeft = max(0, bonusLimit-s.used(userID, BonusPeriod))
	}
	_, resetsAt := plans.WIBDay(time.Now().UnixMilli())
	info := &Info{
		Enabled: s.cfg.AI.Enabled, TopupEnabled: s.cfg.Billing.Enabled,
		Limit: freeLimit, Used: used, FreeRemaining: freeRemaining,
		BonusLimit: bonusLimit, BonusRemaining: bonusLeft, BonusUsed: max(0, bonusLimit-bonusLeft),
		Purchased: purchased, CostPerPrompt: s.cfg.AI.CreditsPerPrompt, ResetsAt: plans.ISO(resetsAt),
	}
	if s.VisionEnabled != nil && s.VisionEnabled() {
		info.Images = &ImageInfo{Cost: s.cfg.AI.ImagePromptCredits, Max: s.cfg.AI.MaxImages}
	}
	planRemaining := 0
	if plan := s.plans.Active(userID); plan != nil {
		q := planQuota(plan)
		planUsed := s.used(userID, q.Key)
		planRemaining = max(0, q.limit-planUsed)
		info.Plan = &PlanInfo{
			ID: plan.ID, Name: plan.Name, ExpiresAt: plans.ISO(plan.ExpiresAt),
			Quota: q.limit, QuotaUsed: planUsed, QuotaRemaining: planRemaining,
			QuotaResetsAt: plans.ISO(min(q.ResetsAt, plan.ExpiresAt)),
		}
	}
	info.Remaining = planRemaining + bonusLeft + freeRemaining + purchased
	return info
}

// Reservation: catatan pemotongan kredit, disimpan bersama job supaya kredit tetap bisa
// dikembalikan walau server sempat restart.
type Reservation struct {
	Source string `json:"source"` // plan | bonus | free | purchased
	Period string `json:"period"`
	Cost   int    `json:"cost"`
}

func (s *Service) ensureUsage(userID int64, period string) {
	s.db.Exec("INSERT INTO ai_usage (user_id, period, used) VALUES (?, ?, 0) ON CONFLICT DO NOTHING", userID, period)
}

// take hanya berhasil kalau kredit masih tersisa -> aman dari race condition.
func (s *Service) take(userID int64, period string, cost, limit int) bool {
	res, err := s.db.Exec("UPDATE ai_usage SET used = used + ? WHERE user_id = ? AND period = ? AND used + ? <= ?", cost, userID, period, cost, limit)
	if err != nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n == 1
}

// Reserve memotong kredit sebelum memanggil AI.
func (s *Service) Reserve(userID int64, cost int) (*Reservation, error) {
	period := FreePeriod()
	if q := planQuota(s.plans.Active(userID)); q != nil {
		s.ensureUsage(userID, q.Key)
		if s.take(userID, q.Key, cost, q.limit) {
			return &Reservation{"plan", q.Key, cost}, nil
		}
	}
	s.ensureUsage(userID, period)
	// Bonus awal dipakai lebih dulu: masa perkenalan sebelum jatah harian.
	if bonusLimit := s.plans.FreeBonusCredits(); bonusLimit > 0 {
		s.ensureUsage(userID, BonusPeriod)
		if s.take(userID, BonusPeriod, cost, bonusLimit) {
			return &Reservation{"bonus", BonusPeriod, cost}, nil
		}
	}
	if s.take(userID, period, cost, s.plans.FreeDailyCredits()) {
		return &Reservation{"free", period, cost}, nil
	}
	if res, err := s.db.Exec("UPDATE credit_balance SET balance = balance - ? WHERE user_id = ? AND balance >= ?", cost, userID, cost); err == nil {
		if n, _ := res.RowsAffected(); n == 1 {
			return &Reservation{"purchased", period, cost}, nil
		}
	}
	billing := s.cfg.Billing.Enabled
	var message string
	switch {
	case cost > s.cfg.AI.CreditsPerPrompt:
		way := "tunggu kredit terisi lagi besok"
		if billing {
			way = "isi ulang kredit"
		}
		message = "Prompt dengan gambar butuh " + strconv.Itoa(cost) + " kredit dan kreditmu belum cukup. Kirim tanpa gambar, atau " + way + "."
	case billing:
		message = "Kredit AI kamu habis. Kredit gratis terisi lagi besok pukul 00.00 WIB, atau berlangganan / isi ulang untuk lanjut sekarang."
	default:
		message = "Kredit AI gratis hari ini sudah habis. Terisi lagi besok pukul 00.00 WIB."
	}
	return nil, &httpx.Error{Status: 402, Message: message, Code: "no_credits"}
}

func (s *Service) Refund(userID int64, r *Reservation) {
	if r == nil {
		return
	}
	switch r.Source {
	case "free", "plan", "bonus":
		s.db.Exec("UPDATE ai_usage SET used = MAX(0, used - ?) WHERE user_id = ? AND period = ?", r.Cost, userID, r.Period)
	default:
		addBalance(s.db, userID, r.Cost)
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

// CreditPayment menambah saldo / mengaktifkan langganan sekali per pembayaran; aman dipanggil
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
		plan := s.plans.FromPackageID(p.PackageID)
		switch {
		case strings.HasPrefix(p.PackageID, "plan:") && plan != nil:
			err = s.plans.Activate(tx, p.UserID, plan)
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

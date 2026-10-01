// Package plans: paket langganan 30 hari (dibayar sekali lewat QRIS, bisa diperpanjang):
//   - pro:       kuota kredit AI per 30 hari + bonus storage
//   - unlimited: tanpa kuota bulanan, dibatasi jumlah prompt per hari (fair use) + bonus storage lebih besar
//
// Storage berlaku per project milik pelanggan, dan kembali ke batas gratis saat langganan berakhir.
// Harga, kuota AI, dan status dijual diatur owner di dashboard (tabel settings, kunci 'plans');
// nilai PLAN_PRO / PLAN_UNLIMITED di .env hanya menjadi default sebelum pernah disimpan.
// Padanan src/plans.js.
package plans

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"time"

	"rakit.io/server/internal/config"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/store"
)

const (
	mb      = 1024 * 1024
	Days    = 30
	DayMs   = 24 * 60 * 60 * 1000
	wibMs   = 7 * 60 * 60 * 1000
	isoTime = "2006-01-02T15:04:05.000Z"
)

// Storage: batas penyimpanan satu project.
type Storage struct {
	TotalSize int64 `json:"totalSize"` // total ukuran file
	Entries   int64 `json:"entries"`   // jumlah file + folder
	DBBytes   int64 `json:"dbBytes"`   // ukuran database
	ImageSize int64 `json:"imageSize"` // ukuran satu gambar
}

// History: riwayat versi yang disimpan per project — umur maksimal (hari) & jumlah maksimal.
type History struct {
	Days int `json:"days"`
	Max  int `json:"max"`
}

var (
	FreeStorage = Storage{TotalSize: 20 * mb, Entries: 500, DBBytes: 10 * mb, ImageSize: 1 * mb}
	FreeHistory = History{Days: 7, Max: 20}
)

// base: bagian tetap tiap paket.
type base struct {
	name      string
	daily     bool // kuota = prompt per hari (WIB); selain itu kredit per 30 hari
	storage   Storage
	history   History
	assistant int // saldo asisten AI website (Rupiah) per siklus 30 hari
	rank      int // urutan untuk upgrade
}

var IDs = []string{"pro", "unlimited"}

var bases = map[string]base{
	"pro": {
		name: "Pro", storage: Storage{TotalSize: 100 * mb, Entries: 2000, DBBytes: 50 * mb, ImageSize: 5 * mb},
		history: History{Days: 30, Max: 200}, assistant: 10_000, rank: 1,
	},
	"unlimited": {
		name: "Unlimited", daily: true, storage: Storage{TotalSize: 250 * mb, Entries: 5000, DBBytes: 100 * mb, ImageSize: 10 * mb},
		history: History{Days: 90, Max: 2000}, assistant: 30_000, rank: 2,
	},
}

// Plan: paket lengkap (bagian tetap + pengaturan owner). StartedAt/ExpiresAt terisi untuk langganan aktif.
type Plan struct {
	ID         string
	Name       string
	Price      int
	Enabled    bool
	Credits    int // Pro: kredit per siklus 30 hari
	DailyLimit int // Unlimited: prompt per hari
	Storage    Storage
	History    History
	Assistant  int

	StartedAt, ExpiresAt int64
}

func (p *Plan) Quota() int {
	if bases[p.ID].daily {
		return p.DailyLimit
	}
	return p.Credits
}

type Plans struct {
	cfg *config.Config
	db  *store.Store
}

func New(cfg *config.Config, db *store.Store) *Plans { return &Plans{cfg: cfg, db: db} }

// ---------- Pengaturan dari dashboard owner ----------

type setting struct {
	Price   float64 `json:"price"`
	Quota   float64 `json:"quota"`
	Enabled bool    `json:"enabled"`
}

// settings: harga, kuota, dan status dijual tiap paket.
func (p *Plans) settings() map[string]setting {
	env := map[string]config.PlanEnv{"pro": p.cfg.PlanPro, "unlimited": p.cfg.PlanUnlimited}
	out := map[string]setting{}
	for _, id := range IDs {
		e := env[id]
		out[id] = setting{Price: float64(e.Price), Quota: float64(e.Quota), Enabled: e.Price > 0 && e.Quota > 0}
	}
	raw, ok := p.db.Setting("plans")
	if !ok {
		return out
	}
	// Nilai rusak: pakai default. Field yang tidak disimpan mempertahankan default-nya.
	var saved map[string]map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &saved) != nil {
		return out
	}
	for _, id := range IDs {
		s := out[id]
		if v, ok := saved[id]["price"]; ok {
			json.Unmarshal(v, &s.Price)
		}
		if v, ok := saved[id]["quota"]; ok {
			json.Unmarshal(v, &s.Quota)
		}
		if v, ok := saved[id]["enabled"]; ok {
			json.Unmarshal(v, &s.Enabled)
		}
		out[id] = s
	}
	return out
}

func (p *Plans) numberSetting(key string, fallback int) int {
	raw, ok := p.db.Setting(key)
	if !ok {
		return fallback
	}
	n, _ := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	return int(n)
}

// FreeDailyCredits: kredit gratis per hari untuk semua pengguna (0 = tanpa AI gratis). Tidak menumpuk.
func (p *Plans) FreeDailyCredits() int {
	return p.numberSetting("free_daily_credits", p.cfg.AI.DailyCredits)
}

// FreeBonusCredits: bonus kredit sekali untuk akun baru — habis pakai, tidak menumpuk, tidak kembali.
func (p *Plans) FreeBonusCredits() int {
	return p.numberSetting("free_bonus_credits", p.cfg.AI.BonusCredits)
}

// Get: paket lengkap, atau nil bila id tidak dikenal.
func (p *Plans) Get(id string) *Plan {
	b, ok := bases[id]
	if !ok {
		return nil
	}
	s := p.settings()[id]
	plan := &Plan{ID: id, Name: b.name, Price: int(s.Price), Enabled: s.Enabled, Storage: b.storage, History: b.history, Assistant: b.assistant}
	if b.daily {
		plan.DailyLimit = int(s.Quota)
	} else {
		plan.Credits = int(s.Quota)
	}
	return plan
}

// Paket nonaktif tetap berlaku untuk pelanggan yang sudah membayar, hanya tidak bisa dibeli.
func forSale(plan *Plan) bool {
	return plan != nil && plan.Enabled && plan.Price > 0 && plan.Quota() > 0
}

func PackageID(planID string) string { return "plan:" + planID }

func (p *Plans) FromPackageID(packageID string) *Plan {
	return p.Get(strings.TrimPrefix(packageID, "plan:"))
}

func (p *Plans) ForSale(planID string) *Plan {
	if plan := p.Get(planID); forSale(plan) {
		return plan
	}
	return nil
}

// Active: langganan aktif akun, atau nil.
func (p *Plans) Active(userID int64) *Plan { return p.activeIn(p.db.DB(), userID) }

func (p *Plans) activeIn(q store.Q, userID int64) *Plan {
	sub, err := store.SubscriptionOf(q, userID)
	if err != nil {
		log.Printf("plans: membaca langganan akun %d: %v", userID, err)
		return nil
	}
	if sub == nil || sub.ExpiresAt <= time.Now().UnixMilli() {
		return nil
	}
	plan := p.Get(sub.Plan)
	if plan == nil {
		return nil
	}
	plan.StartedAt, plan.ExpiresAt = sub.StartedAt, sub.ExpiresAt
	return plan
}

// Period: satu jendela kuota — kunci baris ai_usage dan kapan terisi lagi.
type Period struct {
	Key      string
	ResetsAt int64
}

// CycleOf: kuota Pro dihitung per siklus 30 hari sejak langganan dimulai, supaya perpanjangan
// beberapa bulan tetap mendapat kuota baru tiap siklus.
func CycleOf(plan *Plan) Period {
	const cycle = int64(Days) * DayMs
	n := (time.Now().UnixMilli() - plan.StartedAt) / cycle
	return Period{Key: fmt.Sprintf("sub:%d:%d", plan.StartedAt, n), ResetsAt: plan.StartedAt + (n+1)*cycle}
}

// WIBDay: hari dihitung dalam WIB (UTC+7) — tanggal 'YYYY-MM-DD' dan 00.00 WIB berikutnya (ms).
func WIBDay(nowMs int64) (date string, resetsAt int64) {
	wib := time.UnixMilli(nowMs + wibMs).UTC()
	next := time.Date(wib.Year(), wib.Month(), wib.Day()+1, 0, 0, 0, 0, time.UTC).UnixMilli() - wibMs
	return wib.Format("2006-01-02"), next
}

// DayOf: batas harian Unlimited.
func DayOf() Period {
	date, resetsAt := WIBDay(time.Now().UnixMilli())
	return Period{Key: "day:" + date, ResetsAt: resetsAt}
}

// ISO: waktu (ms) dalam format toISOString() JavaScript.
func ISO(ms int64) string { return time.UnixMilli(ms).UTC().Format(isoTime) }

// AssertCanBuy memastikan paket boleh dibeli sekarang (dipanggil sebelum membuat tagihan).
func (p *Plans) AssertCanBuy(userID int64, plan *Plan) error {
	current := p.Active(userID)
	if current != nil && bases[plan.ID].rank < bases[current.ID].rank {
		return httpx.Errorf(409, "Kamu masih berlangganan %s. Paket %s bisa dibeli setelah masa aktifnya berakhir.", current.Name, plan.Name)
	}
	return nil
}

// Activate mengaktifkan/memperpanjang langganan setelah pembayaran lunas. Dipanggil di dalam
// transaksi pembayaran.
//   - paket sama & masih aktif  → diperpanjang 30 hari dari tanggal berakhir
//   - upgrade (Pro → Unlimited) → mulai sekarang; sisa hari Pro dikonversi ke hari Unlimited sesuai harga
//   - tidak aktif               → mulai sekarang
func (p *Plans) Activate(q store.Q, userID int64, plan *Plan) error {
	const upsert = `
		INSERT INTO subscriptions (user_id, plan, started_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id) DO UPDATE SET plan = excluded.plan, started_at = excluded.started_at,
			expires_at = excluded.expires_at, updated_at = excluded.updated_at`
	now := time.Now().UnixMilli()
	const period = int64(Days) * DayMs
	sub, err := store.SubscriptionOf(q, userID)
	if err != nil {
		return err
	}
	if sub != nil && (sub.ExpiresAt <= now || p.Get(sub.Plan) == nil) {
		sub = nil
	}
	if sub != nil && sub.Plan == plan.ID {
		_, err = q.Exec(upsert, userID, plan.ID, sub.StartedAt, sub.ExpiresAt+period, now)
		return err
	}
	var bonus int64
	if sub != nil && plan.Price > 0 {
		bonus = (sub.ExpiresAt - now) * int64(p.Get(sub.Plan).Price) / int64(plan.Price)
	}
	_, err = q.Exec(upsert, userID, plan.ID, now, now+period+bonus, now)
	return err
}

// StorageFor: batas storage untuk project (dilihat dari langganan pemiliknya).
func (p *Plans) StorageFor(slug string) Storage {
	id, err := p.db.ActivePlanOfProject(slug)
	if err != nil {
		log.Printf("plans: membaca langganan %q: %v", slug, err)
		return FreeStorage
	}
	if b, ok := bases[id]; ok {
		return b.storage
	}
	return FreeStorage
}

// HistoryFor: batas riwayat versi untuk project milik akun ini.
func (p *Plans) HistoryFor(userID int64) History {
	id, err := p.db.ActivePlanOfUser(userID)
	if err != nil {
		log.Printf("plans: membaca langganan akun %d: %v", userID, err)
		return FreeHistory
	}
	if b, ok := bases[id]; ok {
		return b.history
	}
	return FreeHistory
}

// PublicPlan: paket yang dijual, dalam bentuk yang dikirim ke editor.
type PublicPlan struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Price      int     `json:"price"`
	Days       int     `json:"days"`
	Credits    *int    `json:"credits"`
	DailyLimit *int    `json:"dailyLimit"`
	Storage    Storage `json:"storage"`
	History    History `json:"history"`
	Assistant  int     `json:"assistant"`
}

func (p *Plans) Public() []PublicPlan {
	out := []PublicPlan{}
	for _, id := range IDs {
		plan := p.Get(id)
		if !forSale(plan) {
			continue
		}
		view := PublicPlan{ID: plan.ID, Name: plan.Name, Price: plan.Price, Days: Days, Storage: plan.Storage, History: plan.History, Assistant: plan.Assistant}
		quota := plan.Quota()
		if bases[id].daily {
			view.DailyLimit = &quota
		} else {
			view.Credits = &quota
		}
		out = append(out, view)
	}
	return out
}

// ---------- Dashboard owner: harga, kuota, kredit gratis ----------

// Batas nilai yang boleh disimpan owner.
const (
	MinPrice     = 1000
	MaxPrice     = 10_000_000
	MaxQuota     = 100_000
	FreeDailyMax = 1000
	FreeBonusMax = 10_000
)

// AdminPlan: satu paket di dashboard owner.
type AdminPlan struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Price     float64 `json:"price"`
	Quota     float64 `json:"quota"`
	Enabled   bool    `json:"enabled"`
	QuotaUnit string  `json:"quotaUnit"` // credits (per 30 hari) | daily (prompt per hari)
	Storage   Storage `json:"storage"`
}

// AdminPlans: semua paket (termasuk yang tidak dijual) dengan pengaturan owner.
func (p *Plans) AdminPlans() []AdminPlan {
	settings := p.settings()
	out := make([]AdminPlan, 0, len(IDs))
	for _, id := range IDs {
		s, b := settings[id], bases[id]
		unit := "credits"
		if b.daily {
			unit = "daily"
		}
		out = append(out, AdminPlan{ID: id, Name: b.name, Price: s.Price, Quota: s.Quota, Enabled: s.Enabled, QuotaUnit: unit, Storage: b.storage})
	}
	return out
}

// SavePlans memvalidasi dan menyimpan harga, kuota, dan status dijual (q: di dalam transaksi).
// input: id paket -> {price, quota, enabled}; yang tidak disebut mempertahankan nilainya.
func (p *Plans) SavePlans(q store.Q, input map[string]map[string]any) error {
	current := p.settings()
	next := map[string]setting{}
	for _, id := range IDs {
		given, s := input[id], current[id]
		if v := given["price"]; v != nil {
			s.Price = jsconv.ToNumber(v)
		}
		if v := given["quota"]; v != nil {
			s.Quota = jsconv.ToNumber(v)
		}
		if v, ok := given["enabled"]; ok {
			s.Enabled = jsconv.Truthy(v)
		}
		name := bases[id].name
		if !jsconv.IsInteger(s.Price) || s.Price < MinPrice || s.Price > MaxPrice {
			return httpx.Errorf(400, "Harga %s harus bilangan bulat Rp1.000–Rp10.000.000", name)
		}
		if !jsconv.IsInteger(s.Quota) || s.Quota < 1 || s.Quota > MaxQuota {
			return httpx.Errorf(400, "Kuota %s harus bilangan bulat 1–100.000", name)
		}
		next[id] = s
	}
	raw, err := json.Marshal(next)
	if err != nil {
		return err
	}
	return store.SetSettingIn(q, "plans", string(raw))
}

// ModelCost: biaya model AI (Rupiah per 1 juta token), hanya untuk perkiraan margin di dashboard.
func (p *Plans) ModelCost() float64 {
	raw, _ := p.db.Setting("model_cost")
	n := jsconv.Number(raw)
	if math.IsNaN(n) {
		return 0
	}
	return n
}

func (p *Plans) SaveModelCost(q store.Q, value any) error {
	cost := jsconv.ToNumber(value)
	if math.IsNaN(cost) || math.IsInf(cost, 0) || cost < 0 || cost > 10_000_000 {
		return httpx.Errorf(400, "Biaya model tidak valid")
	}
	return store.SetSettingIn(q, "model_cost", jsconv.String(math.Floor(cost*100+0.5)/100))
}

func saveCount(q store.Q, key string, value any, maxValue int, message string) error {
	n := jsconv.ToNumber(value)
	if !jsconv.IsInteger(n) || n < 0 || n > float64(maxValue) {
		return httpx.Errorf(400, "%s harus bilangan bulat 0–%d", message, maxValue)
	}
	return store.SetSettingIn(q, key, jsconv.String(n))
}

func (p *Plans) SaveFreeDailyCredits(q store.Q, value any) error {
	return saveCount(q, "free_daily_credits", value, FreeDailyMax, "Kredit gratis harian")
}

func (p *Plans) SaveFreeBonusCredits(q store.Q, value any) error {
	return saveCount(q, "free_bonus_credits", value, FreeBonusMax, "Bonus kredit awal")
}

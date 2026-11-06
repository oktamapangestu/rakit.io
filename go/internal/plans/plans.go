// Package plans: batas akun. Tidak ada paket langganan: semua akun mendapat batas yang sama (dulu batas paket Pro)
// dan jatah prompt AI per hari (reset 00.00 WIB, diatur owner di dashboard). Setelah jatah habis, AI tetap bisa
// dipakai dengan kredit yang dibeli (isi ulang, lihat billing).
package plans

import (
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

// Batas semua akun.
var (
	FreeStorage = Storage{TotalSize: 100 * mb, Entries: 2000, DBBytes: 50 * mb, ImageSize: 5 * mb}
	FreeHistory = History{Days: 30, Max: 200}
)

type Plans struct {
	cfg *config.Config
	db  *store.Store
}

func New(cfg *config.Config, db *store.Store) *Plans { return &Plans{cfg: cfg, db: db} }

// StorageFor: batas storage project (sama untuk semua akun).
func (p *Plans) StorageFor(slug string) Storage { return FreeStorage }

// HistoryFor: batas riwayat versi project milik akun (sama untuk semua akun).
func (p *Plans) HistoryFor(userID int64) History { return FreeHistory }

// ---------- Pengaturan dari dashboard owner ----------

func (p *Plans) numberSetting(key string, fallback int) int {
	raw, ok := p.db.Setting(key)
	if !ok {
		return fallback
	}
	n, _ := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	return int(n)
}

// DailyPrompts: jatah prompt AI gratis per akun per hari (0 = tanpa AI gratis). Tidak menumpuk.
func (p *Plans) DailyPrompts() int {
	return p.numberSetting("free_daily_prompts", p.cfg.AI.DailyPrompts)
}

// DailyPromptsMax: batas nilai yang boleh disimpan owner.
const DailyPromptsMax = 1000

func (p *Plans) SaveDailyPrompts(q store.Q, value any) error {
	n := jsconv.ToNumber(value)
	if !jsconv.IsInteger(n) || n < 0 || n > DailyPromptsMax {
		return httpx.Errorf(400, "Prompt gratis harian harus bilangan bulat 0–%d", DailyPromptsMax)
	}
	return store.SetSettingIn(q, "free_daily_prompts", jsconv.String(n))
}

// ModelCost: biaya model AI (Rupiah per 1 juta token), hanya untuk perkiraan biaya di dashboard.
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

// ---------- Waktu ----------

// Period: satu jendela kuota — kunci baris ai_usage dan kapan terisi lagi.
type Period struct {
	Key      string
	ResetsAt int64
}

// WIBDay: hari dihitung dalam WIB (UTC+7) — tanggal 'YYYY-MM-DD' dan 00.00 WIB berikutnya (ms).
func WIBDay(nowMs int64) (date string, resetsAt int64) {
	wib := time.UnixMilli(nowMs + wibMs).UTC()
	next := time.Date(wib.Year(), wib.Month(), wib.Day()+1, 0, 0, 0, 0, time.UTC).UnixMilli() - wibMs
	return wib.Format("2006-01-02"), next
}

// ISO: waktu (ms) dalam format toISOString() JavaScript.
func ISO(ms int64) string { return time.UnixMilli(ms).UTC().Format(isoTime) }

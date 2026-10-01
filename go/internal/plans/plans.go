// Package plans: batas penyimpanan per paket langganan. Padanan bagian storage di src/plans.js.
package plans

import "log"

const mb = 1024 * 1024

// Storage: batas penyimpanan satu project.
type Storage struct {
	TotalSize int64 // total ukuran file
	Entries   int64 // jumlah file + folder
	DBBytes   int64 // ukuran database
	ImageSize int64 // ukuran satu gambar
}

var (
	FreeStorage = Storage{TotalSize: 20 * mb, Entries: 500, DBBytes: 10 * mb, ImageSize: 1 * mb}
	planStorage = map[string]Storage{
		"pro":       {TotalSize: 100 * mb, Entries: 2000, DBBytes: 50 * mb, ImageSize: 5 * mb},
		"unlimited": {TotalSize: 250 * mb, Entries: 5000, DBBytes: 100 * mb, ImageSize: 10 * mb},
	}
)

// History: riwayat versi yang disimpan per project — umur maksimal (hari) & jumlah maksimal.
type History struct {
	Days int `json:"days"`
	Max  int `json:"max"`
}

var (
	FreeHistory = History{Days: 7, Max: 20}
	planHistory = map[string]History{"pro": {Days: 30, Max: 200}, "unlimited": {Days: 90, Max: 2000}}
)

// Subscriptions: yang dibutuhkan dari database utama.
type Subscriptions interface {
	// ActivePlanOfUser: id paket langganan akun yang masih berlaku, atau "".
	ActivePlanOfUser(userID int64) (string, error)
	// ActivePlanOfProject: id paket langganan pemilik project yang masih berlaku, atau "".
	ActivePlanOfProject(slug string) (string, error)
}

type Plans struct {
	subs Subscriptions
}

func New(subs Subscriptions) *Plans { return &Plans{subs: subs} }

// StorageFor: batas storage untuk project (dilihat dari langganan pemiliknya). Kembali ke batas
// gratis saat langganan berakhir.
func (p *Plans) StorageFor(slug string) Storage {
	plan, err := p.subs.ActivePlanOfProject(slug)
	if err != nil {
		log.Printf("plans: membaca langganan %q: %v", slug, err)
		return FreeStorage
	}
	if s, ok := planStorage[plan]; ok {
		return s
	}
	return FreeStorage
}

// HistoryFor: batas riwayat versi untuk project milik akun ini.
func (p *Plans) HistoryFor(userID int64) History {
	plan, err := p.subs.ActivePlanOfUser(userID)
	if err != nil {
		log.Printf("plans: membaca langganan akun %d: %v", userID, err)
		return FreeHistory
	}
	if h, ok := planHistory[plan]; ok {
		return h
	}
	return FreeHistory
}

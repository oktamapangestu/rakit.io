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

// Subscriptions: yang dibutuhkan dari database utama.
type Subscriptions interface {
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

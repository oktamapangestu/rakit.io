// Package aimodels: model AI editor (Builder/Plan & pembaca gambar), diatur owner di dashboard. Tiap
// peran punya model utama dan model cadangan: bila model utama gangguan, permintaan dialihkan ke
// cadangan (lihat callAI di paket ai). Nilai di .env hanya default sebelum owner pernah menyimpan.
// Padanan src/aimodels.js.
package aimodels

import (
	"encoding/json"
	"regexp"
	"strings"
	"sync"
	"time"

	"rakit.icu/server/internal/config"
	"rakit.icu/server/internal/httpx"
	"rakit.icu/server/internal/jsconv"
	"rakit.icu/server/internal/plans"
	"rakit.icu/server/internal/store"
)

// cooldown: model yang baru saja gangguan dilewati dulu selama ini, supaya permintaan berikutnya
// langsung memakai cadangan tanpa menunggu model utama gagal lagi. Setelah itu dicoba kembali.
const cooldown = 5 * time.Minute

var modelRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$`)

// Models: string kosong = tidak dipakai.
type Models struct {
	Model          string `json:"model"`
	Fallback       string `json:"fallback"`
	Vision         string `json:"vision"`
	VisionFallback string `json:"visionFallback"`
}

type health struct {
	downUntil     time.Time
	failures      int
	lastError     string
	lastFailureAt time.Time
}

// Service menyimpan pengaturan (database) dan kesehatan model (memori — cukup untuk satu proses server).
type Service struct {
	cfg *config.Config
	db  *store.Store

	mu           sync.Mutex
	health       map[string]*health
	fallbackUsed int
}

func New(cfg *config.Config, db *store.Store) *Service {
	return &Service{cfg: cfg, db: db, health: map[string]*health{}}
}

func (s *Service) Get() Models {
	m := Models{Model: s.cfg.AI.Model, Fallback: s.cfg.AI.FallbackModel, Vision: s.cfg.AI.VisionModel, VisionFallback: s.cfg.AI.VisionFallbackModel}
	raw, ok := s.db.Setting("ai_models")
	if !ok {
		return m
	}
	// Pengaturan rusak: pakai default. Hanya nilai teks yang dipakai.
	var saved map[string]any
	if json.Unmarshal([]byte(raw), &saved) != nil {
		return m
	}
	for key, field := range map[string]*string{"model": &m.Model, "fallback": &m.Fallback, "vision": &m.Vision, "visionFallback": &m.VisionFallback} {
		if v, isString := saved[key].(string); isString {
			*field = v
		}
	}
	return m
}

// Save menyimpan pengaturan model dari dashboard owner (divalidasi).
func (s *Service) Save(input map[string]any) (Models, error) {
	clean := func(key string) string { return strings.TrimSpace(jsconv.String(input[key])) }
	m := Models{Model: clean("model"), Fallback: clean("fallback"), Vision: clean("vision"), VisionFallback: clean("visionFallback")}
	if m.Model == "" {
		return m, httpx.Errorf(400, "Model utama wajib diisi")
	}
	for _, f := range []struct{ label, value string }{
		{"Model utama", m.Model}, {"Model cadangan", m.Fallback}, {"Model gambar", m.Vision}, {"Model gambar cadangan", m.VisionFallback},
	} {
		if f.value != "" && !modelRE.MatchString(f.value) {
			return m, httpx.Errorf(400, "%s: ID model tidak valid", f.label)
		}
	}
	switch {
	case m.Fallback == m.Model:
		return m, httpx.Errorf(400, "Model cadangan harus berbeda dari model utama")
	case m.VisionFallback != "" && m.Vision == "":
		return m, httpx.Errorf(400, "Isi model gambar dulu sebelum model gambar cadangan")
	case m.VisionFallback != "" && m.VisionFallback == m.Vision:
		return m, httpx.Errorf(400, "Model gambar cadangan harus berbeda dari model gambar")
	}
	raw, err := json.Marshal(m)
	if err != nil {
		return m, err
	}
	if err := s.db.SetSetting("ai_models", string(raw)); err != nil {
		return m, err
	}
	return s.Get(), nil
}

func (s *Service) isDown(model string) bool {
	h := s.health[model]
	return h != nil && h.downUntil.After(time.Now())
}

// Order: urutan model yang dicoba — yang sehat dulu; bila semuanya sedang gangguan, tetap urutan
// utama → cadangan.
func (s *Service) Order(primary, fallback string) []string {
	var list []string
	for _, m := range []string{primary, fallback} {
		if m != "" && (len(list) == 0 || list[0] != m) {
			list = append(list, m)
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var up, down []string
	for _, m := range list {
		if s.isDown(m) {
			down = append(down, m)
		} else {
			up = append(up, m)
		}
	}
	return append(up, down...)
}

func (s *Service) ReportDown(model, detail string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	h := s.health[model]
	if h == nil {
		h = &health{}
		s.health[model] = h
	}
	now := time.Now()
	h.downUntil, h.lastFailureAt = now.Add(cooldown), now
	h.failures++
	h.lastError = jsconv.Slice(detail, 200)
}

func (s *Service) ReportUp(model string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if h := s.health[model]; h != nil {
		h.downUntil = time.Time{}
	}
}

func (s *Service) CountFallback() {
	s.mu.Lock()
	s.fallbackUsed++
	s.mu.Unlock()
}

type ModelHealth struct {
	Model          string  `json:"model"`
	Down           bool    `json:"down"`
	RetryInSeconds int     `json:"retryInSeconds"`
	Failures       int     `json:"failures"`
	LastError      string  `json:"lastError"`
	LastFailureAt  *string `json:"lastFailureAt"`
}

type View struct {
	Models          Models        `json:"models"`
	CooldownMinutes int           `json:"cooldownMinutes"`
	FallbackUsed    int           `json:"fallbackUsed"`
	Health          []ModelHealth `json:"health"`
}

// View: untuk dashboard owner — pengaturan + keadaan tiap model sejak server dinyalakan.
func (s *Service) View() View {
	models := s.Get()
	s.mu.Lock()
	defer s.mu.Unlock()
	view := View{Models: models, CooldownMinutes: int(cooldown.Minutes()), FallbackUsed: s.fallbackUsed, Health: []ModelHealth{}}
	seen := map[string]bool{}
	now := time.Now()
	for _, model := range []string{models.Model, models.Fallback, models.Vision, models.VisionFallback} {
		if model == "" || seen[model] {
			continue
		}
		seen[model] = true
		item := ModelHealth{Model: model}
		if h := s.health[model]; h != nil {
			item.Failures, item.LastError = h.failures, h.lastError
			if h.downUntil.After(now) {
				item.Down = true
				item.RetryInSeconds = int((h.downUntil.Sub(now) + time.Second - 1) / time.Second)
			}
			if !h.lastFailureAt.IsZero() {
				at := plans.ISO(h.lastFailureAt.UnixMilli())
				item.LastFailureAt = &at
			}
		}
		view.Health = append(view.Health, item)
	}
	return view
}

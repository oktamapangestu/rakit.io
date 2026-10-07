// Package aimodels: model AI editor (Builder/Plan & pembaca gambar), diatur owner di dashboard. Tiap
// peran punya model utama dan daftar model cadangan: bila model utama gangguan, permintaan dialihkan ke
// cadangan berikutnya sesuai urutan (lihat callAI di paket ai). Nilai di .env hanya default sebelum owner
// pernah menyimpan.
// Padanan src/aimodels.js.
package aimodels

import (
	"encoding/json"
	"regexp"
	"strings"
	"sync"
	"time"

	"rakit.io/server/internal/config"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/plans"
	"rakit.io/server/internal/store"
)

// cooldown: model yang baru saja gangguan dilewati dulu selama ini, supaya permintaan berikutnya
// langsung memakai cadangan tanpa menunggu model utama gagal lagi. Setelah itu dicoba kembali.
const cooldown = 5 * time.Minute

// MaxFallbacks: batas model cadangan per peran.
const MaxFallbacks = 5

var modelRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$`)

// Models: string kosong = tidak dipakai. Cadangan dicoba sesuai urutan daftar.
type Models struct {
	Model           string   `json:"model"`
	Fallbacks       []string `json:"fallbacks"`
	Vision          string   `json:"vision"`
	VisionFallbacks []string `json:"visionFallbacks"`
}

// SplitList: "a, b,,c" → [a b c]; untuk .env (AI_FALLBACK_MODEL=a,b).
func SplitList(s string) []string {
	out := []string{}
	for _, part := range strings.Split(s, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

// list: nilai JSON berupa daftar teks, atau satu teks (pengaturan lama sebelum cadangan bisa lebih dari
// satu). ok = false bila bukan keduanya.
func list(v any) (out []string, ok bool) {
	switch v := v.(type) {
	case string:
		return SplitList(v), true
	case []any:
		out = []string{}
		for _, item := range v {
			if s := strings.TrimSpace(jsconv.String(item)); s != "" {
				out = append(out, s)
			}
		}
		return out, true
	}
	return nil, false
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
	m := Models{Model: s.cfg.AI.Model, Fallbacks: SplitList(s.cfg.AI.FallbackModel), Vision: s.cfg.AI.VisionModel, VisionFallbacks: SplitList(s.cfg.AI.VisionFallbackModel)}
	raw, ok := s.db.Setting("ai_models")
	if !ok {
		return m
	}
	// Pengaturan rusak: pakai default. Hanya nilai bertipe benar yang dipakai.
	var saved map[string]any
	if json.Unmarshal([]byte(raw), &saved) != nil {
		return m
	}
	for key, field := range map[string]*string{"model": &m.Model, "vision": &m.Vision} {
		if v, isString := saved[key].(string); isString {
			*field = v
		}
	}
	// Pengaturan lama menyimpan satu cadangan di "fallback"/"visionFallback".
	for _, f := range []struct {
		keys  [2]string
		field *[]string
	}{{[2]string{"fallbacks", "fallback"}, &m.Fallbacks}, {[2]string{"visionFallbacks", "visionFallback"}, &m.VisionFallbacks}} {
		for _, key := range f.keys {
			if v, ok := list(saved[key]); ok {
				*f.field = v
				break
			}
		}
	}
	return m
}

// Save menyimpan pengaturan model dari dashboard owner (divalidasi).
func (s *Service) Save(input map[string]any) (Models, error) {
	clean := func(key string) string { return strings.TrimSpace(jsconv.String(input[key])) }
	// Cadangan: daftar "fallbacks"; satu teks "fallback" (bentuk lama) juga diterima.
	cleanList := func(keys ...string) []string {
		for _, key := range keys {
			if v, ok := list(input[key]); ok {
				return v
			}
		}
		return []string{}
	}
	m := Models{Model: clean("model"), Fallbacks: cleanList("fallbacks", "fallback"), Vision: clean("vision"), VisionFallbacks: cleanList("visionFallbacks", "visionFallback")}
	if m.Model == "" {
		return m, httpx.Errorf(400, "Model utama wajib diisi")
	}
	for _, f := range []struct{ label, value string }{{"Model utama", m.Model}, {"Model gambar", m.Vision}} {
		if f.value != "" && !modelRE.MatchString(f.value) {
			return m, httpx.Errorf(400, "%s: ID model tidak valid", f.label)
		}
	}
	if len(m.VisionFallbacks) > 0 && m.Vision == "" {
		return m, httpx.Errorf(400, "Isi model gambar dulu sebelum model gambar cadangan")
	}
	for _, f := range []struct {
		label, primaryLabel, primary string
		list                         []string
	}{{"Model cadangan", "model utama", m.Model, m.Fallbacks}, {"Model gambar cadangan", "model gambar", m.Vision, m.VisionFallbacks}} {
		if len(f.list) > MaxFallbacks {
			return m, httpx.Errorf(400, "%s maksimal %d", f.label, MaxFallbacks)
		}
		seen := map[string]bool{}
		for i, model := range f.list {
			switch {
			case !modelRE.MatchString(model):
				return m, httpx.Errorf(400, "%s %d: ID model tidak valid", f.label, i+1)
			case model == f.primary:
				return m, httpx.Errorf(400, "%s harus berbeda dari %s", f.label, f.primaryLabel)
			case seen[model]:
				return m, httpx.Errorf(400, "%s \"%s\" tercantum dua kali", f.label, model)
			}
			seen[model] = true
		}
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

// Order: urutan model yang dicoba — yang sehat dulu (utama, lalu cadangan sesuai urutan); yang sedang
// gangguan di belakang dengan urutan yang sama.
func (s *Service) Order(primary string, fallbacks []string) []string {
	var list []string
	seen := map[string]bool{}
	for _, m := range append([]string{primary}, fallbacks...) {
		if m != "" && !seen[m] {
			seen[m] = true
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
	MaxFallbacks    int           `json:"maxFallbacks"`
	FallbackUsed    int           `json:"fallbackUsed"`
	Health          []ModelHealth `json:"health"`
}

// View: untuk dashboard owner — pengaturan + keadaan tiap model sejak server dinyalakan.
func (s *Service) View() View {
	models := s.Get()
	s.mu.Lock()
	defer s.mu.Unlock()
	view := View{Models: models, CooldownMinutes: int(cooldown.Minutes()), MaxFallbacks: MaxFallbacks, FallbackUsed: s.fallbackUsed, Health: []ModelHealth{}}
	seen := map[string]bool{}
	now := time.Now()
	all := append(append(append([]string{models.Model}, models.Fallbacks...), models.Vision), models.VisionFallbacks...)
	for _, model := range all {
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

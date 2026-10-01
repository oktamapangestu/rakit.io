package assistant

import (
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"time"

	"rakit.icu/server/internal/httpx"
	"rakit.icu/server/internal/jsconv"
	"rakit.icu/server/internal/plans"
)

// ---------- Untuk dashboard owner platform ----------

var (
	keyRE   = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,29}$`)
	modelRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$`)
)

// AdminSite: website yang pernah mengatur asisten (atau diblokir owner).
type AdminSite struct {
	Slug          string  `json:"slug"`
	Username      string  `json:"username"`
	Enabled       bool    `json:"enabled"`
	Blocked       bool    `json:"blocked"`
	ModelKey      string  `json:"modelKey"`
	SpentToday    float64 `json:"spentToday"`
	MessagesToday int64   `json:"messagesToday"`
	Spent30       float64 `json:"spent30"`
	Messages30    int64   `json:"messages30"`
	SiteURL       string  `json:"siteUrl"`
}

type AdminView struct {
	Models        []Model     `json:"models"`
	Trial         int64       `json:"trial"`
	TypicalTokens int         `json:"typicalTokens"`
	Sites         []AdminSite `json:"sites"`
}

// AdminView: model (aktif/nonaktif, harga), saldo percobaan, dan 50 website pemakai terbesar (30 hari).
func (s *Service) AdminView() (*AdminView, error) {
	now := time.Now().UnixMilli()
	today, _ := plans.WIBDay(now)
	since, _ := plans.WIBDay(now - 29*plans.DayMs)
	rows, err := s.db.Query(`
		SELECT p.slug, u.username, s.enabled, s.blocked, s.model_key,
		       COALESCE(t.spent, 0), COALESCE(t.messages, 0),
		       COALESCE((SELECT SUM(spent) FROM assistant_usage a WHERE a.project_id = p.id AND a.day >= ?), 0) AS spent30,
		       COALESCE((SELECT SUM(messages) FROM assistant_usage a WHERE a.project_id = p.id AND a.day >= ?), 0)
		FROM assistant_sites s
		JOIN projects p ON p.id = s.project_id
		JOIN users u ON u.id = p.user_id
		LEFT JOIN assistant_usage t ON t.project_id = p.id AND t.day = ?
		ORDER BY spent30 DESC, p.slug LIMIT 50`, since, since, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	models := s.Models()
	enabled := map[string]bool{}
	for _, m := range models {
		if m.Enabled {
			enabled[m.Key] = true
		}
	}
	view := &AdminView{Models: models, Trial: s.trialAmount(), TypicalTokens: typicalTokens, Sites: []AdminSite{}}
	for rows.Next() {
		var site AdminSite
		var on, blocked int
		var spentToday, spent30 int64
		if err := rows.Scan(&site.Slug, &site.Username, &on, &blocked, &site.ModelKey, &spentToday, &site.MessagesToday, &spent30, &site.Messages30); err != nil {
			return nil, err
		}
		site.Enabled, site.Blocked = on != 0, blocked != 0
		if site.ModelKey != "" && !enabled[site.ModelKey] {
			site.ModelKey += " (nonaktif)"
		}
		site.SpentToday, site.Spent30 = rupiahRound(spentToday), rupiahRound(spent30)
		site.SiteURL = s.cfg.SiteURL(site.Slug)
		view.Sites = append(view.Sites, site)
	}
	return view, rows.Err()
}

// round2 meniru Math.round(x * 100) / 100.
func round2(x float64) float64 { return round(x*100) / 100 }

// SaveAdminSettings menyimpan daftar model dan/atau saldo percobaan dari dashboard owner (divalidasi).
// Kunci yang tidak ada di body tidak diubah.
func (s *Service) SaveAdminSettings(body map[string]any) error {
	if raw, ok := body["models"]; ok {
		list, _ := raw.([]any)
		if len(list) == 0 || len(list) > 20 {
			return httpx.Errorf(400, "Daftar model harus berisi 1–20 model")
		}
		seen := map[string]bool{}
		clean := make([]Model, 0, len(list))
		for _, item := range list {
			m, _ := item.(map[string]any)
			number := func(key string) float64 {
				if v, ok := m[key]; ok {
					return jsconv.ToNumber(v)
				}
				return math.NaN() // Number(undefined)
			}
			key := strings.ToLower(strings.TrimSpace(jsconv.String(m["key"])))
			name := jsconv.Slice(strings.TrimSpace(jsconv.String(m["name"])), 60)
			tier := jsconv.Slice(strings.TrimSpace(jsconv.String(m["tier"])), 20)
			model := strings.TrimSpace(jsconv.String(m["model"]))
			cost, markup := number("cost"), number("markup")
			if !keyRE.MatchString(key) || seen[key] {
				return httpx.Errorf(400, "Kode model \"%s\" tidak valid atau ganda (huruf kecil, angka, -)", key)
			}
			seen[key] = true
			if name == "" {
				return httpx.Errorf(400, "Nama model \"%s\" wajib diisi", key)
			}
			if !modelRE.MatchString(model) {
				return httpx.Errorf(400, "ID model di gateway untuk \"%s\" tidak valid", name)
			}
			if math.IsNaN(cost) || math.IsInf(cost, 0) || cost <= 0 || cost > 1_000_000 {
				return httpx.Errorf(400, "Biaya %s harus lebih dari 0 (Rp per 1 juta token)", name)
			}
			if math.IsNaN(markup) || markup < 1 || markup > 20 {
				return httpx.Errorf(400, "Margin %s harus 1–20×", name)
			}
			clean = append(clean, Model{Key: key, Name: name, Tier: tier, Model: model, Cost: round2(cost), Markup: round2(markup), Enabled: jsconv.Truthy(m["enabled"])})
		}
		data, err := json.Marshal(clean)
		if err != nil {
			return err
		}
		if err := s.store.SetSetting("assistant_models", string(data)); err != nil {
			return err
		}
	}
	if raw, ok := body["trial"]; ok {
		n := jsconv.ToNumber(raw)
		if !jsconv.IsInteger(n) || n < 0 || n > 1_000_000 {
			return httpx.Errorf(400, "Saldo percobaan harus bilangan bulat Rupiah")
		}
		if err := s.store.SetSetting("assistant_trial", jsconv.String(n)); err != nil {
			return err
		}
	}
	return nil
}

// SetBlocked memblokir (atau membuka blokir) asisten di website project. Website yang belum pernah
// mengatur asisten pun bisa diblokir.
func (s *Service) SetBlocked(slug string, blocked bool) error {
	project, err := s.store.ProjectBySlug(slug)
	if err != nil {
		return err
	}
	if project == nil {
		return httpx.Errorf(404, "Project tidak ditemukan")
	}
	_, err = s.db.Exec(`
		INSERT INTO assistant_sites (project_id, blocked, updated_at) VALUES (?, ?, ?)
		ON CONFLICT (project_id) DO UPDATE SET blocked = excluded.blocked, updated_at = excluded.updated_at`,
		project.ID, blocked, time.Now().UnixMilli())
	return err
}

package ai

// AI pribadi: pengguna memasang endpoint kompatibel OpenAI (OpenAI, DeepSeek, Groq, OpenRouter, Ollama, …) dengan
// API key-nya sendiri di tab "Provider AI". Selama aktif, Builder/Plan, diagram, dan draf catatan memakai endpoint
// itu tanpa memotong jatah prompt/kredit, tanpa antrean bersama, dan tanpa model cadangan. Mode Agen (Claude Agent
// SDK) butuh format Anthropic: bila pengguna mengisi agent_base_url (mis. https://api.anthropic.com/v1), mode Agen
// memakai base URL itu dengan key & model yang sama; bila kosong, permintaan Agen dikerjakan Builder. Key disimpan di
// user_ai_provider dan tidak pernah dikirim balik ke browser.

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"rakit.io/server/internal/aimodels"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
)

type personalKey struct{}

// withPersonal: konteks job yang memakai AI pribadi.
func withPersonal(ctx context.Context, ep *aimodels.Endpoint) context.Context {
	if ep == nil {
		return ctx
	}
	return context.WithValue(ctx, personalKey{}, ep)
}

// personalOf: endpoint AI pribadi job ini, atau nil (AI platform).
func personalOf(ctx context.Context) *aimodels.Endpoint {
	if ctx == nil {
		return nil
	}
	ep, _ := ctx.Value(personalKey{}).(*aimodels.Endpoint)
	return ep
}

type personalRow struct {
	baseURL, apiKey, model, agentBaseURL string
	active                               bool
	updatedAt                            int64
}

func (s *Service) personalRow(userID int64) (*personalRow, error) {
	var r personalRow
	err := s.db.QueryRow("SELECT base_url, api_key, model, agent_base_url, active, updated_at FROM user_ai_provider WHERE user_id = ?", userID).
		Scan(&r.baseURL, &r.apiKey, &r.model, &r.agentBaseURL, &r.active, &r.updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &r, err
}

// Personal: endpoint AI pribadi akun bila terpasang dan aktif, atau nil.
func (s *Service) Personal(userID int64) *aimodels.Endpoint {
	r, err := s.personalRow(userID)
	if err != nil || r == nil || !r.active {
		return nil
	}
	return &aimodels.Endpoint{BaseURL: r.baseURL, APIKey: r.apiKey, Model: r.model}
}

// PersonalAgent: endpoint format Anthropic untuk mode Agen dari AI pribadi yang aktif, atau nil.
func (s *Service) PersonalAgent(userID int64) *aimodels.Endpoint {
	r, err := s.personalRow(userID)
	if err != nil || r == nil || !r.active || r.agentBaseURL == "" {
		return nil
	}
	return &aimodels.Endpoint{BaseURL: r.agentBaseURL, APIKey: r.apiKey, Model: r.model}
}

// PersonalModel: model AI pribadi yang aktif ("" = AI platform) dan apakah mode Agen bisa memakainya. Untuk info
// kredit di editor.
func (s *Service) PersonalModel(userID int64) (model string, agent bool) {
	r, err := s.personalRow(userID)
	if err != nil || r == nil || !r.active {
		return "", false
	}
	return r.model, r.agentBaseURL != ""
}

// PersonalView: pengaturan AI pribadi untuk tab Provider AI (tanpa API key).
type PersonalView struct {
	Configured bool   `json:"configured"`
	Active     bool   `json:"active"`
	BaseURL    string `json:"baseUrl"`
	Model      string `json:"model"`
	// AgentBaseURL: base URL format Anthropic untuk mode Agen ("" = mode Agen dikerjakan Builder).
	AgentBaseURL string `json:"agentBaseUrl"`
	KeyHint      string `json:"keyHint"` // mis. "sk-…a1b2"; "" = tanpa key (mis. Ollama lokal)
	UpdatedAt    int64  `json:"updatedAt"`
}

func keyHint(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		return "…"
	}
	return key[:3] + "…" + key[len(key)-4:]
}

func (s *Service) PersonalView(userID int64) (*PersonalView, error) {
	r, err := s.personalRow(userID)
	if err != nil || r == nil {
		return &PersonalView{}, err
	}
	return &PersonalView{Configured: true, Active: r.active, BaseURL: r.baseURL, Model: r.model, AgentBaseURL: r.agentBaseURL, KeyHint: keyHint(r.apiKey), UpdatedAt: r.updatedAt}, nil
}

// SavePersonal menyimpan AI pribadi: { baseUrl, apiKey, model, active }. apiKey kosong = tetap memakai key lama
// (clearKey: true untuk menghapusnya, mis. Ollama tanpa key). Hanya field yang dikirim yang diubah.
func (s *Service) SavePersonal(userID int64, body map[string]any) (*PersonalView, error) {
	old, err := s.personalRow(userID)
	if err != nil {
		return nil, err
	}
	r := personalRow{active: true}
	if old != nil {
		r = *old
	}
	if v, ok := body["baseUrl"]; ok {
		base, err := aimodels.CleanBaseURL(jsconv.String(v))
		if err != nil {
			return nil, httpx.Errorf(400, "Base URL %s", err.Error())
		}
		r.baseURL = base
	}
	if v, ok := body["agentBaseUrl"]; ok {
		r.agentBaseURL = ""
		if raw := strings.TrimSpace(jsconv.String(v)); raw != "" {
			base, err := aimodels.CleanBaseURL(raw)
			if err != nil {
				return nil, httpx.Errorf(400, "Base URL mode Agen %s", err.Error())
			}
			r.agentBaseURL = base
		}
	}
	if key := strings.TrimSpace(jsconv.String(body["apiKey"])); key != "" {
		if len(key) > 500 {
			return nil, httpx.Errorf(400, "API key terlalu panjang")
		}
		r.apiKey = key
	} else if jsconv.Truthy(body["clearKey"]) {
		r.apiKey = ""
	}
	if v, ok := body["model"]; ok {
		r.model = strings.TrimSpace(jsconv.String(v))
	}
	if v, ok := body["active"]; ok {
		r.active = jsconv.Truthy(v)
	}
	switch {
	case r.baseURL == "":
		return nil, httpx.Errorf(400, "Base URL wajib diisi, mis. https://api.openai.com/v1")
	case r.model == "" || len(r.model) > 200:
		return nil, httpx.Errorf(400, "Nama model wajib diisi (maks. 200 karakter)")
	}
	_, err = s.db.Exec(`
		INSERT INTO user_ai_provider (user_id, base_url, api_key, model, agent_base_url, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (user_id) DO UPDATE SET base_url = excluded.base_url, api_key = excluded.api_key, model = excluded.model,
			agent_base_url = excluded.agent_base_url, active = excluded.active, updated_at = excluded.updated_at`,
		userID, r.baseURL, r.apiKey, r.model, r.agentBaseURL, r.active, time.Now().UnixMilli())
	if err != nil {
		return nil, err
	}
	return s.PersonalView(userID)
}

// DeletePersonal menghapus AI pribadi; AI editor kembali memakai AI platform.
func (s *Service) DeletePersonal(userID int64) error {
	_, err := s.db.Exec("DELETE FROM user_ai_provider WHERE user_id = ?", userID)
	return err
}

// TestPersonal menguji endpoint (GET /models, tanpa biaya token). Tanpa baseUrl/apiKey di body = memakai yang
// tersimpan.
func (s *Service) TestPersonal(ctx context.Context, userID int64, body map[string]any) (aimodels.TestResult, error) {
	r, err := s.personalRow(userID)
	if err != nil {
		return aimodels.TestResult{}, err
	}
	base, key := strings.TrimSpace(jsconv.String(body["baseUrl"])), strings.TrimSpace(jsconv.String(body["apiKey"]))
	if r != nil {
		if base == "" {
			base = r.baseURL
		}
		if key == "" && base == r.baseURL {
			key = r.apiKey
		}
	}
	return aimodels.TestEndpoint(ctx, base, key), nil
}

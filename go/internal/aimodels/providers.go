package aimodels

// Provider AI: endpoint chat completions kompatibel OpenAI (OpenAI, DeepSeek, OpenRouter, Groq, Gemini &
// Anthropic lewat endpoint kompatibelnya, Ollama, …) yang ditambahkan owner di dashboard. Provider dari
// .env (AI_BASE_URL + AI_API_KEY) tetap ada sebagai provider bawaan tanpa ID.
//
// Model merujuk provider dengan akhiran "@id": "gpt-5@openai". Tanpa akhiran = provider bawaan, jadi
// pengaturan lama tetap berlaku. ID model sendiri tidak boleh memuat "@" (lihat modelRE), sehingga
// pemisahannya tidak ambigu.

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
)

// MaxProviders: batas provider tambahan.
const MaxProviders = 20

var providerIDRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,29}$`)

// RefRE: referensi model yang valid, dengan atau tanpa provider ("model" / "model@provider").
var RefRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}(@[a-z0-9][a-z0-9-]{0,29})?$`)

type Provider struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
}

// SplitRef: "gpt-5@openai" → ("gpt-5", "openai"); "deepseek-v4" → ("deepseek-v4", "").
func SplitRef(ref string) (model, provider string) {
	if i := strings.LastIndexByte(ref, '@'); i >= 0 {
		return ref[:i], ref[i+1:]
	}
	return ref, ""
}

// Providers: provider tambahan dari dashboard (tanpa provider bawaan).
func (s *Service) Providers() []Provider {
	raw, ok := s.db.Setting("ai_providers")
	if !ok {
		return []Provider{}
	}
	var list []Provider
	if json.Unmarshal([]byte(raw), &list) != nil {
		return []Provider{}
	}
	return list
}

func (s *Service) provider(id string) (Provider, bool) {
	for _, p := range s.Providers() {
		if p.ID == id {
			return p, true
		}
	}
	return Provider{}, false
}

// Enabled: ada provider yang bisa dipakai (bawaan dari .env, atau tambahan dari dashboard).
func (s *Service) Enabled() bool {
	return s.cfg.AI.Enabled || len(s.Providers()) > 0
}

// Endpoint: alamat & kunci untuk memanggil satu referensi model.
type Endpoint struct {
	BaseURL, APIKey, Model string
}

// Resolve menerjemahkan referensi model menjadi endpoint provider-nya.
func (s *Service) Resolve(ref string) (Endpoint, error) {
	model, id := SplitRef(ref)
	if id == "" {
		if !s.cfg.AI.Enabled {
			return Endpoint{}, fmt.Errorf(`provider bawaan (.env) belum diatur untuk model "%s"`, model)
		}
		return Endpoint{s.cfg.AI.BaseURL, s.cfg.AI.APIKey, model}, nil
	}
	p, ok := s.provider(id)
	if !ok {
		return Endpoint{}, fmt.Errorf(`provider "%s" untuk model "%s" tidak ada (sudah dihapus?)`, id, model)
	}
	return Endpoint{p.BaseURL, p.APIKey, model}, nil
}

// CheckRef memeriksa referensi model dari dashboard: formatnya benar dan provider-nya ada.
func (s *Service) CheckRef(ref string) error {
	if !RefRE.MatchString(ref) {
		return fmt.Errorf("ID model tidak valid")
	}
	if _, id := SplitRef(ref); id != "" {
		if _, ok := s.provider(id); !ok {
			return fmt.Errorf(`provider "%s" belum ada — tambahkan dulu di Provider AI`, id)
		}
	}
	return nil
}

// ---------- Dashboard owner ----------

// ProviderView: provider untuk dashboard. API key tidak pernah dikirim balik, hanya 4 karakter terakhir.
type ProviderView struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	BaseURL string   `json:"baseUrl"`
	HasKey  bool     `json:"hasKey"`
	KeyHint string   `json:"keyHint"`
	Builtin bool     `json:"builtin"` // provider bawaan dari .env: tidak bisa diubah di dashboard
	UsedBy  []string `json:"usedBy"`  // model yang memakainya (provider dipakai tidak bisa dihapus)
}

type ProvidersView struct {
	Providers    []ProviderView `json:"providers"`
	MaxProviders int            `json:"maxProviders"`
}

func keyHint(key string) string {
	if key == "" {
		return ""
	}
	r := []rune(key)
	return "…" + string(r[max(0, len(r)-4):])
}

// usage: provider ID → pemakainya ("Model utama: x", "Asisten Cepat: y"). "" = provider bawaan.
func (s *Service) usage() map[string][]string {
	out := map[string][]string{}
	add := func(label, ref string) {
		if ref == "" {
			return
		}
		_, id := SplitRef(ref)
		out[id] = append(out[id], label+": "+ref)
	}
	m := s.Get()
	add("Model utama", m.Model)
	for i, ref := range m.Fallbacks {
		add(fmt.Sprintf("Cadangan %d", i+1), ref)
	}
	add("Model gambar", m.Vision)
	for i, ref := range m.VisionFallbacks {
		add(fmt.Sprintf("Cadangan gambar %d", i+1), ref)
	}
	add("Autocomplete (.env)", s.cfg.AI.CompleteModel)
	tasks := s.Tasks()
	for _, info := range taskList {
		if t, ok := tasks[info.Key]; ok {
			add(info.Label, t.Model)
			for i, ref := range t.Fallbacks {
				add(fmt.Sprintf("%s cadangan %d", info.Label, i+1), ref)
			}
		}
	}
	if s.AssistantModels != nil {
		for _, a := range s.AssistantModels() {
			add("Asisten "+a[0], a[1])
		}
	}
	return out
}

func (s *Service) ProvidersView() ProvidersView {
	used := s.usage()
	list := []ProviderView{{
		Name: "Bawaan (.env)", BaseURL: s.cfg.AI.BaseURL, HasKey: s.cfg.AI.APIKey != "",
		KeyHint: keyHint(s.cfg.AI.APIKey), Builtin: true, UsedBy: append([]string{}, used[""]...),
	}}
	for _, p := range s.Providers() {
		list = append(list, ProviderView{ID: p.ID, Name: p.Name, BaseURL: p.BaseURL, HasKey: p.APIKey != "",
			KeyHint: keyHint(p.APIKey), UsedBy: append([]string{}, used[p.ID]...)})
	}
	return ProvidersView{Providers: list, MaxProviders: MaxProviders}
}

func cleanBaseURL(raw string) (string, error) {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("harus alamat http(s) lengkap, mis. https://api.openai.com/v1")
	}
	return raw, nil
}

// SaveProviders menyimpan seluruh daftar provider tambahan dari dashboard. API key kosong untuk provider
// yang sudah ada = tetap memakai key lama. Provider yang masih dipakai model tidak bisa dihapus.
func (s *Service) SaveProviders(input map[string]any) (ProvidersView, error) {
	items, isList := input["providers"].([]any)
	if !isList {
		return ProvidersView{}, httpx.Errorf(400, "Daftar provider tidak valid")
	}
	if len(items) > MaxProviders {
		return ProvidersView{}, httpx.Errorf(400, "Provider maksimal %d", MaxProviders)
	}
	old := map[string]Provider{}
	for _, p := range s.Providers() {
		old[p.ID] = p
	}
	seen := map[string]bool{}
	clean := make([]Provider, 0, len(items))
	for _, item := range items {
		m, _ := item.(map[string]any)
		str := func(key string) string { return strings.TrimSpace(jsconv.String(m[key])) }
		p := Provider{ID: strings.ToLower(str("id")), Name: jsconv.Slice(str("name"), 60), APIKey: str("apiKey")}
		if !providerIDRE.MatchString(p.ID) {
			return ProvidersView{}, httpx.Errorf(400, `ID provider "%s" tidak valid (huruf kecil, angka, -; maks. 30)`, p.ID)
		}
		if seen[p.ID] {
			return ProvidersView{}, httpx.Errorf(400, `ID provider "%s" dipakai dua kali`, p.ID)
		}
		seen[p.ID] = true
		if p.Name == "" {
			return ProvidersView{}, httpx.Errorf(400, `Nama provider "%s" wajib diisi`, p.ID)
		}
		base, err := cleanBaseURL(str("baseUrl"))
		if err != nil {
			return ProvidersView{}, httpx.Errorf(400, "Base URL %s %s", p.Name, err.Error())
		}
		p.BaseURL = base
		if len(p.APIKey) > 500 || strings.ContainsAny(p.APIKey, " \t\r\n") {
			return ProvidersView{}, httpx.Errorf(400, "API key %s tidak valid", p.Name)
		}
		if p.APIKey == "" {
			p.APIKey = old[p.ID].APIKey
		}
		clean = append(clean, p)
	}
	used := s.usage()
	var removed []string
	for id := range old {
		if !seen[id] && len(used[id]) > 0 {
			removed = append(removed, id)
		}
	}
	if len(removed) > 0 {
		sort.Strings(removed)
		id := removed[0]
		return ProvidersView{}, httpx.Errorf(400, `Provider "%s" masih dipakai (%s). Ganti model itu dulu sebelum menghapusnya.`, id, strings.Join(used[id], ", "))
	}
	raw, err := json.Marshal(clean)
	if err != nil {
		return ProvidersView{}, err
	}
	if err := s.db.SetSetting("ai_providers", string(raw)); err != nil {
		return ProvidersView{}, err
	}
	return s.ProvidersView(), nil
}

// TestResult: hasil tes koneksi provider (GET /models).
type TestResult struct {
	OK     bool     `json:"ok"`
	Error  string   `json:"error,omitempty"`
	Models []string `json:"models"`
}

// TestProvider menguji provider dengan meminta daftar modelnya (GET {baseUrl}/models, tanpa biaya token).
// input: { id } untuk provider tersimpan / bawaan (id ""), atau { baseUrl, apiKey } untuk yang belum
// disimpan (apiKey kosong + id provider lama = pakai key tersimpan).
func (s *Service) TestProvider(ctx context.Context, input map[string]any) TestResult {
	id := strings.TrimSpace(jsconv.String(input["id"]))
	base, key := strings.TrimSpace(jsconv.String(input["baseUrl"])), strings.TrimSpace(jsconv.String(input["apiKey"]))
	if p, ok := s.provider(id); ok && key == "" {
		key = p.APIKey
	}
	if jsconv.Truthy(input["builtin"]) {
		base, key = s.cfg.AI.BaseURL, s.cfg.AI.APIKey
	}
	base, err := cleanBaseURL(base)
	if err != nil {
		return TestResult{Error: "Base URL " + err.Error(), Models: []string{}}
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/models", nil)
	if err != nil {
		return TestResult{Error: err.Error(), Models: []string{}}
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
		if req.URL.Hostname() == "api.anthropic.com" { // /models Anthropic memakai header miliknya sendiri
			req.Header.Set("x-api-key", key)
			req.Header.Set("anthropic-version", "2023-06-01")
		}
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return TestResult{Error: "Tidak bisa terhubung: " + err.Error(), Models: []string{}}
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode < 200 || res.StatusCode > 299 {
		msg := fmt.Sprintf("Provider menjawab %d", res.StatusCode)
		if res.StatusCode == 401 || res.StatusCode == 403 {
			msg += " — API key salah atau tidak punya akses"
		}
		return TestResult{Error: msg + ": " + jsconv.Slice(strings.TrimSpace(string(body)), 200), Models: []string{}}
	}
	var list struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Models []struct { // Gemini/Ollama memakai "models"
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"models"`
	}
	if json.Unmarshal(body, &list) != nil {
		return TestResult{Error: "Jawaban /models bukan JSON — periksa Base URL (biasanya diakhiri /v1)", Models: []string{}}
	}
	out := []string{}
	for _, m := range list.Data {
		out = append(out, m.ID)
	}
	for _, m := range list.Models {
		out = append(out, strings.TrimPrefix(cmp.Or(m.ID, m.Name), "models/"))
	}
	sort.Strings(out)
	if len(out) > 1000 {
		out = out[:1000]
	}
	return TestResult{OK: true, Models: out}
}

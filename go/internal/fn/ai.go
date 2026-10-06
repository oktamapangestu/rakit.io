package fn

// Library AI fungsi: ai.chat / ai.json / ai.embed di kode fungsi, memakai provider yang dipasang pemilik
// project dengan API key-nya sendiri (tab Fungsi → Provider AI). Penerjemahan ke API tiap provider ada di
// internal/fnai; di sini: penyimpanan provider, validasi argumen dari kode fungsi, gambar, dan pencatatan.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"rakit.io/server/internal/files"
	"rakit.io/server/internal/fnai"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/store"
)

const (
	maxProviders    = 10
	maxAICalls      = 5                // panggilan ai.* per eksekusi
	aiCallTimeout   = 60 * time.Second // per panggilan (tidak dihitung ke batas waktu fungsi)
	maxAIImages     = 4                // gambar per panggilan
	maxAIImageBytes = 5 << 20
	maxAIText       = 200_000 // total karakter teks per panggilan chat
	maxAIMaxTokens  = 32_000
	maxEmbedInputs  = 100
	maxEmbedChars   = 20_000 // per teks
)

var providerNameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,29}$`)

// ---------- Penyimpanan provider ----------

// ProviderInfo: provider untuk editor — tanpa API key (hanya 4 karakter terakhirnya).
type ProviderInfo struct {
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	BaseURL    string `json:"baseUrl"`
	Model      string `json:"model"`
	EmbedModel string `json:"embedModel"`
	Default    bool   `json:"default"`
	KeyHint    string `json:"keyHint"`
	UpdatedAt  int64  `json:"updatedAt"`
	Today      struct {
		Calls        int `json:"calls"`
		Errors       int `json:"errors"`
		InputTokens  int `json:"inputTokens"`
		OutputTokens int `json:"outputTokens"`
	} `json:"today"`
}

type storedProvider struct {
	fnai.Provider
	Default   bool
	UpdatedAt int64
}

func (s *Service) providers(projectID int64) ([]storedProvider, error) {
	rows, err := s.db.Query(`SELECT name, kind, base_url, api_key, model, embed_model, is_default, updated_at
		FROM fn_ai_providers WHERE project_id = ? ORDER BY is_default DESC, name`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []storedProvider
	for rows.Next() {
		var p storedProvider
		if err := rows.Scan(&p.Name, &p.Kind, &p.BaseURL, &p.APIKey, &p.Model, &p.EmbedModel, &p.Default, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ProviderInfos: daftar provider project + pemakaian hari ini (untuk tab Fungsi).
func (s *Service) ProviderInfos(p *store.Project) ([]ProviderInfo, error) {
	list, err := s.providers(p.ID)
	if err != nil {
		return nil, err
	}
	out := make([]ProviderInfo, 0, len(list))
	for _, sp := range list {
		info := ProviderInfo{Name: sp.Name, Kind: sp.Kind, BaseURL: sp.BaseURL, Model: sp.Model, EmbedModel: sp.EmbedModel,
			Default: sp.Default, UpdatedAt: sp.UpdatedAt}
		if key := []rune(sp.APIKey); len(key) > 8 {
			info.KeyHint = "…" + string(key[len(key)-4:])
		} else {
			info.KeyHint = "…"
		}
		s.db.QueryRow("SELECT calls, errors, input_tokens, output_tokens FROM fn_ai_usage WHERE project_id = ? AND day = ? AND provider = ?",
			p.ID, today(), sp.Name).Scan(&info.Today.Calls, &info.Today.Errors, &info.Today.InputTokens, &info.Today.OutputTokens)
		out = append(out, info)
	}
	return out, nil
}

// ProviderInput: isian form provider. APIKey kosong saat mengubah = key lama tetap dipakai.
type ProviderInput struct {
	Name, Kind, BaseURL, APIKey, Model, EmbedModel string
	Default                                        bool
}

// validBaseURL: http(s), bukan website rakit.io. Alamat internal ditolak saat dihubungi (lihat fetch.go).
func (s *Service) validBaseURL(raw string) (string, error) {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil {
		return "", httpx.Errorf(400, "Base URL harus alamat http(s), mis. https://api.groq.com/openai/v1")
	}
	host := strings.ToLower(u.Hostname())
	if base := s.cfg.BaseDomain; host == base || strings.HasSuffix(host, "."+base) {
		return "", httpx.Errorf(400, "Base URL tidak boleh website rakit.io")
	}
	return raw, nil
}

// SetProvider menambah atau mengubah provider. Provider pertama otomatis menjadi default.
func (s *Service) SetProvider(p *store.Project, in ProviderInput) error {
	in.Name = strings.ToLower(strings.TrimSpace(in.Name))
	if !providerNameRE.MatchString(in.Name) {
		return httpx.Errorf(400, "Nama provider: huruf kecil, angka, - atau _ (mis. openai, gemini, groq)")
	}
	if _, ok := fnai.Kinds[in.Kind]; !ok {
		return httpx.Errorf(400, "Jenis provider tidak dikenal")
	}
	in.Model, in.EmbedModel, in.APIKey = strings.TrimSpace(in.Model), strings.TrimSpace(in.EmbedModel), strings.TrimSpace(in.APIKey)
	if in.Model == "" {
		return httpx.Errorf(400, "Model wajib diisi (mis. gpt-4o-mini, claude-sonnet-4-5, gemini-2.5-flash)")
	}
	if len(in.Model) > 120 || len(in.EmbedModel) > 120 || len(in.APIKey) > maxSecretSize {
		return httpx.Errorf(400, "Isian terlalu panjang")
	}
	if strings.TrimSpace(in.BaseURL) != "" {
		u, err := s.validBaseURL(in.BaseURL)
		if err != nil {
			return err
		}
		in.BaseURL = u
	} else if in.Kind == fnai.Compatible {
		return httpx.Errorf(400, "Base URL wajib untuk provider kompatibel OpenAI (mis. https://api.deepseek.com/v1)")
	}
	existing, err := s.providers(p.ID)
	if err != nil {
		return err
	}
	var old *storedProvider
	for i := range existing {
		if existing[i].Name == in.Name {
			old = &existing[i]
		}
	}
	if old == nil {
		if len(existing) >= maxProviders {
			return httpx.Errorf(409, "Maksimal %d provider AI per project", maxProviders)
		}
		if in.APIKey == "" {
			return httpx.Errorf(400, "API key wajib diisi")
		}
		in.Default = in.Default || len(existing) == 0
	} else if in.APIKey == "" {
		in.APIKey = old.APIKey
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if in.Default {
		if _, err := tx.Exec("UPDATE fn_ai_providers SET is_default = 0 WHERE project_id = ?", p.ID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`
		INSERT INTO fn_ai_providers (project_id, name, kind, base_url, api_key, model, embed_model, is_default, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (project_id, name) DO UPDATE SET kind = excluded.kind, base_url = excluded.base_url, api_key = excluded.api_key,
			model = excluded.model, embed_model = excluded.embed_model,
			is_default = CASE WHEN excluded.is_default THEN 1 ELSE fn_ai_providers.is_default END, updated_at = excluded.updated_at`,
		p.ID, in.Name, in.Kind, in.BaseURL, in.APIKey, in.Model, in.EmbedModel, in.Default, time.Now().UnixMilli()); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteProvider menghapus provider; bila itu default, provider lain (urut nama) menjadi default.
func (s *Service) DeleteProvider(p *store.Project, name string) error {
	res, err := s.db.Exec("DELETE FROM fn_ai_providers WHERE project_id = ? AND name = ?", p.ID, strings.ToLower(name))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return httpx.Errorf(404, "Provider tidak ditemukan")
	}
	_, err = s.db.Exec(`UPDATE fn_ai_providers SET is_default = 1 WHERE project_id = ? AND name = (
		SELECT name FROM fn_ai_providers WHERE project_id = ? ORDER BY name LIMIT 1)
		AND NOT EXISTS (SELECT 1 FROM fn_ai_providers WHERE project_id = ? AND is_default = 1)`, p.ID, p.ID, p.ID)
	return err
}

// AIProviderNames: provider project untuk konteks AI Builder, mis. "gemini (Google Gemini, gemini-2.5-flash, default)".
// API key tidak pernah ikut.
func (s *Service) AIProviderNames(slug string) []string {
	p, err := s.store.ProjectBySlug(slug)
	if err != nil || p == nil {
		return nil
	}
	list, err := s.providers(p.ID)
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(list))
	for _, sp := range list {
		note := fnai.Kinds[sp.Kind].Label + ", " + sp.Model
		if sp.Default {
			note += ", default"
		}
		out = append(out, sp.Name+" ("+note+")")
	}
	return out
}

// TestProvider mengirim satu pesan pendek ke provider untuk memeriksa key & model.
func (s *Service) TestProvider(ctx context.Context, p *store.Project, name string) (map[string]any, error) {
	prov, err := s.provider(p.ID, name)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, aiCallTimeout)
	defer cancel()
	start := time.Now()
	res, err := fnai.Chat(ctx, s.aiClient, prov.Provider, fnai.ChatRequest{
		Messages:  []fnai.Message{{Role: "user", Parts: []fnai.Part{{Text: "Balas hanya dengan satu kata: OK"}}}},
		MaxTokens: 256,
	})
	s.recordAI(p.ID, prov.Name, res, err)
	if err != nil {
		return map[string]any{"ok": false, "error": err.Error(), "ms": time.Since(start).Milliseconds()}, nil
	}
	return map[string]any{"ok": true, "text": res.Text, "model": res.Model, "ms": time.Since(start).Milliseconds()}, nil
}

// provider mencari provider berdasarkan nama ("" = default).
func (s *Service) provider(projectID int64, name string) (*storedProvider, error) {
	list, err := s.providers(projectID)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, httpx.Errorf(400, "Belum ada provider AI. Tambahkan di tab Fungsi → Provider AI (isi API key OpenAI, Gemini, Claude, dll).")
	}
	name = strings.ToLower(strings.TrimSpace(name))
	for i, p := range list {
		if (name == "" && p.Default) || p.Name == name {
			return &list[i], nil
		}
	}
	if name == "" {
		return &list[0], nil
	}
	names := make([]string, len(list))
	for i, p := range list {
		names[i] = p.Name
	}
	return nil, httpx.Errorf(400, "Provider AI %q tidak ada. Yang tersedia: %s", name, strings.Join(names, ", "))
}

func (s *Service) recordAI(projectID int64, name string, res *fnai.ChatResult, err error) {
	var in, out, failed int
	if res != nil {
		in, out = res.InputTokens, res.OutputTokens
	}
	if err != nil {
		failed = 1
	}
	s.recordAIUsage(projectID, name, in, out, failed)
}

func (s *Service) recordAIUsage(projectID int64, name string, in, out, failed int) {
	s.db.Exec(`
		INSERT INTO fn_ai_usage (project_id, day, provider, calls, errors, input_tokens, output_tokens) VALUES (?, ?, ?, 1, ?, ?, ?)
		ON CONFLICT (project_id, day, provider) DO UPDATE SET calls = calls + 1, errors = errors + excluded.errors,
			input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`,
		projectID, today(), name, failed, in, out)
}

// ---------- ai.* dari kode fungsi ----------

// aiArgs: argumen ai.chat / ai.json / ai.embed dari prelude.js (sudah dirapikan di sisi JS).
type aiArgs struct {
	Provider    string          `json:"provider"`
	Model       string          `json:"model"`
	System      string          `json:"system"`
	Messages    []aiMessage     `json:"messages"`
	Temperature *float64        `json:"temperature"`
	MaxTokens   int             `json:"maxTokens"`
	Shape       json.RawMessage `json:"shape"`
	Input       json.RawMessage `json:"input"`
}

type aiMessage struct {
	Role    string   `json:"role"`
	Content []aiPart `json:"content"`
}

type aiPart struct {
	Text  *string `json:"text"`
	Image *string `json:"image"`
}

// aiOp menjalankan satu operasi ai.* untuk eksekusi fungsi di target t.
func (s *Service) aiOp(ctx context.Context, t Target, op string, raw []json.RawMessage) (any, error) {
	if op == "ai.providers" {
		list, err := s.providers(t.Project.ID)
		if err != nil {
			return nil, err
		}
		out := []map[string]any{}
		for _, p := range list {
			out = append(out, map[string]any{"name": p.Name, "kind": p.Kind, "model": p.Model, "default": p.Default})
		}
		return out, nil
	}
	var args aiArgs
	if len(raw) < 1 || json.Unmarshal(raw[0], &args) != nil {
		return nil, errors.New("argumen tidak valid")
	}
	prov, err := s.provider(t.Project.ID, args.Provider)
	if err != nil {
		return nil, errors.New(err.Error())
	}
	ctx, cancel := context.WithTimeout(ctx, aiCallTimeout)
	defer cancel()
	switch op {
	case "ai.chat", "ai.json":
		req, err := s.chatRequest(ctx, t, args)
		if err != nil {
			return nil, err
		}
		req.JSON = op == "ai.json"
		if req.JSON && len(args.Shape) > 0 && string(args.Shape) != "null" {
			req.System = strings.TrimSpace(req.System + "\n\nThe JSON object must have exactly this shape (keys and value types):\n" + string(args.Shape))
		}
		res, err := fnai.Chat(ctx, s.aiClient, prov.Provider, req)
		s.recordAI(t.Project.ID, prov.Name, res, err)
		if err != nil {
			return nil, err
		}
		if !req.JSON {
			return map[string]any{"text": res.Text, "model": res.Model, "provider": prov.Name, "finish": res.Finish,
				"usage": map[string]int{"input": res.InputTokens, "output": res.OutputTokens}}, nil
		}
		if v, ok := fnai.ParseJSON(res.Text); ok {
			return v, nil
		}
		// Bukan JSON: minta sekali lagi dalam percakapan yang sama (dihitung sebagai panggilan provider kedua).
		req.Messages = append(req.Messages,
			fnai.Message{Role: "assistant", Parts: []fnai.Part{{Text: res.Text}}},
			fnai.Message{Role: "user", Parts: []fnai.Part{{Text: "That was not valid JSON. Reply again with only the JSON object."}}})
		res, err = fnai.Chat(ctx, s.aiClient, prov.Provider, req)
		s.recordAI(t.Project.ID, prov.Name, res, err)
		if err != nil {
			return nil, err
		}
		if v, ok := fnai.ParseJSON(res.Text); ok {
			return v, nil
		}
		return nil, fmt.Errorf("ai.json: %s tidak mengirim JSON yang valid", prov.Name)

	case "ai.embed":
		var inputs []string
		single := false
		var one string
		if json.Unmarshal(args.Input, &one) == nil {
			inputs, single = []string{one}, true
		} else if json.Unmarshal(args.Input, &inputs) != nil {
			return nil, errors.New("ai.embed: masukan harus teks atau array teks")
		}
		if len(inputs) == 0 || len(inputs) > maxEmbedInputs {
			return nil, fmt.Errorf("ai.embed: 1–%d teks per panggilan", maxEmbedInputs)
		}
		for _, in := range inputs {
			if strings.TrimSpace(in) == "" || len([]rune(in)) > maxEmbedChars {
				return nil, fmt.Errorf("ai.embed: tiap teks 1–%d karakter", maxEmbedChars)
			}
		}
		res, err := fnai.Embed(ctx, s.aiClient, prov.Provider, args.Model, inputs)
		tokens, failed := 0, 0
		if res != nil {
			tokens = res.Tokens
		}
		if err != nil {
			failed = 1
		}
		s.recordAIUsage(t.Project.ID, prov.Name, tokens, 0, failed)
		if err != nil {
			return nil, err
		}
		if single {
			return res.Vectors[0], nil
		}
		return res.Vectors, nil
	}
	return nil, fmt.Errorf("operasi %q tidak dikenal", op)
}

// chatRequest memvalidasi pesan dari kode fungsi dan memuat gambar-gambarnya.
func (s *Service) chatRequest(ctx context.Context, t Target, args aiArgs) (fnai.ChatRequest, error) {
	req := fnai.ChatRequest{Model: strings.TrimSpace(args.Model), System: args.System, Temperature: args.Temperature, MaxTokens: args.MaxTokens}
	if req.Temperature != nil && (*req.Temperature < 0 || *req.Temperature > 2) {
		return req, errors.New("temperature harus 0–2")
	}
	if req.MaxTokens < 0 || req.MaxTokens > maxAIMaxTokens {
		return req, fmt.Errorf("maxTokens maksimal %d", maxAIMaxTokens)
	}
	if len(args.Messages) == 0 {
		return req, errors.New("ai.chat: tulis pesannya, mis. ai.chat('Halo') atau ai.chat({ messages: [...] })")
	}
	chars, images := len([]rune(args.System)), 0
	for i, m := range args.Messages {
		if m.Role != "user" && m.Role != "assistant" {
			return req, fmt.Errorf("pesan ke-%d: role harus \"user\" atau \"assistant\" (instruksi sistem lewat { system })", i+1)
		}
		msg := fnai.Message{Role: m.Role}
		for _, part := range m.Content {
			switch {
			case part.Image != nil:
				if images++; images > maxAIImages {
					return req, fmt.Errorf("maksimal %d gambar per panggilan", maxAIImages)
				}
				img, err := s.loadImage(ctx, t, *part.Image)
				if err != nil {
					return req, err
				}
				msg.Parts = append(msg.Parts, fnai.Part{Image: img})
			case part.Text != nil:
				chars += len([]rune(*part.Text))
				msg.Parts = append(msg.Parts, fnai.Part{Text: *part.Text})
			}
		}
		if len(msg.Parts) == 0 {
			return req, fmt.Errorf("pesan ke-%d kosong", i+1)
		}
		req.Messages = append(req.Messages, msg)
	}
	if chars > maxAIText {
		return req, fmt.Errorf("teks terlalu panjang (maks. %d karakter per panggilan)", maxAIText)
	}
	return req, nil
}

var imageMIMEs = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true}

// loadImage membaca gambar untuk model vision: data URL, gambar di project ("/uploads/…", "/images/logo.png"),
// atau URL https publik (lewat penjaga alamat internal yang sama dengan fetch).
func (s *Service) loadImage(ctx context.Context, t Target, ref string) (*fnai.Image, error) {
	ref = strings.TrimSpace(ref)
	var data []byte
	switch {
	case strings.HasPrefix(ref, "data:"):
		meta, payload, ok := strings.Cut(strings.TrimPrefix(ref, "data:"), ",")
		if !ok || !strings.HasSuffix(meta, ";base64") {
			return nil, errors.New("gambar: data URL harus base64 (data:image/png;base64,...)")
		}
		decoded, err := base64.StdEncoding.DecodeString(payload)
		if err != nil {
			return nil, errors.New("gambar: base64 tidak valid")
		}
		data = decoded
	case strings.HasPrefix(ref, "/"):
		rel, err := files.CleanPath(strings.SplitN(ref, "?", 2)[0])
		if err != nil || !files.IsImageFile(rel) || Hidden(rel) {
			return nil, fmt.Errorf("gambar %s tidak ada di project", ref)
		}
		abs, err := files.ResolveIn(t.Root, rel)
		if err != nil {
			return nil, fmt.Errorf("gambar %s tidak ada di project", ref)
		}
		info, err := os.Lstat(abs)
		if err != nil || !info.Mode().IsRegular() {
			return nil, fmt.Errorf("gambar %s tidak ada di project", ref)
		}
		if info.Size() > maxAIImageBytes {
			return nil, errors.New("gambar maksimal 5 MB")
		}
		if data, err = os.ReadFile(abs); err != nil {
			return nil, err
		}
	case strings.HasPrefix(ref, "https://") || strings.HasPrefix(ref, "http://"):
		u, err := url.Parse(ref)
		if err != nil || u.Host == "" {
			return nil, fmt.Errorf("gambar: alamat tidak valid (%s)", ref)
		}
		if base := s.cfg.BaseDomain; strings.EqualFold(u.Hostname(), base) || strings.HasSuffix(strings.ToLower(u.Hostname()), "."+base) {
			return nil, errors.New("gambar dari website rakit.io: pakai path-nya saja, mis. \"/uploads/bukti/abc.jpg\"")
		}
		r, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return nil, err
		}
		r.Header.Set("User-Agent", "rakit.io-fungsi")
		resp, err := s.client.Do(r)
		if err != nil {
			if errors.Is(err, errBlocked) {
				return nil, fmt.Errorf("gambar: %v", errBlocked)
			}
			return nil, fmt.Errorf("gambar: gagal mengunduh %s", u.Host)
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("gambar: %s menjawab %d", u.Host, resp.StatusCode)
		}
		if data, err = io.ReadAll(io.LimitReader(resp.Body, maxAIImageBytes+1)); err != nil {
			return nil, errors.New("gambar: unduhan terputus")
		}
	default:
		return nil, errors.New("gambar: pakai URL https://, path gambar di project (\"/uploads/…\"), atau data URL")
	}
	if len(data) > maxAIImageBytes {
		return nil, errors.New("gambar maksimal 5 MB")
	}
	mime := http.DetectContentType(data)
	if !imageMIMEs[mime] {
		return nil, errors.New("gambar harus JPG, PNG, WEBP, atau GIF")
	}
	return &fnai.Image{MIME: mime, Data: data}, nil
}

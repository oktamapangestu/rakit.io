// Package fnai: library AI untuk fungsi serverless (ai.chat / ai.json / ai.embed). Satu bentuk permintaan
// diterjemahkan ke API tiap provider: OpenAI (chat completions), Anthropic (Messages API), Google Gemini
// (generateContent), dan endpoint apa pun yang kompatibel OpenAI (DeepSeek, Groq, OpenRouter, Ollama, …).
// API key milik pemilik project (disimpan di fn_ai_providers) dan tidak pernah sampai ke kode fungsi.
package fnai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// Jenis provider.
const (
	OpenAI     = "openai"
	Anthropic  = "anthropic"
	Gemini     = "gemini"
	Compatible = "compatible"
)

// Kinds: jenis provider beserta alamat & model embedding bawaannya.
var Kinds = map[string]struct {
	Label, BaseURL, EmbedModel string
}{
	OpenAI:     {"OpenAI", "https://api.openai.com/v1", "text-embedding-3-small"},
	Anthropic:  {"Anthropic Claude", "https://api.anthropic.com/v1", ""},
	Gemini:     {"Google Gemini", "https://generativelanguage.googleapis.com/v1beta", "gemini-embedding-001"},
	Compatible: {"Kompatibel OpenAI", "", ""},
}

const maxResponse = 8 << 20 // jawaban provider (embedding bisa besar)

// Provider: satu provider yang dipasang pemilik project.
type Provider struct {
	Name       string // nama yang dipakai di kode: ai.chat({ provider: 'gemini' })
	Kind       string
	BaseURL    string // kosong = alamat bawaan jenisnya
	APIKey     string
	Model      string // model chat bawaan
	EmbedModel string // model embedding (kosong = bawaan jenisnya)
}

func (p Provider) base() string {
	if p.BaseURL != "" {
		return strings.TrimRight(p.BaseURL, "/")
	}
	return Kinds[p.Kind].BaseURL
}

// Image: gambar untuk model vision (sudah diunduh/dibaca server).
type Image struct {
	MIME string
	Data []byte
}

func (i Image) dataURL() string {
	return "data:" + i.MIME + ";base64," + base64.StdEncoding.EncodeToString(i.Data)
}

// Part: teks atau gambar dalam satu pesan.
type Part struct {
	Text  string
	Image *Image
}

// Message: pesan percakapan; Role "user" atau "assistant".
type Message struct {
	Role  string
	Parts []Part
}

// ChatRequest: permintaan chat yang sama untuk semua provider.
type ChatRequest struct {
	Model       string
	System      string
	Messages    []Message
	Temperature *float64
	MaxTokens   int
	JSON        bool // minta jawaban berupa objek JSON
}

// ChatResult: jawaban chat.
type ChatResult struct {
	Text         string `json:"text"`
	Model        string `json:"model"`
	Finish       string `json:"finish"`
	InputTokens  int    `json:"-"`
	OutputTokens int    `json:"-"`
}

// Error: kesalahan dari provider, dengan pesan yang bisa ditampilkan ke pemilik fungsi.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return e.Message }

// ---------- HTTP ----------

func post(ctx context.Context, client *http.Client, endpoint string, headers map[string]string, body any, out any, p Provider) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "rakit.io-fungsi")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return &Error{504, fmt.Sprintf("%s tidak menjawab tepat waktu", p.Name)}
		}
		if u, _ := url.Parse(endpoint); u != nil {
			return &Error{502, fmt.Sprintf("gagal menghubungi %s (%s): %v", p.Name, u.Host, unwrap(err))}
		}
		return &Error{502, fmt.Sprintf("gagal menghubungi %s", p.Name)}
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse+1))
	if err != nil {
		return &Error{502, fmt.Sprintf("jawaban %s terputus", p.Name)}
	}
	if len(data) > maxResponse {
		return &Error{502, fmt.Sprintf("jawaban %s terlalu besar", p.Name)}
	}
	if resp.StatusCode >= 300 {
		return providerError(p, resp.StatusCode, data)
	}
	if err := json.Unmarshal(data, out); err != nil {
		return &Error{502, fmt.Sprintf("jawaban %s tidak bisa dibaca", p.Name)}
	}
	return nil
}

// unwrap: pesan terdalam (mis. "alamat internal tidak boleh dihubungi dari fungsi"), tanpa URL lengkap.
func unwrap(err error) error {
	for {
		next := errors.Unwrap(err)
		if next == nil {
			return err
		}
		err = next
	}
}

// providerError menerjemahkan status HTTP & pesan error provider (semua memakai {"error": {"message"}}
// atau {"error": "…"}) menjadi pesan yang jelas.
func providerError(p Provider, status int, data []byte) error {
	var body struct {
		Error   json.RawMessage `json:"error"`
		Message string          `json:"message"`
	}
	json.Unmarshal(data, &body)
	msg := body.Message
	var nested struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(body.Error, &nested) == nil && nested.Message != "" {
		msg = nested.Message
	} else if s := ""; json.Unmarshal(body.Error, &s) == nil && s != "" {
		msg = s
	}
	if msg == "" {
		msg = strings.TrimSpace(string(data))
	}
	if r := []rune(msg); len(r) > 300 {
		msg = string(r[:300]) + "…"
	}
	switch {
	case status == 401 || status == 403:
		return &Error{status, fmt.Sprintf("API key %s ditolak (%d): %s", p.Name, status, msg)}
	case status == 429:
		return &Error{status, fmt.Sprintf("%s menolak karena batas pemakaian/kuota (429): %s", p.Name, msg)}
	case status == 404:
		return &Error{status, fmt.Sprintf("%s: model atau alamat tidak ditemukan (404): %s", p.Name, msg)}
	}
	return &Error{status, fmt.Sprintf("%s menolak permintaan (%d): %s", p.Name, status, msg)}
}

// ---------- Chat ----------

// Chat mengirim satu permintaan chat ke provider.
func Chat(ctx context.Context, client *http.Client, p Provider, req ChatRequest) (*ChatResult, error) {
	if req.Model == "" {
		req.Model = p.Model
	}
	if req.Model == "" {
		return nil, &Error{400, fmt.Sprintf("model untuk %s belum diisi (atur di tab Fungsi → Provider AI, atau kirim { model })", p.Name)}
	}
	if len(req.Messages) == 0 {
		return nil, &Error{400, "pesan kosong"}
	}
	if req.JSON {
		req.System = strings.TrimSpace(req.System + "\n\nReply with only one valid JSON object, with no Markdown and no text around it.")
	}
	switch p.Kind {
	case OpenAI, Compatible:
		return chatOpenAI(ctx, client, p, req)
	case Anthropic:
		return chatAnthropic(ctx, client, p, req)
	case Gemini:
		return chatGemini(ctx, client, p, req)
	}
	return nil, &Error{400, fmt.Sprintf("jenis provider %q tidak dikenal", p.Kind)}
}

func chatOpenAI(ctx context.Context, client *http.Client, p Provider, req ChatRequest) (*ChatResult, error) {
	messages := []map[string]any{}
	if req.System != "" {
		messages = append(messages, map[string]any{"role": "system", "content": req.System})
	}
	for _, m := range req.Messages {
		if len(m.Parts) == 1 && m.Parts[0].Image == nil {
			messages = append(messages, map[string]any{"role": m.Role, "content": m.Parts[0].Text})
			continue
		}
		parts := []map[string]any{}
		for _, part := range m.Parts {
			if part.Image != nil {
				parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]string{"url": part.Image.dataURL()}})
			} else {
				parts = append(parts, map[string]any{"type": "text", "text": part.Text})
			}
		}
		messages = append(messages, map[string]any{"role": m.Role, "content": parts})
	}
	body := map[string]any{"model": req.Model, "messages": messages}
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}
	if req.MaxTokens > 0 {
		// Model OpenAI baru menolak max_tokens; endpoint kompatibel umumnya hanya kenal max_tokens.
		if p.Kind == OpenAI {
			body["max_completion_tokens"] = req.MaxTokens
		} else {
			body["max_tokens"] = req.MaxTokens
		}
	}
	if req.JSON && p.Kind == OpenAI {
		body["response_format"] = map[string]string{"type": "json_object"}
	}
	var out struct {
		Model   string `json:"model"`
		Choices []struct {
			Message struct {
				Content any `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := post(ctx, client, p.base()+"/chat/completions", map[string]string{"Authorization": "Bearer " + p.APIKey}, body, &out, p); err != nil {
		return nil, err
	}
	if len(out.Choices) == 0 {
		return nil, &Error{502, fmt.Sprintf("%s tidak mengirim jawaban", p.Name)}
	}
	res := &ChatResult{Model: firstOf(out.Model, req.Model), Finish: out.Choices[0].FinishReason,
		InputTokens: out.Usage.PromptTokens, OutputTokens: out.Usage.CompletionTokens}
	switch c := out.Choices[0].Message.Content.(type) {
	case string:
		res.Text = c
	case []any: // sebagian endpoint kompatibel mengirim potongan [{type:"text", text}]
		for _, item := range c {
			if m, ok := item.(map[string]any); ok {
				if t, ok := m["text"].(string); ok {
					res.Text += t
				}
			}
		}
	}
	return res, nil
}

func chatAnthropic(ctx context.Context, client *http.Client, p Provider, req ChatRequest) (*ChatResult, error) {
	messages := []map[string]any{}
	for _, m := range req.Messages {
		parts := []map[string]any{}
		for _, part := range m.Parts {
			if part.Image != nil {
				parts = append(parts, map[string]any{"type": "image", "source": map[string]string{
					"type": "base64", "media_type": part.Image.MIME, "data": base64.StdEncoding.EncodeToString(part.Image.Data)}})
			} else {
				parts = append(parts, map[string]any{"type": "text", "text": part.Text})
			}
		}
		messages = append(messages, map[string]any{"role": m.Role, "content": parts})
	}
	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 1024 // wajib di Messages API
	}
	body := map[string]any{"model": req.Model, "max_tokens": maxTokens, "messages": messages}
	if req.System != "" {
		body["system"] = req.System
	}
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}
	var out struct {
		Model   string `json:"model"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
		Usage      struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	headers := map[string]string{"x-api-key": p.APIKey, "anthropic-version": "2023-06-01"}
	if err := post(ctx, client, p.base()+"/messages", headers, body, &out, p); err != nil {
		return nil, err
	}
	res := &ChatResult{Model: firstOf(out.Model, req.Model), Finish: out.StopReason,
		InputTokens: out.Usage.InputTokens, OutputTokens: out.Usage.OutputTokens}
	for _, c := range out.Content {
		if c.Type == "text" {
			res.Text += c.Text
		}
	}
	return res, nil
}

func geminiModel(model string) string { return url.PathEscape(strings.TrimPrefix(model, "models/")) }

func chatGemini(ctx context.Context, client *http.Client, p Provider, req ChatRequest) (*ChatResult, error) {
	contents := []map[string]any{}
	for _, m := range req.Messages {
		role := "user"
		if m.Role == "assistant" {
			role = "model"
		}
		parts := []map[string]any{}
		for _, part := range m.Parts {
			if part.Image != nil {
				parts = append(parts, map[string]any{"inline_data": map[string]string{
					"mime_type": part.Image.MIME, "data": base64.StdEncoding.EncodeToString(part.Image.Data)}})
			} else {
				parts = append(parts, map[string]any{"text": part.Text})
			}
		}
		contents = append(contents, map[string]any{"role": role, "parts": parts})
	}
	body := map[string]any{"contents": contents}
	if req.System != "" {
		body["systemInstruction"] = map[string]any{"parts": []map[string]string{{"text": req.System}}}
	}
	gen := map[string]any{}
	if req.Temperature != nil {
		gen["temperature"] = *req.Temperature
	}
	if req.MaxTokens > 0 {
		gen["maxOutputTokens"] = req.MaxTokens
	}
	if req.JSON {
		gen["responseMimeType"] = "application/json"
	}
	if len(gen) > 0 {
		body["generationConfig"] = gen
	}
	var out struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text    string `json:"text"`
					Thought bool   `json:"thought"`
				} `json:"parts"`
			} `json:"content"`
			FinishReason string `json:"finishReason"`
		} `json:"candidates"`
		PromptFeedback struct {
			BlockReason string `json:"blockReason"`
		} `json:"promptFeedback"`
		UsageMetadata struct {
			PromptTokenCount     int `json:"promptTokenCount"`
			CandidatesTokenCount int `json:"candidatesTokenCount"`
		} `json:"usageMetadata"`
		ModelVersion string `json:"modelVersion"`
	}
	endpoint := p.base() + "/models/" + geminiModel(req.Model) + ":generateContent"
	if err := post(ctx, client, endpoint, map[string]string{"x-goog-api-key": p.APIKey}, body, &out, p); err != nil {
		return nil, err
	}
	if len(out.Candidates) == 0 {
		if reason := out.PromptFeedback.BlockReason; reason != "" {
			return nil, &Error{422, fmt.Sprintf("%s menolak permintaan ini (%s)", p.Name, reason)}
		}
		return nil, &Error{502, fmt.Sprintf("%s tidak mengirim jawaban", p.Name)}
	}
	c := out.Candidates[0]
	res := &ChatResult{Model: firstOf(out.ModelVersion, req.Model), Finish: c.FinishReason,
		InputTokens: out.UsageMetadata.PromptTokenCount, OutputTokens: out.UsageMetadata.CandidatesTokenCount}
	for _, part := range c.Content.Parts {
		if !part.Thought {
			res.Text += part.Text
		}
	}
	return res, nil
}

// ---------- JSON ----------

var jsonBlockRE = regexp.MustCompile("(?s)```[ \\t]*(?:json)?[ \\t]*\\r?\\n(.*?)```")

// ParseJSON membaca jawaban JSON model: utuh, di dalam blok ```json, atau objek/array pertama-terakhir.
func ParseJSON(text string) (any, bool) {
	text = strings.TrimSpace(text)
	var v any
	if json.Unmarshal([]byte(text), &v) == nil {
		return v, true
	}
	if m := jsonBlockRE.FindStringSubmatch(text); m != nil && json.Unmarshal([]byte(strings.TrimSpace(m[1])), &v) == nil {
		return v, true
	}
	for _, pair := range [][2]string{{"{", "}"}, {"[", "]"}} {
		start, end := strings.Index(text, pair[0]), strings.LastIndex(text, pair[1])
		if start >= 0 && end > start && json.Unmarshal([]byte(text[start:end+1]), &v) == nil {
			return v, true
		}
	}
	return nil, false
}

// ---------- Embedding ----------

// EmbedResult: vektor per teks masukan (urutan sama).
type EmbedResult struct {
	Vectors [][]float64
	Model   string
	Tokens  int
}

// Embed membuat vektor embedding untuk teks-teks masukan.
func Embed(ctx context.Context, client *http.Client, p Provider, model string, inputs []string) (*EmbedResult, error) {
	if model == "" {
		model = p.EmbedModel
	}
	if model == "" {
		model = Kinds[p.Kind].EmbedModel
	}
	if p.Kind == Anthropic {
		return nil, &Error{400, "Anthropic tidak menyediakan embedding. Pakai provider OpenAI, Gemini, atau yang kompatibel OpenAI"}
	}
	if model == "" {
		return nil, &Error{400, fmt.Sprintf("model embedding untuk %s belum diisi (atur di tab Fungsi → Provider AI, atau kirim { model })", p.Name)}
	}
	switch p.Kind {
	case OpenAI, Compatible:
		var out struct {
			Model string `json:"model"`
			Data  []struct {
				Index     int       `json:"index"`
				Embedding []float64 `json:"embedding"`
			} `json:"data"`
			Usage struct {
				PromptTokens int `json:"prompt_tokens"`
			} `json:"usage"`
		}
		body := map[string]any{"model": model, "input": inputs}
		if err := post(ctx, client, p.base()+"/embeddings", map[string]string{"Authorization": "Bearer " + p.APIKey}, body, &out, p); err != nil {
			return nil, err
		}
		res := &EmbedResult{Vectors: make([][]float64, len(inputs)), Model: firstOf(out.Model, model), Tokens: out.Usage.PromptTokens}
		for i, d := range out.Data {
			idx := d.Index
			if idx < 0 || idx >= len(inputs) {
				idx = i
			}
			if idx < len(inputs) {
				res.Vectors[idx] = d.Embedding
			}
		}
		return checkVectors(p, res)
	case Gemini:
		requests := make([]map[string]any, len(inputs))
		for i, text := range inputs {
			requests[i] = map[string]any{"model": "models/" + strings.TrimPrefix(model, "models/"), "content": map[string]any{"parts": []map[string]string{{"text": text}}}}
		}
		var out struct {
			Embeddings []struct {
				Values []float64 `json:"values"`
			} `json:"embeddings"`
		}
		endpoint := p.base() + "/models/" + geminiModel(model) + ":batchEmbedContents"
		if err := post(ctx, client, endpoint, map[string]string{"x-goog-api-key": p.APIKey}, map[string]any{"requests": requests}, &out, p); err != nil {
			return nil, err
		}
		res := &EmbedResult{Vectors: make([][]float64, len(inputs)), Model: model}
		for i, e := range out.Embeddings {
			if i < len(inputs) {
				res.Vectors[i] = e.Values
			}
		}
		return checkVectors(p, res)
	}
	return nil, &Error{400, fmt.Sprintf("jenis provider %q tidak dikenal", p.Kind)}
}

func checkVectors(p Provider, res *EmbedResult) (*EmbedResult, error) {
	for _, v := range res.Vectors {
		if len(v) == 0 {
			return nil, &Error{502, fmt.Sprintf("%s tidak mengirim embedding untuk semua teks", p.Name)}
		}
	}
	return res, nil
}

func firstOf(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

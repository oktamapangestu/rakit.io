package ai

// Proxy AI untuk container mode Agen (lihat agent.go). Mesin agen di container memanggil 127.0.0.1:8001, yang
// diteruskan ke sini lewat unix socket. Kunci provider tidak pernah masuk container: proxy ini yang menambahkannya,
// memaksa model ke model yang diatur owner, membatasi max_tokens, menghitung token setiap request (untuk statistik),
// dan menolak request begitu batas token satu prompt tercapai.
//
// Format yang diteruskan: Anthropic Messages (/v1/messages — Claude Agent SDK) dan OpenAI Chat Completions
// (/v1/chat/completions). Path diteruskan relatif ke base URL provider (yang berakhiran /v1).

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
)

const agentProxyMaxBody = 32 << 20

type agentProxy struct {
	ctx       context.Context
	client    *http.Client
	baseURL   string // base URL provider, mis. https://api.example.com/v1
	apiKey    string
	model     string
	maxOutput int // batas max_tokens per request
	budget    int // batas token (input+output) satu prompt

	mu       sync.Mutex
	in, out  int
	requests int
}

func (p *agentProxy) usage() (in, out int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.in, p.out
}

func (p *agentProxy) exhausted() bool {
	in, out := p.usage()
	return in+out >= p.budget
}

func (p *agentProxy) add(in, out int) {
	p.mu.Lock()
	p.in += in
	p.out += out
	p.requests++
	p.mu.Unlock()
}

// agentProxyError: balasan error dalam format API yang dipanggil, supaya mesin agen menampilkannya dengan benar.
func agentProxyError(w http.ResponseWriter, anthropic bool, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if anthropic {
		json.NewEncoder(w).Encode(map[string]any{"type": "error", "error": map[string]string{"type": "invalid_request_error", "message": message}})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"message": message, "type": "invalid_request_error"}})
}

func (p *agentProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	// Claude Code memeriksa koneksi dengan /api/hello sebelum mulai.
	if path == "/api/hello" {
		w.WriteHeader(http.StatusOK)
		return
	}
	anthropic := strings.HasPrefix(path, "/v1/messages")
	allowed := path == "/v1/messages" || path == "/v1/messages/count_tokens" || path == "/v1/chat/completions"
	if r.Method != http.MethodPost || !allowed {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if p.exhausted() {
		// 400, bukan 429: mesin agen mencoba ulang 429 berkali-kali, padahal batas ini tidak akan pulih.
		agentProxyError(w, anthropic, http.StatusBadRequest, "Batas pemakaian AI untuk satu prompt mode Agen sudah tercapai. Hentikan pekerjaan dan tulis ringkasan dari yang sudah selesai.")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, agentProxyMaxBody+1))
	if err != nil || len(raw) > agentProxyMaxBody {
		agentProxyError(w, anthropic, http.StatusRequestEntityTooLarge, "Request terlalu besar")
		return
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		agentProxyError(w, anthropic, http.StatusBadRequest, "Body bukan JSON")
		return
	}
	body["model"] = p.model
	for _, key := range []string{"max_tokens", "max_completion_tokens"} {
		if n, ok := body[key].(float64); ok && p.maxOutput > 0 && int(n) > p.maxOutput {
			body[key] = p.maxOutput
		}
	}
	if anthropic {
		renameImageColumns(body)
	} else if body["stream"] == true {
		// Tanpa ini provider OpenAI-compatible tidak mengirim jumlah token di stream, dan batas token tidak berlaku.
		body["stream_options"] = map[string]bool{"include_usage": true}
	}
	payload, _ := json.Marshal(body)

	target := strings.TrimRight(p.baseURL, "/") + strings.TrimPrefix(path, "/v1")
	req, err := http.NewRequestWithContext(p.ctx, http.MethodPost, target, bytes.NewReader(payload))
	if err != nil {
		agentProxyError(w, anthropic, http.StatusBadGateway, err.Error())
		return
	}
	req.Header.Set("Content-Type", "application/json")
	for _, h := range []string{"Accept", "Anthropic-Version", "Anthropic-Beta"} {
		if v := r.Header.Get(h); v != "" {
			req.Header.Set(h, v)
		}
	}
	if p.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.apiKey)
		req.Header.Set("X-Api-Key", p.apiKey)
	}
	res, err := p.client.Do(req)
	if err != nil {
		agentProxyError(w, anthropic, http.StatusBadGateway, "Provider AI tidak bisa dihubungi")
		return
	}
	defer res.Body.Close()
	for _, h := range []string{"Content-Type", "Retry-After", "Request-Id", "X-Request-Id"} {
		if v := res.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	w.WriteHeader(res.StatusCode)

	meter := &usageMeter{}
	flusher, _ := w.(http.Flusher)
	reader := bufio.NewReaderSize(res.Body, 64<<10)
	streaming := strings.Contains(res.Header.Get("Content-Type"), "event-stream")
	var whole bytes.Buffer
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			w.Write(line)
			if streaming {
				meter.line(line)
				if flusher != nil {
					flusher.Flush()
				}
			} else if whole.Len() < agentProxyMaxBody {
				whole.Write(line)
			}
		}
		if err != nil {
			break
		}
	}
	if !streaming {
		meter.json(whole.Bytes())
	}
	if path != "/v1/messages/count_tokens" {
		p.add(meter.in, meter.out)
	}
}

// usageMeter membaca pemakaian token dari jawaban provider: Anthropic (message_start.usage.input_tokens,
// message_delta.usage.output_tokens kumulatif) maupun OpenAI (usage.prompt_tokens/completion_tokens di potongan
// terakhir). Nilai terbesar yang terlihat yang dipakai, karena keduanya kumulatif per jawaban.
type usageMeter struct{ in, out int }

func (m *usageMeter) line(raw []byte) {
	data, ok := bytes.CutPrefix(bytes.TrimSpace(raw), []byte("data:"))
	if !ok {
		return
	}
	m.json(bytes.TrimSpace(data))
}

func (m *usageMeter) json(raw []byte) {
	if len(raw) == 0 || raw[0] != '{' {
		return
	}
	var v struct {
		Usage   map[string]any `json:"usage"`
		Message struct {
			Usage map[string]any `json:"usage"`
		} `json:"message"`
	}
	if json.Unmarshal(raw, &v) != nil {
		return
	}
	for _, u := range []map[string]any{v.Usage, v.Message.Usage} {
		if u == nil {
			continue
		}
		num := func(k string) int { n, _ := u[k].(float64); return int(n) }
		in := num("prompt_tokens") + num("input_tokens") + num("cache_read_input_tokens") + num("cache_creation_input_tokens")
		m.in = max(m.in, in)
		m.out = max(m.out, num("completion_tokens")+num("output_tokens"))
	}
}

// renameImageColumns: pada riwayat format Anthropic, argumen tool_use berisi objek {"type": "image"} (kolom
// database bertipe image) membuat sebagian provider Anthropic-compatible menolak request (dikira blok gambar).
// Nilai itu diganti "picture" — create_table di container menerima keduanya (lihat claude_driver.mjs).
func renameImageColumns(body map[string]any) {
	messages, _ := body["messages"].([]any)
	var walk func(v any)
	walk = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			if x["type"] == "image" && x["name"] != nil {
				x["type"] = "picture"
			}
			for _, child := range x {
				walk(child)
			}
		case []any:
			for _, child := range x {
				walk(child)
			}
		}
	}
	for _, m := range messages {
		msg, _ := m.(map[string]any)
		blocks, _ := msg["content"].([]any)
		for _, b := range blocks {
			if block, _ := b.(map[string]any); block != nil && block["type"] == "tool_use" {
				walk(block["input"])
			}
		}
	}
}

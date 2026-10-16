package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAgentProxy(t *testing.T) {
	var got struct {
		path, auth, key string
		body            map[string]any
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		got.path, got.auth, got.key = r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("X-Api-Key")
		got.body = nil
		json.Unmarshal(raw, &got.body)
		switch r.URL.Path {
		case "/v1/messages":
			w.Header().Set("Content-Type", "text/event-stream")
			io.WriteString(w, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":100,\"cache_read_input_tokens\":50,\"output_tokens\":1}}}\n\n")
			io.WriteString(w, "event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":30}}\n\n")
		case "/v1/chat/completions":
			if got.body["stream"] == true {
				w.Header().Set("Content-Type", "text/event-stream")
				io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"hai\"}}]}\n\n")
				io.WriteString(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":200,\"completion_tokens\":40}}\n\ndata: [DONE]\n\n")
			} else {
				w.Header().Set("Content-Type", "application/json")
				io.WriteString(w, `{"choices":[{"message":{"content":"hai"}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}`)
			}
		}
	}))
	defer upstream.Close()

	p := &agentProxy{ctx: context.Background(), client: upstream.Client(), baseURL: upstream.URL + "/v1", apiKey: "rahasia", model: "model-owner", maxOutput: 1000, budget: 400}
	post := func(path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer dari-container")
		p.ServeHTTP(rec, req)
		return rec
	}

	// Anthropic: kunci & model diganti, max_tokens dibatasi, kolom image di riwayat tool_use diganti picture.
	rec := post("/v1/messages", `{"model":"claude-opus","max_tokens":64000,"stream":true,"messages":[{"role":"assistant","content":[{"type":"tool_use","id":"t","name":"create_table","input":{"columns":[{"name":"foto","type":"image"}]}}]}]}`)
	if rec.Code != 200 || got.path != "/v1/messages" || got.auth != "Bearer rahasia" || got.key != "rahasia" || got.body["model"] != "model-owner" || got.body["max_tokens"] != float64(1000) {
		t.Fatalf("anthropic diteruskan salah: %d %+v", rec.Code, got)
	}
	if !strings.Contains(rec.Body.String(), "message_delta") {
		t.Errorf("stream tidak diteruskan: %q", rec.Body.String())
	}
	col := got.body["messages"].([]any)[0].(map[string]any)["content"].([]any)[0].(map[string]any)["input"].(map[string]any)["columns"].([]any)[0].(map[string]any)
	if col["type"] != "picture" {
		t.Errorf("kolom image tidak diganti: %v", col)
	}
	if in, out := p.usage(); in != 150 || out != 30 {
		t.Errorf("token anthropic = %d/%d, mau 150/30", in, out)
	}

	// OpenAI stream: include_usage dipaksa, token dihitung dari potongan terakhir.
	post("/v1/chat/completions", `{"model":"x","stream":true,"messages":[]}`)
	if opts, _ := got.body["stream_options"].(map[string]any); opts["include_usage"] != true {
		t.Errorf("stream_options = %v", got.body["stream_options"])
	}
	if in, out := p.usage(); in != 350 || out != 70 {
		t.Errorf("token setelah openai = %d/%d, mau 350/70", in, out)
	}

	// Batas token tercapai (420 ≥ 400 sesudah request JSON berikut): request berikutnya ditolak tanpa ke provider.
	post("/v1/chat/completions", `{"model":"x","messages":[]}`)
	got.path = ""
	rec = post("/v1/chat/completions", `{"model":"x","messages":[]}`)
	if rec.Code != http.StatusBadRequest || got.path != "" || !strings.Contains(rec.Body.String(), "Batas pemakaian") {
		t.Errorf("batas token: %d %q (diteruskan ke %q)", rec.Code, rec.Body.String(), got.path)
	}

	// Path lain tidak diteruskan.
	rec = httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/models", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /v1/models = %d", rec.Code)
	}
}

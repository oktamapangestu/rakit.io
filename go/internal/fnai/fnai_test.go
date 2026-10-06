package fnai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

// fake: provider tiruan yang mencatat request terakhir dan menjawab dengan `reply`.
type fake struct {
	path    string
	headers http.Header
	body    map[string]any
	status  int
	reply   string
}

func (f *fake) server(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		f.path, f.headers, f.body = r.URL.Path, r.Header.Clone(), nil
		json.Unmarshal(raw, &f.body)
		if f.status != 0 {
			w.WriteHeader(f.status)
		}
		io.WriteString(w, f.reply)
	}))
	t.Cleanup(srv.Close)
	return srv
}

var img = &Image{MIME: "image/png", Data: []byte{0x89, 'P', 'N', 'G'}}

func ask(parts ...Part) []Message { return []Message{{Role: "user", Parts: parts}} }

func TestChatOpenAI(t *testing.T) {
	f := &fake{reply: `{"model":"gpt-x","choices":[{"message":{"content":"{\"ok\":true}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":5}}`}
	srv := f.server(t)
	temp := 0.2
	p := Provider{Name: "openai", Kind: OpenAI, BaseURL: srv.URL + "/v1/", APIKey: "sk-1", Model: "gpt-x"}
	res, err := Chat(context.Background(), srv.Client(), p, ChatRequest{System: "Kamu CS.", Messages: ask(Part{Text: "Apa ini?"}, Part{Image: img}), Temperature: &temp, MaxTokens: 100, JSON: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Text != `{"ok":true}` || res.InputTokens != 12 || res.OutputTokens != 5 || res.Model != "gpt-x" {
		t.Fatalf("hasil: %+v", res)
	}
	if f.path != "/v1/chat/completions" || f.headers.Get("Authorization") != "Bearer sk-1" {
		t.Errorf("request: %s %v", f.path, f.headers.Get("Authorization"))
	}
	msgs := f.body["messages"].([]any)
	if sys := msgs[0].(map[string]any); sys["role"] != "system" || !strings.Contains(sys["content"].(string), "JSON") {
		t.Errorf("system + instruksi JSON: %v", sys)
	}
	content := msgs[1].(map[string]any)["content"].([]any)
	if u := content[1].(map[string]any)["image_url"].(map[string]any)["url"]; u != "data:image/png;base64,iVBORw==" {
		t.Errorf("gambar data URL: %v", u)
	}
	if f.body["max_completion_tokens"] != 100.0 || f.body["max_tokens"] != nil || f.body["response_format"] == nil {
		t.Errorf("OpenAI: max_completion_tokens & response_format: %v", f.body)
	}

	// Kompatibel OpenAI: max_tokens, tanpa response_format, teks sebagai potongan.
	f.reply = `{"choices":[{"message":{"content":[{"type":"text","text":"Ha"},{"type":"text","text":"lo"}]},"finish_reason":"stop"}]}`
	p.Kind = Compatible
	res, err = Chat(context.Background(), srv.Client(), p, ChatRequest{Messages: ask(Part{Text: "hai"}), MaxTokens: 50, JSON: true})
	if err != nil || res.Text != "Halo" || res.Model != "gpt-x" {
		t.Fatalf("kompatibel: %+v %v", res, err)
	}
	if f.body["max_tokens"] != 50.0 || f.body["response_format"] != nil || f.body["messages"].([]any)[1].(map[string]any)["content"] != "hai" {
		t.Errorf("kompatibel body: %v", f.body)
	}
}

func TestChatAnthropic(t *testing.T) {
	f := &fake{reply: `{"model":"claude-x","content":[{"type":"text","text":"Halo "},{"type":"text","text":"juga"}],"stop_reason":"end_turn","usage":{"input_tokens":9,"output_tokens":3}}`}
	srv := f.server(t)
	p := Provider{Name: "claude", Kind: Anthropic, BaseURL: srv.URL, APIKey: "ak", Model: "claude-x"}
	res, err := Chat(context.Background(), srv.Client(), p, ChatRequest{System: "S", Messages: ask(Part{Image: img}, Part{Text: "Apa?"})})
	if err != nil {
		t.Fatal(err)
	}
	if res.Text != "Halo juga" || res.InputTokens != 9 || res.Finish != "end_turn" {
		t.Fatalf("hasil: %+v", res)
	}
	if f.path != "/messages" || f.headers.Get("x-api-key") != "ak" || f.headers.Get("anthropic-version") == "" {
		t.Errorf("request: %s %v", f.path, f.headers)
	}
	if f.body["system"] != "S" || f.body["max_tokens"] != 1024.0 {
		t.Errorf("system & max_tokens wajib: %v", f.body)
	}
	src := f.body["messages"].([]any)[0].(map[string]any)["content"].([]any)[0].(map[string]any)["source"].(map[string]any)
	if src["type"] != "base64" || src["media_type"] != "image/png" || src["data"] != "iVBORw==" {
		t.Errorf("gambar: %v", src)
	}
}

func TestChatGemini(t *testing.T) {
	f := &fake{reply: `{"candidates":[{"content":{"parts":[{"text":"pikir","thought":true},{"text":"{\"a\":1}"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":2},"modelVersion":"gemini-x-001"}`}
	srv := f.server(t)
	p := Provider{Name: "gemini", Kind: Gemini, BaseURL: srv.URL, APIKey: "gk", Model: "gemini-x"}
	res, err := Chat(context.Background(), srv.Client(), p, ChatRequest{System: "S", JSON: true, MaxTokens: 64,
		Messages: []Message{{Role: "user", Parts: []Part{{Text: "a"}, {Image: img}}}, {Role: "assistant", Parts: []Part{{Text: "b"}}}, {Role: "user", Parts: []Part{{Text: "c"}}}}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Text != `{"a":1}` || res.Model != "gemini-x-001" || res.OutputTokens != 2 {
		t.Fatalf("hasil (tanpa bagian 'thought'): %+v", res)
	}
	if f.path != "/models/gemini-x:generateContent" || f.headers.Get("x-goog-api-key") != "gk" {
		t.Errorf("request: %s", f.path)
	}
	contents := f.body["contents"].([]any)
	if contents[1].(map[string]any)["role"] != "model" {
		t.Errorf("assistant -> model: %v", contents[1])
	}
	inline := contents[0].(map[string]any)["parts"].([]any)[1].(map[string]any)["inline_data"].(map[string]any)
	if inline["mime_type"] != "image/png" || inline["data"] != "iVBORw==" {
		t.Errorf("gambar: %v", inline)
	}
	gen := f.body["generationConfig"].(map[string]any)
	if gen["responseMimeType"] != "application/json" || gen["maxOutputTokens"] != 64.0 {
		t.Errorf("generationConfig: %v", gen)
	}

	f.reply = `{"promptFeedback":{"blockReason":"SAFETY"}}`
	if _, err := Chat(context.Background(), srv.Client(), p, ChatRequest{Messages: ask(Part{Text: "x"})}); err == nil || !strings.Contains(err.Error(), "SAFETY") {
		t.Errorf("diblokir: %v", err)
	}
}

func TestErrors(t *testing.T) {
	f := &fake{}
	srv := f.server(t)
	p := Provider{Name: "openai", Kind: OpenAI, BaseURL: srv.URL, APIKey: "x", Model: "m"}
	cases := []struct {
		status int
		reply  string
		want   string
	}{
		{401, `{"error":{"message":"Incorrect API key"}}`, "API key openai ditolak (401): Incorrect API key"},
		{429, `{"error":{"message":"quota"}}`, "batas pemakaian/kuota (429): quota"},
		{404, `{"error":"model not found"}`, "tidak ditemukan (404): model not found"},
		{500, `oops`, "menolak permintaan (500): oops"},
	}
	for _, c := range cases {
		f.status, f.reply = c.status, c.reply
		_, err := Chat(context.Background(), srv.Client(), p, ChatRequest{Messages: ask(Part{Text: "x"})})
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%d: %v", c.status, err)
		}
	}
	if _, err := Chat(context.Background(), srv.Client(), Provider{Name: "x", Kind: OpenAI}, ChatRequest{Messages: ask(Part{Text: "x"})}); err == nil || !strings.Contains(err.Error(), "model") {
		t.Errorf("tanpa model: %v", err)
	}
}

func TestEmbed(t *testing.T) {
	f := &fake{reply: `{"model":"emb","data":[{"index":1,"embedding":[0.3,0.4]},{"index":0,"embedding":[0.1,0.2]}],"usage":{"prompt_tokens":4}}`}
	srv := f.server(t)
	res, err := Embed(context.Background(), srv.Client(), Provider{Name: "o", Kind: OpenAI, BaseURL: srv.URL, APIKey: "k"}, "", []string{"a", "b"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(res.Vectors, [][]float64{{0.1, 0.2}, {0.3, 0.4}}) || res.Tokens != 4 || f.body["model"] != "text-embedding-3-small" {
		t.Fatalf("openai: %+v body %v", res, f.body)
	}

	f.reply = `{"embeddings":[{"values":[1,2]},{"values":[3,4]}]}`
	res, err = Embed(context.Background(), srv.Client(), Provider{Name: "g", Kind: Gemini, BaseURL: srv.URL, APIKey: "k", EmbedModel: "emb-g"}, "", []string{"a", "b"})
	if err != nil || !reflect.DeepEqual(res.Vectors, [][]float64{{1, 2}, {3, 4}}) || f.path != "/models/emb-g:batchEmbedContents" {
		t.Fatalf("gemini: %+v %v %s", res, err, f.path)
	}
	if req := f.body["requests"].([]any)[0].(map[string]any); req["model"] != "models/emb-g" {
		t.Errorf("gemini model: %v", req)
	}

	if _, err := Embed(context.Background(), srv.Client(), Provider{Name: "c", Kind: Anthropic}, "", []string{"a"}); err == nil || !strings.Contains(err.Error(), "Anthropic tidak menyediakan") {
		t.Errorf("anthropic: %v", err)
	}
	f.reply = `{"data":[{"index":0,"embedding":[1]}]}`
	if _, err := Embed(context.Background(), srv.Client(), Provider{Name: "o", Kind: Compatible, BaseURL: srv.URL, EmbedModel: "e"}, "", []string{"a", "b"}); err == nil {
		t.Error("vektor kurang harus gagal")
	}
}

func TestParseJSON(t *testing.T) {
	for in, want := range map[string]any{
		`{"a":1}`:                           map[string]any{"a": 1.0},
		"Berikut:\n```json\n{\"a\":2}\n```": map[string]any{"a": 2.0},
		`Jawaban: {"a":3} semoga membantu`:  map[string]any{"a": 3.0},
		`[1,2]`:                             []any{1.0, 2.0},
	} {
		got, ok := ParseJSON(in)
		if !ok || !reflect.DeepEqual(got, want) {
			t.Errorf("%q: %v %v", in, got, ok)
		}
	}
	if _, ok := ParseJSON("bukan json"); ok {
		t.Error("teks biasa bukan JSON")
	}
}

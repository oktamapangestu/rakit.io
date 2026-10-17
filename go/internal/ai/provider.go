// Package ai: asisten AI di editor — mode Builder (tool calling) dan Plan, sebagai job di server.
// Padanan src/ai.js dan src/aiapply.js.
package ai

import (
	"bufio"
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"rakit.io/server/internal/aiqueue"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
)

type message = map[string]any

// providerError: provider menjawab dengan status gagal (atau event error di tengah stream).
type providerError struct {
	status     int
	detail     string
	retryAfter int // detik, dari header Retry-After bila ada
}

func (e *providerError) Error() string { return fmt.Sprintf("AI provider %d: %s", e.status, e.detail) }

func (e *providerError) busy() bool { return e.status == 429 || e.status == 503 }

// failure: kegagalan job yang pesannya ditampilkan ke user, dengan status untuk statistik.
type failure struct {
	aiStatus string // dicatat di ai_requests
	message  string
}

func (e *failure) Error() string { return e.message }

type toolCall struct {
	ID, Name, Arguments string
}

type reply struct {
	Text, Reasoning  string
	ToolCalls        []toolCall
	FinishReason     string
	PromptTokens     int
	CompletionTokens int
}

// hooks: yang dipanggil selama satu panggilan AI berjalan.
type hooks struct {
	ctx        context.Context
	onText     func(chars int)
	onThinking func()
	onQueued   func(position, total int)
	onRunning  func()
	onRetry    func(attempt, seconds int)
	onModel    func(model string)
	// Isi stream untuk tampilan "apa yang dikerjakan AI" (lihat activity.go). onStart: tiap kali model
	// mulai dipanggil (termasuk coba ulang & model cadangan), supaya potongan dari percobaan gagal dibuang.
	onStart     func()
	onReasoning func(text string)
	onContent   func(text string)
	onToolDelta func(index int, name, arguments string)
	// Dari runBuilder: hasil tiap tool call (urut seperti reply.ToolCalls) dan catatan pemeriksaan.
	onToolResult func(n int, call toolCall, result string)
	onNote       func(text string)
}

type request struct {
	model    string
	messages []message
	tools    bool   // sertakan tool mode Builder
	task     string // tugas (aimodels.Task*): menentukan model utama & cadangan yang dipakai
	// maxTokens: batas jawaban (0 = AI_MAX_TOKENS); temperature: nil = bawaan provider.
	maxTokens   int
	temperature *float64
}

type streamEvent struct {
	Error json.RawMessage `json:"error"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
	Choices []struct {
		Delta struct {
			ReasoningContent string `json:"reasoning_content"`
			Reasoning        string `json:"reasoning"` // nama lain di sebagian gateway (OpenRouter, Groq)
			Content          string `json:"content"`
			ToolCalls        []struct {
				Index    *int   `json:"index"`
				ID       string `json:"id"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

// chatCompletion memanggil endpoint chat completions (format OpenAI) dengan streaming SSE, di provider
// milik model (req.model = "model" atau "model@provider", lihat paket aimodels).
func (s *Service) chatCompletion(req request, h hooks) (*reply, error) {
	endpoint, err := s.models.Resolve(req.model)
	if err != nil {
		return nil, err // dianggap gangguan: callAI pindah ke model cadangan bila ada
	}
	body := map[string]any{
		"model":          endpoint.Model,
		"max_tokens":     cmp.Or(req.maxTokens, s.cfg.AI.MaxTokens),
		"stream":         true,
		"stream_options": map[string]bool{"include_usage": true},
		"messages":       req.messages,
	}
	if req.tools {
		body["tools"] = json.RawMessage(s.builderTools)
	}
	if req.temperature != nil {
		body["temperature"] = *req.temperature
	}
	var payload bytes.Buffer
	enc := json.NewEncoder(&payload)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(body); err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(h.ctx, http.MethodPost, endpoint.BaseURL+"/chat/completions", &payload)
	if err != nil {
		return nil, err
	}
	if endpoint.APIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+endpoint.APIKey)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	res, err := s.http.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		detail, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		retryAfter, _ := strconv.Atoi(strings.TrimSpace(res.Header.Get("Retry-After")))
		return nil, &providerError{status: res.StatusCode, detail: jsconv.Slice(string(detail), 500), retryAfter: retryAfter}
	}

	if h.onStart != nil {
		h.onStart()
	}
	out := &reply{}
	calls := map[int]*toolCall{} // tool call yang datang sepotong-sepotong, dikumpulkan per index
	nextIndex := 0
	reader := bufio.NewReaderSize(res.Body, 64*1024)
	for {
		line, readErr := reader.ReadString('\n')
		line = strings.TrimSpace(line)
		// Abaikan komentar SSE seperti ": keepalive".
		if data, isData := strings.CutPrefix(line, "data:"); isData {
			data = strings.TrimSpace(data)
			var event streamEvent
			if data != "[DONE]" && json.Unmarshal([]byte(data), &event) == nil {
				if raw := string(event.Error); raw != "" && raw != "null" && raw != "false" && raw != `""` && raw != "0" {
					return nil, &providerError{status: 502, detail: raw}
				}
				if event.Usage != nil {
					out.PromptTokens, out.CompletionTokens = event.Usage.PromptTokens, event.Usage.CompletionTokens
				}
				if len(event.Choices) > 0 {
					choice := event.Choices[0]
					if thought := cmp.Or(choice.Delta.ReasoningContent, choice.Delta.Reasoning); thought != "" {
						out.Reasoning += thought
						if h.onThinking != nil {
							h.onThinking()
						}
						if h.onReasoning != nil {
							h.onReasoning(thought)
						}
					}
					if choice.Delta.Content != "" {
						out.Text += choice.Delta.Content
						if h.onText != nil {
							h.onText(jsconv.Len(choice.Delta.Content))
						}
						if h.onContent != nil {
							h.onContent(choice.Delta.Content)
						}
					}
					for _, tc := range choice.Delta.ToolCalls {
						i := nextIndex
						if tc.Index != nil {
							i = *tc.Index
						}
						call := calls[i]
						if call == nil {
							call = &toolCall{}
							calls[i] = call
							nextIndex = max(nextIndex, i+1)
						}
						if tc.ID != "" {
							call.ID = tc.ID
						}
						if tc.Function.Name != "" && call.Name == "" {
							call.Name = tc.Function.Name
						}
						if tc.Function.Arguments != "" {
							call.Arguments += tc.Function.Arguments
							if h.onText != nil {
								h.onText(jsconv.Len(tc.Function.Arguments))
							}
						}
						if h.onToolDelta != nil && (tc.Function.Arguments != "" || tc.Function.Name != "") {
							h.onToolDelta(i, call.Name, tc.Function.Arguments)
						}
					}
					if choice.FinishReason != nil && *choice.FinishReason != "" {
						out.FinishReason = *choice.FinishReason
					}
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return nil, readErr
		}
	}
	indexes := make([]int, 0, len(calls))
	for i := range calls {
		indexes = append(indexes, i)
	}
	sort.Ints(indexes)
	for n, i := range indexes {
		call := *calls[i]
		if call.ID == "" {
			call.ID = "call_" + strconv.Itoa(n)
		}
		out.ToolCalls = append(out.ToolCalls, call)
	}
	return out, nil
}

var retryDelays = []time.Duration{2 * time.Second, 5 * time.Second, 10 * time.Second} // jeda coba ulang saat provider sibuk (429/503)

func sleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// isOutage: gangguan di sisi model/provider (bukan pembatalan user, antrean penuh, atau API key
// yang salah) — alasan untuk pindah ke model cadangan.
func isOutage(err error, ctx context.Context) bool {
	if ctx.Err() != nil {
		return false
	}
	var f *failure
	var he *httpx.Error
	if errors.As(err, &f) || errors.As(err, &he) {
		return false
	}
	var pe *providerError
	if errors.As(err, &pe) {
		return pe.status != 401 && pe.status != 403
	}
	return true // jaringan putus, timeout, stream terputus di tengah jawaban
}

// callAI memanggil AI dengan strategi cadangan: coba model utama tugas itu (lihat aimodels.For); bila gangguan, ulangi permintaan
// yang sama dengan model cadangan berikutnya, dan seterusnya. Model yang gangguan dilewati beberapa menit (lihat paket aimodels),
// jadi putaran berikutnya langsung memakai cadangan.
func (s *Service) callAI(req request, h hooks) (*reply, error) {
	order := s.models.OrderFor(req.task)
	for i, model := range order {
		hasNext := i < len(order)-1
		// Ada cadangan: cukup 1 kali coba ulang saat sibuk, lalu pindah — daripada user menunggu lama.
		retries := len(retryDelays)
		if hasNext {
			retries = 1
		}
		req.model = model
		out, err := s.callModel(req, h, retries)
		if err == nil {
			s.models.ReportUp(model)
			if i > 0 {
				s.models.CountFallback()
			}
			if h.onModel != nil {
				h.onModel(model)
			}
			return out, nil
		}
		if !isOutage(err, h.ctx) {
			return nil, err
		}
		s.models.ReportDown(model, err.Error())
		if !hasNext {
			return nil, err
		}
		log.Printf(`AI: model "%s" gangguan (%v); pindah ke "%s"`, model, err, order[i+1])
	}
	return nil, errors.New("tidak ada model AI yang dikonfigurasi")
}

// callModel memanggil satu model lewat antrean: tunggu slot, jalankan, lepas slot. Bila provider
// menolak karena sibuk (429/503), coba lagi dengan jeda (atau sesuai Retry-After) sampai maxRetries kali.
func (s *Service) callModel(req request, h hooks, maxRetries int) (*reply, error) {
	for attempt := 0; ; attempt++ {
		release, err := s.queue.Acquire(h.ctx, h.onQueued)
		if err != nil {
			var qe *aiqueue.Error
			if errors.As(err, &qe) {
				status := "queue_timeout"
				if qe.Kind == "full" {
					status = "queue_full"
				}
				return nil, &failure{status, qe.Message + " Kredit dikembalikan."}
			}
			return nil, err
		}
		if h.onRunning != nil {
			h.onRunning()
		}
		out, err := s.chatCompletion(req, h)
		if err == nil {
			s.queue.ReportSuccess()
			release()
			return out, nil
		}
		var pe *providerError
		busy := errors.As(err, &pe) && pe.busy()
		if busy {
			s.queue.ReportBusy()
		}
		release()
		if !busy || attempt >= maxRetries || h.ctx.Err() != nil {
			return nil, err
		}
		delay := retryDelays[attempt] + time.Duration(rand.Float64()*float64(time.Second))
		if pe.retryAfter > 0 {
			delay = min(time.Duration(pe.retryAfter)*time.Second, 30*time.Second)
		}
		s.queue.CountRetry()
		if h.onRetry != nil {
			h.onRetry(attempt+1, int(math.Ceil(delay.Seconds())))
		}
		if err := sleep(h.ctx, delay); err != nil {
			return nil, err
		}
	}
}

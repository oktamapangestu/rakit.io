package ai

// Pertanyaan agen ke pengguna (mode Agen, tool ask_user): agen yang butuh keputusan pemilik website memanggil
// ask_user dengan satu pertanyaan dan 2–4 pilihan. Job berhenti sejenak: editor menampilkan dialog (event
// "question"), jawabannya dikirim lewat POST /api/ai/jobs/:id/answer dan diteruskan ke agen sebagai hasil tool,
// lalu agen melanjutkan di job yang sama (tanpa kredit tambahan). Selama menunggu, batas waktu job tidak berjalan.
// Tidak dijawab dalam askTimeout (atau editor ditutup) → agen diminta memilih yang paling aman sendiri.
//
//	{type: "question", id, question, options: [{label, description}]}
//	{type: "answered", id, answer, timeout}   answer kosong bila tidak dijawab

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/store"
)

const (
	askTimeout       = 10 * time.Minute
	maxAskQuestion   = 500
	maxAskLabel      = 80
	maxAskDesc       = 200
	maxAskAnswerSize = 1000
)

type askOption struct {
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

// pendingAsk: pertanyaan yang sedang menunggu jawaban (satu per job).
type pendingAsk struct {
	userID int64
	id     int
	answer chan string
}

// validateAsk memeriksa argumen ask_user dari agen.
func validateAsk(raw io.Reader) (question string, options []askOption, err error) {
	var args struct {
		Question string      `json:"question"`
		Options  []askOption `json:"options"`
	}
	if err := json.NewDecoder(io.LimitReader(raw, 64<<10)).Decode(&args); err != nil {
		return "", nil, fmt.Errorf("Argumen ask_user bukan JSON")
	}
	question = strings.TrimSpace(args.Question)
	if question == "" || jsconv.Len(question) > maxAskQuestion {
		return "", nil, fmt.Errorf("question wajib diisi, maksimal %d karakter", maxAskQuestion)
	}
	if len(args.Options) < 2 || len(args.Options) > 4 {
		return "", nil, fmt.Errorf("options harus berisi 2 sampai 4 pilihan")
	}
	seen := map[string]bool{}
	for _, o := range args.Options {
		o.Label, o.Description = strings.TrimSpace(o.Label), strings.TrimSpace(o.Description)
		if o.Label == "" || jsconv.Len(o.Label) > maxAskLabel {
			return "", nil, fmt.Errorf("label setiap pilihan wajib diisi, maksimal %d karakter", maxAskLabel)
		}
		if seen[o.Label] {
			return "", nil, fmt.Errorf("label pilihan tidak boleh sama: %q", o.Label)
		}
		seen[o.Label] = true
		o.Description = jsconv.Slice(o.Description, maxAskDesc)
		options = append(options, o)
	}
	return question, options, nil
}

// askUser: handler /ask_user layanan tools container. Menunggu jawaban pengguna, lalu membalas agen dengan teks.
func (t *agentTools) askUser(w http.ResponseWriter, r *http.Request) {
	reply := func(status int, text string) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(status)
		io.WriteString(w, text)
	}
	question, options, err := validateAsk(r.Body)
	if err != nil {
		reply(http.StatusBadRequest, err.Error())
		return
	}
	s := t.s
	s.mu.Lock()
	if s.asks[t.messageID] != nil {
		s.mu.Unlock()
		reply(http.StatusConflict, "Masih ada pertanyaan yang menunggu jawaban; tanyakan satu per satu.")
		return
	}
	t.askSeq++
	ask := &pendingAsk{userID: t.userID, id: t.askSeq, answer: make(chan string, 1)}
	s.asks[t.messageID] = ask
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		if s.asks[t.messageID] == ask {
			delete(s.asks, t.messageID)
		}
		s.mu.Unlock()
	}()

	t.deadline.pause()
	defer t.deadline.resume()
	t.send(event{"type": "question", "id": ask.id, "question": question, "options": options})

	var answer string
	timer := time.NewTimer(askTimeout)
	defer timer.Stop()
	select {
	case answer = <-ask.answer:
	case <-timer.C:
	case <-t.jobCtx.Done():
		t.send(event{"type": "answered", "id": ask.id, "answer": "", "timeout": false})
		reply(http.StatusServiceUnavailable, "Job dihentikan.")
		return
	}
	t.send(event{"type": "answered", "id": ask.id, "answer": answer, "timeout": answer == ""})
	if answer == "" {
		reply(http.StatusOK, "The owner did not answer. Continue with the safest reasonable choice and state the assumption you made in your summary.")
		return
	}
	for _, o := range options {
		if o.Label == answer {
			reply(http.StatusOK, fmt.Sprintf("The owner chose: %q.", answer))
			return
		}
	}
	reply(http.StatusOK, fmt.Sprintf("The owner answered in their own words: %q.", answer))
}

// Answer: jawaban pengguna untuk pertanyaan agen yang sedang menunggu (POST /api/ai/jobs/:id/answer).
func (s *Service) Answer(user *store.User, rawID string, body map[string]any) error {
	answer := strings.TrimSpace(jsconv.String(body["answer"]))
	if answer == "" {
		return httpx.Errorf(400, "Jawaban tidak boleh kosong")
	}
	answer = jsconv.Slice(answer, maxAskAnswerSize)
	qid, _ := body["question"].(float64)
	s.mu.Lock()
	defer s.mu.Unlock()
	ask := s.asks[id(rawID)]
	if ask == nil || ask.userID != user.ID || ask.id != int(qid) {
		return httpx.Errorf(409, "Pertanyaan ini sudah tidak menunggu jawaban")
	}
	delete(s.asks, id(rawID))
	ask.answer <- answer
	return nil
}

// pausableDeadline: batas waktu job mode Agen yang bisa dihentikan sementara (selama menunggu jawaban pengguna).
type pausableDeadline struct {
	mu        sync.Mutex
	remaining time.Duration
	started   time.Time
	timer     *time.Timer
	paused    int
	expire    func()
	expired   bool
}

func newPausableDeadline(d time.Duration, expire func()) *pausableDeadline {
	p := &pausableDeadline{remaining: d, expire: expire}
	p.mu.Lock()
	p.start()
	p.mu.Unlock()
	return p
}

func (p *pausableDeadline) start() {
	p.started = time.Now()
	p.timer = time.AfterFunc(p.remaining, func() {
		p.mu.Lock()
		p.expired = true
		p.mu.Unlock()
		p.expire()
	})
}

func (p *pausableDeadline) pause() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.paused++
	if p.paused == 1 && p.timer.Stop() {
		p.remaining -= time.Since(p.started)
	}
}

func (p *pausableDeadline) resume() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.paused--
	if p.paused == 0 && !p.expired {
		p.start()
	}
}

func (p *pausableDeadline) stop() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.timer.Stop()
}

func (p *pausableDeadline) hasExpired() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.expired
}

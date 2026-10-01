// Package aiqueue: antrean request ke provider AI. Paling banyak `maxConcurrent` panggilan berjalan
// bersamaan, sisanya menunggu urut (FIFO). Disimpan di memori — cukup untuk satu proses server.
// Padanan src/aiqueue.js.
package aiqueue

import (
	"context"
	"sort"
	"sync"
	"time"

	"rakit.io/server/internal/config"
)

// raiseAfter: batas dinaikkan lagi setelah sekian panggilan lancar berturut-turut.
const raiseAfter = 20

// Error: antrean penuh ("full") atau terlalu lama ("timeout").
type Error struct {
	Kind    string
	Message string
}

func (e *Error) Error() string { return e.Message }

type entry struct {
	grant      chan struct{}
	onPosition func(position, total int)
	enqueuedAt time.Time
}

type Queue struct {
	cfg *config.Config

	mu     sync.Mutex
	queue  []*entry
	active int
	// Batas adaptif: turun saat provider menolak karena sibuk, naik perlahan saat lancar. Dengan
	// begini antrean menemukan sendiri batas concurrency provider yang sebenarnya.
	limit         int
	successStreak int
	recentWaits   []int64 // waktu tunggu (ms) 100 request terakhir yang sempat mengantre

	served, queuedTotal, rejectedFull, timedOut, retries int
}

func New(cfg *config.Config) *Queue {
	return &Queue{cfg: cfg, limit: cfg.AI.MaxConcurrent}
}

// notify memberi tahu tiap penunggu posisinya sekarang. Dipanggil sambil memegang kunci.
func (q *Queue) notify() {
	for i, e := range q.queue {
		if e.onPosition != nil {
			e.onPosition(i+1, len(q.queue))
		}
	}
}

func (q *Queue) dispatch() {
	for q.active < q.limit && len(q.queue) > 0 {
		e := q.queue[0]
		q.queue = q.queue[1:]
		q.recentWaits = append(q.recentWaits, time.Since(e.enqueuedAt).Milliseconds())
		if len(q.recentWaits) > 100 {
			q.recentWaits = q.recentWaits[1:]
		}
		q.active++
		q.served++
		close(e.grant)
	}
	q.notify()
}

func (q *Queue) release() func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			q.mu.Lock()
			q.active--
			q.dispatch()
			q.mu.Unlock()
		})
	}
}

// leave mengeluarkan penunggu dari antrean; false bila ia sudah mendapat giliran.
func (q *Queue) leave(e *entry) bool {
	for i, other := range q.queue {
		if other == e {
			q.queue = append(q.queue[:i], q.queue[i+1:]...)
			q.notify()
			return true
		}
	}
	return false
}

// Acquire menunggu giliran memanggil provider. Mengembalikan fungsi release yang wajib dipanggil
// setelah selesai. Gagal dengan *Error bila antrean penuh atau terlalu lama, atau dengan kesalahan
// ctx bila dibatalkan.
func (q *Queue) Acquire(ctx context.Context, onPosition func(position, total int)) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	q.mu.Lock()
	if q.active < q.limit && len(q.queue) == 0 {
		q.active++
		q.served++
		q.mu.Unlock()
		return q.release(), nil
	}
	if len(q.queue) >= q.cfg.AI.QueueMax {
		q.rejectedFull++
		q.mu.Unlock()
		return nil, &Error{Kind: "full", Message: "AI sedang penuh. Coba lagi beberapa saat lagi."}
	}
	q.queuedTotal++
	e := &entry{grant: make(chan struct{}), onPosition: onPosition, enqueuedAt: time.Now()}
	q.queue = append(q.queue, e)
	q.notify()
	q.mu.Unlock()

	timer := time.NewTimer(q.cfg.AI.QueueTimeout)
	defer timer.Stop()
	select {
	case <-e.grant:
		return q.release(), nil
	case <-timer.C:
		q.mu.Lock()
		left := q.leave(e)
		if left {
			q.timedOut++
		}
		q.mu.Unlock()
		if left {
			return nil, &Error{Kind: "timeout", Message: "Antrean AI terlalu lama."}
		}
		return q.release(), nil // giliran datang tepat bersamaan
	case <-ctx.Done():
		q.mu.Lock()
		left := q.leave(e)
		q.mu.Unlock()
		if !left {
			q.release()() // sudah sempat mendapat giliran: kembalikan slotnya
		}
		return nil, ctx.Err()
	}
}

func (q *Queue) CountRetry() {
	q.mu.Lock()
	q.retries++
	q.mu.Unlock()
}

// ReportBusy: provider menolak karena sibuk (dipanggil selagi slot pemanggil masih terpakai).
func (q *Queue) ReportBusy() {
	q.mu.Lock()
	q.limit = max(1, min(q.limit, q.active)-1)
	q.successStreak = 0
	q.mu.Unlock()
}

// ReportSuccess: panggilan ke provider berhasil.
func (q *Queue) ReportSuccess() {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.limit >= q.cfg.AI.MaxConcurrent {
		return
	}
	q.successStreak++
	if q.successStreak >= raiseAfter {
		q.limit++
		q.successStreak = 0
		q.dispatch()
	}
}

type Stats struct {
	Active              int   `json:"active"`
	Queued              int   `json:"queued"`
	MaxConcurrent       int   `json:"maxConcurrent"`
	CurrentLimit        int   `json:"currentLimit"`
	QueueMax            int   `json:"queueMax"`
	QueueTimeoutSeconds int   `json:"queueTimeoutSeconds"`
	Served              int   `json:"served"`
	QueuedTotal         int   `json:"queuedTotal"`
	RejectedFull        int   `json:"rejectedFull"`
	TimedOut            int   `json:"timedOut"`
	Retries             int   `json:"retries"`
	MedianWaitMs        int64 `json:"medianWaitMs"`
	MaxWaitMs           int64 `json:"maxWaitMs"`
}

func (q *Queue) Stats() Stats {
	q.mu.Lock()
	defer q.mu.Unlock()
	waits := append([]int64(nil), q.recentWaits...)
	sort.Slice(waits, func(i, j int) bool { return waits[i] < waits[j] })
	s := Stats{
		Active: q.active, Queued: len(q.queue), MaxConcurrent: q.cfg.AI.MaxConcurrent, CurrentLimit: q.limit,
		QueueMax: q.cfg.AI.QueueMax, QueueTimeoutSeconds: int(q.cfg.AI.QueueTimeout.Seconds()),
		Served: q.served, QueuedTotal: q.queuedTotal, RejectedFull: q.rejectedFull, TimedOut: q.timedOut, Retries: q.retries,
	}
	if len(waits) > 0 {
		s.MedianWaitMs, s.MaxWaitMs = waits[len(waits)/2], waits[len(waits)-1]
	}
	return s
}

package fn

import (
	"sync"
	"time"
)

// clock: batas waktu eksekusi yang bisa dijeda. Waktu menunggu provider AI (ai.*) tidak dihitung ke batas
// 10 detik fungsi — panggilan AI punya batas sendiri (aiCallTimeout) — supaya fungsi yang memakai AI tidak
// selalu kehabisan waktu. Saat waktu habis, cancel dipanggil (QuickJS berhenti lewat CloseOnContextDone).
type clock struct {
	mu        sync.Mutex
	remaining time.Duration
	started   time.Time
	timer     *time.Timer
	cancel    func()
	paused    int
}

func newClock(limit time.Duration, cancel func()) *clock {
	c := &clock{remaining: limit, cancel: cancel}
	c.started = time.Now()
	c.timer = time.AfterFunc(limit, cancel)
	return c
}

// pause menghentikan jam (bisa bertumpuk); resume menjalankannya lagi dengan sisa waktu.
func (c *clock) pause() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.paused++; c.paused == 1 && c.timer.Stop() {
		c.remaining -= time.Since(c.started)
	}
}

func (c *clock) resume() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.paused--; c.paused == 0 {
		c.started = time.Now()
		c.timer = time.AfterFunc(max(c.remaining, 0), c.cancel)
	}
}

func (c *clock) stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.timer.Stop()
}

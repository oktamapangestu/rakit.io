package fn

import (
	"sync/atomic"
	"testing"
	"time"
)

// Waktu selama jam dijeda (menunggu provider AI) tidak dihitung ke batas waktu.
func TestClockPause(t *testing.T) {
	var fired atomic.Bool
	c := newClock(80*time.Millisecond, func() { fired.Store(true) })
	defer c.stop()
	time.Sleep(40 * time.Millisecond)
	c.pause()
	c.pause() // bertumpuk (panggilan AI bersamaan)
	time.Sleep(120 * time.Millisecond)
	c.resume()
	if fired.Load() {
		t.Fatal("waktu jeda ikut terhitung")
	}
	c.resume()
	time.Sleep(20 * time.Millisecond)
	if fired.Load() {
		t.Fatal("sisa waktu (±40 ms) belum habis")
	}
	time.Sleep(60 * time.Millisecond)
	if !fired.Load() {
		t.Fatal("batas waktu tidak ditegakkan setelah dilanjutkan")
	}
}

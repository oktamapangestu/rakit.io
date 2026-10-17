package ai

import (
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestValidateAsk(t *testing.T) {
	q, opts, err := validateAsk(strings.NewReader(`{"question":"  Judulnya? ","options":[{"label":" A ","description":" pertama "},{"label":"B"}]}`))
	if err != nil || q != "Judulnya?" || len(opts) != 2 || opts[0] != (askOption{"A", "pertama"}) {
		t.Fatalf("validateAsk = %q %+v %v", q, opts, err)
	}
	for _, bad := range []string{
		`bukan json`,
		`{"question":"","options":[{"label":"A"},{"label":"B"}]}`,
		`{"question":"Q","options":[{"label":"A"}]}`,
		`{"question":"Q","options":[{"label":"A"},{"label":"B"},{"label":"C"},{"label":"D"},{"label":"E"}]}`,
		`{"question":"Q","options":[{"label":"A"},{"label":" "}]}`,
		`{"question":"Q","options":[{"label":"A"},{"label":"A"}]}`,
		`{"question":"` + strings.Repeat("x", maxAskQuestion+1) + `","options":[{"label":"A"},{"label":"B"}]}`,
	} {
		if _, _, err := validateAsk(strings.NewReader(bad)); err == nil {
			t.Errorf("validateAsk(%.60s) tidak ditolak", bad)
		}
	}
}

func TestPausableDeadline(t *testing.T) {
	var fired atomic.Bool
	d := newPausableDeadline(60*time.Millisecond, func() { fired.Store(true) })
	defer d.stop()
	time.Sleep(20 * time.Millisecond)
	d.pause()
	time.Sleep(100 * time.Millisecond) // lebih lama dari batasnya: selama dijeda tidak habis
	if fired.Load() || d.hasExpired() {
		t.Fatal("batas waktu habis selama dijeda")
	}
	d.resume()
	time.Sleep(120 * time.Millisecond)
	if !fired.Load() || !d.hasExpired() {
		t.Fatal("batas waktu tidak habis setelah dilanjutkan")
	}
}

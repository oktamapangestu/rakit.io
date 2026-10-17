package pagecheck

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCheck(t *testing.T) {
	c := New(Options{MaxConcurrent: 2, Idle: time.Second})
	if c == nil {
		t.Skip("tidak ada Chromium/Chrome")
	}
	defer c.Close()

	// Layanan lain di 127.0.0.1 yang tidak boleh terjangkau kode halaman.
	var hits atomic.Int32
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Write([]byte("rahasia"))
	}))
	defer internal.Close()

	site := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/", "/index.html":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write([]byte(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<script src="/app.js"></script><script src="/hilang.js"></script></head>
<body><div class="lebar" style="width:900px">x</div>
<script>fetch('` + internal.URL + `/x').catch(() => {}); fetch('/api/db/produk').then(r => r.json()); localStorage.setItem('a', '1')</script></body></html>`))
		case "/app.js":
			w.Header().Set("Content-Type", "text/javascript")
			w.Write([]byte("console.error('gagal memuat', 42); undefinedFn();"))
		case "/bersih.html":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write([]byte(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><p>Halo</p>`))
		case "/api/db/produk":
			time.Sleep(300 * time.Millisecond)
			http.Error(w, `{"error":"Tabel tidak ada"}`, http.StatusNotFound)
		default:
			http.NotFound(w, r)
		}
	})
	reps, err := c.Check(context.Background(), site, []string{"/", "/bersih.html", "/tidak-ada.html"})
	if err != nil {
		t.Fatal(err)
	}
	all := strings.Join(reps[0].Problems, "\n")
	for _, want := range []string{"undefinedFn is not defined", "console.error: gagal memuat 42", "HTTP 404: GET /hilang.js",
		"HTTP 404: GET /api/db/produk", "lebih lebar dari layar HP", "div.lebar"} {
		if !strings.Contains(all, want) {
			t.Errorf("tidak ada %q di:\n%s", want, all)
		}
	}
	if hits.Load() != 0 {
		t.Errorf("halaman bisa menjangkau layanan lain di 127.0.0.1")
	}
	if strings.Join(reps[0].Blocked, ",") != "127.0.0.1" {
		t.Errorf("blocked = %v", reps[0].Blocked)
	}
	if len(reps[1].Problems) != 0 {
		t.Errorf("halaman bersih: %v", reps[1].Problems)
	}
	if reps[2].Status != 404 || len(reps[2].Problems) != 1 || !strings.Contains(reps[2].Problems[0], "HTTP 404") {
		t.Errorf("halaman tidak ada: %d %v", reps[2].Status, reps[2].Problems)
	}

	// Pemeriksaan bersamaan memakai browser yang sama; setelah menganggur browser dimatikan lalu bisa menyala lagi.
	done := make(chan error, 2)
	for range 2 {
		go func() {
			_, err := c.Check(context.Background(), site, []string{"/bersih.html"})
			done <- err
		}()
	}
	for range 2 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	time.Sleep(1500 * time.Millisecond)
	c.mu.Lock()
	off := c.browser == nil
	c.mu.Unlock()
	if !off {
		t.Error("browser tidak dimatikan setelah menganggur")
	}
	if reps, err := c.Check(context.Background(), site, []string{"/bersih.html"}); err != nil || len(reps[0].Problems) != 0 {
		t.Errorf("setelah menyala lagi: %v %v", err, reps)
	}
}

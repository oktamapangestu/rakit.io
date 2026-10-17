package sites

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"rakit.io/server/internal/config"
)

func minified1(t *testing.T, typ, src string) string {
	t.Helper()
	var out bytes.Buffer
	if err := minifier.Minify(typ, &out, strings.NewReader(src)); err != nil {
		t.Fatalf("minify %s: %v", typ, err)
	}
	return out.String()
}

func TestMinifyKeepsAlpine(t *testing.T) {
	page := `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <!-- komentar -->
  <script defer src="/app.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js"></script>
  <style> [x-cloak] { display: none !important; } </style>
</head>
<body>
  <nav x-data="{ open: false }" :class="{ 'is-open': open }">
    <button type="button" @click="open = !open" x-on:keydown.escape.window="open = false">Menu</button>
    <ul x-show="open" x-cloak x-transition>
      <template x-for="item in items" :key="item.id"><li x-text="item.nama"></li></template>
    </ul>
  </nav>
  <form x-data="bukuTamu" @submit.prevent="kirim()">
    <input type="text" x-model="nama" required>
    <pre>  spasi   tetap </pre>
  </form>
  <script>
    // komentar
    document.addEventListener('alpine:init', () => {
      Alpine.data('bukuTamu', () => ({ nama: '', async kirim() { await fetch('/api/db/ucapan', { method: 'POST' }); } }));
    });
  </script>
</body>
</html>`
	out := minified1(t, "text/html", page)
	for _, want := range []string{
		`x-data="{ open: false }"`, `:class="{ 'is-open': open }"`, `@click="open = !open"`,
		`x-on:keydown.escape.window="open = false"`, `x-cloak`, `<template x-for="item in items" :key="item.id">`,
		`@submit.prevent="kirim()"`, `<pre>  spasi   tetap </pre>`, `Alpine.data("bukuTamu"`, `<!doctype html>`, `</body>`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("hilang %q di:\n%s", want, out)
		}
	}
	if strings.Contains(out, "komentar") {
		t.Errorf("komentar tidak dibuang:\n%s", out)
	}
	t.Logf("%d -> %d byte\n%s", len(page), len(out), out)
}

func TestMinifyJSKeepsGlobals(t *testing.T) {
	out := minified1(t, "text/javascript", "function hitungTotal(harga, jumlah) {\n  const total = harga * jumlah;\n  return total;\n}\nvar keranjang = [];\n")
	for _, want := range []string{"function hitungTotal(", "keranjang"} {
		if !strings.Contains(out, want) {
			t.Errorf("hilang %q di %s", want, out)
		}
	}
	t.Log(out)
}

func TestServeMinify(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "index.html"), []byte("<!doctype html>\n<html>\n<head>\n  <title>Hai</title>\n</head>\n<body>\n  <p>Halo</p>\n</body>\n</html>\n"), 0o644)
	os.WriteFile(filepath.Join(root, "app.js"), []byte("// komentar\nfunction halo() {\n  return 1;\n}\n"), 0o644)
	h := New(&config.Config{AppOrigin: "http://localhost"}, nil)
	target := &Target{Root: root, Minify: true}

	get := func(path string, prep func(*http.Request)) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		if prep != nil {
			prep(r)
		}
		w := httptest.NewRecorder()
		h.ServeTarget(w, r, target)
		return w
	}

	// Pengunjung: diminify, ETag berbeda dari versi asli, 304 untuk ETag yang sama.
	w := get("/app.js", nil)
	if body := w.Body.String(); strings.Contains(body, "komentar") || !strings.Contains(body, "function halo()") {
		t.Fatalf("app.js tidak diminify: %q", body)
	}
	etag := w.Header().Get("ETag")
	if !strings.HasSuffix(etag, `-m"`) || w.Header().Get("Content-Length") != strconv.Itoa(w.Body.Len()) {
		t.Fatalf("header salah: etag %s, length %s", etag, w.Header().Get("Content-Length"))
	}
	if w := get("/app.js", func(r *http.Request) { r.Header.Set("If-None-Match", etag) }); w.Code != http.StatusNotModified {
		t.Fatalf("ETag minify: status %d", w.Code)
	}
	if body := get("/", nil).Body.String(); strings.Contains(body, "\n") {
		t.Fatalf("index.html tidak diminify: %q", body)
	}

	// Preview editor: halaman versi iframe asli + memasang cookie; file yang dimuat sesudahnya juga asli.
	w = get("/", func(r *http.Request) { r.Header.Set("Sec-Fetch-Dest", "iframe") })
	if !strings.Contains(w.Body.String(), "<p>Halo</p>\n") || !strings.Contains(w.Header().Get("Set-Cookie"), previewCookie+"=1") {
		t.Fatalf("preview: cookie %q, isi %q", w.Header().Get("Set-Cookie"), w.Body.String())
	}
	w = get("/app.js", func(r *http.Request) { r.AddCookie(&http.Cookie{Name: previewCookie, Value: "1"}) })
	if !strings.Contains(w.Body.String(), "// komentar") || strings.HasSuffix(w.Header().Get("ETag"), `-m"`) {
		t.Fatalf("app.js dari preview diminify: %q", w.Body.String())
	}

	// Versi dev / sandbox agen (Minify false): selalu asli.
	target.Minify = false
	if body := get("/app.js", nil).Body.String(); !strings.Contains(body, "// komentar") {
		t.Fatalf("Minify false tetap diminify: %q", body)
	}
}

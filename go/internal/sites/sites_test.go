package sites

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rakit.io/server/internal/config"
)

func TestWithPicker(t *testing.T) {
	h := &Handler{cfg: &config.Config{AppOrigin: "https://rakit.io"}}
	scripts := `<script src="/api/_console.js?v=` + consoleVersion + `" data-app="https://rakit.io"></script>` +
		`<script defer src="/api/_picker.js?v=` + pickerFileVer + `" data-app="https://rakit.io"></script>`
	cases := []struct{ page, before, after string }{
		// Skrip sistem tepat setelah <head>, sebelum skrip website.
		{`<!doctype html><html lang="id"><head><script src="app.js"></script></head><body><header>x</header></body></html>`,
			`<!doctype html><html lang="id"><head>`, `<script src="app.js"></script></head><body><header>x</header></body></html>`},
		// Tanpa <head>: setelah <html>. <header> bukan <head>.
		{`<!DOCTYPE html><HTML><body><header>x</header></body></HTML>`, `<!DOCTYPE html><HTML>`, `<body><header>x</header></body></HTML>`},
		// Hanya doctype: tetap sesudahnya (sebelum doctype = quirks mode).
		{`<!doctype html><p>halo</p>`, `<!doctype html>`, `<p>halo</p>`},
		// Potongan HTML tanpa apa-apa: di awal.
		{`<p>halo</p>`, ``, `<p>halo</p>`},
		// HTML yang sedang diketik ("</h" belum selesai): skrip di depan, tidak ikut tertelan jadi teks.
		{`<h1> halo </h`, ``, `<h1> halo </h`},
	}
	for _, c := range cases {
		if out := string(h.withPicker([]byte(c.page))); out != c.before+scripts+c.after {
			t.Errorf("skrip salah tempat untuk %q:\n%.300s", c.page, out)
		}
	}
}

// ETag versi iframe ikut berubah bila skrip pemilih berubah (server diperbarui, file halaman tetap).
func TestPageETagIncludesPickerVersion(t *testing.T) {
	file := filepath.Join(t.TempDir(), "index.html")
	if err := os.WriteFile(file, []byte("<p>halo</p>"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	plain, framed := pageETag(info, false), pageETag(info, true)
	if plain == framed || !strings.Contains(framed, pickerVersion) {
		t.Fatalf("ETag iframe harus memuat versi pemilih: %s / %s", plain, framed)
	}
	old := pickerVersion
	pickerVersion = "versibaru"
	defer func() { pickerVersion = old }()
	if pageETag(info, true) == framed {
		t.Fatal("ETag iframe tidak berubah saat skrip pemilih berubah")
	}
}

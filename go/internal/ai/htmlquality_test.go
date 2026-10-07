package ai

import (
	"strings"
	"testing"
)

func TestDeadLinkProblems(t *testing.T) {
	html := `<html><body>
	<a href="#">Beranda</a>
	<a href="#kontak">Kontak</a>
	<a href="#harga">Harga</a>
	<section id="kontak">...</section>
	</body></html>`
	got := deadLinkProblems(html)
	joined := strings.Join(got, " | ")
	if !strings.Contains(joined, "href=\"#\"") {
		t.Fatalf("harusnya mendeteksi href=# mati, dapat: %v", got)
	}
	if !strings.Contains(joined, "#harga") {
		t.Fatalf("harusnya mendeteksi anchor #harga menggantung, dapat: %v", got)
	}
	if strings.Contains(joined, "#kontak") {
		t.Fatalf("anchor #kontak valid, tidak boleh dilaporkan, dapat: %v", got)
	}
}

func TestDeadLinkClean(t *testing.T) {
	html := `<a href="#fitur">Fitur</a><a href="/lain.html">Lain</a><section id="fitur"></section>`
	if got := deadLinkProblems(html); len(got) != 0 {
		t.Fatalf("HTML bersih seharusnya tanpa masalah, dapat: %v", got)
	}
}

// Angka rujukan ini sama dengan skills/antislop-human/contrast-check.py dan WCAG 2.x.
func TestContrastRatio(t *testing.T) {
	cases := []struct {
		fg, bg string
		want   float64
	}{
		{"#ffffff", "#000000", 21.0},
		{"#555555", "#000000", 2.82},
		{"#ffffff", "#1a1a1a", 17.40},
		{"#777777", "#ffffff", 4.48},
	}
	for _, c := range cases {
		got := contrastRatio(c.fg, c.bg)
		if diff := got - c.want; diff > 0.05 || diff < -0.05 {
			t.Errorf("kontras %s/%s = %.2f, ingin %.2f", c.fg, c.bg, got, c.want)
		}
	}
}

func TestContrastProblems(t *testing.T) {
	html := `<style>
	.terang { color: #555555; background-color: #000000; }
	.bagus  { color: #ffffff; background-color: #1a1a1a; }
	</style>
	<p style="color: #999999; background: #ffffff">teks</p>`
	got := contrastProblems(html)
	joined := strings.Join(got, " | ")
	if !strings.Contains(joined, "#555555") {
		t.Fatalf("harusnya melaporkan kontras rendah #555555, dapat: %v", got)
	}
	if strings.Contains(joined, "#ffffff di atas #1a1a1a") {
		t.Fatalf("pasangan bagus tidak boleh dilaporkan, dapat: %v", got)
	}
	if len(got) > 4 {
		t.Fatalf("laporan harus dibatasi maksimal 4, dapat %d", len(got))
	}
}

func TestHtmlProblemsIgnoresNonHTML(t *testing.T) {
	if got := htmlProblems("app.js", `<a href="#">x</a>`); len(got) != 0 {
		t.Fatalf("file .js tidak diperiksa, dapat: %v", got)
	}
}

func TestPowApprox(t *testing.T) {
	// Cek akurasi pendekatan pow (dipakai luminance) terhadap nilai acuan.
	cases := []struct{ x, y, want float64 }{
		{0.5, 2.4, 0.1895},
		{1.0, 2.4, 1.0},
		{0.03928 / 12.92, 1.0, 0.00304},
	}
	for _, c := range cases {
		got := pow(c.x, c.y)
		if diff := got - c.want; diff > 1e-3 || diff < -1e-3 {
			t.Errorf("pow(%v,%v)=%v, ingin %v", c.x, c.y, got, c.want)
		}
	}
}

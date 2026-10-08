package ai

// Pemeriksaan kualitas HTML deterministik, dijalankan saat file .html ditulis (lihat stageToolCall).
// Berbeda dari aturan di prompt, pemeriksaan ini TIDAK bergantung pada kepatuhan model: kalau ada
// masalah, hasilnya dikirim balik ke model untuk diperbaiki (pola sama seperti apiPathProblems).
//
// Dua hal diperiksa:
//  1. Tautan mati — href="#" atau anchor ke id yang tidak ada di halaman (aturan R-24/R-26 antislop-ui).
//  2. Kontras warna WCAG AA — pasangan color/background-color yang rasionya di bawah 4.5:1 (R-25).

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// htmlProblems mengembalikan daftar masalah kualitas pada satu file HTML.
func htmlProblems(path, content string) []string {
	if !strings.HasSuffix(strings.ToLower(path), ".html") {
		return nil
	}
	var problems []string
	problems = append(problems, deadLinkProblems(content)...)
	problems = append(problems, contrastProblems(content)...)
	return problems
}

var (
	// Didahului spasi, bukan sekadar batas kata: :href / x-bind:id milik Alpine.js berisi ekspresi JS, bukan URL/id.
	hrefRE     = regexp.MustCompile(`(?is)<a\b[^>]*\shref\s*=\s*["']([^"']*)["']`)
	idAttrRE   = regexp.MustCompile(`(?is)\sid\s*=\s*["']([\w-]+)["']`)
	hexColorRE = regexp.MustCompile(`(?i)#([0-9a-f]{3}|[0-9a-f]{6})\b`)
	// Deklarasi dalam blok <style>…</style> atau atribut style="…".
	colorDeclRE = regexp.MustCompile(`(?i)(^|[;{\s])(color|background|background-color)\s*:\s*([^;}"']+)`)
)

// deadLinkProblems mencari <a href="#"> dan anchor ke id yang tidak ada di halaman.
func deadLinkProblems(content string) []string {
	ids := map[string]bool{}
	for _, m := range idAttrRE.FindAllStringSubmatch(content, -1) {
		ids[strings.ToLower(m[1])] = true
	}
	dead := 0
	hanging := map[string]bool{}
	for _, m := range hrefRE.FindAllStringSubmatch(content, -1) {
		h := strings.TrimSpace(m[1])
		switch {
		case h == "" || h == "#":
			dead++
		case strings.HasPrefix(h, "#"):
			if !ids[strings.ToLower(h[1:])] {
				hanging[h] = true
			}
		}
	}
	var out []string
	if dead > 0 {
		out = append(out, fmt.Sprintf("%d tautan <a href=\"#\"> tidak menuju apa pun — hapus atau arahkan ke seksi nyata", dead))
	}
	for h := range hanging {
		out = append(out, fmt.Sprintf("tautan \"%s\" menunjuk id yang tidak ada di halaman ini", h))
	}
	return out
}

// contrastProblems mencari pasangan color/background-color di CSS/inline style yang
// rasionya di bawah 4.5:1 (WCAG AA teks normal).
func contrastProblems(content string) []string {
	// Kumpulkan warna teks & latar per "aturan" CSS (blok {…} atau atribut style).
	styles := styleText(content)
	seen := map[string]bool{}
	var out []string
	for _, decl := range splitRules(styles) {
		fg, bg := pickColors(decl)
		if fg == "" || bg == "" {
			continue
		}
		ratio := contrastRatio(fg, bg)
		if ratio <= 0 {
			continue
		}
		key := fmt.Sprintf("%s|%s", fg, bg)
		if ratio < 4.5 && !seen[key] {
			seen[key] = true
			out = append(out, fmt.Sprintf("kontras teks %s di atas %s hanya %.1f:1 (WCAG AA butuh 4.5:1)", fg, bg, ratio))
			if len(out) >= 4 { // batasi agar hasil balik ke model tidak kepanjangan
				return out
			}
		}
	}
	return out
}

// styleText mengambil isi <style>…</style> plus semua nilai atribut style="…".
func styleText(content string) string {
	var b strings.Builder
	for _, m := range regexp.MustCompile(`(?is)<style[^>]*>(.*?)</style>`).FindAllStringSubmatch(content, -1) {
		b.WriteString(m[1])
		b.WriteString("\n")
	}
	for _, m := range regexp.MustCompile(`(?is)\bstyle\s*=\s*["']([^"']*)["']`).FindAllStringSubmatch(content, -1) {
		b.WriteString(m[1])
		b.WriteString(";")
		b.WriteString("\n")
	}
	return b.String()
}

// splitRules memecah teks CSS menjadi potongan aturan. Satu aturan = isi di antara '{' dan '}',
// plus potongan deklarasi inline yang dipisah ';'.
func splitRules(css string) []string {
	var out []string
	// Ambil isi blok { ... }
	for _, m := range regexp.MustCompile(`(?s)\{([^{}]*)\}`).FindAllStringSubmatch(css, -1) {
		out = append(out, m[1])
	}
	// Deklarasi inline (tanpa blok) tetap dipecah per ';'.
	for _, part := range strings.Split(css, ";") {
		if !strings.Contains(part, "{") && !strings.Contains(part, "}") {
			out = append(out, part)
		}
	}
	return out
}

// pickColors mengembalikan (warna teks, warna latar) dari satu potongan aturan, bila keduanya ada.
func pickColors(rule string) (string, string) {
	var fg, bg string
	for _, m := range colorDeclRE.FindAllStringSubmatch(rule, -1) {
		prop := strings.ToLower(m[2])
		val := strings.TrimSpace(m[3])
		hex := firstHex(val)
		if hex == "" {
			continue
		}
		if prop == "color" {
			fg = hex
		} else {
			bg = hex
		}
	}
	return fg, bg
}

func firstHex(v string) string {
	if m := hexColorRE.FindString(v); m != "" {
		return strings.ToLower(m)
	}
	return ""
}

// contrastRatio menghitung rasio kontras WCAG 2.x antara dua warna hex (#rgb atau #rrggbb).
func contrastRatio(a, b string) float64 {
	r1, g1, b1, ok1 := parseHex(a)
	r2, g2, b2, ok2 := parseHex(b)
	if !ok1 || !ok2 {
		return 0
	}
	l1 := luminance(r1, g1, b1)
	l2 := luminance(r2, g2, b2)
	if l1 < l2 {
		l1, l2 = l2, l1
	}
	return (l1 + 0.05) / (l2 + 0.05)
}

func parseHex(h string) (float64, float64, float64, bool) {
	h = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(h)), "#")
	if len(h) == 3 {
		h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
	}
	if len(h) != 6 {
		return 0, 0, 0, false
	}
	n, err := strconv.ParseUint(h, 16, 32)
	if err != nil {
		return 0, 0, 0, false
	}
	return float64((n>>16)&0xff) / 255, float64((n>>8)&0xff) / 255, float64(n&0xff) / 255, true
}

// luminance: relative luminance WCAG 2.x.
func luminance(r, g, b float64) float64 {
	ch := func(c float64) float64 {
		if c <= 0.03928 {
			return c / 12.92
		}
		return pow((c+0.055)/1.055, 2.4)
	}
	return 0.2126*ch(r) + 0.7152*ch(g) + 0.0722*ch(b)
}

// pow: eksponen sederhana (menghindari impor math hanya untuk satu panggilan; presisi cukup).
func pow(x, y float64) float64 {
	if x <= 0 {
		return 0
	}
	// x^y = exp(y*ln x) via deret cepat untuk kebutuhan kontras (galat < 1e-6).
	return expApprox(y * lnApprox(x))
}

func lnApprox(x float64) float64 {
	// ln via reduksi ke sekitar 1 dengan faktor 2.
	k := 0.0
	for x >= 2 {
		x /= 2
		k++
	}
	for x < 0.5 {
		x *= 2
		k--
	}
	z := (x - 1) / (x + 1)
	z2 := z * z
	sum := 0.0
	term := z
	for n := 1; n <= 25; n += 2 {
		sum += term / float64(n)
		term *= z2
	}
	return 2*sum + k*0.6931471805599453
}

func expApprox(x float64) float64 {
	// exp via deret Taylor dengan reduksi rentang.
	k := 0
	for x > 0.5 {
		x -= 0.6931471805599453
		k++
	}
	for x < -0.5 {
		x += 0.6931471805599453
		k--
	}
	sum, term := 1.0, 1.0
	for n := 1; n <= 20; n++ {
		term *= x / float64(n)
		sum += term
	}
	for i := 0; i < k; i++ {
		sum *= 2
	}
	for i := 0; i > k; i-- {
		sum /= 2
	}
	return sum
}

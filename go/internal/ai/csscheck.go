package ai

// Pemeriksaan struktur CSS (file .css dan <style> di HTML), dijalankan saat file ditulis. Browser tidak pernah
// menampilkan error CSS: satu kurung kurawal yang lupa ditutup diam-diam membuat semua aturan sesudahnya tidak
// berlaku (atau ikut bersarang di aturan sebelumnya), komentar yang tidak ditutup menelan sisa file. Yang diperiksa
// hanya hal yang pasti salah: kurung { } tidak seimbang, komentar /* dan tanda kutip yang tidak ditutup.

import (
	"fmt"
	"strings"
)

// cssProblems: masalah struktur di kode CSS. firstLine = nomor baris kode itu di file (untuk <style> di HTML).
func cssProblems(css string, firstLine int) []string {
	type open struct {
		line     int
		selector string
	}
	var out []string
	var stack []open
	line := firstLine
	segment := 0 // awal teks selector/deklarasi yang sedang dibaca (sesudah { } atau ;)
	inURL := false
	for i := 0; i < len(css); i++ {
		c := css[i]
		switch {
		case c == '\n':
			line++
		case c == '/' && i+1 < len(css) && css[i+1] == '*':
			end := strings.Index(css[i+2:], "*/")
			if end < 0 {
				return append(out, fmt.Sprintf("komentar /* di baris %d tidak pernah ditutup dengan */ — semua CSS sesudahnya diabaikan browser", line))
			}
			line += strings.Count(css[i:i+2+end+2], "\n")
			i += 2 + end + 1
		case c == '"' || c == '\'':
			start := line
			j := i + 1
			for ; j < len(css); j++ {
				if css[j] == '\\' {
					j++
					continue
				}
				if css[j] == c || css[j] == '\n' {
					break
				}
			}
			if j >= len(css) || css[j] == '\n' {
				return append(out, fmt.Sprintf("tanda kutip %c di baris %d tidak ditutup di baris yang sama — aturan itu dan sesudahnya rusak", c, start))
			}
			i = j
		case inURL:
			if c == ')' {
				inURL = false
			}
		case c == '(' && i >= 3 && strings.EqualFold(css[i-3:i], "url"):
			// url(...) tanpa tanda kutip boleh berisi karakter apa pun selain ) — mis. data:image/svg+xml.
			j := i + 1
			for j < len(css) && (css[j] == ' ' || css[j] == '\t') {
				j++
			}
			inURL = j < len(css) && css[j] != '"' && css[j] != '\''
		case c == '{':
			stack = append(stack, open{line, strings.TrimSpace(css[segment:i])})
			segment = i + 1
		case c == '}':
			if len(stack) == 0 {
				out = append(out, fmt.Sprintf("kurung } di baris %d tidak punya pasangan { — aturan sesudahnya diabaikan browser", line))
			} else {
				stack = stack[:len(stack)-1]
			}
			segment = i + 1
		case c == ';':
			segment = i + 1
		}
	}
	if len(stack) > 0 {
		o := stack[0]
		if len(stack) > 1 {
			// Yang paling dalam biasanya yang lupa ditutup (aturan sesudahnya ikut masuk ke dalamnya).
			o = stack[len(stack)-1]
		}
		out = append(out, fmt.Sprintf(`kurung { untuk "%s" di baris %d tidak pernah ditutup — aturan sesudahnya ikut rusak (kurang %d kurung })`,
			clipText(strings.Join(strings.Fields(o.selector), " "), 60), o.line, len(stack)))
	}
	return out
}

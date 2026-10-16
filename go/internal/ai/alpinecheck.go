package ai

// Pemeriksaan atribut Alpine.js di halaman HTML (bagian dari syntaxProblems, dijalankan saat file ditulis):
//   - ekspresi di x-data, x-init, x-show, x-text, :class, @click, x-model, … dikompilasi QuickJS persis seperti
//     Alpine menyusunnya (lihat alpineWrap), jadi salah ketik yang membuat Alpine melempar error saat halaman dibuka
//     ketahuan sebelum disimpan;
//   - x-for/x-if hanya bekerja di <template>, dan <template>-nya harus berisi tepat satu elemen akar.
// Kolom database yang dipakai di dalam x-for diperiksa di pemeriksaan akhir (columnProblems), karena tabelnya boleh
// dibuat belakangan di jawaban yang sama.

import (
	"fmt"
	"regexp"
	"strings"

	"golang.org/x/net/html"

	"rakit.io/server/internal/jscheck"
)

var (
	// Atribut yang nilainya ekspresi JavaScript. x-transition, x-ref, x-cloak, x-ignore, x-teleport, x-mask berisi
	// teks biasa (kelas CSS, nama, selector) dan tidak diperiksa.
	alpineExprAttrRE = regexp.MustCompile(`^(?:x-(?:data|init|show|text|html|model|modelable|if|effect|id|for|intersect|trap)(?:[.:].*)?|x-bind(?::.+)?|x-on:.+|[:@][^:@].*)$`)
	xForRE           = regexp.MustCompile(`(?s)^\s*(.*?)\s+(?:in|of)\s+(.*)$`)
	// Aturan Alpine (generateFunctionFromString): ekspresi yang diawali if/let/const dibungkus fungsi.
	alpineIfRE  = regexp.MustCompile(`^[\n\s]*if.*\(.*\)`)
	alpineLetRE = regexp.MustCompile(`^(let|const)\s`)
)

const maxAlpineReports = 5

// alpineAttr: satu atribut Alpine berisi ekspresi.
type alpineAttr struct {
	tag, name, value string
	expr             string // bagian yang dijalankan sebagai JavaScript (untuk x-for: daftar di kanan "in")
}

func (a alpineAttr) label() string {
	return fmt.Sprintf(`<%s %s="%s">`, a.tag, a.name, clipText(strings.Join(strings.Fields(a.value), " "), 100))
}

func clipText(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}

// walk memanggil fn untuk setiap elemen di bawah n (termasuk isi <template>).
func walk(n *html.Node, fn func(*html.Node)) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode {
			fn(c)
		}
		walk(c, fn)
	}
}

func attr(n *html.Node, name string) (string, bool) {
	for _, a := range n.Attr {
		if a.Key == name {
			return a.Val, true
		}
	}
	return "", false
}

// templateRoots: elemen langsung di dalam <template> (x/net/html menaruh isi template sebagai anak elemennya).
func templateRoots(n *html.Node) int {
	count := 0
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode {
			count++
		}
	}
	return count
}

// alpineProblemsIn: masalah atribut Alpine di halaman content. Hanya halaman yang memakai x-data.
func alpineProblemsIn(content string) []problem {
	if !strings.Contains(content, "x-data") {
		return nil
	}
	doc, err := html.Parse(strings.NewReader(content))
	if err != nil {
		return nil
	}
	var out []problem
	var list []alpineAttr
	walk(doc, func(n *html.Node) {
		for _, a := range n.Attr {
			if !alpineExprAttrRE.MatchString(a.Key) {
				continue
			}
			isFor := a.Key == "x-for" || strings.HasPrefix(a.Key, "x-for.")
			isIf := a.Key == "x-if"
			if (isFor || isIf) && n.Data != "template" {
				out = append(out, problem{"alpine", fmt.Sprintf(`%s: %s hanya bekerja di <template> — bungkus elemennya dengan <template %s="…">`, alpineAttr{tag: n.Data, name: a.Key, value: a.Val}.label(), a.Key, a.Key)})
				continue
			}
			if (isFor || isIf) && templateRoots(n) != 1 {
				out = append(out, problem{"alpine", fmt.Sprintf(`<template %s="%s"> harus berisi tepat satu elemen akar (sekarang %d) — Alpine hanya menampilkan elemen pertama; bungkus isinya dengan satu elemen`, a.Key, clipText(a.Val, 80), templateRoots(n))})
			}
			item := alpineAttr{tag: n.Data, name: a.Key, value: a.Val, expr: a.Val}
			if isFor {
				m := xForRE.FindStringSubmatch(a.Val)
				if m == nil {
					out = append(out, problem{"alpine", fmt.Sprintf(`%s: x-for harus berbentuk "item in daftar" atau "(item, index) in daftar"`, item.label())})
					continue
				}
				item.expr = m[2]
			}
			if strings.TrimSpace(item.expr) != "" {
				list = append(list, item)
			}
		}
	})
	return append(out, alpineSyntax(list)...)
}

// alpineWrap: kode yang disusun Alpine untuk sebuah ekspresi (new AsyncFunction(['__self', 'scope'], …)).
func alpineWrap(expr string) string {
	trimmed := strings.TrimSpace(expr)
	if alpineIfRE.MatchString(trimmed) || alpineLetRE.MatchString(trimmed) {
		expr = "(async()=>{ " + expr + " })()"
	}
	return "with (scope) { __self.result = " + expr + " }; __self.finished = true; return __self.result;"
}

// alpineSyntax: ekspresi yang tidak bisa dikompilasi. Semua dikompilasi sekaligus (satu fungsi per ekspresi); hanya bila
// gagal, daftarnya dibagi dua berulang kali sampai ekspresi yang salah ketemu. Posisi error di kompilasi gabungan
// tidak bisa dipakai: kurung yang tidak ditutup di satu ekspresi baru terasa di ekspresi sesudahnya.
func alpineSyntax(list []alpineAttr) []problem {
	var out []problem
	var search func(part []alpineAttr)
	search = func(part []alpineAttr) {
		if len(part) == 0 || len(out) >= maxAlpineReports {
			return
		}
		var b strings.Builder
		for i, a := range part {
			// Sama dengan new AsyncFunction(['__self', 'scope'], body): body diapit baris baru.
			fmt.Fprintf(&b, "async function __alpine%d(__self, scope) {\n%s\n}\n", i, alpineWrap(a.expr))
		}
		err := jscheck.Check(b.String(), jscheck.Script, "alpine")
		if err == nil {
			return
		}
		if len(part) == 1 {
			out = append(out, problem{"alpine", fmt.Sprintf("%s: %s (Alpine gagal menjalankan ekspresi ini)", part[0].label(), err.Message)})
			return
		}
		half := len(part) / 2
		search(part[:half])
		search(part[half:])
	}
	search(list)
	return out
}

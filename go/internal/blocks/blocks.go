// Package blocks: bagian halaman ("blok") yang dipilih pengguna di preview untuk diubah lewat prompt AI.
//
// Blok ditunjuk dengan selector sederhana yang dibuat skrip pemilih (internal/sites/picker.js):
// rantai dari <body> dengan :nth-of-type di setiap langkah, mis.
//
//	body > section:nth-of-type(2) > div:nth-of-type(1)
//
// Bentuk ini dicari ulang di HTML sumber dengan parser HTML5 (sama dengan browser), untuk memeriksa
// apakah AI mengubah bagian halaman di luar blok yang dipilih.
package blocks

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"

	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
)

const (
	MaxBlocks   = 5
	maxSelector = 400
	maxLabel    = 60
	maxHTML     = 6000 // potongan HTML blok yang ikut dikirim ke AI
)

// Block: satu blok terpilih. HTML hanya untuk konteks AI dan tidak disimpan.
type Block struct {
	Page     string `json:"page"`     // file HTML, mis. index.html
	Selector string `json:"selector"` // body > section:nth-of-type(2)
	Label    string `json:"label"`    // nama yang ditampilkan, mis. "Hero"
	HTML     string `json:"-"`
}

type step struct {
	tag string
	n   int
}

var stepRE = regexp.MustCompile(`^([a-z][a-z0-9-]*):nth-of-type\(([1-9][0-9]{0,3})\)$`)

func parseSelector(sel string) ([]step, error) {
	parts := strings.Split(sel, " > ")
	if len(sel) > maxSelector || len(parts) < 2 || parts[0] != "body" {
		return nil, fmt.Errorf("selector tidak valid")
	}
	steps := make([]step, 0, len(parts)-1)
	for _, p := range parts[1:] {
		m := stepRE.FindStringSubmatch(p)
		if m == nil {
			return nil, fmt.Errorf("selector tidak valid")
		}
		n, _ := strconv.Atoi(m[2])
		steps = append(steps, step{m[1], n})
	}
	return steps, nil
}

// Parse membaca blok dari body request. raw nil = tidak ada blok. resolve mengubah pathname halaman
// di preview (mis. "/" atau "/about") menjadi file HTML-nya ("" bila tidak ada).
func Parse(raw any, resolve func(pathname string) string) ([]Block, error) {
	if raw == nil {
		return nil, nil
	}
	list, ok := raw.([]any)
	if !ok {
		return nil, httpx.Errorf(400, "Daftar blok tidak valid")
	}
	if len(list) > MaxBlocks {
		return nil, httpx.Errorf(400, "Maksimal %d blok sekaligus", MaxBlocks)
	}
	out := []Block{}
	seen := map[string]bool{}
	for _, item := range list {
		m, _ := item.(map[string]any)
		page, _ := m["page"].(string)
		selector, _ := m["selector"].(string)
		if _, err := parseSelector(selector); err != nil {
			return nil, httpx.Errorf(400, "Blok tidak valid. Pilih ulang bloknya di preview.")
		}
		file := resolve(page)
		if file == "" {
			return nil, httpx.Errorf(400, "Halaman blok tidak ditemukan. Pilih ulang bloknya di preview.")
		}
		if seen[file+"\n"+selector] {
			continue
		}
		seen[file+"\n"+selector] = true
		label := jsconv.Slice(strings.TrimSpace(jsconv.String(m["label"])), maxLabel)
		if label == "" {
			label = "Blok"
		}
		code, _ := m["html"].(string)
		out = append(out, Block{Page: file, Selector: selector, Label: label, HTML: jsconv.Slice(code, maxHTML)})
	}
	return out, nil
}

// Pages: file HTML yang memuat blok-blok ini, beserta selectornya.
func Pages(blocks []Block) map[string][]string {
	out := map[string][]string{}
	for _, b := range blocks {
		out[b.Page] = append(out[b.Page], b.Selector)
	}
	return out
}

// ---------- Instruksi untuk AI ----------

// Instructions: bagian prompt yang menjelaskan blok terpilih dan batasannya.
func Instructions(blocks []Block) string {
	if len(blocks) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("Selected blocks (the user picked these parts of the page in the preview):\n")
	for i, blk := range blocks {
		fmt.Fprintf(&b, "%d. %q in %s (CSS path: %s)\n", i+1, blk.Label, blk.Page, blk.Selector)
		if blk.HTML != "" {
			fmt.Fprintf(&b, "<block>\n%s\n</block>\n", blk.HTML)
		}
	}
	b.WriteString("\nChange ONLY the selected blocks: their HTML, and CSS/JS that applies to them. Keep every other " +
		"part of the page exactly as it is (do not edit, reorder, reformat, or remove anything outside these blocks). " +
		"If the request truly needs a change elsewhere (e.g. a shared CSS variable), keep it minimal and mention it in your summary.")
	return b.String()
}

// ---------- Pemeriksaan: adakah perubahan di luar blok? ----------

func body(doc *html.Node) *html.Node {
	for n := doc.FirstChild; n != nil; n = n.NextSibling {
		if n.Type == html.ElementNode && n.Data == "html" {
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				if c.Type == html.ElementNode && c.Data == "body" {
					return c
				}
			}
		}
	}
	return nil
}

// find: elemen yang ditunjuk langkah-langkah selector, atau nil.
func find(doc *html.Node, steps []step) *html.Node {
	cur := body(doc)
	for _, s := range steps {
		if cur == nil {
			return nil
		}
		var next *html.Node
		count := 0
		for c := cur.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode && c.Data == s.tag {
				if count++; count == s.n {
					next = c
					break
				}
			}
		}
		cur = next
	}
	return cur
}

var (
	spacesRE  = regexp.MustCompile(`\s+`)
	betweenRE = regexp.MustCompile(`>\s+<`)
)

// outside: dokumen tanpa blok-blok yang ditandai di mask, dinormalkan (spasi/indentasi diabaikan).
// ok = false bila HTML tidak bisa dibaca atau ada blok bertanda yang tidak ditemukan.
func outside(src string, selectors [][]step, mask int) (string, bool) {
	doc, err := html.Parse(strings.NewReader(src))
	if err != nil {
		return "", false
	}
	// Cari semua dulu: membuang satu blok tidak boleh menggeser hitungan blok berikutnya.
	var nodes []*html.Node
	for i, s := range selectors {
		if mask&(1<<i) == 0 {
			continue
		}
		n := find(doc, s)
		if n == nil {
			return "", false
		}
		nodes = append(nodes, n)
	}
	for _, n := range nodes {
		if n.Parent != nil { // nil = ada di dalam blok lain yang sudah dibuang
			n.Parent.RemoveChild(n)
		}
	}
	var out strings.Builder
	if err := html.Render(&out, doc); err != nil {
		return "", false
	}
	return strings.TrimSpace(betweenRE.ReplaceAllString(spacesRE.ReplaceAllString(out.String(), " "), "><")), true
}

// ChangedOutside: apakah isi baru halaman mengubah bagian di luar blok-blok terpilih. Blok yang tidak
// ada di HTML sumber (mis. dibuat JavaScript) tidak bisa diperiksa: dianggap tidak berubah.
//
// Di HTML baru tiap blok bisa sudah diubah (elemen di posisinya dibuang dari perbandingan) atau sudah
// dihapus atas permintaan pengguna (tidak ada yang dibuang; elemen di posisinya kini milik saudara
// berikutnya). Semua kombinasi dicoba (maks. 2^5); cukup satu yang cocok dengan halaman lama.
func ChangedOutside(before, after string, selectors []string) bool {
	steps := make([][]step, 0, len(selectors))
	for _, sel := range selectors {
		s, err := parseSelector(sel)
		if err != nil {
			return false
		}
		steps = append(steps, s)
	}
	all := 1<<len(steps) - 1
	old, ok := outside(before, steps, all)
	if !ok {
		return false
	}
	for mask := all; mask >= 0; mask-- {
		if now, ok := outside(after, steps, mask); ok && now == old {
			return false
		}
	}
	return true
}

package ai

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestParseExplanation(t *testing.T) {
	known := map[string]int{"script.js": 20, "index.html": 30, "logo.png": 0}
	text := "Berikut penjelasannya:\n```json\n" + `{
	  "summary": "File ini mengatur tombol pesan.",
	  "steps": [
	    {"id": 10, "title": "Mulai", "kind": "start", "lines": [[1, 3]], "explain": "a", "next": []},
	    {"id": 20, "title": "Cek isi form", "kind": "decision", "lines": "5-8", "explain": "b",
	     "terms": [{"term": "if", "meaning": "percabangan"}, {"term": "", "meaning": "kosong"}],
	     "refs": [{"path": "/index.html", "line": 12, "note": "form #pesan"}, {"path": "tidak-ada.js", "note": "x"}, {"path": "index.html", "line": 999}],
	     "next": [{"to": 30, "label": "ya"}, {"to": 10, "label": "tidak"}, {"to": 99}, 30]},
	    {"id": 30, "title": "Kirim", "kind": "aneh", "lines": [[18, 40], [9, 7], 2], "explain": "c"},
	    {"title": ""}
	  ],
	  "related": [{"path": "index.html", "line": 40, "note": "memuat script.js"}],
	  "complexity": "Cepat.",
	  "notes": [{"level": "BUG", "line": 99, "text": "Tidak ada validasi"}, {"level": "x", "text": "catatan"}]
	}` + "\n```"
	ex, problem, err := parseExplanation(text, 20, known)
	if err != nil {
		t.Fatal(err)
	}
	if problem != "" {
		t.Errorf("tidak ada masalah: %q", problem)
	}
	if len(ex.Steps) != 3 || ex.Steps[1].ID != 2 || ex.Steps[2].Kind != "process" {
		t.Fatalf("langkah: %+v", ex.Steps)
	}
	if got := ex.Steps[1].Lines; !reflect.DeepEqual(got, [][2]int{{5, 8}}) {
		t.Errorf("baris dari teks: %v", got)
	}
	if got := ex.Steps[2].Lines; !reflect.DeepEqual(got, [][2]int{{18, 20}, {7, 9}, {2, 2}}) {
		t.Errorf("baris dijepit & dibalik: %v", got)
	}
	if got := ex.Steps[1].Next; !reflect.DeepEqual(got, []ExplainEdge{{3, "ya"}, {1, "tidak"}}) {
		t.Errorf("cabang: %v", got)
	}
	if got := ex.Steps[1].Refs; !reflect.DeepEqual(got, []ExplainRef{{"index.html", 12, "form #pesan"}, {"index.html", 0, ""}}) {
		t.Errorf("rujukan: %v", got)
	}
	if len(ex.Steps[1].Terms) != 1 {
		t.Errorf("istilah kosong harus dibuang: %v", ex.Steps[1].Terms)
	}
	if len(ex.Related) != 1 || ex.Related[0].Line != 0 {
		t.Errorf("baris 40 di luar index.html (30 baris) dibuang: %v", ex.Related)
	}
	if got := ex.Notes; !reflect.DeepEqual(got, []ExplainNote{{"bug", 0, "Tidak ada validasi"}, {"info", 0, "catatan"}}) {
		t.Errorf("catatan: %v", got)
	}

	for _, bad := range []string{"tidak ada json", "```json\n{\"summary\": \"x\", \"steps\": []}\n```", "{rusak"} {
		if _, _, err := parseExplanation(bad, 10, known); err == nil {
			t.Errorf("harus gagal: %q", bad)
		}
	}
}

// Model kadang memakai kunci sendiri, tanpa nomor baris, dan berbahasa Inggris: tetap terbaca, tapi ditandai
// supaya diminta perbaikan sekali.
func TestParseExplanationLoose(t *testing.T) {
	text := "```json\n" + `{"summary": "This file loads the products and handles the cart when the user clicks.",
	  "flow": [{"step": 1, "action": "Load products", "detail": "It fetches the list and this is shown when ready."},
	           {"step": 2, "action": "Add to cart", "detail": "The item is added and the total is updated with the discount."}],
	  "notes": ["No error handling for fetch."]}` + "\n```"
	ex, problem, err := parseExplanation(text, 10, map[string]int{})
	if err != nil {
		t.Fatal(err)
	}
	if len(ex.Steps) != 2 || ex.Steps[1].Title != "Add to cart" || ex.Steps[0].Explain == "" || len(ex.Notes) != 1 {
		t.Fatalf("kunci alternatif: %+v", ex)
	}
	if !strings.Contains(problem, `"lines"`) || !strings.Contains(problem, "Indonesian") {
		t.Errorf("masalah: %q", problem)
	}
}

func TestRelatedFiles(t *testing.T) {
	root := t.TempDir()
	write := func(rel, content string) {
		abs := filepath.Join(root, filepath.FromSlash(rel))
		os.MkdirAll(filepath.Dir(abs), 0o755)
		os.WriteFile(abs, []byte(content), 0o644)
	}
	target := `const res = await fetch('/api/fn/kirim'); document.body.classList.add('siap');`
	write("script.js", target)
	write("index.html", `<script src="script.js"></script>`)
	write("about.html", `<a href="index.html">Beranda</a>`)
	write("functions/kirim.js", `export default () => {}`)
	write("style.css", `.siap { color: red }`)
	texts := []string{"about.html", "functions/kirim.js", "index.html", "script.js", "style.css"}

	contents, order := relatedFiles(root, "script.js", target, texts)
	if want := []string{"functions/kirim.js", "index.html"}; !reflect.DeepEqual(order, want) {
		t.Fatalf("urutan: %v, mau %v", order, want)
	}
	if !strings.Contains(contents["index.html"], "script.js") {
		t.Error("isi file terkait ikut dibaca")
	}
	if got := numbered("a\nb"); got != "1| a\n2| b\n" {
		t.Errorf("nomor baris: %q", got)
	}
}

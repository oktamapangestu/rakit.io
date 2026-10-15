package ai

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// testWorkspace: project sementara berisi files (path -> isi).
func testWorkspace(t *testing.T, files map[string]string, tables ...string) *workspace {
	t.Helper()
	root := t.TempDir()
	for rel, content := range files {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return newWorkspace(root, tables)
}

func toolCallOf(name string, args any) toolCall {
	raw, _ := json.Marshal(args)
	return toolCall{ID: "c1", Name: name, Arguments: string(raw)}
}

func joined(list []problem) string { return strings.Join(texts(list), "\n") }

func TestSyntaxProblems(t *testing.T) {
	if got := syntaxProblems("app.js", "const a = 1;\nlet b = a +;\n"); len(got) != 1 || !strings.Contains(got[0].text, "baris 2") {
		t.Errorf("file .js: %q", joined(got))
	}
	page := "<!doctype html>\n<html>\n<body>\n<script>\nconst ok = 1;\nif (ok {\n</script>\n" +
		"<script type=\"module\">import x from './x.js'</script>\n" +
		"<script type=\"application/ld+json\">{\"a\": }</script>\n" +
		"<script type=\"text/template\">{{ bukan js }}</script>\n</body></html>"
	got := syntaxProblems("index.html", page)
	if len(got) != 2 || !strings.Contains(got[0].text, "<script> baris 6") || !strings.Contains(got[1].text, "JSON") {
		t.Errorf("<script> di HTML: %q", joined(got))
	}
	if got := syntaxProblems("functions/kirim.js", "export async function handler() {}"); len(got) != 1 || !strings.Contains(got[0].text, "export default") {
		t.Errorf("fungsi tanpa export default: %q", joined(got))
	}
	if got := syntaxProblems("style.css", "a {"); got != nil {
		t.Errorf("CSS tidak diperiksa: %q", joined(got))
	}
}

func TestLocalTarget(t *testing.T) {
	cases := map[[2]string]string{
		{"index.html", "style.css"}:               "style.css",
		{"blog/a.html", "../css/x.css?v=2"}:       "css/x.css",
		{"blog/a.html", "/js/app.js"}:             "js/app.js",
		{"index.html", "/"}:                       "index.html",
		{"index.html", "/blog/"}:                  "blog/index.html",
		{"index.html", "tentang"}:                 "tentang",
		{"index.html", "https://x.com/a.js"}:      "",
		{"index.html", "//cdn.x.com/a.js"}:        "",
		{"index.html", "#kontak"}:                 "",
		{"index.html", "mailto:a@b.c"}:            "",
		{"index.html", "/api/ai/widget.js"}:       "",
		{"index.html", "/uploads/produk/a.jpg"}:   "",
		{"index.html", "${row.gambar}"}:           "",
		{"index.html", "/images/foto%20saya.jpg"}: "images/foto saya.jpg",
	}
	for in, want := range cases {
		if got := localTarget(in[0], in[1]); got != want {
			t.Errorf("localTarget(%q, %q) = %q, seharusnya %q", in[0], in[1], got, want)
		}
	}
}

func TestFinalProblemsReferences(t *testing.T) {
	ws := testWorkspace(t, map[string]string{
		"index.html":      "<a href=\"/hapus\">x</a>",
		"hapus.html":      "<p>x</p>",
		"tentang.html":    "<p>x</p>",
		"blog/index.html": "<p>x</p>",
		"images/logo.png": "png",
	})
	page := `<link rel="stylesheet" href="style.css"><script defer src="/js/app.js"></script>
<a href="/tentang">ok</a><a href="/blog">ok</a><a href="kontak.html">hilang</a>
<img src="/images/logo.png"><img src="/images/hero.jpg"><a href="https://x.com">luar</a>`
	ws.st.set(change{Action: "write", Path: "baru.html", Content: page})
	ws.st.set(change{Action: "write", Path: "style.css", Content: "body{background:url('/images/bg.webp')}"})
	ws.st.set(change{Action: "delete", Path: "hapus.html"})

	byFile, images := ws.finalProblems()
	got := joined(byFile["baru.html"])
	for _, want := range []string{`"js/app.js" yang tidak ada`, `kontak.html`} {
		if !strings.Contains(got, want) {
			t.Errorf("baru.html tidak melaporkan %q:\n%s", want, got)
		}
	}
	for _, unwanted := range []string{"style.css", "tentang", "blog", "logo.png", "x.com"} {
		if strings.Contains(got, unwanted) {
			t.Errorf("baru.html salah melaporkan %q:\n%s", unwanted, got)
		}
	}
	if !strings.Contains(joined(byFile["index.html"]), "yang kamu hapus") {
		t.Errorf("tautan ke file yang dihapus tidak dilaporkan: %v", byFile)
	}
	if strings.Join(images, ",") != "images/hero.jpg,images/bg.webp" {
		t.Errorf("gambar yang belum ada: %v", images)
	}
	if note := imagesNote(images); !strings.Contains(note, "`/images/hero.jpg`") {
		t.Errorf("catatan gambar: %q", note)
	}
}

func TestAlpineProblems(t *testing.T) {
	ws := testWorkspace(t, map[string]string{
		"app.js":   "document.addEventListener('alpine:init', () => { Alpine.data('toko', () => ({})) })",
		"util.js":  "function menu() { return { open: false } }",
		"other.js": "Alpine.data('lain', () => ({}))",
	})
	const core = `<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js"></script>`
	cases := []struct {
		name, page string
		want       []string // potongan pesan yang harus ada; kosong = tidak ada masalah
	}{
		{"benar", `<script defer src="/app.js"></script><script src="util.js"></script>` + core +
			`<div x-data="toko"></div><div x-data="menu()"></div><div x-data="{ open: false }"></div>`, nil},
		{"komponen tidak terdaftar", `<script defer src="/app.js"></script>` + core + `<div x-data="keranjang"></div><div x-data="lain"></div>`,
			[]string{`x-data="keranjang"`, `x-data="lain"`}},
		{"komponen dimuat sesudah Alpine", core + `<script defer src="/app.js"></script><div x-data="toko"></div>`,
			[]string{"SESUDAH tag Alpine"}},
		{"Alpine tanpa defer & dua kali", `<script src="https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js"></script>` + core,
			[]string{"defer", "dimuat 2 kali"}},
		{"plugin sesudah inti", core + `<script defer src="https://cdn.jsdelivr.net/npm/@alpinejs/collapse@3.17.4/dist/cdn.min.js"></script>`,
			[]string{"SEBELUM tag Alpine"}},
		{"x-data tanpa Alpine", `<div x-data="{ a: 1 }"></div>`, []string{"tidak memuat Alpine"}},
		{"komponen inline", core + `<script>document.addEventListener('alpine:init', () => Alpine.data('x', () => ({})))</script><div x-data="x"></div>`, nil},
	}
	for _, c := range cases {
		got := joined(ws.alpineProblems("index.html", parsePage(c.page)))
		if len(c.want) == 0 && got != "" {
			t.Errorf("%s: seharusnya tanpa masalah, dapat:\n%s", c.name, got)
		}
		for _, w := range c.want {
			if !strings.Contains(got, w) {
				t.Errorf("%s: tidak ada %q di:\n%s", c.name, w, got)
			}
		}
	}
}

func TestFinalProblemsFunctionCall(t *testing.T) {
	ws := testWorkspace(t, map[string]string{"functions/ada.js": "export default () => 1"})
	ws.st.set(change{Action: "write", Path: "app.js", Content: "fetch('/api/fn/ada'); fetch('/api/fn/kirim-wa', { method: 'POST' })"})
	byFile, _ := ws.finalProblems()
	got := joined(byFile["app.js"])
	if !strings.Contains(got, "functions/kirim-wa.js tidak ada") || strings.Contains(got, "/ada") {
		t.Errorf("fungsi yang tidak ada: %q", got)
	}
}

func TestEditFile(t *testing.T) {
	ws := testWorkspace(t, map[string]string{"index.html": "<h1>Halo</h1>\n<p>Satu</p>\n<p>Satu</p>\n", "crlf.css": "a {\r\n  color: red;\r\n}\r\n"})

	res, found := stageToolCall(toolCallOf("edit_file", map[string]any{"path": "index.html", "edits": []map[string]string{
		{"old_text": "<h1>Halo</h1>", "new_text": "<h1>Selamat datang</h1>"},
	}}), ws, false)
	if !strings.HasPrefix(res, "OK:") || found != nil {
		t.Fatalf("edit sah ditolak: %s", res)
	}
	// Edit kedua memakai isi yang sudah diubah edit pertama.
	res, _ = stageToolCall(toolCallOf("edit_file", map[string]any{"path": "index.html", "edits": []map[string]string{
		{"old_text": "Selamat datang", "new_text": "Hai"},
		{"old_text": "<p>Satu</p>", "new_text": "<p>Dua</p>"},
	}}), ws, false)
	if !strings.Contains(res, "muncul 2 kali") {
		t.Fatalf("teks yang tidak unik harus ditolak: %s", res)
	}
	if got, _ := ws.read("index.html"); got != "<h1>Selamat datang</h1>\n<p>Satu</p>\n<p>Satu</p>\n" {
		t.Fatalf("edit yang gagal tidak boleh mengubah apa pun: %q", got)
	}
	res, found = stageToolCall(toolCallOf("edit_file", map[string]any{"path": "index.html", "edits": []map[string]string{{"old_text": "<h2>", "new_text": "x"}}}), ws, false)
	if !strings.Contains(res, "tidak ditemukan persis") || len(found) != 1 || found[0].kind != "edit" {
		t.Fatalf("teks yang tidak ada: %s %v", res, found)
	}
	if res, _ = stageToolCall(toolCallOf("edit_file", map[string]any{"path": "baru.html", "edits": []map[string]string{{"old_text": "a", "new_text": "b"}}}), ws, false); !strings.Contains(res, "Pakai write_file") {
		t.Fatalf("file yang belum ada: %s", res)
	}
	// File CRLF: old_text dengan \n tetap cocok.
	res, _ = stageToolCall(toolCallOf("edit_file", map[string]any{"path": "crlf.css", "edits": []map[string]string{{"old_text": "a {\n  color: red;", "new_text": "a {\n  color: blue;"}}}), ws, false)
	if got, _ := ws.read("crlf.css"); !strings.HasPrefix(res, "OK:") || got != "a {\r\n  color: blue;\r\n}\r\n" {
		t.Fatalf("edit CRLF: %s %q", res, got)
	}
	// Hasil edit diperiksa seperti write_file.
	res, found = stageToolCall(toolCallOf("edit_file", map[string]any{"path": "crlf.css", "edits": []map[string]string{{"old_text": "blue", "new_text": "green"}}}), ws, false)
	if !strings.HasPrefix(res, "OK:") {
		t.Fatalf("edit CSS: %s", res)
	}
	ws.st.set(change{Action: "write", Path: "app.js", Content: "const a = 1;"})
	res, found = stageToolCall(toolCallOf("edit_file", map[string]any{"path": "app.js", "edits": []map[string]string{{"old_text": "1;", "new_text": "(1;"}}}), ws, false)
	if !strings.HasPrefix(res, "Ditulis, TAPI") || len(found) != 1 || found[0].kind != "js" {
		t.Fatalf("sintaks hasil edit tidak diperiksa: %s", res)
	}
}

func TestReadFile(t *testing.T) {
	ws := testWorkspace(t, map[string]string{"index.html": "<p>disk</p>", "images/a.png": "png"})
	if res, _ := stageToolCall(toolCallOf("read_file", map[string]any{"path": "index.html"}), ws, false); res != "Isi terbaru \"index.html\":\n<p>disk</p>" {
		t.Errorf("baca dari disk: %q", res)
	}
	ws.st.set(change{Action: "write", Path: "index.html", Content: "<p>baru</p>"})
	if res, _ := stageToolCall(toolCallOf("read_file", map[string]any{"path": "/index.html"}), ws, false); !strings.HasSuffix(res, "<p>baru</p>") {
		t.Errorf("baca versi yang sudah dicatat: %q", res)
	}
	ws.st.set(change{Action: "delete", Path: "index.html"})
	if res, _ := stageToolCall(toolCallOf("read_file", map[string]any{"path": "index.html"}), ws, false); !strings.Contains(res, "tidak ada") {
		t.Errorf("file yang dihapus: %q", res)
	}
	if res, _ := stageToolCall(toolCallOf("read_file", map[string]any{"path": "images/a.png"}), ws, false); !strings.Contains(res, "bukan file teks") {
		t.Errorf("gambar: %q", res)
	}
	if len(ws.st.order) != 1 {
		t.Errorf("read_file tidak boleh dicatat sebagai perubahan: %v", ws.st.order)
	}
}

func TestSlimContextNote(t *testing.T) {
	out := slimContext("Project files:\n- a.html\n\n<file path=\"a.html\">\nx\n</file>\n\nRequest:\nhalo")
	if !strings.Contains(out, "read_file") || strings.Contains(out, "<file") {
		t.Errorf("slimContext: %q", out)
	}
}

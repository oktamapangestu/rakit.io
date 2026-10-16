package ai

import (
	"strings"
	"testing"
)

func TestPlaceholders(t *testing.T) {
	content := "<!-- ... sisa halaman tetap sama ... -->\n<p>Baca selengkapnya...</p>\n<!-- Hero -->\n" +
		"<script>\n// ...\nconst a = 1; // ... existing code\n/* … kode lainnya … */\nconst url = 'https://x.com/...';\n" +
		"// ambil data lalu tampilkan\nconst [first, ...rest] = list;\n</script>"
	got := placeholders(content)
	want := []string{"... sisa halaman tetap sama ...", "… kode lainnya …", "...", "... existing code"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("placeholders = %q, want %q", got, want)
	}
	// Placeholder yang sudah ada di kode pengguna tidak dilaporkan; yang baru dilaporkan.
	before := "function a() {}\n// ... existing code\n"
	if got := placeholderProblems(before, before+"const b = 2;\n"); len(got) != 0 {
		t.Errorf("placeholder lama: %q", joined(got))
	}
	if got := placeholderProblems(before, "function a() {}\n// ... fungsi lain tetap sama\n"); len(got) != 1 || got[0].kind != "loss" {
		t.Errorf("placeholder baru: %q", joined(got))
	}
}

func TestShrinkNote(t *testing.T) {
	long := strings.Repeat("baris\n", 100)
	if shrinkNote("a.js", long, strings.Repeat("baris\n", 30)) == "" {
		t.Error("100 → 30 baris harus diberi catatan")
	}
	if shrinkNote("a.js", long, strings.Repeat("baris\n", 50)) != "" {
		t.Error("100 → 50 baris tidak perlu catatan")
	}
	if shrinkNote("a.js", strings.Repeat("baris\n", 20), "x") != "" {
		t.Error("file pendek tidak dicek")
	}
}

func TestLostDefinitions(t *testing.T) {
	ws := testWorkspace(t, map[string]string{
		"index.html": `<div x-data="keranjang"><button onclick="hitungTotal()">Hitung</button><span id="total"></span></div>`,
		"menu.html":  `<div x-data="menu"><p x-text="$store.tema.nama"></p></div>`,
		"script.js": "document.addEventListener('alpine:init', () => {\n  Alpine.data('keranjang', () => ({ items: [] }));\n" +
			"  Alpine.data('menu', () => ({ hapus() {} }));\n  Alpine.store('tema', { nama: 'gelap' });\n});\n" +
			"function hitungTotal() { document.getElementById('total').textContent = 1; }\n" +
			"const formatRupiah = (n) => 'Rp' + n;\nfunction hapus() {}\n",
		"functions/kirim.js": "export default async function () { return hitungTotal(); }",
	})
	// script.js ditulis ulang: komponen keranjang, store tema, hitungTotal, dan formatRupiah hilang; hapus() masih ada
	// sebagai method komponen menu.
	ws.st.set(change{Action: "write", Path: "script.js", Content: "document.addEventListener('alpine:init', () => {\n" +
		"  Alpine.data('menu', () => ({ hapus() {} }));\n});\n"})
	got := joined(ws.lostDefinitions()["script.js"])
	for _, want := range []string{
		`komponen Alpine.data('keranjang') dihapus dari script.js, tapi x-data="keranjang" masih dipakai di index.html`,
		`Alpine.store('tema') dihapus dari script.js, tapi $store.tema masih dipakai di menu.html`,
		`fungsi hitungTotal() dihapus dari script.js, tapi masih dipanggil di index.html`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("tidak ada %q di:\n%s", want, got)
		}
	}
	// formatRupiah tidak dipakai di mana pun; hapus() masih ada sebagai method; functions/ tidak dihitung.
	if strings.Contains(got, "formatRupiah") || strings.Contains(got, "hapus()") || strings.Contains(got, "functions/") {
		t.Errorf("laporan berlebih:\n%s", got)
	}

	// id yang hilang dari halaman tapi masih dicari JavaScript.
	ws = testWorkspace(t, map[string]string{
		"index.html": `<span id="total"></span><span id="catatan"></span><script src="app.js"></script>`,
		"app.js":     "document.getElementById('total').textContent = 1;\ndocument.querySelector('#catatan');\n",
	})
	ws.st.set(change{Action: "write", Path: "index.html", Content: `<span id="catatan"></span><script src="app.js"></script>`})
	got = joined(ws.lostDefinitions()["index.html"])
	if !strings.Contains(got, `elemen id="total" dihapus dari index.html, tapi masih dicari JavaScript di app.js`) || strings.Contains(got, "catatan") {
		t.Errorf("id hilang: %q", got)
	}

	// File dihapus; komponennya dipindah ke file lain → tidak dilaporkan.
	ws = testWorkspace(t, map[string]string{
		"index.html": `<div x-data="keranjang"></div><script defer src="lama.js"></script>`,
		"lama.js":    "Alpine.data('keranjang', () => ({}))",
	})
	ws.st.set(change{Action: "delete", Path: "lama.js"})
	ws.st.set(change{Action: "write", Path: "baru.js", Content: "Alpine.data('keranjang', () => ({}))"})
	if got := ws.lostDefinitions(); len(got) != 0 {
		t.Errorf("komponen dipindah: %v", got)
	}
}

func TestStageToolCallLoss(t *testing.T) {
	long := "function a() {}\n" + strings.Repeat("// baris\n", 80)
	ws := testWorkspace(t, map[string]string{"app.js": long})
	result, found := stageToolCall(toolCallOf("write_file", map[string]string{"path": "app.js", "content": "function a() {}\n// ... sisanya sama\n"}), ws, false)
	if !strings.HasPrefix(result, `Ditulis, TAPI ada masalah di "app.js": ada komentar placeholder "... sisanya sama"`) || len(found) != 1 {
		t.Errorf("placeholder: %s", result)
	}
	result, found = stageToolCall(toolCallOf("write_file", map[string]string{"path": "app.js", "content": "function a() {}\n"}), ws, false)
	if !strings.Contains(result, `Catatan: "app.js" sekarang 1 baris, sebelumnya 81`) || len(found) != 1 || found[0].kind != "shrink" {
		t.Errorf("menyusut: %s %v", result, found)
	}
	// Isi sebelum jawaban ini tetap bisa dibaca setelah file ditulis ulang.
	if got := readFile(map[string]any{"path": "app.js", "original": true}, ws); got != "Isi \"app.js\" sebelum jawaban ini:\n"+long {
		t.Errorf("read_file original: %q", got)
	}
	if got := readFile(map[string]any{"path": "baru.js", "original": true}, ws); !strings.Contains(got, "belum ada sebelum jawaban ini") {
		t.Errorf("read_file original file baru: %q", got)
	}
}

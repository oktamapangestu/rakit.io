package ai

import (
	"strings"
	"testing"
)

// slimContext membuang blok isi <file>, tapi mempertahankan daftar file, tabel, dan permintaan.
func TestSlimContext(t *testing.T) {
	ctx := "Project files:\n- index.html\n- css/style.css\n- js/app.js\n\n" +
		"Database tables:\n- produk (id, nama, harga)\n\n" +
		"<file path=\"index.html\">\n<!doctype html><h1>Toko</h1>\n</file>\n\n" +
		"<file path=\"css/style.css\">\nbody{margin:0}\n</file>\n\n" +
		"<file path=\"js/app.js\">\nconsole.log('x');\n</file>\n\n" +
		"The user currently has \"index.html\" open in the editor.\n\n---\n\nRequest:\nbikin halaman about"

	out := slimContext(ctx)

	keep := []string{"- index.html", "- css/style.css", "- js/app.js", "produk (id, nama, harga)", "bikin halaman about"}
	for _, k := range keep {
		if !strings.Contains(out, k) {
			t.Errorf("slimContext membuang bagian yang seharusnya tetap ada: %q", k)
		}
	}
	drop := []string{"<!doctype html>", "body{margin:0}", "console.log('x')", "<file path=", "</file>"}
	for _, d := range drop {
		if strings.Contains(out, d) {
			t.Errorf("slimContext menyisakan isi file yang seharusnya dibuang: %q", d)
		}
	}
	if len(out) >= len(ctx) {
		t.Errorf("slimContext tidak mengecilkan konteks: %d >= %d", len(out), len(ctx))
	}
}

// Tanpa blok file, konteks tidak berubah.
func TestSlimContextNoFileBlocks(t *testing.T) {
	in := "Project files:\n- a.html\n\nRequest:\nhalo"
	if got := slimContext(in); got != in {
		t.Errorf("slimContext mengubah konteks tanpa blok file:\n%q", got)
	}
}

// messageText & withText: ambil/ganti teks tanpa merusak kunci lain.
func TestMessageTextHelpers(t *testing.T) {
	m := message{"role": "user", "content": "halo", "extra": 1}
	if messageText(m) != "halo" {
		t.Fatalf("messageText salah: %q", messageText(m))
	}
	if messageText(message{"content": 42}) != "" {
		t.Fatalf("messageText harus string kosong untuk isi non-string")
	}
	out := withText(m, "baru")
	if out["content"] != "baru" || out["role"] != "user" || out["extra"] != 1 {
		t.Fatalf("withText merusak isi pesan: %#v", out)
	}
	if m["content"] != "halo" {
		t.Fatalf("withText mengubah pesan asli (harus salinan)")
	}
}

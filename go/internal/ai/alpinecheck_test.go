package ai

import (
	"strings"
	"testing"

	"rakit.io/server/internal/userdb"
)

func TestAlpineExpressions(t *testing.T) {
	cases := []struct {
		name, page string
		want       []string // potongan pesan yang harus ada; kosong = tidak ada masalah
	}{
		{"benar", `<div x-data="{ open: false, items: [], toggle() { this.open = !this.open } }" x-init="items = await (await fetch('/api/db/produk')).json()">
<button @click.prevent="open = !open; $dispatch('x')" :class="{ 'aktif': open }" x-show="open && items.length > 0">a</button>
<input x-model.number="jumlah"><span x-text="'Rp ' + (harga * jumlah).toLocaleString('id-ID')"></span>
<button @click="if (open) toggle()">b</button><button @click="let n = 1; open = n > 0">c</button>
<div x-transition:enter="transition ease-out duration-200" x-ref="panel" x-cloak x-on:keydown.escape.window="open = false"></div>
<template x-for="(p, i) in items" :key="p.id"><li x-text="p.nama"></li></template>
<template x-if="open"><p>x</p></template><div x-data></div></div>`, nil},
		{"salah ketik", `<div x-data="{ open: false }"><button @click="open = !open)">a</button><span x-text="'Rp ' + harga.toFixed(">b</span>
<div :class="{ aktif: open ">c</div></div>`, []string{`@click="open = !open)"`, `x-text="'Rp ' + harga.toFixed("`, `:class="{ aktif: open"`}},
		{"x-data rusak", `<div x-data="{ open: false, }}"></div>`, []string{`x-data="{ open: false, }}"`}},
		{"x-for bukan di template", `<div x-data="{ a: [] }"><li x-for="x in a" x-text="x"></li></div>`, []string{"hanya bekerja di <template>"}},
		{"template dua akar", `<div x-data="{ a: [] }"><template x-for="x in a"><h3 x-text="x"></h3><p>y</p></template></div>`, []string{"tepat satu elemen akar (sekarang 2)"}},
		{"x-for tanpa in", `<div x-data="{ a: [] }"><template x-for="x a"><p></p></template></div>`, []string{"item in daftar"}},
		{"daftar x-for rusak", `<div x-data="{ a: [] }"><template x-for="x in a.filter(i =>"><p></p></template></div>`, []string{`x-for="x in a.filter(i =>"`}},
		{"bukan halaman Alpine", `<div @click="ini bukan alpine ("></div>`, nil},
	}
	for _, c := range cases {
		got := joined(alpineProblemsIn(c.page))
		if len(c.want) == 0 && got != "" {
			t.Errorf("%s: seharusnya tanpa masalah, dapat:\n%s", c.name, got)
		}
		for _, w := range c.want {
			if !strings.Contains(got, w) {
				t.Errorf("%s: tidak ada %q di:\n%s", c.name, w, got)
			}
		}
	}
	// Lewat syntaxProblems (dipanggil saat file ditulis), dengan jenis "alpine" untuk statistik.
	got := syntaxProblems("index.html", `<div x-data="{ a: 1 }"><p x-text="a +"></p></div>`)
	if len(got) != 1 || got[0].kind != "alpine" {
		t.Errorf("syntaxProblems: %+v", got)
	}
}

func TestCSSProblems(t *testing.T) {
	cases := []struct {
		name, css string
		want      []string
	}{
		{"benar", ".a { color: red; }\n@media (max-width: 600px) { .a { color: blue } }\n.b::after { content: \"}\"; background: url(data:image/svg+xml;utf8,<svg>{}</svg>); }\n/* { */\n.c { & .d { x: 1 } }", nil},
		{"kurung tidak ditutup", ".a { color: red;\n.b { color: blue; }\n.c { x: 1 }\n", []string{`kurung { untuk ".a" di baris 1`}},
		{"kurung berlebih", ".a { color: red; } }\n.b { x: 1 }", []string{"kurung } di baris 1 tidak punya pasangan"}},
		{"komentar tidak ditutup", ".a { x: 1 }\n/* catatan\n.b { x: 2 }", []string{"komentar /* di baris 2"}},
		{"kutip tidak ditutup", ".a { content: \"x; }\n.b { x: 2 }", []string{"tanda kutip \" di baris 1"}},
	}
	for _, c := range cases {
		got := strings.Join(cssProblems(c.css, 1), "\n")
		if len(c.want) == 0 && got != "" {
			t.Errorf("%s: seharusnya tanpa masalah, dapat:\n%s", c.name, got)
		}
		for _, w := range c.want {
			if !strings.Contains(got, w) {
				t.Errorf("%s: tidak ada %q di:\n%s", c.name, w, got)
			}
		}
	}
	if got := syntaxProblems("style.css", "a {"); len(got) != 1 || got[0].kind != "css" {
		t.Errorf("file .css: %+v", got)
	}
	page := "<html>\n<head>\n<style>\n.a { x: 1 }\n.b { x: 2\n</style></head></html>"
	if got := syntaxProblems("index.html", page); len(got) != 1 || !strings.Contains(got[0].text, `<style>: kurung { untuk ".b" di baris 5`) {
		t.Errorf("<style> di HTML: %+v", got)
	}
}

func TestObjectKeys(t *testing.T) {
	cases := map[string]string{
		`{ nama: this.nama, 'harga': Number(x), "stok": 1 }`: "nama,harga,stok",
		`{ nama, harga }`: "nama,harga",
		`{ a: { b: 1, c: [1, 2] }, d: fn(e, { f: 1 }), g: ` + "`${h}`" + ` }`: "a,d,g",
		`{ ...this.form, x: 1 }`: "!",
		`{ [kunci]: 1 }`:         "!",
		`{ nama: 1`:              "!",
	}
	for in, want := range cases {
		keys, ok := objectKeys(in)
		got := strings.Join(keys, ",")
		if !ok {
			got = "!"
		}
		if got != want {
			t.Errorf("objectKeys(%q) = %q, seharusnya %q", in, got, want)
		}
	}
}

func TestColumnProblems(t *testing.T) {
	ws := testWorkspace(t, map[string]string{
		"app.js": "document.addEventListener('alpine:init', () => Alpine.data('toko', () => ({ produk: [], async init() { this.produk = (await (await fetch('/api/db/produk?expand=kategori_id')).json()).rows.map((p) => ({ ...p, hargaRp: 'Rp ' + p.harga })) } })))",
	}, "produk")
	ws.columns = map[string][]string{"produk": {"nama", "harga", "kategori_id", "kategori_id__ref"}}
	ws.st.set(change{Action: "table", Name: "pesan", Columns: []userdb.Column{{Name: "nama", Type: "text"}, {Name: "isi", Type: "text"}}})
	const core = `<script defer src="/app.js"></script><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js"></script>`
	page := core + `<div x-data="toko"><template x-for="p in produk" :key="p.id"><div><b x-text="p.nama"></b><i x-text="p.hargaRp"></i>
<span x-text="p.kategori_id__ref?.nama"></span><img :src="p.foto"><s x-text="p.nama_produk + p.created_at + p.nama.length"></s></div></template>
<template x-for="f in [{ judul: 'a' }]"><p x-text="f.judul"></p></template></div>
<script>fetch('/api/db/pesan', { method: 'POST', body: JSON.stringify({ nama: n, pesan: p, created_at: 1 }) }); fetch('/api/fn/kirim', { body: JSON.stringify({ apa: 1 }) })</script>`
	ws.st.set(change{Action: "write", Path: "index.html", Content: page})
	ws.st.set(change{Action: "write", Path: "functions/kirim.js", Content: "export default () => 1"})
	ws.st.set(change{Action: "write", Path: "edit.js", Content: "fetch(`/api/db/produk/${id}`, { method: 'PATCH', headers: {}, body: JSON.stringify({ harga, stock: 2 }) })"})

	byFile, _ := ws.finalProblems()
	got := joined(byFile["index.html"])
	for _, want := range []string{`p.foto`, `p.nama_produk`, `/api/db/pesan berisi "pesan"`, "kolomnya: isi, nama"} {
		if !strings.Contains(got, want) {
			t.Errorf("index.html tidak melaporkan %q:\n%s", want, got)
		}
	}
	for _, unwanted := range []string{"p.nama ", "hargaRp", "kategori_id__ref", "created_at", "judul", `"apa"`, ".length"} {
		if strings.Contains(got, unwanted) {
			t.Errorf("index.html salah melaporkan %q:\n%s", unwanted, got)
		}
	}
	if got := joined(byFile["edit.js"]); !strings.Contains(got, `"stock"`) || strings.Contains(got, `"harga"`) {
		t.Errorf("edit.js: %q", got)
	}
	for _, list := range byFile {
		for _, p := range list {
			if strings.Contains(p.text, "kolom") && p.kind != "column" {
				t.Errorf("jenis masalah kolom: %+v", p)
			}
		}
	}

	// Halaman yang juga mengambil data dari fungsi serverless: daftar yang bukan nama tabel tidak diperiksa.
	ws.st.set(change{Action: "write", Path: "index.html", Content: core + `<div x-data="toko"><template x-for="c in cuaca"><p x-text="c.suhu"></p></template>
<template x-for="p in produk"><p x-text="p.warna"></p></template></div><script>fetch('/api/fn/kirim')</script>`})
	byFile, _ = ws.finalProblems()
	got = joined(byFile["index.html"])
	if strings.Contains(got, "suhu") || !strings.Contains(got, "p.warna") {
		t.Errorf("sumber data lain: %q", got)
	}
}

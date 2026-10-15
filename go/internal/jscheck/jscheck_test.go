package jscheck

import (
	"strings"
	"testing"
)

func TestCheck(t *testing.T) {
	cases := []struct {
		name string
		code string
		kind Kind
		line int // 0 = sah
	}{
		{"skrip sah", "document.addEventListener('alpine:init', () => {\n  Alpine.data('a', () => ({ async init() { await fetch('/x') } }))\n})", Script, 0},
		{"skrip klasik tidak strict", "var x = 010; with (Math) { x = PI }", Script, 0},
		{"sintaks modern", "class A { #p = 1; static { } m() { return this.#p?.x ?? 2 } }", Script, 0},
		{"modul dengan import & await", "import x from './a.js';\nexport default async function () { await x }\n", Module, 0},
		{"kurung tidak tertutup", "const a = 1;\nfunction f() {\n  return a +;\n}\n", Script, 3},
		{"objek terpotong", "const x = {\n a: 1,\n", Script, 3},
		{"await di skrip klasik", "await fetch('/x')", Script, 1},
		{"import di skrip klasik", "import x from './a.js'", Script, 1},
		{"with di modul (strict)", "with (Math) {}", Module, 1},
	}
	for _, c := range cases {
		err := Check(c.code, c.kind, "app.js")
		switch {
		case c.line == 0 && err != nil:
			t.Errorf("%s: seharusnya sah, dapat %v", c.name, err)
		case c.line > 0 && err == nil:
			t.Errorf("%s: kesalahan sintaks tidak terdeteksi", c.name)
		case c.line > 0 && err.Line != c.line:
			t.Errorf("%s: baris %d, seharusnya %d (%v)", c.name, err.Line, c.line, err)
		case c.line > 0 && !strings.HasPrefix(err.Message, "SyntaxError"):
			t.Errorf("%s: pesan tanpa SyntaxError: %q", c.name, err.Message)
		}
	}
	if Check("   \n", Script, "kosong.js") != nil {
		t.Error("kode kosong dianggap salah")
	}
}

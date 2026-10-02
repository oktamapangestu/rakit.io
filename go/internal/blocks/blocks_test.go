package blocks

import (
	"strings"
	"testing"
)

const page = `<!doctype html>
<html lang="id">
<head><title>Toko</title><link rel="stylesheet" href="style.css"></head>
<body>
  <header class="nav"><a href="/">Toko</a></header>
  <section class="hero"><h1>Halo</h1><p>Selamat datang</p></section>
  <section class="pricing"><div class="card">Pro</div><div class="card">Unlimited</div></section>
  <section class="faq"><h2>FAQ</h2></section>
  <footer>© 2026</footer>
  <script src="script.js"></script>
</body>
</html>`

const (
	hero    = "body > section:nth-of-type(1)"
	pricing = "body > section:nth-of-type(2)"
	card2   = "body > section:nth-of-type(2) > div:nth-of-type(2)"
)

func TestChangedOutside(t *testing.T) {
	cases := []struct {
		name      string
		after     string
		selectors []string
		want      bool
	}{
		{"isi blok diubah", strings.Replace(page, "<h1>Halo</h1>", `<h1 class="big">Halo dunia</h1><a href="#">Mulai</a>`, 1), []string{hero}, false},
		{"seluruh file diformat ulang + blok diubah", strings.ReplaceAll(strings.Replace(page, "Selamat datang", "Hai", 1), "><", ">\n    <"), []string{hero}, false},
		{"bagian lain ikut diubah", strings.Replace(strings.Replace(page, "Halo", "Hai", 1), "© 2026", "© 2027", 1), []string{hero}, true},
		{"atribut di luar blok diubah", strings.Replace(page, `class="nav"`, `class="nav dark"`, 1), []string{hero}, true},
		{"blok diganti tag lain di tempat yang sama", strings.Replace(page, `<section class="hero"><h1>Halo</h1><p>Selamat datang</p></section>`, `<div class="hero">Baru</div>`, 1), []string{hero}, true},
		{"blok dihapus", strings.Replace(page, `<section class="hero"><h1>Halo</h1><p>Selamat datang</p></section>`, "", 1), []string{hero}, false},
		{"blok tengah dihapus (saudara sesudahnya bergeser)", strings.Replace(page, `<section class="pricing"><div class="card">Pro</div><div class="card">Unlimited</div></section>`, "", 1), []string{pricing}, false},
		{"section baru disisipkan di luar blok", strings.Replace(page, "<footer>", `<section class="cta">Daftar</section><footer>`, 1), []string{hero}, true},
		{"dua blok diubah", strings.Replace(strings.Replace(page, "Halo", "Hai", 1), "Unlimited", "Unlimited+", 1), []string{hero, pricing}, false},
		{"blok di dalam blok lain", strings.Replace(page, "Unlimited", "Unlimited+", 1), []string{pricing, card2}, false},
		{"kartu kedua diubah, kartu pertama ikut", strings.Replace(strings.Replace(page, "Unlimited", "Unlimited+", 1), ">Pro<", ">Pro+<", 1), []string{card2}, true},
		{"tidak ada perubahan", page, []string{hero}, false},
		{"blok tidak ada di sumber (dibuat JavaScript)", strings.Replace(page, "© 2026", "© 2027", 1), []string{"body > section:nth-of-type(9)"}, false},
	}
	for _, c := range cases {
		if got := ChangedOutside(page, c.after, c.selectors); got != c.want {
			t.Errorf("%s: ChangedOutside = %v, mau %v", c.name, got, c.want)
		}
	}
}

func TestParse(t *testing.T) {
	resolve := func(p string) string {
		switch p {
		case "/":
			return "index.html"
		case "/about":
			return "about.html"
		}
		return ""
	}
	block := func(page, selector, label string) map[string]any {
		return map[string]any{"page": page, "selector": selector, "label": label, "html": "<section>x</section>"}
	}

	got, err := Parse([]any{block("/", hero, "  Hero  "), block("/about", "body > main:nth-of-type(1)", ""), block("/", hero, "Hero lagi")}, resolve)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Page != "index.html" || got[0].Label != "Hero" || got[1].Page != "about.html" || got[1].Label != "Blok" || got[0].HTML == "" {
		t.Fatalf("Parse = %+v", got)
	}
	if got, err := Parse(nil, resolve); err != nil || got != nil {
		t.Fatalf("tanpa blok: %v %v", got, err)
	}

	bad := map[string]any{
		"bukan daftar":         "x",
		"selector salah":       []any{block("/", "section.hero", "x")},
		"selector bukan body":  []any{block("/", "html > body", "x")},
		"nth-of-type nol":      []any{block("/", "body > section:nth-of-type(0)", "x")},
		"halaman tidak ada":    []any{block("/tidak-ada", hero, "x")},
		"terlalu banyak blok":  []any{block("/", hero, "1"), block("/", hero, "2"), block("/", hero, "3"), block("/", hero, "4"), block("/", hero, "5"), block("/", hero, "6")},
		"selector disisipi js": []any{block("/", "body > img:nth-of-type(1) onerror=alert(1)", "x")},
	}
	for name, raw := range bad {
		if _, err := Parse(raw, resolve); err == nil {
			t.Errorf("%s: harusnya ditolak", name)
		}
	}
}

func TestInstructions(t *testing.T) {
	if Instructions(nil) != "" {
		t.Fatal("tanpa blok harus kosong")
	}
	text := Instructions([]Block{{Page: "index.html", Selector: hero, Label: "Hero", HTML: "<section>x</section>"}, {Page: "index.html", Selector: pricing, Label: "Harga"}})
	for _, want := range []string{`1. "Hero" in index.html (CSS path: ` + hero + ")", "<block>\n<section>x</section>\n</block>", `2. "Harga"`, "Change ONLY the selected blocks"} {
		if !strings.Contains(text, want) {
			t.Errorf("instruksi tidak memuat %q:\n%s", want, text)
		}
	}
}

func TestCSSdanJS(t *testing.T) {
	resolve := func(string) string { return "index.html" }
	got, err := Parse([]any{map[string]any{
		"page": "/", "selector": hero, "label": "Hero", "html": `<section class="hero" id="atas"><h1 class="judul">Hai</h1><a class="btn">Mulai</a></section>`,
		"css": []any{
			map[string]any{"file": "/style.css", "rules": ".hero { padding: 2rem; }"},
			map[string]any{"file": "", "rules": "h1 { color: red; }"},
			map[string]any{"file": "/../rahasia.css", "rules": "x{}"},
			map[string]any{"file": "/skrip.js", "rules": "x{}"},
			map[string]any{"file": "/kosong.css", "rules": "  "},
			"bukan objek",
			map[string]any{"file": "/besar.css", "rules": strings.Repeat("a", 6000)},
		},
	}}, resolve)
	if err != nil {
		t.Fatal(err)
	}
	css := got[0].CSS
	if len(css) != 3 || css[0] != (CSS{"style.css", ".hero { padding: 2rem; }"}) || css[1] != (CSS{"", "h1 { color: red; }"}) || css[2].File != "besar.css" {
		t.Fatalf("CSS = %+v", css)
	}
	if total := len(css[0].Rules) + len(css[1].Rules) + len(css[2].Rules); total != maxCSS {
		t.Fatalf("total CSS %d, mau dipotong di %d", total, maxCSS)
	}

	FindJS(got, map[string]string{
		"script.js": "const x = 1;\ndocument.querySelector('.hero').classList.add('on');\nconst heroic = 2;\ndocument.getElementById('atas');",
		"lain.js":   "// .judul dipakai di sini\nconst btn = 1; // 'btn' sebagai kata utuh",
		"aman.js":   "console.log('heroes', 'judulnya')",
	})
	want := []string{"lain.js:1: // .judul dipakai di sini", "lain.js:2: const btn = 1; // 'btn' sebagai kata utuh", "script.js:2: document.querySelector('.hero').classList.add('on');", "script.js:4: document.getElementById('atas');"}
	if strings.Join(got[0].JS, "\n") != strings.Join(want, "\n") {
		t.Fatalf("JS =\n%s", strings.Join(got[0].JS, "\n"))
	}

	if r := Related(got); strings.Join(r, ",") != "index.html,style.css,besar.css,lain.js,script.js" {
		t.Fatalf("Related = %v", r)
	}
	text := Instructions(got)
	for _, w := range []string{"<css file=\"style.css\">\n.hero { padding: 2rem; }\n</css>", "<css file=\"inline <style> in index.html\">", "JavaScript lines that refer to this block's id/class names:\n- lain.js:1:"} {
		if !strings.Contains(text, w) {
			t.Errorf("instruksi tidak memuat %q", w)
		}
	}
}

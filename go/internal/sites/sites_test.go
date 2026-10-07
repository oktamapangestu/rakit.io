package sites

import (
	"strings"
	"testing"

	"rakit.io/server/internal/config"
)

func TestWithPicker(t *testing.T) {
	h := &Handler{cfg: &config.Config{AppOrigin: "https://rakit.io"}}
	cases := []struct{ page, before, after string }{
		// Skrip console tepat setelah <head>, sebelum skrip website; pemilih sebelum </body>.
		{`<!doctype html><html lang="id"><head><script src="app.js"></script></head><body><header>x</header></body></html>`,
			`<!doctype html><html lang="id"><head>`, `<script src="app.js"></script></head><body><header>x</header>`},
		// Tanpa <head>: setelah <html>. <header> bukan <head>.
		{`<!DOCTYPE html><HTML><body><header>x</header></body></HTML>`, `<!DOCTYPE html><HTML>`, `<body><header>x</header>`},
		// Hanya doctype: tetap sesudahnya (sebelum doctype = quirks mode).
		{`<!doctype html><p>halo</p>`, `<!doctype html>`, `<p>halo</p>`},
		// Potongan HTML tanpa apa-apa: di awal, pemilih di akhir.
		{`<p>halo</p>`, ``, `<p>halo</p>`},
	}
	for _, c := range cases {
		out := string(h.withPicker([]byte(c.page)))
		if !strings.HasPrefix(out, c.before+`<script src="/api/_console.js?v=`+consoleVersion+`" data-app="https://rakit.io"></script>`+c.after) {
			t.Errorf("console salah tempat untuk %q:\n%.200s", c.page, out)
		}
		if strings.Count(out, ` data-app="https://rakit.io"`) != 2 || !strings.Contains(out, pickerJS+`</script>`) {
			t.Errorf("pemilih tidak disisipkan untuk %q", c.page)
		}
		if strings.Contains(c.page, "</body>") && !strings.Contains(out, pickerJS+"</script></body>") {
			t.Errorf("pemilih bukan sebelum </body> untuk %q", c.page)
		}
	}
}

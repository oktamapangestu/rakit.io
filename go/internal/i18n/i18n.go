// Package i18n: bahasa antarmuka aplikasi (Indonesia = bawaan, Inggris = halaman /en/...).
//
// Bahasa pilihan disimpan di cookie "lang" (dipasang saat membuka halaman /en/... atau lewat ?lang=).
// Pesan untuk pengguna tetap ditulis dalam bahasa Indonesia di kode; T menerjemahkannya ke bahasa Inggris
// memakai kamus di en.go. Kunci kamus boleh berupa format fmt (%s, %d, %q, %v, ...): pesan yang sudah
// diformat dicocokkan dengan pola format itu, lalu nilai-nilainya dipasang di terjemahannya.
package i18n

import (
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
)

const (
	ID = "id"
	EN = "en"

	// Cookie berisi bahasa pilihan pengguna ("id" atau "en").
	Cookie = "lang"
)

// FromRequest: bahasa pilihan pengguna menurut cookie (bawaan: Indonesia).
func FromRequest(r *http.Request) string {
	if c, err := r.Cookie(Cookie); err == nil && c.Value == EN {
		return EN
	}
	return ID
}

// Path: alamat halaman aplikasi base ("/", "/editor", "/panduan") dalam bahasa lang.
func Path(lang, base string) string {
	if lang != EN {
		return base
	}
	if base == "/" {
		return "/en"
	}
	return "/en" + base
}

// Mark mencatat bahasa jawaban di header Content-Language, supaya httpx.Fail dan penulis jawaban lain
// yang hanya memegang ResponseWriter tahu bahasa pengguna.
func Mark(w http.ResponseWriter, lang string) {
	if lang == EN {
		w.Header().Set("Content-Language", EN)
	}
}

// Of: bahasa jawaban yang dicatat Mark.
func Of(w http.ResponseWriter) string {
	if w.Header().Get("Content-Language") == EN {
		return EN
	}
	return ID
}

// SetCookie menyimpan bahasa pilihan selama setahun.
func SetCookie(w http.ResponseWriter, lang string, secure bool) {
	http.SetCookie(w, &http.Cookie{Name: Cookie, Value: lang, Path: "/", MaxAge: 365 * 24 * 3600,
		HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode})
}

// T menerjemahkan pesan berbahasa Indonesia ke bahasa lang. Pesan yang tidak ada di kamus dikembalikan
// apa adanya.
func T(lang, msg string) string {
	if lang != EN || msg == "" {
		return msg
	}
	if en, ok := en[msg]; ok {
		return en
	}
	for _, p := range compiled() {
		m := p.re.FindStringSubmatch(msg)
		if m == nil {
			continue
		}
		return p.fill(m[1:])
	}
	return msg
}

// ---------- Pola format ----------

type pattern struct {
	re   *regexp.Regexp
	en   []part // terjemahan, dipecah menjadi teks & rujukan ke nilai ke-n
	size int    // panjang teks tetap: pola paling spesifik dicoba lebih dulu
}

type part struct {
	text string
	arg  int // -1 = teks biasa
}

func (p pattern) fill(args []string) string {
	var b strings.Builder
	for _, x := range p.en {
		if x.arg < 0 {
			b.WriteString(x.text)
		} else if x.arg < len(args) {
			b.WriteString(args[x.arg])
		}
	}
	return b.String()
}

// verbRE: kata kerja fmt dengan indeks opsional (%[2]s), flag, lebar, dan presisi (%.1f, %02d).
var verbRE = regexp.MustCompile(`%(\[(\d+)\])?[-+# 0]*\d*(\.\d+)?[sdvqfxXg]`)

var (
	once     sync.Once
	patterns []pattern
)

func compiled() []pattern {
	once.Do(func() {
		for id, en := range en {
			if !verbRE.MatchString(strings.ReplaceAll(id, "%%", "")) {
				continue
			}
			p, ok := compile(id, en)
			if ok {
				patterns = append(patterns, p)
			}
		}
		sort.Slice(patterns, func(i, j int) bool { return patterns[i].size > patterns[j].size })
	})
	return patterns
}

func compile(id, en string) (pattern, bool) {
	var re strings.Builder
	re.WriteString(`^`)
	size, last, n := 0, 0, 0
	for _, loc := range verbRE.FindAllStringIndex(id, -1) {
		lit := strings.ReplaceAll(id[last:loc[0]], "%%", "%")
		re.WriteString(regexp.QuoteMeta(lit))
		size += len(lit)
		re.WriteString(`([\s\S]*?)`)
		last = loc[1]
		n++
	}
	lit := strings.ReplaceAll(id[last:], "%%", "%")
	re.WriteString(regexp.QuoteMeta(lit) + `$`)
	size += len(lit)
	compiledRE, err := regexp.Compile(re.String())
	if err != nil || size < 6 { // pola tanpa cukup teks tetap (mis. "%s: %s") akan cocok dengan apa saja
		return pattern{}, false
	}
	// Terjemahan: %s ke-n tanpa indeks = nilai ke-n; %[k]s = nilai ke-k.
	var parts []part
	last, seq := 0, 0
	for _, m := range verbRE.FindAllStringSubmatchIndex(en, -1) {
		parts = append(parts, part{text: strings.ReplaceAll(en[last:m[0]], "%%", "%"), arg: -1})
		arg := seq
		if m[4] >= 0 {
			k := 0
			for _, c := range en[m[4]:m[5]] {
				k = k*10 + int(c-'0')
			}
			arg = k - 1
		} else {
			seq++
		}
		if arg >= n {
			return pattern{}, false
		}
		parts = append(parts, part{arg: arg})
		last = m[1]
	}
	parts = append(parts, part{text: strings.ReplaceAll(en[last:], "%%", "%"), arg: -1})
	return pattern{re: compiledRE, en: parts, size: size}, true
}

// System menerjemahkan teks sistem di dalam isi pesan AI: seluruh isi bila sama persis dengan teks yang
// dikenal, atau paragraf terakhir yang ditambahkan server (catatan perubahan di luar blok, jawaban terpotong).
// Jawaban AI sendiri dibiarkan.
func System(lang, content string) string {
	if lang != EN {
		return content
	}
	if v, ok := en[content]; ok {
		return v
	}
	i := strings.LastIndex(content, "\n\n")
	if i < 0 {
		return content
	}
	if v, ok := en[content[i:]]; ok {
		return content[:i] + v
	}
	if t := T(lang, content[i+2:]); t != content[i+2:] {
		return content[:i+2] + t
	}
	return content
}

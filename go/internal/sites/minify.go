package sites

// Minify otomatis: website publik (bukan versi dev, bukan preview di editor) menerima .html/.css/.js yang sudah
// diminify; file di editor tetap seperti ditulis. Hasilnya di-cache di memori per (file, ukuran, waktu ubah).
// Bila minify gagal (mis. sintaks JS yang tidak dikenali), file asli yang dikirim.
//
// Preview di editor tidak diminify supaya nomor baris error di tab Console (dan perbaikan otomatis AI) tetap
// cocok dengan file aslinya. Halaman versi iframe memasang cookie previewCookie; file .css/.js yang dimuat
// sesudahnya membawa cookie itu sehingga ikut dikirim asli. Akibatnya browser pemilik juga menerima versi asli
// saat membuka website-nya di tab biasa selama cookie berlaku — pengunjung lain tidak terpengaruh.

import (
	"bytes"
	"container/list"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"

	"github.com/tdewolff/minify/v2"
	"github.com/tdewolff/minify/v2/css"
	"github.com/tdewolff/minify/v2/html"
	"github.com/tdewolff/minify/v2/js"
)

const (
	previewCookie  = "rakit_preview"
	maxMinifyInput = 2 << 20  // file lebih besar dikirim apa adanya
	minifyCacheCap = 64 << 20 // total isi cache (byte)
)

var minifier = func() *minify.M {
	m := minify.New()
	// Konservatif: tag & tanda kutip tetap ada, supaya atribut Alpine (x-data, :class, @click) tidak berubah arti.
	m.Add("text/html", &html.Minifier{KeepDocumentTags: true, KeepEndTags: true, KeepQuotes: true,
		KeepDefaultAttrVals: true, KeepSpecialComments: true})
	m.AddFunc("text/css", css.Minify)
	// KeepVarNames: nama variabel global di <script> biasa dipakai skrip lain & atribut Alpine.
	// Pola tipe: <script> inline di HTML diminify dengan tipe application/javascript.
	m.AddRegexp(regexp.MustCompile(`^(application|text)/(x-)?(java|ecma)script$`), &js.Minifier{KeepVarNames: true})
	return m
}()

// minifyType: tipe minifier untuk Content-Type file, "" = tidak diminify.
func minifyType(ctype string) string {
	for _, t := range []string{"text/html", "text/css", "text/javascript"} {
		if strings.HasPrefix(ctype, t) {
			return t
		}
	}
	return ""
}

// wantMinify: apakah request ini menerima versi minify.
func wantMinify(r *http.Request, target *Target, file *siteFile) bool {
	if !target.Minify || minifyType(file.ctype) == "" || file.info.Size() > maxMinifyInput || inFrame(r) {
		return false
	}
	_, err := r.Cookie(previewCookie)
	return err != nil
}

// setPreviewCookie dipasang di halaman versi iframe (preview editor), lihat komentar di atas.
func setPreviewCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: previewCookie, Value: "1", Path: "/", MaxAge: 12 * 3600, HttpOnly: true,
		SameSite: http.SameSiteLaxMode})
}

type minifyKey struct {
	abs   string
	size  int64
	mtime int64
}

type minifyEntry struct {
	key  minifyKey
	body []byte
}

// minifyCache: LRU sederhana dengan batas total byte.
type minifyCache struct {
	mu    sync.Mutex
	items map[string]*list.Element // abs → entri (satu versi per file)
	order *list.List               // depan = paling baru dipakai
	bytes int
}

var minified = &minifyCache{items: map[string]*list.Element{}, order: list.New()}

func (c *minifyCache) get(k minifyKey) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.items[k.abs]
	if !ok || el.Value.(*minifyEntry).key != k {
		return nil, false
	}
	c.order.MoveToFront(el)
	return el.Value.(*minifyEntry).body, true
}

func (c *minifyCache) put(k minifyKey, body []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[k.abs]; ok {
		c.bytes -= len(el.Value.(*minifyEntry).body)
		c.order.Remove(el)
	}
	c.items[k.abs] = c.order.PushFront(&minifyEntry{k, body})
	c.bytes += len(body)
	for c.bytes > minifyCacheCap && c.order.Len() > 1 {
		old := c.order.Back()
		e := old.Value.(*minifyEntry)
		c.order.Remove(old)
		delete(c.items, e.key.abs)
		c.bytes -= len(e.body)
	}
}

// minifiedFile: isi file versi minify (dari cache bila ada). ok = false bila file tidak bisa dibaca atau minify gagal.
func minifiedFile(file *siteFile) ([]byte, bool) {
	k := minifyKey{file.abs, file.info.Size(), file.info.ModTime().UnixNano()}
	if body, ok := minified.get(k); ok {
		return body, true
	}
	src, err := os.ReadFile(file.abs)
	if err != nil {
		return nil, false
	}
	var out bytes.Buffer
	out.Grow(len(src))
	if err := minifier.Minify(minifyType(file.ctype), &out, bytes.NewReader(src)); err != nil || out.Len() > len(src) {
		// Gagal atau malah lebih besar: simpan versi asli supaya tidak dicoba lagi tiap request.
		minified.put(k, src)
		return src, true
	}
	body := out.Bytes()
	minified.put(k, body)
	return body, true
}

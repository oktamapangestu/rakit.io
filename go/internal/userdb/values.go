package userdb

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"rakit.icu/server/internal/httpx"
)

// Row: objek JSON dengan urutan kunci terjaga (id, created_at, lalu kolom sesuai urutan tabel).
type Row struct {
	keys []string
	vals map[string]any
}

func newRow() *Row { return &Row{vals: map[string]any{}} }

func (r *Row) Set(key string, value any) {
	if _, ok := r.vals[key]; !ok {
		r.keys = append(r.keys, key)
	}
	r.vals[key] = value
}

func (r *Row) Get(key string) any { return r.vals[key] }

func (r *Row) MarshalJSON() ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	buf.WriteByte('{')
	for i, key := range r.keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		if err := enc.Encode(key); err != nil {
			return nil, err
		}
		buf.Truncate(buf.Len() - 1) // buang newline dari Encode
		buf.WriteByte(':')
		if err := enc.Encode(r.vals[key]); err != nil {
			return nil, err
		}
		buf.Truncate(buf.Len() - 1)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

// Field: satu pasangan kunci-nilai dari body JSON atau query string, dengan urutan aslinya.
type Field struct {
	Key   string
	Value any
}

// DecodeObject membaca objek JSON tingkat atas dengan urutan kunci terjaga. ok = false bila body
// bukan objek (array, angka, dst.).
func DecodeObject(raw []byte) (fields []Field, ok bool, err error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	tok, err := dec.Token()
	if err != nil {
		return nil, false, err
	}
	if delim, isDelim := tok.(json.Delim); !isDelim || delim != '{' {
		// Tetap periksa bahwa sisanya JSON yang sah.
		var rest any
		return nil, false, json.Unmarshal(raw, &rest)
	}
	index := map[string]int{}
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return nil, false, err
		}
		var value any
		if err := dec.Decode(&value); err != nil {
			return nil, false, err
		}
		key := keyTok.(string)
		if i, dup := index[key]; dup {
			fields[i].Value = value // kunci ganda: nilai terakhir yang dipakai
			continue
		}
		index[key] = len(fields)
		fields = append(fields, Field{Key: key, Value: value})
	}
	if _, err := dec.Token(); err != nil {
		return nil, false, err
	}
	if dec.More() {
		return nil, false, json.Unmarshal(raw, new(any))
	}
	return fields, true, nil
}

// ---------- Konversi nilai ala JavaScript ----------

var decimalRE = regexp.MustCompile(`^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)$`)

// jsNumber meniru Number(string) di JavaScript.
func jsNumber(s string) float64 {
	s = strings.TrimSpace(s)
	switch s {
	case "":
		return 0
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if len(s) > 2 && s[0] == '0' {
		base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[s[1]]
		if base != 0 {
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	if !decimalRE.MatchString(s) {
		return math.NaN()
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil && math.IsInf(n, 0) {
		return n
	}
	if err != nil {
		return math.NaN()
	}
	return n
}

// jsString meniru String(value) untuk nilai JSON non-objek.
func jsString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case float64:
		out, _ := json.Marshal(t)
		return string(out)
	}
	return ""
}

var leadingIntRE = regexp.MustCompile(`^\s*([+-]?\d+)`)

// jsParseInt meniru Number.parseInt(s, 10); ok = false bila hasilnya NaN.
func jsParseInt(s string) (n int, ok bool) {
	m := leadingIntRE.FindStringSubmatch(s)
	if m == nil {
		return 0, false
	}
	f, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return 0, false
	}
	return int(math.Max(math.Min(f, 1e15), -1e15)), true
}

func isInteger(n float64) bool { return !math.IsInf(n, 0) && n == math.Trunc(n) }

const maxSafeInteger = 1<<53 - 1

func rowID(id string) (int64, error) {
	n := jsNumber(id)
	if !isInteger(n) || n < 1 || n > maxSafeInteger {
		return 0, httpx.Errorf(400, "id tidak valid")
	}
	return int64(n), nil
}

func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }

// ---------- Validasi nilai kolom ----------

var (
	// Alamat gambar yang boleh disimpan: path di website sendiri atau URL http(s). Data URL ditolak.
	imagePathRE = regexp.MustCompile(`(?i)^/[A-Za-z0-9._/-]{1,300}\.(png|jpe?g|gif|webp|svg|avif|ico)$`)
	imageURLRE  = regexp.MustCompile(`(?i)^https?://[^\s"'<>]{3,1000}$`)
	dateRE      = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):?(\d{2}))?)?$`)
)

func base64Hint(column string) string {
	return "Gambar jangan disimpan sebagai teks/base64. Upload filenya dulu dengan POST /api/db/<tabel>/upload?column=" + column + ", lalu simpan alamat yang dikembalikan di kolom bertipe image."
}

// validDate: format tanggal diterima dan nilainya masuk akal (padanan DATE_RE + Date.parse).
func validDate(text string) bool {
	m := dateRE.FindStringSubmatch(text)
	if m == nil {
		return false
	}
	num := func(i int) int {
		n, _ := strconv.Atoi(m[i])
		return n
	}
	if month, day := num(2), num(3); month < 1 || month > 12 || day < 1 || day > 31 {
		return false
	}
	if m[4] != "" {
		hour, minute, second := num(4), num(5), num(6)
		if hour > 24 || minute > 59 || second > 59 || (hour == 24 && (minute > 0 || second > 0)) {
			return false
		}
	}
	if m[7] != "" && (num(7) > 23 || num(8) > 59) {
		return false
	}
	return true
}

func hasPrefixFold(s, prefix string) bool {
	return len(s) >= len(prefix) && strings.EqualFold(s[:len(prefix)], prefix)
}

// coerce mengubah nilai dari JSON/query string ke bentuk yang disimpan di SQLite (nil = NULL).
func coerce(c Column, value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	if s, isString := value.(string); isString && s == "" && c.Type != "text" {
		return nil, nil
	}
	fail := func(hint string) (any, error) {
		return nil, httpx.Errorf(400, `Nilai kolom "%s" harus %s`, c.Name, hint)
	}
	_, isMap := value.(map[string]any)
	_, isList := value.([]any)
	isObject := isMap || isList

	switch c.Type {
	case "text":
		if isObject {
			return fail("berupa teks")
		}
		text := jsString(value)
		if utf16Len(text) > limitTextLength {
			if hasPrefixFold(text, "data:image/") {
				return nil, httpx.Errorf(413, `Kolom "%s": %s`, c.Name, base64Hint(c.Name))
			}
			return fail("maksimal " + strconv.Itoa(limitTextLength) + " karakter")
		}
		return text, nil
	case "image":
		text, _ := value.(string)
		text = strings.TrimSpace(text)
		if hasPrefixFold(text, "data:") {
			return nil, httpx.Errorf(400, `Kolom "%s": %s`, c.Name, base64Hint(c.Name))
		}
		validPath := imagePathRE.MatchString(text) && !strings.Contains(text, "..")
		if !validPath && !imageURLRE.MatchString(text) {
			return fail(`alamat gambar, contoh "/uploads/produk/foto.jpg" (hasil upload) atau "https://…"`)
		}
		return text, nil
	case "number":
		n, ok := value.(float64)
		if !ok {
			if _, isBool := value.(bool); isBool || isObject {
				return fail("berupa angka")
			}
			n = jsNumber(jsString(value))
		}
		if math.IsNaN(n) || math.IsInf(n, 0) {
			return fail("berupa angka")
		}
		return n, nil
	case "boolean":
		switch value {
		case true, float64(1), "1", "true", "ya":
			return int64(1), nil
		case false, float64(0), "0", "false", "tidak":
			return int64(0), nil
		}
		return fail("true atau false")
	case "date":
		text := strings.TrimSpace(jsString(value))
		if isObject || !validDate(text) {
			return fail("tanggal, contoh 2026-12-31 atau 2026-12-31T19:00")
		}
		return text, nil
	case "reference":
		n, ok := value.(float64)
		if !ok {
			n = math.NaN()
			if _, isBool := value.(bool); !isBool && !isObject {
				n = jsNumber(jsString(value))
			}
		}
		if math.IsNaN(n) || !isInteger(n) || n <= 0 || n > maxSafeInteger {
			return fail("id baris " + c.RefTable + " (bilangan bulat positif)")
		}
		return int64(n), nil
	}
	return fail("valid")
}

func isEmpty(v any) bool { return v == nil || v == "" }

// buildValues memvalidasi body terhadap kolom tabel. Mengembalikan nilai siap simpan, berurutan
// seperti di body. partial = pembaruan sebagian (PATCH).
func buildValues(t *Table, body []Field, isObject, partial bool) ([]Field, error) {
	if !isObject {
		return nil, httpx.Errorf(400, `Body harus berupa objek JSON, contoh {"nama": "Budi"}`)
	}
	var unknown []string
	for _, f := range body {
		if t.column(f.Key) == nil && !systemColumns[f.Key] {
			unknown = append(unknown, f.Key)
		}
	}
	if len(unknown) > 0 {
		return nil, httpx.Errorf(400, "Kolom tidak dikenal: %s", strings.Join(unknown, ", "))
	}

	var values []Field
	given := map[string]any{}
	provided := map[string]bool{}
	for _, f := range body {
		c := t.column(f.Key)
		if c == nil {
			continue
		}
		v, err := coerce(*c, f.Value)
		if err != nil {
			return nil, err
		}
		values = append(values, Field{Key: f.Key, Value: v})
		given[f.Key], provided[f.Key] = v, true
	}
	for _, c := range t.Columns {
		if !c.Required {
			continue
		}
		if (partial && provided[c.Name] && isEmpty(given[c.Name])) || (!partial && isEmpty(given[c.Name])) {
			return nil, httpx.Errorf(400, `Kolom "%s" wajib diisi`, c.Name)
		}
	}
	return values, nil
}

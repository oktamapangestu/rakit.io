// Package siteapi: API publik di domain project — https://<slug>.rakit.io/api/db/<tabel>.
// Hanya operasi yang dibuka "Publik" oleh pemilik di editor database yang boleh dipakai.
// Padanan bagian /api/db di src/siteapi.js.
package siteapi

import (
	"bytes"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"

	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/userdb"
)

const (
	jsonLimit   = 64 * 1024
	uploadLimit = 11 * 1024 * 1024
)

var opLabel = map[string]string{"list": "melihat daftar", "view": "melihat", "create": "menambah", "update": "mengubah", "delete": "menghapus"}

type Handler struct {
	db *userdb.DB

	reads, writes, uploads *httpx.RateLimiter
}

func New(db *userdb.DB) *Handler {
	return &Handler{
		db:      db,
		reads:   httpx.NewRateLimiter(time.Minute, 300, ""),
		writes:  httpx.NewRateLimiter(time.Minute, 60, ""),
		uploads: httpx.NewRateLimiter(10*time.Minute, 20, "Terlalu banyak upload gambar. Coba lagi beberapa menit lagi."),
	}
}

// Matches: apakah path ini bagian dari /api/db (tidak peka huruf besar/kecil, seperti router Express).
func Matches(path string) bool {
	const prefix = "/api/db"
	if len(path) < len(prefix) || !strings.EqualFold(path[:len(prefix)], prefix) {
		return false
	}
	return len(path) == len(prefix) || path[len(prefix)] == '/'
}

// params: segmen path setelah /api/db, sudah di-decode.
func params(r *http.Request) ([]string, error) {
	rest := strings.Trim(r.URL.EscapedPath()[len("/api/db"):], "/")
	if rest == "" {
		return nil, nil
	}
	parts := strings.Split(rest, "/")
	for i, p := range parts {
		decoded, err := url.PathUnescape(p)
		if err != nil {
			return nil, httpx.Errorf(400, "Alamat tidak valid")
		}
		parts[i] = decoded
	}
	return parts, nil
}

// orderedQuery membaca query string dengan urutan kunci terjaga; kunci berulang memakai nilai pertama.
func orderedQuery(raw string) []userdb.Field {
	var out []userdb.Field
	seen := map[string]bool{}
	for _, pair := range strings.Split(raw, "&") {
		if pair == "" {
			continue
		}
		key, value, _ := strings.Cut(pair, "=")
		decode := func(s string) string {
			if d, err := url.QueryUnescape(s); err == nil {
				return d
			}
			return s
		}
		key = decode(key)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, userdb.Field{Key: key, Value: decode(value)})
	}
	return out
}

func isJSON(r *http.Request) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return err == nil && mediaType == "application/json"
}

// readLimited membaca body sampai `limit` byte; lebih dari itu → 413.
func readLimited(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	tooLarge := httpx.Errorf(413, "Request terlalu besar")
	if r.ContentLength > limit {
		return nil, tooLarge
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return nil, tooLarge
		}
		return nil, httpx.Errorf(400, "Request tidak lengkap")
	}
	return data, nil
}

// jsonBody membaca body JSON (bila Content-Type-nya JSON). isObject = false bila body bukan objek
// atau tidak ada body JSON.
func jsonBody(w http.ResponseWriter, r *http.Request) (fields []userdb.Field, isObject bool, err error) {
	if !isJSON(r) {
		return nil, false, nil
	}
	raw, err := readLimited(w, r, jsonLimit)
	if err != nil {
		return nil, false, err
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, false, nil
	}
	invalid := httpx.Errorf(400, "JSON tidak valid")
	// Seperti express.json() mode strict: hanya objek atau array.
	if trimmed[0] != '{' && trimmed[0] != '[' {
		return nil, false, invalid
	}
	fields, isObject, err = userdb.DecodeObject(trimmed)
	if err != nil {
		return nil, false, invalid
	}
	return fields, isObject, nil
}

// ServeHTTP menangani satu request /api/db untuk website project `slug`.
func (h *Handler) Serve(w http.ResponseWriter, r *http.Request, slug string) {
	w.Header().Set("Cache-Control", "no-store")
	ip := httpx.ClientIP(r)
	reading := r.Method == http.MethodGet || r.Method == http.MethodHead
	limiter := h.writes
	if reading {
		limiter = h.reads
	}
	if !limiter.Allow(w, slug+":"+ip) {
		return
	}

	parts, err := params(r)
	if err != nil {
		httpx.Fail(w, err)
		return
	}
	isUpload := r.Method == http.MethodPost && len(parts) == 2 && strings.EqualFold(parts[1], "upload")

	var body []userdb.Field
	var isObject bool
	if !isUpload || isJSON(r) {
		if body, isObject, err = jsonBody(w, r); err != nil {
			httpx.Fail(w, err)
			return
		}
	}

	ctx := r.Context()
	query := orderedQuery(r.URL.RawQuery)
	// Ambil parameter khusus; sisanya menjadi filter.
	pick := func(key string) string {
		for _, f := range query {
			if f.Key == key {
				return f.Value.(string)
			}
		}
		return ""
	}
	// publicTable: tabel beserta izin operasi untuk pengunjung.
	publicTable := func(op string) (*userdb.Table, error) {
		t, err := h.db.GetTable(ctx, slug, parts[0])
		if err != nil {
			return nil, err
		}
		if t.Rules[op] != "public" {
			return nil, httpx.Errorf(403, `Pengunjung tidak diizinkan %s data tabel "%s". Pemilik bisa membukanya di editor database → Atur → Akses.`, opLabel[op], t.Name)
		}
		return t, nil
	}
	var expand []string
	if e := pick("expand"); e != "" {
		expand = []string{e}
	}

	var result any
	status := http.StatusOK
	switch {
	case reading && len(parts) == 1:
		var t *userdb.Table
		if t, err = publicTable("list"); err == nil {
			opts := userdb.ListOptions{Limit: pick("limit"), Offset: pick("offset"), Sort: pick("sort"), Expand: expand, Public: true}
			for _, f := range query {
				switch f.Key {
				case "limit", "offset", "sort", "expand":
				default:
					opts.Filters = append(opts.Filters, f)
				}
			}
			result, err = h.db.ListRows(ctx, slug, t.Name, opts)
		}
	case reading && len(parts) == 2:
		var t *userdb.Table
		if t, err = publicTable("view"); err == nil {
			result, err = h.db.GetRow(ctx, slug, t.Name, parts[1], true, expand)
		}
	case r.Method == http.MethodPost && len(parts) == 1:
		var t *userdb.Table
		if t, err = publicTable("create"); err == nil {
			status = http.StatusCreated
			result, err = h.db.InsertRow(ctx, slug, t.Name, body, isObject, true)
		}
	case isUpload:
		// Upload gambar untuk kolom bertipe image: body = isi file. Mengembalikan { url }.
		if !h.uploads.Allow(w, "up:"+slug+":"+ip) {
			return
		}
		var buf []byte
		if !isJSON(r) {
			if buf, err = readLimited(w, r, uploadLimit); err != nil {
				break
			}
		}
		var location string
		status = http.StatusCreated
		location, err = h.db.UploadImage(ctx, slug, parts[0], pick("column"), buf, true)
		result = map[string]string{"url": location}
	case r.Method == http.MethodPatch && len(parts) == 2:
		var t *userdb.Table
		if t, err = publicTable("update"); err == nil {
			result, err = h.db.UpdateRow(ctx, slug, t.Name, parts[1], body, isObject, true)
		}
	case r.Method == http.MethodDelete && len(parts) == 2:
		var t *userdb.Table
		if t, err = publicTable("delete"); err == nil {
			err = h.db.DeleteRow(ctx, slug, t.Name, parts[1])
			result = map[string]bool{"ok": true}
		}
	default:
		err = httpx.Errorf(404, "Endpoint tidak ditemukan")
	}
	if err != nil {
		httpx.Fail(w, err)
		return
	}
	httpx.JSON(w, status, result)
}

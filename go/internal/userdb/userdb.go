// Package userdb: database milik project (satu file SQLite per project di data/db/<slug>.db), dikelola
// hanya lewat fungsi di sini — tidak ada SQL mentah dari user. Metadata tabel (tipe kolom, flag, aturan
// akses) disimpan di tabel internal _rakit_tables. Padanan src/userdb.js; file yang sama juga dibuka
// server Node (editor database, AI Builder) selama migrasi.
package userdb

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"modernc.org/sqlite"

	"rakit.io/server/internal/config"
	"rakit.io/server/internal/files"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/plans"
)

const (
	limitTextLength = 10_000
	limitPageSize   = 100
	poolMax         = 50
	sqliteFull      = 13
)

var (
	Operations    = []string{"list", "view", "create", "update", "delete"}
	nameRE        = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)
	systemColumns = map[string]bool{"id": true, "created_at": true}
)

type Column struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Required bool   `json:"required"`
	Private  bool   `json:"private"`
	RefTable string `json:"refTable,omitempty"`
}

type Table struct {
	Name      string
	Columns   []Column
	Rules     map[string]string // operasi -> "public" | "owner"
	CreatedAt string
}

func (t *Table) column(name string) *Column {
	for i := range t.Columns {
		if t.Columns[i].Name == name {
			return &t.Columns[i]
		}
	}
	return nil
}

func (t *Table) visible(publicView bool) []Column {
	if !publicView {
		return t.Columns
	}
	var out []Column
	for _, c := range t.Columns {
		if !c.Private {
			out = append(out, c)
		}
	}
	return out
}

// DB mengelola koneksi ke database semua project.
type DB struct {
	cfg   *config.Config
	plans *plans.Plans

	mu   sync.Mutex
	pool map[string]*handle
	tick uint64
}

// handle: satu file database yang sedang terbuka (LRU kecil, supaya tidak membuka ribuan file sekaligus).
type handle struct {
	db       *sql.DB
	info     os.FileInfo // untuk mendeteksi file yang dihapus/diganti proses lain
	lastUsed uint64
	refs     int
	evicted  bool
}

func New(cfg *config.Config, p *plans.Plans) *DB {
	return &DB{cfg: cfg, plans: p, pool: map[string]*handle{}}
}

func (d *DB) path(slug string) string { return filepath.Join(d.cfg.DataDir, "db", slug+".db") }

func notFound(name string) error { return httpx.Errorf(404, `Tabel "%s" tidak ditemukan`, name) }

func ident(name string) string { return `"` + name + `"` } // hanya untuk nama yang sudah lolos nameRE

// conn: satu koneksi yang dipakai selama satu operasi.
type conn struct {
	*sql.Conn
	ctx context.Context
}

func (c *conn) exec(query string, args ...any) (sql.Result, error) {
	res, err := c.ExecContext(c.ctx, query, args...)
	return res, translate(err)
}

func (c *conn) query(query string, args ...any) (*sql.Rows, error) {
	return c.QueryContext(c.ctx, query, args...)
}

func (c *conn) exists(query string, args ...any) (bool, error) {
	rows, err := c.query(query, args...)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	return rows.Next(), rows.Err()
}

func translate(err error) error {
	var se *sqlite.Error
	if errors.As(err, &se) && se.Code()&0xff == sqliteFull {
		return httpx.Errorf(413, "Database penuh. Hapus data yang tidak dipakai, atau berlangganan untuk kuota database lebih besar.")
	}
	return err
}

const metaTableSQL = `CREATE TABLE IF NOT EXISTS _rakit_tables (
	name       TEXT PRIMARY KEY,
	columns    TEXT NOT NULL,
	rules      TEXT NOT NULL,
	created_at TEXT NOT NULL
)`

// acquire membuka (atau memakai ulang) database project dan menyiapkan satu koneksi. Tanpa `create`
// (API publik) file baru tidak pernah dibuat: bila project belum punya database, ok = false.
func (d *DB) acquire(ctx context.Context, slug string, create bool) (c *conn, release func(), ok bool, err error) {
	file := d.path(slug)
	info, statErr := os.Stat(file)
	if statErr != nil && !os.IsNotExist(statErr) {
		return nil, nil, false, statErr
	}
	missing := statErr != nil

	d.mu.Lock()
	h := d.pool[slug]
	// File dihapus atau diganti (project dihapus lalu dibuat lagi oleh server lain): buang koneksi lama.
	if h != nil && (missing || !os.SameFile(h.info, info)) {
		d.evict(slug, h)
		h = nil
	}
	if missing && !create {
		d.mu.Unlock()
		return nil, nil, false, nil
	}
	if h == nil {
		q := url.Values{}
		q.Set("mode", "rwc")
		q.Add("_pragma", "busy_timeout(3000)")
		q.Add("_pragma", "journal_mode(WAL)")
		db, openErr := sql.Open("sqlite", "file:"+filepath.ToSlash(file)+"?"+q.Encode())
		if openErr == nil {
			// Satu koneksi per file: operasi berurutan, seperti di Node.
			db.SetMaxOpenConns(1)
			if openErr = os.MkdirAll(filepath.Dir(file), 0o755); openErr == nil {
				_, openErr = db.ExecContext(ctx, metaTableSQL)
			}
			if openErr == nil {
				info, openErr = os.Stat(file)
			}
			if openErr != nil {
				db.Close()
			}
		}
		if openErr != nil {
			d.mu.Unlock()
			return nil, nil, false, openErr
		}
		h = &handle{db: db, info: info}
		d.pool[slug] = h
		if len(d.pool) > poolMax {
			d.evictOldest(slug)
		}
	}
	d.tick++
	h.lastUsed = d.tick
	h.refs++
	d.mu.Unlock()

	release = func() {
		if c != nil {
			c.Close()
		}
		d.mu.Lock()
		h.refs--
		if h.evicted && h.refs == 0 {
			h.db.Close()
		}
		d.mu.Unlock()
	}
	raw, err := h.db.Conn(ctx)
	if err != nil {
		release()
		return nil, nil, false, err
	}
	c = &conn{Conn: raw, ctx: ctx}
	if err := d.prepare(c, slug); err != nil {
		release()
		return nil, nil, false, err
	}
	return c, release, true, nil
}

func (d *DB) evict(slug string, h *handle) {
	delete(d.pool, slug)
	h.evicted = true
	if h.refs == 0 {
		h.db.Close()
	}
}

func (d *DB) evictOldest(keep string) {
	var oldest string
	for slug, h := range d.pool {
		if slug != keep && (oldest == "" || h.lastUsed < d.pool[oldest].lastUsed) {
			oldest = slug
		}
	}
	if oldest != "" {
		d.evict(oldest, d.pool[oldest])
	}
}

// prepare: batas ukuran ditegakkan SQLite sendiri (penulisan melebihi batas gagal dengan SQLITE_FULL).
// Diset tiap kali dipakai, supaya ikut berubah saat langganan dimulai/berakhir.
func (d *DB) prepare(c *conn, slug string) error {
	var pageSize int64
	if err := c.QueryRowContext(c.ctx, "PRAGMA page_size").Scan(&pageSize); err != nil {
		return err
	}
	var applied int64
	limit := d.plans.StorageFor(baseSlug(slug)).DBBytes / pageSize
	return c.QueryRowContext(c.ctx, "PRAGMA max_page_count = "+strconv.FormatInt(limit, 10)).Scan(&applied)
}

func (c *conn) transaction(fn func() error) error {
	if _, err := c.exec("BEGIN IMMEDIATE"); err != nil {
		return err
	}
	if err := fn(); err != nil {
		c.exec("ROLLBACK")
		return translate(err)
	}
	_, err := c.exec("COMMIT")
	return err
}

// ---------- Metadata ----------

func (c *conn) readMeta(name string) (*Table, error) {
	var columns, rules string
	t := &Table{}
	err := c.QueryRowContext(c.ctx, "SELECT name, columns, rules, created_at FROM _rakit_tables WHERE name = ?", name).
		Scan(&t.Name, &columns, &rules, &t.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		// Database tanpa tabel metadata (belum pernah dipakai) = tidak ada tabel.
		if strings.Contains(err.Error(), "no such table") {
			return nil, nil
		}
		return nil, err
	}
	if err := json.Unmarshal([]byte(columns), &t.Columns); err != nil {
		return nil, err
	}
	saved := map[string]any{}
	if err := json.Unmarshal([]byte(rules), &saved); err != nil {
		return nil, err
	}
	t.Rules = map[string]string{}
	for _, op := range Operations {
		t.Rules[op] = "owner"
		if v, _ := saved[op].(string); v == "public" || v == "owner" {
			t.Rules[op] = v
		}
	}
	return t, nil
}

func (c *conn) table(name string) (*Table, error) {
	if !nameRE.MatchString(name) {
		return nil, notFound(name)
	}
	t, err := c.readMeta(name)
	if err != nil {
		return nil, err
	}
	if t == nil {
		return nil, notFound(name)
	}
	return t, nil
}

type reference struct{ from, column string }

// Kolom relasi di seluruh project yang menunjuk ke tabel `name`.
func (c *conn) referencesTo(name string) ([]reference, error) {
	rows, err := c.query("SELECT name, columns FROM _rakit_tables")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []reference
	for rows.Next() {
		var from, raw string
		if err := rows.Scan(&from, &raw); err != nil {
			return nil, err
		}
		var columns []Column
		if err := json.Unmarshal([]byte(raw), &columns); err != nil {
			return nil, err
		}
		for _, col := range columns {
			if col.Type == "reference" && col.RefTable == name {
				out = append(out, reference{from, col.Name})
			}
		}
	}
	return out, rows.Err()
}

// Remove menutup koneksi & menghapus file database project (dipakai saat project dihapus).
func (d *DB) Remove(slug string) {
	d.mu.Lock()
	if h := d.pool[slug]; h != nil {
		d.evict(slug, h)
	}
	d.mu.Unlock()
	for _, suffix := range []string{"", "-wal", "-shm"} {
		os.Remove(d.path(slug) + suffix)
	}
}

// with membuka database project, mengambil tabel `name`, lalu menjalankan fn. owner = dari editor
// database pemilik: database dibuat bila belum ada. Untuk API publik, jangan membuat file database
// baru hanya karena ada request.
func (d *DB) with(ctx context.Context, slug, name string, owner bool, fn func(c *conn, t *Table) error) error {
	c, release, ok, err := d.acquire(ctx, slug, owner)
	if err != nil {
		return err
	}
	if !ok {
		return notFound(name)
	}
	defer release()
	t, err := c.table(name)
	if err != nil {
		return err
	}
	return fn(c, t)
}

// GetTable mengembalikan metadata tabel (404 bila tidak ada).
func (d *DB) GetTable(ctx context.Context, slug, name string) (*Table, error) {
	var out *Table
	err := d.with(ctx, slug, name, false, func(_ *conn, t *Table) error {
		out = t
		return nil
	})
	return out, err
}

// ---------- Baris ----------

// selectRows menjalankan SELECT * dan mengembalikan tiap baris sebagai peta kolom -> nilai.
func (c *conn) selectRows(query string, args ...any) ([]map[string]any, error) {
	rows, err := c.query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	names, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	var out []map[string]any
	for rows.Next() {
		vals := make([]any, len(names))
		ptrs := make([]any, len(names))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := make(map[string]any, len(names))
		for i, name := range names {
			if b, isBytes := vals[i].([]byte); isBytes {
				vals[i] = string(b)
			}
			row[name] = vals[i]
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func truthy(v any) bool {
	switch t := v.(type) {
	case int64:
		return t != 0
	case float64:
		return t != 0
	case string:
		return t != ""
	case bool:
		return t
	}
	return false
}

func outputRow(raw map[string]any, columns []Column) *Row {
	out := newRow()
	out.Set("id", raw["id"])
	out.Set("created_at", raw["created_at"])
	for _, c := range columns {
		value := raw[c.Name]
		if c.Type == "boolean" && value != nil {
			value = truthy(value)
		}
		out.Set(c.Name, value)
	}
	return out
}

func asID(v any) (int64, bool) {
	switch t := v.(type) {
	case int64:
		return t, true
	case float64:
		return int64(t), t == float64(int64(t))
	}
	return 0, false
}

// normalizeExpand: terima expand sebagai daftar nama kolom relasi yang valid & terlihat.
func normalizeExpand(t *Table, expand []string, publicView bool) ([]string, error) {
	var list []string
	for _, item := range expand {
		for _, name := range strings.Split(item, ",") {
			if name = strings.TrimSpace(name); name != "" {
				list = append(list, name)
			}
		}
	}
	for _, name := range list {
		c := t.column(name)
		if c == nil || c.Type != "reference" {
			return nil, httpx.Errorf(400, `Kolom "%s" bukan relasi`, name)
		}
		if publicView && c.Private {
			return nil, httpx.Errorf(400, `Kolom relasi "%s" bersifat privat`, name)
		}
	}
	return list, nil
}

// attachExpanded menyertakan data baris tujuan untuk kolom relasi yang diminta (?expand=kategori_id),
// di bawah kunci "<kolom>__ref", tanpa menghapus nilai id-nya.
func (c *conn) attachExpanded(t *Table, rows []*Row, expand []string, publicView bool) error {
	wanted := map[string]bool{}
	for _, name := range expand {
		wanted[name] = true
	}
	for _, col := range t.Columns {
		if col.Type != "reference" || !wanted[col.Name] {
			continue
		}
		target, err := c.table(col.RefTable)
		if err != nil {
			return err
		}
		visible := target.visible(publicView)
		seen := map[int64]bool{}
		var ids []any
		for _, r := range rows {
			if id, ok := asID(r.Get(col.Name)); ok && !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
		found := map[int64]*Row{}
		if len(ids) > 0 {
			placeholders := strings.TrimSuffix(strings.Repeat("?, ", len(ids)), ", ")
			picked, err := c.selectRows("SELECT * FROM "+ident(target.Name)+" WHERE id IN ("+placeholders+")", ids...)
			if err != nil {
				return err
			}
			for _, raw := range picked {
				if id, ok := asID(raw["id"]); ok {
					found[id] = outputRow(raw, visible)
				}
			}
		}
		for _, r := range rows {
			var ref any
			if id, ok := asID(r.Get(col.Name)); ok && found[id] != nil {
				ref = found[id]
			}
			r.Set(col.Name+"__ref", ref)
		}
	}
	return nil
}

// ListOptions: parameter daftar baris. Sort kosong = urut id.
type ListOptions struct {
	Limit, Offset string
	Sort          string
	Expand        []string
	Filters       []Field // nilai berupa string dari query
	Public        bool
}

type ListResult struct {
	Rows   []*Row `json:"rows"`
	Total  int64  `json:"total"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}

func parseSort(sort string, visible []Column) (string, error) {
	if sort == "" {
		sort = "id"
	}
	column, desc := strings.CutPrefix(sort, "-")
	known := systemColumns[column]
	for _, c := range visible {
		known = known || c.Name == column
	}
	if !known {
		return "", httpx.Errorf(400, `Tidak bisa mengurutkan berdasarkan "%s"`, column)
	}
	dir := "ASC"
	if desc {
		dir = "DESC"
	}
	return ident(column) + " " + dir + ", id " + dir, nil
}

func (d *DB) ListRows(ctx context.Context, slug, name string, opts ListOptions) (*ListResult, error) {
	var result *ListResult
	err := d.with(ctx, slug, name, !opts.Public, func(c *conn, t *Table) error {
		visible := t.visible(opts.Public)
		expand, err := normalizeExpand(t, opts.Expand, opts.Public)
		if err != nil {
			return err
		}

		var where []string
		var params []any
		for _, f := range opts.Filters {
			column := Column{Name: "id", Type: "number"}
			if f.Key != "id" {
				found := false
				for _, v := range visible {
					if v.Name == f.Key {
						column, found = v, true
					}
				}
				if !found {
					return httpx.Errorf(400, `Tidak bisa memfilter kolom "%s"`, f.Key)
				}
			}
			value, err := coerce(column, f.Value)
			if err != nil {
				return err
			}
			if value == nil {
				where = append(where, ident(f.Key)+" IS NULL")
			} else {
				where = append(where, ident(f.Key)+" = ?")
				params = append(params, value)
			}
		}
		whereSQL := ""
		if len(where) > 0 {
			whereSQL = "WHERE " + strings.Join(where, " AND ")
		}
		limit, _ := jsconv.ParseInt(opts.Limit)
		if limit == 0 {
			limit = 50
		}
		limit = min(max(limit, 1), limitPageSize)
		offset, _ := jsconv.ParseInt(opts.Offset)
		offset = max(offset, 0)
		order, err := parseSort(opts.Sort, visible)
		if err != nil {
			return err
		}

		tbl := ident(t.Name)
		var total int64
		if err := c.QueryRowContext(c.ctx, "SELECT COUNT(*) FROM "+tbl+" "+whereSQL, params...).Scan(&total); err != nil {
			return err
		}
		raws, err := c.selectRows("SELECT * FROM "+tbl+" "+whereSQL+" ORDER BY "+order+" LIMIT ? OFFSET ?", append(params, limit, offset)...)
		if err != nil {
			return err
		}
		rows := make([]*Row, 0, len(raws))
		for _, raw := range raws {
			rows = append(rows, outputRow(raw, visible))
		}
		if err := c.attachExpanded(t, rows, expand, opts.Public); err != nil {
			return err
		}
		result = &ListResult{Rows: rows, Total: total, Limit: limit, Offset: offset}
		return nil
	})
	return result, err
}

func (c *conn) getRow(t *Table, id int64, publicView bool, expand []string) (*Row, error) {
	raws, err := c.selectRows("SELECT * FROM "+ident(t.Name)+" WHERE id = ?", id)
	if err != nil {
		return nil, err
	}
	if len(raws) == 0 {
		return nil, httpx.Errorf(404, "Baris tidak ditemukan")
	}
	list, err := normalizeExpand(t, expand, publicView)
	if err != nil {
		return nil, err
	}
	row := outputRow(raws[0], t.visible(publicView))
	return row, c.attachExpanded(t, []*Row{row}, list, publicView)
}

func (d *DB) GetRow(ctx context.Context, slug, name, id string, publicView bool, expand []string) (*Row, error) {
	var row *Row
	err := d.with(ctx, slug, name, !publicView, func(c *conn, t *Table) error {
		key, err := rowID(id)
		if err != nil {
			return err
		}
		row, err = c.getRow(t, key, publicView, expand)
		return err
	})
	return row, err
}

// Pastikan setiap nilai kolom relasi benar-benar menunjuk ke baris yang ada di tabel tujuan.
func (c *conn) assertReferences(t *Table, values []Field) error {
	for _, f := range values {
		col := t.column(f.Key)
		if col.Type != "reference" || f.Value == nil {
			continue
		}
		target, err := c.table(col.RefTable)
		if err != nil {
			return err
		}
		found, err := c.exists("SELECT 1 FROM "+ident(target.Name)+" WHERE id = ?", f.Value)
		if err != nil {
			return err
		}
		if !found {
			return httpx.Errorf(400, `Kolom "%s" menunjuk ke %s id %d yang tidak ada`, col.Name, col.RefTable, f.Value)
		}
	}
	return nil
}

func jsNow() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

// InsertRow menambah baris. body = objek JSON berurutan; isObject = false bila body bukan objek.
func (d *DB) InsertRow(ctx context.Context, slug, name string, body []Field, isObject, publicView bool) (*Row, error) {
	var row *Row
	err := d.with(ctx, slug, name, !publicView, func(c *conn, t *Table) error {
		values, err := buildValues(t, body, isObject, false)
		if err != nil {
			return err
		}
		if err := c.assertReferences(t, values); err != nil {
			return err
		}
		columns := "created_at"
		args := []any{jsNow()}
		for _, f := range values {
			columns += ", " + ident(f.Key)
			args = append(args, f.Value)
		}
		res, err := c.exec("INSERT INTO "+ident(t.Name)+" ("+columns+") VALUES (?"+strings.Repeat(", ?", len(values))+")", args...)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err != nil {
			return err
		}
		row, err = c.getRow(t, id, publicView, nil)
		return err
	})
	return row, err
}

func (d *DB) UpdateRow(ctx context.Context, slug, name, id string, body []Field, isObject, publicView bool) (*Row, error) {
	var row *Row
	err := d.with(ctx, slug, name, !publicView, func(c *conn, t *Table) error {
		values, err := buildValues(t, body, isObject, true)
		if err != nil {
			return err
		}
		if err := c.assertReferences(t, values); err != nil {
			return err
		}
		if len(values) == 0 {
			return httpx.Errorf(400, "Tidak ada kolom yang diubah")
		}
		key, err := rowID(id)
		if err != nil {
			return err
		}
		// Gambar lama yang diganti, supaya filenya bisa dibersihkan setelah update berhasil.
		var oldImages []any
		var changedImages []string
		for _, f := range values {
			if t.column(f.Key).Type == "image" {
				changedImages = append(changedImages, f.Key)
			}
		}
		if len(changedImages) > 0 {
			before, err := c.selectRows("SELECT * FROM "+ident(t.Name)+" WHERE id = ?", key)
			if err != nil {
				return err
			}
			if len(before) > 0 {
				for _, col := range changedImages {
					oldImages = append(oldImages, before[0][col])
				}
			}
		}

		sets := make([]string, len(values))
		args := make([]any, 0, len(values)+1)
		for i, f := range values {
			sets[i] = ident(f.Key) + " = ?"
			args = append(args, f.Value)
		}
		res, err := c.exec("UPDATE "+ident(t.Name)+" SET "+strings.Join(sets, ", ")+" WHERE id = ?", append(args, key)...)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return httpx.Errorf(404, "Baris tidak ditemukan")
		}
		d.removeUnusedUploads(c, slug, t, oldImages)
		row, err = c.getRow(t, key, publicView, nil)
		return err
	})
	return row, err
}

func (d *DB) DeleteRow(ctx context.Context, slug, name, id string) error {
	return d.with(ctx, slug, name, true, func(c *conn, t *Table) error {
		key, err := rowID(id)
		if err != nil {
			return err
		}
		var oldImages []any
		var imageCols []string
		for _, col := range t.Columns {
			if col.Type == "image" {
				imageCols = append(imageCols, col.Name)
			}
		}
		if len(imageCols) > 0 {
			before, err := c.selectRows("SELECT * FROM "+ident(t.Name)+" WHERE id = ?", key)
			if err != nil {
				return err
			}
			if len(before) > 0 {
				for _, col := range imageCols {
					oldImages = append(oldImages, before[0][col])
				}
			}
		}
		err = c.transaction(func() error {
			// ON DELETE SET NULL: lepaskan rujukan dari tabel lain sebelum baris dihapus.
			refs, err := c.referencesTo(t.Name)
			if err != nil {
				return err
			}
			for _, ref := range refs {
				col := ident(ref.column)
				if _, err := c.exec("UPDATE "+ident(ref.from)+" SET "+col+" = NULL WHERE "+col+" = ?", key); err != nil {
					return err
				}
			}
			res, err := c.exec("DELETE FROM "+ident(t.Name)+" WHERE id = ?", key)
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n == 0 {
				return httpx.Errorf(404, "Baris tidak ditemukan")
			}
			return nil
		})
		if err != nil {
			return err
		}
		d.removeUnusedUploads(c, slug, t, oldImages)
		return nil
	})
}

// ---------- Upload gambar untuk kolom bertipe image ----------
// File disimpan di website: uploads/<tabel>/<acak>.<ext>, lalu alamatnya disimpan di baris tabel.

var svgHeadRE = regexp.MustCompile(`(?is)^\s*(<\?xml[^>]*>\s*)?(<!--.*?-->\s*)*<svg[\s>]`)

// Jenis gambar dari isi file (bukan dari nama/Content-Type kiriman).
func sniffImage(buf []byte) string {
	at := func(a, b int) string {
		if len(buf) < b {
			return ""
		}
		return string(buf[a:b])
	}
	switch {
	case len(buf) > 8 && at(0, 4) == "\x89PNG":
		return "png"
	case len(buf) > 3 && at(0, 3) == "\xff\xd8\xff":
		return "jpg"
	case at(0, 4) == "GIF8":
		return "gif"
	case at(0, 4) == "RIFF" && at(8, 12) == "WEBP":
		return "webp"
	case at(4, 8) == "ftyp" && (at(8, 12) == "avif" || at(8, 12) == "avis"):
		return "avif"
	}
	head := buf
	if len(head) > 2048 {
		head = head[:2048]
	}
	if svgHeadRE.Match(head) {
		return "svg"
	}
	return ""
}

// UploadImage menyimpan gambar untuk kolom `columnName` (bertipe image) di tabel `name` dan
// mengembalikan alamatnya. publicView = dari pengunjung website: hanya boleh bila tabel membuka
// Tambah atau Ubah untuk publik, dan SVG ditolak (SVG bisa berisi script).
func (d *DB) UploadImage(ctx context.Context, slug, name, columnName string, buf []byte, publicView bool) (string, error) {
	t, err := d.GetTable(ctx, slug, name)
	if err != nil {
		return "", err
	}
	column := t.column(columnName)
	if column == nil {
		var images []string
		for _, c := range t.Columns {
			if c.Type == "image" {
				images = append(images, c.Name)
			}
		}
		list := "(belum ada)"
		if len(images) > 0 {
			list = strings.Join(images, ", ")
		}
		return "", httpx.Errorf(400, `Sertakan ?column=<nama kolom gambar>. Kolom gambar di tabel "%s": %s`, t.Name, list)
	}
	if column.Type != "image" {
		return "", httpx.Errorf(400, `Kolom "%s" bukan kolom gambar (tipe image). Ubah tipenya di editor database, atau pakai kolom lain.`, column.Name)
	}
	if publicView && t.Rules["create"] != "public" && t.Rules["update"] != "public" {
		return "", httpx.Errorf(403, `Pengunjung tidak diizinkan mengupload gambar ke tabel "%s". Pemilik bisa membuka akses Tambah di editor database → Atur → Akses.`, t.Name)
	}
	if len(buf) == 0 {
		return "", httpx.Errorf(400, `Kirim file gambar sebagai body request (fetch(url, { method: "POST", body: file }))`)
	}
	ext := sniffImage(buf)
	if ext == "" || (publicView && ext == "svg") {
		return "", httpx.Errorf(400, "File harus berupa gambar JPG, PNG, WEBP, GIF, atau AVIF")
	}
	random := make([]byte, 5)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	rel := fmt.Sprintf("uploads/%s/%s-%s.%s", t.Name, strconv.FormatInt(time.Now().UnixMilli(), 36), hex.EncodeToString(random), ext)
	// Cek ukuran per gambar & kuota storage paket.
	if _, err := files.WriteImage(d.siteRoot(slug), rel, buf, false, d.plans.StorageFor(baseSlug(slug))); err != nil {
		return "", err
	}
	return "/" + rel, nil
}

// Hapus file upload lama yang sudah tidak dipakai baris mana pun (setelah baris dihapus/diubah).
func (d *DB) removeUnusedUploads(c *conn, slug string, t *Table, urls []any) {
	prefix := "/uploads/" + t.Name + "/"
	done := map[string]bool{}
	for _, v := range urls {
		u, isString := v.(string)
		if !isString || done[u] || !strings.HasPrefix(u, prefix) || strings.Contains(u, "..") {
			continue
		}
		done[u] = true
		used := false
		for _, col := range t.Columns {
			if col.Type != "image" || used {
				continue
			}
			used, _ = c.exists("SELECT 1 FROM "+ident(t.Name)+" WHERE "+ident(col.Name)+" = ? LIMIT 1", u)
		}
		if !used {
			os.Remove(filepath.Join(d.siteRoot(slug), filepath.FromSlash(u[1:])))
		}
	}
}

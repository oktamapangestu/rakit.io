package userdb

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"rakit.icu/server/internal/httpx"
	"rakit.icu/server/internal/jsconv"
)

// Pengelolaan tabel dari editor database pemilik: buat, ubah, hapus, dan ringkasan pemakaian.

const (
	limitTables  = 20
	limitColumns = 30
)

// image: alamat gambar (file di folder uploads/ website, atau URL https). Isi gambar TIDAK disimpan di database.
var ColumnTypes = []string{"text", "number", "boolean", "date", "reference", "image"}

var sqlType = map[string]string{"text": "TEXT", "number": "REAL", "boolean": "INTEGER", "date": "TEXT", "reference": "INTEGER", "image": "TEXT"}

// TableInfo: tabel beserta jumlah barisnya, dalam bentuk yang dikirim ke editor.
type TableInfo struct {
	Name      string            `json:"name"`
	Columns   []Column          `json:"columns"`
	Rules     map[string]string `json:"rules"`
	CreatedAt string            `json:"createdAt"`
	RowCount  int64             `json:"rowCount"`
}

type Usage struct {
	Bytes  int64 `json:"bytes"`
	Tables int64 `json:"tables"`
	Limits struct {
		Bytes  int64 `json:"bytes"`
		Tables int   `json:"tables"`
	} `json:"limits"`
}

// display meniru `${value}` di JavaScript untuk pesan kesalahan.
func display(v any, present bool) string {
	switch {
	case !present:
		return "undefined"
	case v == nil:
		return "null"
	}
	return jsconv.String(v)
}

// truthy meniru Boolean(value) untuk nilai JSON.
func jsTruthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case float64:
		return t != 0
	case string:
		return t != ""
	}
	return true
}

var separatorsRE = regexp.MustCompile(`[\s-]+`)

func normalizeName(v any, present bool, what string) (string, error) {
	text := ""
	if present && v != nil {
		text = jsconv.String(v)
	}
	name := separatorsRE.ReplaceAllString(strings.ToLower(strings.TrimSpace(text)), "_")
	if !nameRE.MatchString(name) || strings.HasPrefix(name, "sqlite_") || strings.HasPrefix(name, "_rakit") {
		return "", httpx.Errorf(400, `Nama %s "%s" tidak valid. Pakai huruf kecil, angka, dan _, diawali huruf (maks. 40 karakter).`, what, display(v, present))
	}
	return name, nil
}

func normalizeColumn(input any) (Column, error) {
	obj, _ := input.(map[string]any)
	rawName, hasName := obj["name"]
	name, err := normalizeName(rawName, hasName, "kolom")
	if err != nil {
		return Column{}, err
	}
	if systemColumns[name] {
		return Column{}, httpx.Errorf(400, `Kolom "%s" sudah dibuat otomatis`, name)
	}
	rawType, hasType := obj["type"]
	kind, _ := rawType.(string)
	if _, known := sqlType[kind]; !known {
		return Column{}, httpx.Errorf(400, `Tipe kolom "%s" tidak dikenal. Pilih: %s`, display(rawType, hasType), strings.Join(ColumnTypes, ", "))
	}
	column := Column{Name: name, Type: kind, Required: jsTruthy(obj["required"]), Private: jsTruthy(obj["private"])}
	if kind == "reference" {
		if !jsTruthy(obj["refTable"]) {
			return Column{}, httpx.Errorf(400, `Kolom relasi "%s" harus menunjuk ke tabel lain (refTable)`, name)
		}
		if column.RefTable, err = normalizeName(obj["refTable"], true, "tabel relasi"); err != nil {
			return Column{}, err
		}
		if systemColumns[column.RefTable] {
			return Column{}, httpx.Errorf(400, `Kolom relasi "%s" tidak bisa menunjuk ke "%s"`, name, column.RefTable)
		}
	}
	return column, nil
}

func normalizeRules(input any, base map[string]string) map[string]string {
	rules := map[string]string{}
	obj, _ := input.(map[string]any)
	for _, op := range Operations {
		rules[op] = "owner"
		if base != nil {
			rules[op] = base[op]
		}
		if v, _ := obj[op].(string); v == "public" || v == "owner" {
			rules[op] = v
		}
	}
	return rules
}

func assertUniqueColumns(columns []Column) error {
	seen := map[string]bool{}
	for _, c := range columns {
		if seen[c.Name] {
			return httpx.Errorf(400, `Kolom "%s" ditulis lebih dari sekali`, c.Name)
		}
		seen[c.Name] = true
	}
	if len(columns) > limitColumns {
		return httpx.Errorf(400, "Maksimal %d kolom per tabel", limitColumns)
	}
	return nil
}

// Validasi kolom relasi: tabel tujuan harus ada dan bukan tabel itu sendiri.
func (c *conn) assertRefTargets(tableName string, columns []Column) error {
	for _, col := range columns {
		if col.Type != "reference" {
			continue
		}
		if col.RefTable == tableName {
			return httpx.Errorf(400, `Kolom "%s" tidak bisa menunjuk ke tabelnya sendiri`, col.Name)
		}
		target, err := c.readMeta(col.RefTable)
		if err != nil {
			return err
		}
		if target == nil {
			return httpx.Errorf(400, `Kolom "%s" menunjuk ke tabel "%s" yang tidak ada`, col.Name, col.RefTable)
		}
	}
	return nil
}

func (c *conn) writeMeta(t *Table) error {
	columns, err := json.Marshal(t.Columns)
	if err != nil {
		return err
	}
	rules, err := json.Marshal(t.Rules)
	if err != nil {
		return err
	}
	_, err = c.exec(`
		INSERT INTO _rakit_tables (name, columns, rules, created_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (name) DO UPDATE SET columns = excluded.columns, rules = excluded.rules`,
		t.Name, string(columns), string(rules), t.CreatedAt)
	return err
}

func (c *conn) tableNames() ([]string, error) {
	rows, err := c.query("SELECT name FROM _rakit_tables ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

func (c *conn) describe(t *Table) (*TableInfo, error) {
	info := &TableInfo{Name: t.Name, Columns: t.Columns, Rules: t.Rules, CreatedAt: t.CreatedAt}
	if info.Columns == nil {
		info.Columns = []Column{}
	}
	return info, c.QueryRowContext(c.ctx, "SELECT COUNT(*) FROM "+ident(t.Name)).Scan(&info.RowCount)
}

func (c *conn) countTables() (n int64, err error) {
	return n, c.QueryRowContext(c.ctx, "SELECT COUNT(*) FROM _rakit_tables").Scan(&n)
}

// owner membuka database project untuk pemilik (dibuat bila belum ada) dan menjalankan fn.
func (d *DB) owner(ctx context.Context, slug string, fn func(c *conn) error) error {
	c, release, _, err := d.acquire(ctx, slug, true)
	if err != nil {
		return err
	}
	defer release()
	return fn(c)
}

// HasDatabase: project sudah punya file database.
func (d *DB) HasDatabase(slug string) bool {
	_, err := os.Stat(d.path(slug))
	return err == nil
}

func (d *DB) Usage(ctx context.Context, slug string) (*Usage, error) {
	u := &Usage{}
	err := d.owner(ctx, slug, func(c *conn) error {
		var pages, pageSize int64
		if err := c.QueryRowContext(c.ctx, "PRAGMA page_count").Scan(&pages); err != nil {
			return err
		}
		if err := c.QueryRowContext(c.ctx, "PRAGMA page_size").Scan(&pageSize); err != nil {
			return err
		}
		u.Bytes = pages * pageSize
		u.Limits.Bytes = d.plans.StorageFor(slug).DBBytes
		u.Limits.Tables = limitTables
		var err error
		u.Tables, err = c.countTables()
		return err
	})
	return u, err
}

func (d *DB) ListTables(ctx context.Context, slug string) ([]*TableInfo, error) {
	out := []*TableInfo{}
	err := d.owner(ctx, slug, func(c *conn) error {
		names, err := c.tableNames()
		if err != nil {
			return err
		}
		for _, name := range names {
			t, err := c.readMeta(name)
			if err != nil || t == nil {
				return err
			}
			info, err := c.describe(t)
			if err != nil {
				return err
			}
			out = append(out, info)
		}
		return nil
	})
	return out, err
}

// CreateTable membuat tabel dari masukan editor: { name, columns: [{name,type,required,private,refTable}], rules }.
func (d *DB) CreateTable(ctx context.Context, slug string, input map[string]any) (*TableInfo, error) {
	var info *TableInfo
	err := d.owner(ctx, slug, func(c *conn) error {
		rawName, hasName := input["name"]
		name, err := normalizeName(rawName, hasName, "tabel")
		if err != nil {
			return err
		}
		columns := []Column{}
		list, _ := input["columns"].([]any)
		for _, item := range list {
			column, err := normalizeColumn(item)
			if err != nil {
				return err
			}
			columns = append(columns, column)
		}
		if err := assertUniqueColumns(columns); err != nil {
			return err
		}
		rules := normalizeRules(input["rules"], nil)

		return c.transaction(func() error {
			if existing, err := c.readMeta(name); err != nil {
				return err
			} else if existing != nil {
				return httpx.Errorf(409, `Tabel "%s" sudah ada`, name)
			}
			if n, err := c.countTables(); err != nil {
				return err
			} else if n >= limitTables {
				return httpx.Errorf(413, "Maksimal %d tabel per proyek", limitTables)
			}
			if err := c.assertRefTargets(name, columns); err != nil {
				return err
			}
			columnSQL := ""
			for _, col := range columns {
				columnSQL += ", " + ident(col.Name) + " " + sqlType[col.Type]
			}
			if _, err := c.exec("CREATE TABLE " + ident(name) + " (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL" + columnSQL + ")"); err != nil {
				return err
			}
			t := &Table{Name: name, Columns: columns, Rules: rules, CreatedAt: jsNow()}
			if err := c.writeMeta(t); err != nil {
				return err
			}
			info, err = c.describe(t)
			return err
		})
	})
	return info, err
}

// UpdateTable mengubah tabel. Semua bagian opsional, dijalankan berurutan dalam satu transaksi:
// { addColumns: [{name,type,required,private}], dropColumns: ['kolom'], renameColumns: [{from,to}],
// columnFlags: {kolom: {required, private}}, rules: {list:'public',...}, rename: 'nama_baru' }
func (d *DB) UpdateTable(ctx context.Context, slug, name string, patch map[string]any) (*TableInfo, error) {
	var info *TableInfo
	err := d.owner(ctx, slug, func(c *conn) error {
		return c.transaction(func() error {
			t, err := c.table(name)
			if err != nil {
				return err
			}
			tbl := ident(t.Name)

			add, _ := patch["addColumns"].([]any)
			for _, input := range add {
				column, err := normalizeColumn(input)
				if err != nil {
					return err
				}
				if t.column(column.Name) != nil {
					return httpx.Errorf(409, `Kolom "%s" sudah ada`, column.Name)
				}
				if err := c.assertRefTargets(t.Name, []Column{column}); err != nil {
					return err
				}
				t.Columns = append(t.Columns, column)
				if err := assertUniqueColumns(t.Columns); err != nil {
					return err
				}
				if _, err := c.exec("ALTER TABLE " + tbl + " ADD COLUMN " + ident(column.Name) + " " + sqlType[column.Type]); err != nil {
					return err
				}
			}

			drops, _ := patch["dropColumns"].([]any)
			for _, raw := range drops {
				drop, _ := raw.(string)
				if t.column(drop) == nil {
					return httpx.Errorf(404, `Kolom "%s" tidak ditemukan`, display(raw, true))
				}
				kept := t.Columns[:0:0]
				for _, col := range t.Columns {
					if col.Name != drop {
						kept = append(kept, col)
					}
				}
				t.Columns = kept
				if _, err := c.exec("ALTER TABLE " + tbl + " DROP COLUMN " + ident(drop)); err != nil {
					return err
				}
			}

			renames, _ := patch["renameColumns"].([]any)
			for _, raw := range renames {
				pair, _ := raw.(map[string]any)
				from, _ := pair["from"].(string)
				column := t.column(from)
				if column == nil {
					_, hasFrom := pair["from"]
					return httpx.Errorf(404, `Kolom "%s" tidak ditemukan`, display(pair["from"], hasFrom))
				}
				rawTo, hasTo := pair["to"]
				newName, err := normalizeName(rawTo, hasTo, "kolom")
				if err != nil {
					return err
				}
				if newName == from {
					continue
				}
				if systemColumns[newName] || t.column(newName) != nil {
					return httpx.Errorf(409, `Kolom "%s" sudah ada`, newName)
				}
				if _, err := c.exec("ALTER TABLE " + tbl + " RENAME COLUMN " + ident(from) + " TO " + ident(newName)); err != nil {
					return err
				}
				column.Name = newName
			}

			flags, _ := patch["columnFlags"].(map[string]any)
			flagOrder := make([]string, 0, len(flags))
			for columnName := range flags {
				flagOrder = append(flagOrder, columnName)
			}
			sort.Strings(flagOrder)
			for _, columnName := range flagOrder {
				column := t.column(columnName)
				if column == nil {
					return httpx.Errorf(404, `Kolom "%s" tidak ditemukan`, columnName)
				}
				set, _ := flags[columnName].(map[string]any)
				if v, ok := set["required"]; ok {
					column.Required = jsTruthy(v)
				}
				if v, ok := set["private"]; ok {
					column.Private = jsTruthy(v)
				}
			}

			if jsTruthy(patch["rules"]) {
				t.Rules = normalizeRules(patch["rules"], t.Rules)
			}

			if rawName, renaming := patch["rename"]; renaming {
				newName, err := normalizeName(rawName, true, "tabel")
				if err != nil {
					return err
				}
				if newName != t.Name {
					if existing, err := c.readMeta(newName); err != nil {
						return err
					} else if existing != nil {
						return httpx.Errorf(409, `Tabel "%s" sudah ada`, newName)
					}
					if _, err := c.exec("ALTER TABLE " + tbl + " RENAME TO " + ident(newName)); err != nil {
						return err
					}
					if _, err := c.exec("DELETE FROM _rakit_tables WHERE name = ?", t.Name); err != nil {
						return err
					}
					// Ikut perbarui kolom relasi di tabel lain yang menunjuk ke nama lama.
					names, err := c.tableNames()
					if err != nil {
						return err
					}
					for _, otherName := range names {
						other, err := c.readMeta(otherName)
						if err != nil || other == nil {
							return err
						}
						dirty := false
						for i := range other.Columns {
							if col := &other.Columns[i]; col.Type == "reference" && col.RefTable == t.Name {
								col.RefTable, dirty = newName, true
							}
						}
						if dirty {
							if err := c.writeMeta(other); err != nil {
								return err
							}
						}
					}
					t.Name = newName
				}
			}

			if err := c.writeMeta(t); err != nil {
				return err
			}
			info, err = c.describe(t)
			return err
		})
	})
	return info, err
}

func (d *DB) DeleteTable(ctx context.Context, slug, name string) error {
	err := d.owner(ctx, slug, func(c *conn) error {
		return c.transaction(func() error {
			t, err := c.table(name)
			if err != nil {
				return err
			}
			refs, err := c.referencesTo(t.Name)
			if err != nil {
				return err
			}
			if len(refs) > 0 {
				list := make([]string, len(refs))
				for i, r := range refs {
					list[i] = r.from + "." + r.column
				}
				return httpx.Errorf(409, `Tabel "%s" masih dirujuk oleh %s. Hapus dulu kolom relasinya.`, t.Name, strings.Join(list, ", "))
			}
			if _, err := c.exec("DROP TABLE " + ident(t.Name)); err != nil {
				return err
			}
			_, err = c.exec("DELETE FROM _rakit_tables WHERE name = ?", t.Name)
			return err
		})
	})
	if err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(d.cfg.SiteRoot(slug), "uploads", name))
}

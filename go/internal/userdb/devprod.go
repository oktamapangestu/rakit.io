package userdb

// Publikasi manual (dev/prod, lihat internal/publish): project punya dua database.
//   - kunci <slug>         : versi dev — dipakai editor, AI, dan <slug>--dev.rakit.io
//   - kunci <slug>@prod    : versi prod — dipakai website publik <slug>.rakit.io
//
// Upload gambar ikut kuncinya: dev di data/sites/<slug>/uploads, prod di data/published/<slug>/uploads.
// Perubahan struktur tabel di dev dicatat berurutan (_rakit_migrations) lalu diputar ulang ke prod saat
// publikasi. Catatan ini (bukan perbandingan skema) menjaga ganti nama tabel/kolom tetap ganti nama,
// bukan hapus + buat baru yang menghilangkan data di prod.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const prodSuffix = "@prod"

// ProdKey: kunci database versi prod.
func ProdKey(slug string) string { return slug + prodSuffix }

func baseSlug(key string) string { return strings.TrimSuffix(key, prodSuffix) }

// siteRoot: folder file tempat upload gambar database ini disimpan.
func (d *DB) siteRoot(key string) string {
	if strings.HasSuffix(key, prodSuffix) {
		return d.cfg.PublishedRoot(baseSlug(key))
	}
	return d.cfg.SiteRoot(key)
}

// ---------- Catatan perubahan struktur (hanya di database dev) ----------

const logTableSQL = `CREATE TABLE IF NOT EXISTS _rakit_migrations (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	op         TEXT NOT NULL,
	created_at TEXT NOT NULL
)`

// Op: satu perubahan struktur. Kind: create (Input = input CreateTable), update (Input = patch
// UpdateTable), delete.
type Op struct {
	Kind  string         `json:"kind"`
	Table string         `json:"table"`
	Input map[string]any `json:"input,omitempty"`
}

// logOp mencatat perubahan bila database ini sedang mencatat (dijalankan di transaksi yang sama).
func (c *conn) logOp(op Op) error {
	on, err := c.exists("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_rakit_migrations'")
	if err != nil || !on {
		return err
	}
	raw, err := json.Marshal(op)
	if err != nil {
		return err
	}
	_, err = c.exec("INSERT INTO _rakit_migrations (op, created_at) VALUES (?, ?)", string(raw), jsNow())
	return err
}

// StartLog: mulai mencatat perubahan struktur di database dev (database dibuat bila belum ada).
func (d *DB) StartLog(ctx context.Context, slug string) error {
	return d.owner(ctx, slug, func(c *conn) error {
		_, err := c.exec(logTableSQL)
		return err
	})
}

// StopLog: berhenti mencatat (kembali ke mode langsung tayang).
func (d *DB) StopLog(ctx context.Context, slug string) error {
	if !d.HasDatabase(slug) {
		return nil
	}
	return d.owner(ctx, slug, func(c *conn) error {
		_, err := c.exec("DROP TABLE IF EXISTS _rakit_migrations")
		return err
	})
}

// PendingOps: perubahan struktur di dev yang belum dipublikasikan, berurutan.
func (d *DB) PendingOps(ctx context.Context, slug string) ([]Op, error) {
	out := []Op{}
	if !d.HasDatabase(slug) {
		return out, nil
	}
	err := d.owner(ctx, slug, func(c *conn) error {
		on, err := c.exists("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_rakit_migrations'")
		if err != nil || !on {
			return err
		}
		rows, err := c.query("SELECT op FROM _rakit_migrations ORDER BY id")
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var raw string
			var op Op
			if err := rows.Scan(&raw); err != nil {
				return err
			}
			if json.Unmarshal([]byte(raw), &op) == nil {
				out = append(out, op)
			}
		}
		return rows.Err()
	})
	return out, err
}

// ClearLog: perubahan sudah dipublikasikan.
func (d *DB) ClearLog(ctx context.Context, slug string) error {
	return d.owner(ctx, slug, func(c *conn) error {
		_, err := c.exec("DELETE FROM _rakit_migrations")
		return err
	})
}

// ---------- File database ----------

func (d *DB) close(key string) {
	d.mu.Lock()
	if h := d.pool[key]; h != nil {
		d.evict(key, h)
	}
	d.mu.Unlock()
}

func (d *DB) removeFiles(key string) error {
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if err := os.Remove(d.path(key) + suffix); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

// CopyDB menyalin database (struktur + data) ke kunci lain; database tujuan yang lama dibuang. Bila
// sumber belum punya database, tujuan ikut tidak punya.
func (d *DB) CopyDB(ctx context.Context, from, to string) error {
	d.close(to)
	if err := d.removeFiles(to); err != nil {
		return err
	}
	if !d.HasDatabase(from) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(d.path(to)), 0o755); err != nil {
		return err
	}
	return d.owner(ctx, from, func(c *conn) error {
		// VACUUM INTO: salinan utuh yang konsisten walau database sedang dipakai (WAL).
		_, err := c.exec("VACUUM INTO ?", d.path(to))
		return err
	})
}

// MoveDB memindahkan database ke kunci lain (menggantikan database tujuan).
func (d *DB) MoveDB(ctx context.Context, from, to string) error {
	if err := d.CopyDB(ctx, from, to); err != nil {
		return err
	}
	d.close(from)
	return d.removeFiles(from)
}

// ApplyOps memutar ulang perubahan struktur ke database lain (dari dev ke prod). Semua atau tidak sama
// sekali: database tujuan dicadangkan dulu dan dikembalikan bila ada langkah yang gagal.
func (d *DB) ApplyOps(ctx context.Context, key string, ops []Op) error {
	if len(ops) == 0 {
		return nil
	}
	backup := key + "@backup"
	if err := d.CopyDB(ctx, key, backup); err != nil {
		return err
	}
	defer func() {
		d.close(backup)
		d.removeFiles(backup)
	}()
	hadDB := d.HasDatabase(key)
	for i, op := range ops {
		var err error
		switch op.Kind {
		case "create":
			_, err = d.CreateTable(ctx, key, op.Input)
		case "update":
			_, err = d.UpdateTable(ctx, key, op.Table, op.Input)
		case "delete":
			err = d.DeleteTable(ctx, key, op.Table)
		default:
			err = fmt.Errorf("langkah tidak dikenal: %q", op.Kind)
		}
		if err != nil {
			restoreErr := d.CopyDB(ctx, backup, key)
			if !hadDB {
				d.close(key)
				restoreErr = errors.Join(restoreErr, d.removeFiles(key))
			}
			return errors.Join(fmt.Errorf("langkah %d (%s tabel %s): %w", i+1, op.Kind, op.Table, err), restoreErr)
		}
	}
	return nil
}

// Schema: tabel & kolom database (tanpa data), untuk ringkasan perubahan.
func (d *DB) Schema(ctx context.Context, key string) (map[string][]string, error) {
	out := map[string][]string{}
	if !d.HasDatabase(key) {
		return out, nil
	}
	tables, err := d.ListTables(ctx, key)
	if err != nil {
		return nil, err
	}
	for _, t := range tables {
		cols := []string{}
		for _, c := range t.Columns {
			cols = append(cols, c.Name)
		}
		out[t.Name] = cols
	}
	return out, nil
}

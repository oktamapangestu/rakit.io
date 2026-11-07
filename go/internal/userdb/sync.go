package userdb

// Sinkron aplikasi desktop <-> rakit.io (lihat internal/bundle dan internal/api/sync.go, cloud.go):
//   - unduh dari server: database project disalin utuh (struktur + data) ke komputer pengguna;
//   - publikasi dari desktop: hanya struktur tabel yang dikirim. MergeSchema menambah tabel & kolom yang belum ada
//     di server tanpa pernah menghapus atau mengubah data yang sudah ada di sana.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"

	"rakit.io/server/internal/httpx"
)

// SnapshotTo menyalin database (struktur + data) ke file dst. false = project belum punya database.
func (d *DB) SnapshotTo(ctx context.Context, key, dst string) (bool, error) {
	if !d.HasDatabase(key) {
		return false, nil
	}
	os.Remove(dst)
	err := d.owner(ctx, key, func(c *conn) error {
		_, err := c.exec("VACUUM INTO ?", dst)
		return err
	})
	return err == nil, err
}

// ReplaceFromFile mengganti database key dengan salinan file src (database lama dibuang). Catatan perubahan
// struktur (_rakit_migrations) dari asalnya ikut dibuang: project tujuan mulai bersih.
func (d *DB) ReplaceFromFile(ctx context.Context, key, src string) error {
	d.close(key)
	if err := d.removeFiles(key); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(d.path(key)), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(d.path(key), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	// Pastikan benar-benar database rakit yang bisa dibaca; bila tidak, buang lagi.
	if _, err := d.ListTables(ctx, key); err != nil {
		d.close(key)
		d.removeFiles(key)
		return fmt.Errorf("database dari server tidak bisa dibaca: %w", err)
	}
	return d.StopLog(ctx, key)
}

// SchemaResult: hasil MergeSchema, dalam kalimat untuk pengguna.
type SchemaResult struct {
	Changes  []string `json:"changes"`
	Warnings []string `json:"warnings"`
}

// asInput mengubah nilai ke bentuk masukan CreateTable/UpdateTable (map/slice JSON).
func asInput(v any) any {
	raw, _ := json.Marshal(v)
	var out any
	json.Unmarshal(raw, &out)
	return out
}

// MergeSchema menyamakan struktur database key dengan tables (dari project lain) tanpa menghapus apa pun:
// tabel yang belum ada dibuat, kolom yang belum ada ditambahkan, dan aturan akses tabel disamakan. Tabel/kolom
// yang hanya ada di key dibiarkan; kolom bernama sama dengan tipe berbeda tidak diubah (jadi peringatan).
func (d *DB) MergeSchema(ctx context.Context, key string, tables []*TableInfo) (*SchemaResult, error) {
	res := &SchemaResult{Changes: []string{}, Warnings: []string{}}
	if len(tables) == 0 {
		return res, nil
	}
	existing := map[string]*TableInfo{}
	if d.HasDatabase(key) {
		list, err := d.ListTables(ctx, key)
		if err != nil {
			return nil, err
		}
		for _, t := range list {
			existing[t.Name] = t
		}
	}
	sorted := append([]*TableInfo(nil), tables...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })

	// 1. Tabel baru, tanpa kolom relasi dulu (tabel tujuannya mungkin belum dibuat).
	created := map[string]bool{}
	for _, t := range sorted {
		if existing[t.Name] != nil {
			continue
		}
		cols := []Column{}
		for _, c := range t.Columns {
			if c.Type != "reference" {
				cols = append(cols, c)
			}
		}
		input, _ := asInput(map[string]any{"name": t.Name, "columns": cols, "rules": t.Rules}).(map[string]any)
		if _, err := d.CreateTable(ctx, key, input); err != nil {
			res.Warnings = append(res.Warnings, fmt.Sprintf("Tabel %s tidak bisa dibuat: %s", t.Name, message(err)))
			continue
		}
		created[t.Name] = true
		res.Changes = append(res.Changes, fmt.Sprintf("Tabel baru %s", t.Name))
	}
	// 2. Kolom yang belum ada (termasuk kolom relasi tabel baru) dan aturan akses.
	for _, t := range sorted {
		have := existing[t.Name]
		if have == nil && !created[t.Name] {
			continue
		}
		haveCols := map[string]Column{}
		if have != nil {
			for _, c := range have.Columns {
				haveCols[c.Name] = c
			}
		}
		for _, c := range t.Columns {
			if old, ok := haveCols[c.Name]; ok {
				if old.Type != c.Type {
					res.Warnings = append(res.Warnings, fmt.Sprintf("Kolom %s.%s di server bertipe %s, di komputer %s; tidak diubah", t.Name, c.Name, old.Type, c.Type))
				}
				continue
			}
			if created[t.Name] && c.Type != "reference" {
				continue // sudah dibuat bersama tabelnya
			}
			patch, _ := asInput(map[string]any{"addColumns": []Column{c}}).(map[string]any)
			if _, err := d.UpdateTable(ctx, key, t.Name, patch); err != nil {
				res.Warnings = append(res.Warnings, fmt.Sprintf("Kolom %s.%s tidak bisa ditambahkan: %s", t.Name, c.Name, message(err)))
				continue
			}
			if !created[t.Name] {
				res.Changes = append(res.Changes, fmt.Sprintf("Kolom baru %s.%s", t.Name, c.Name))
			}
		}
		if have != nil && !sameRules(have.Rules, t.Rules) {
			patch, _ := asInput(map[string]any{"rules": t.Rules}).(map[string]any)
			if _, err := d.UpdateTable(ctx, key, t.Name, patch); err != nil {
				res.Warnings = append(res.Warnings, fmt.Sprintf("Aturan akses tabel %s tidak bisa diubah: %s", t.Name, message(err)))
			} else {
				res.Changes = append(res.Changes, fmt.Sprintf("Ubah aturan akses tabel %s", t.Name))
			}
		}
	}
	return res, nil
}

func sameRules(a, b map[string]string) bool {
	for _, op := range Operations {
		if a[op] != b[op] {
			return false
		}
	}
	return true
}

// message: teks kesalahan untuk pengguna.
func message(err error) string {
	var he *httpx.Error
	if errors.As(err, &he) {
		return he.Message
	}
	return err.Error()
}

// Package bundle: satu project dalam satu file zip, untuk sinkron aplikasi desktop <-> rakit.io.
//
//	rakit.json   Meta: nama & subdomain asal, struktur tabel database
//	files/...    file website project (data/sites/<slug>)
//	database.db  opsional, database lengkap (hanya arah server -> desktop)
//
// Arah desktop -> server hanya membawa file dan struktur tabel; data database di server tidak pernah ditimpa.
package bundle

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"rakit.io/server/internal/files"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/plans"
	"rakit.io/server/internal/userdb"
)

const (
	metaName = "rakit.json"
	filesDir = "files/"
	dbName   = "database.db"
	// Uploads: folder gambar kiriman database. Ikut saat diunduh (baris database merujuk ke sana), tidak ikut saat
	// dipublikasikan dari desktop (data database server tidak berubah, jadi upload server dipertahankan).
	Uploads = "uploads"
	Version = 1
	maxMeta = 1 << 20
)

type Meta struct {
	Version int                 `json:"version"`
	Name    string              `json:"name"`
	Slug    string              `json:"slug"`
	Tables  []*userdb.TableInfo `json:"tables"`
}

// IsUpload: path relatif di folder upload gambar.
func IsUpload(rel string) bool { return rel == Uploads || strings.HasPrefix(rel, Uploads+"/") }

// Write menulis bundle ke w: file di root (tanpa folder upload bila withUploads false) dan database dbFile
// (kosong = tanpa database).
func Write(w io.Writer, meta Meta, root string, withUploads bool, dbFile string) error {
	meta.Version = Version
	if meta.Tables == nil {
		meta.Tables = []*userdb.TableInfo{}
	}
	zw := zip.NewWriter(w)
	raw, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	f, err := zw.Create(metaName)
	if err != nil {
		return err
	}
	if _, err := f.Write(raw); err != nil {
		return err
	}
	entries, err := files.ListTree(root)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.Dir || (!withUploads && IsUpload(e.Path)) {
			continue
		}
		in, _, err := files.OpenRegular(root, e.Path)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			return err
		}
		out, err := zw.Create(filesDir + e.Path)
		if err == nil {
			_, err = io.Copy(out, in)
		}
		in.Close()
		if err != nil {
			return err
		}
	}
	if dbFile != "" {
		in, err := os.Open(dbFile)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := zw.CreateHeader(&zip.FileHeader{Name: dbName, Method: zip.Deflate})
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, in); err != nil {
			return err
		}
	}
	return zw.Close()
}

// Opened: bundle yang sudah dibongkar ke folder sementara. Close menghapusnya.
type Opened struct {
	Meta  Meta
	Dir   string // folder sementara
	Files string // isi website (Dir/files)
	DB    string // database.db yang dibongkar, "" bila tidak ada
}

func (o *Opened) Close() error { return os.RemoveAll(o.Dir) }

var errInvalid = httpx.Errorf(400, "File project tidak valid")

// Read membongkar bundle (zip berukuran size) ke folder sementara di tmpParent, dengan batas storage project.
// withDB: database.db boleh ada (arah server -> desktop); tanpanya database diabaikan. withUploads: folder upload
// ikut dibongkar.
func Read(r io.ReaderAt, size int64, tmpParent string, limits plans.Storage, withDB, withUploads bool) (*Opened, error) {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return nil, errInvalid
	}
	if err := os.MkdirAll(tmpParent, 0o755); err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp(tmpParent, ".bundle-")
	if err != nil {
		return nil, err
	}
	o := &Opened{Dir: dir, Files: filepath.Join(dir, "files")}
	if err := o.extract(zr, limits, withDB, withUploads); err != nil {
		o.Close()
		return nil, err
	}
	return o, nil
}

func (o *Opened) extract(zr *zip.Reader, limits plans.Storage, withDB, withUploads bool) error {
	if err := os.MkdirAll(o.Files, 0o755); err != nil {
		return err
	}
	var total, entries int64
	dirs := map[string]bool{}
	hasMeta := false
	for _, f := range zr.File {
		name := f.Name
		switch {
		case name == metaName:
			raw, err := readAll(f, maxMeta)
			if err != nil {
				return err
			}
			if json.Unmarshal(raw, &o.Meta) != nil || o.Meta.Version != Version {
				return errInvalid
			}
			hasMeta = true
		case name == dbName:
			if !withDB {
				continue
			}
			o.DB = filepath.Join(o.Dir, dbName)
			if err := copyEntry(f, o.DB, limits.DBBytes+limits.DBBytes/2); err != nil {
				return err
			}
		case strings.HasPrefix(name, filesDir):
			if strings.HasSuffix(name, "/") || !f.Mode().IsRegular() {
				continue // folder dibuat dari path file; symlink & lainnya tidak pernah dibongkar
			}
			rel, err := files.CleanPath(strings.TrimPrefix(name, filesDir))
			if err != nil || rel != strings.TrimPrefix(name, filesDir) {
				return errInvalid
			}
			if IsUpload(rel) && !withUploads {
				continue
			}
			// Hitung file + folder induk baru, seperti kuota di editor.
			parts := strings.Split(rel, "/")
			for i := 1; i < len(parts); i++ {
				if d := strings.Join(parts[:i], "/"); !dirs[d] {
					dirs[d] = true
					entries++
				}
			}
			entries++
			if entries > limits.Entries {
				return httpx.Errorf(413, "Maksimal %d file & folder", limits.Entries)
			}
			left := limits.TotalSize - total
			abs, err := files.ResolveIn(o.Files, rel)
			if err != nil {
				return errInvalid
			}
			if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
				return err
			}
			n, err := copyCounted(f, abs, left)
			if err != nil {
				return err
			}
			total += n
		}
	}
	if !hasMeta {
		return errInvalid
	}
	return nil
}

func quotaFull(limit int64) error {
	return httpx.Errorf(413, "Kuota penyimpanan %s MB penuh", fmt.Sprintf("%g", float64(limit)/1024/1024))
}

func readAll(f *zip.File, limit int64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, errInvalid
	}
	defer rc.Close()
	raw, err := io.ReadAll(io.LimitReader(rc, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return nil, errInvalid
	}
	return raw, nil
}

// copyCounted membongkar satu file, gagal bila isinya melebihi left byte (angka di header zip tidak dipercaya).
func copyCounted(f *zip.File, dst string, left int64) (int64, error) {
	rc, err := f.Open()
	if err != nil {
		return 0, errInvalid
	}
	defer rc.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o644)
	if err != nil {
		if errors.Is(err, fs.ErrExist) {
			return 0, errInvalid // nama ganda
		}
		return 0, err
	}
	n, err := io.Copy(out, io.LimitReader(rc, max(left, 0)+1))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return n, errInvalid
	}
	if n > left {
		return n, quotaFull(left + n)
	}
	return n, nil
}

func copyEntry(f *zip.File, dst string, limit int64) error {
	n, err := copyCounted(f, dst, limit)
	if err != nil && n > limit {
		return httpx.Errorf(413, "Database terlalu besar")
	}
	return err
}

// Install mengganti isi website root dengan folder src (hasil Read). keepUploads: folder upload root yang lama
// dipertahankan (publikasi dari desktop); tanpanya folder upload ikut dari src. Ditukar sekaligus supaya pengunjung
// tidak melihat website setengah jadi. src dipindahkan (tidak bisa dipakai lagi).
func Install(src, root string, keepUploads bool) error {
	if keepUploads {
		os.RemoveAll(filepath.Join(src, Uploads))
		if _, err := os.Stat(filepath.Join(root, Uploads)); err == nil {
			if err := os.Rename(filepath.Join(root, Uploads), filepath.Join(src, Uploads)); err != nil {
				return err
			}
		}
	}
	if err := os.MkdirAll(filepath.Dir(root), 0o755); err != nil {
		return err
	}
	old := root + ".old-" + filepath.Base(filepath.Dir(src))
	if err := os.Rename(root, old); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := os.Rename(src, root); err != nil {
		os.Rename(old, root) // kembalikan versi lama
		if keepUploads {
			os.Rename(filepath.Join(src, Uploads), filepath.Join(root, Uploads))
		}
		return err
	}
	return os.RemoveAll(old)
}

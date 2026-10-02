// Package publish: mode publikasi website project.
//
//   - live   (bawaan): file yang diedit langsung tayang di <slug>.rakit.io.
//   - manual (dev/prod): editor & AI mengubah versi dev (data/sites/<slug>, database <slug>), yang tampil
//     di <slug>--dev.rakit.io dan preview editor. Website publik <slug>.rakit.io menyajikan versi prod
//     (data/published/<slug>, database <slug>@prod), yang baru berubah saat pemilik menekan Publikasikan.
//
// Publikasi menyalin file dev ke prod (folder uploads/ prod — gambar kiriman pengunjung — dipertahankan)
// dan memutar ulang perubahan struktur tabel dev ke database prod; data tabel dev tidak ikut.
package publish

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"rakit.io/server/internal/config"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/store"
	"rakit.io/server/internal/userdb"
)

// uploads: folder gambar kiriman database; milik masing-masing versi, tidak pernah ikut disalin.
const uploads = "uploads"

type Service struct {
	cfg    *config.Config
	store  *store.Store
	userdb *userdb.DB

	mu    sync.Mutex
	locks map[string]*sync.Mutex // per project: ganti mode & publikasi tidak boleh bersamaan
}

func New(cfg *config.Config, db *store.Store, udb *userdb.DB) *Service {
	return &Service{cfg: cfg, store: db, userdb: udb, locks: map[string]*sync.Mutex{}}
}

func (s *Service) lock(slug string) func() {
	s.mu.Lock()
	l := s.locks[slug]
	if l == nil {
		l = &sync.Mutex{}
		s.locks[slug] = l
	}
	s.mu.Unlock()
	l.Lock()
	return l.Unlock
}

// ---------- Status ----------

type FileChange struct {
	Path   string `json:"path"`
	Change string `json:"change"` // added | changed | removed
}

type SchemaChange struct {
	Text        string `json:"text"`
	Destructive bool   `json:"destructive"` // menghapus data yang ada di versi publik
}

type Status struct {
	Mode        string         `json:"mode"`
	SiteURL     string         `json:"siteUrl"`
	DevURL      string         `json:"devUrl,omitempty"`
	PublishedAt *string        `json:"publishedAt"`
	Files       []FileChange   `json:"files"`
	Schema      []SchemaChange `json:"schema"`
	Pending     bool           `json:"pending"`     // ada yang belum dipublikasikan
	Destructive bool           `json:"destructive"` // publikasi akan menghapus data di versi publik
}

func iso(ms int64) *string {
	if ms == 0 {
		return nil
	}
	s := time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z")
	return &s
}

// Status: mode project dan, untuk publikasi manual, apa saja yang belum dipublikasikan.
func (s *Service) Status(ctx context.Context, p *store.Project) (*Status, error) {
	st := &Status{Mode: p.Mode, SiteURL: s.cfg.SiteURL(p.Slug), PublishedAt: iso(p.PublishedAt), Files: []FileChange{}, Schema: []SchemaChange{}}
	if !p.Manual() {
		return st, nil
	}
	st.DevURL = s.cfg.DevURL(p.Slug)
	var err error
	if st.Files, err = diffTrees(s.cfg.SiteRoot(p.Slug), s.cfg.PublishedRoot(p.Slug)); err != nil {
		return nil, err
	}
	ops, err := s.userdb.PendingOps(ctx, p.Slug)
	if err != nil {
		return nil, err
	}
	prod, err := s.userdb.Schema(ctx, userdb.ProdKey(p.Slug))
	if err != nil {
		return nil, err
	}
	st.Schema = describe(ops, prod)
	for _, c := range st.Schema {
		st.Destructive = st.Destructive || c.Destructive
	}
	st.Pending = len(st.Files) > 0 || len(st.Schema) > 0
	return st, nil
}

// ---------- Ganti mode ----------

// SetMode mengganti mode publikasi.
//   - live -> manual: versi sekarang (file + database beserta datanya) menjadi prod; dev mulai dari
//     salinannya.
//   - manual -> live: perlu confirm. Data asli (database & upload prod) kembali menjadi data project,
//     dan file dev — termasuk yang belum dipublikasikan — langsung tayang.
func (s *Service) SetMode(ctx context.Context, p *store.Project, mode string, confirm bool) (*Status, error) {
	if mode != store.ModeLive && mode != store.ModeManual {
		return nil, httpx.Errorf(400, "Mode publikasi tidak dikenal")
	}
	defer s.lock(p.Slug)()
	if mode == p.Mode {
		return s.Status(ctx, p)
	}
	slug := p.Slug
	if mode == store.ModeManual {
		if err := replaceTree(s.cfg.SiteRoot(slug), s.cfg.PublishedRoot(slug), false); err != nil {
			return nil, err
		}
		// Salin dulu, baru mulai mencatat: catatan perubahan hanya ada di dev.
		if err := s.userdb.CopyDB(ctx, slug, userdb.ProdKey(slug)); err != nil {
			return nil, err
		}
		if err := s.userdb.StartLog(ctx, slug); err != nil {
			return nil, err
		}
		if err := s.userdb.ClearLog(ctx, slug); err != nil {
			return nil, err
		}
		p.PublishedAt = time.Now().UnixMilli()
	} else {
		if !confirm {
			return nil, &httpx.Error{Status: 409, Code: "confirm", Message: "Kembali ke mode langsung tayang perlu konfirmasi."}
		}
		if err := s.userdb.MoveDB(ctx, userdb.ProdKey(slug), slug); err != nil {
			return nil, err
		}
		if err := moveUploads(s.cfg.PublishedRoot(slug), s.cfg.SiteRoot(slug)); err != nil {
			return nil, err
		}
		if err := s.userdb.StopLog(ctx, slug); err != nil {
			return nil, err
		}
		if err := os.RemoveAll(s.cfg.PublishedRoot(slug)); err != nil {
			return nil, err
		}
		p.PublishedAt = 0
	}
	p.Mode = mode
	if err := s.store.SetPublishMode(p.ID, p.Mode, p.PublishedAt); err != nil {
		return nil, err
	}
	return s.Status(ctx, p)
}

// ---------- Publikasi ----------

// Publish menerapkan versi dev ke prod. Perubahan yang menghapus data di versi publik perlu confirm.
func (s *Service) Publish(ctx context.Context, p *store.Project, confirm bool) (*Status, error) {
	if !p.Manual() {
		return nil, httpx.Errorf(409, "Project ini langsung tayang; tidak perlu dipublikasikan.")
	}
	defer s.lock(p.Slug)()
	st, err := s.Status(ctx, p)
	if err != nil {
		return nil, err
	}
	if st.Destructive && !confirm {
		return nil, &httpx.Error{Status: 409, Code: "confirm", Message: "Publikasi ini akan menghapus data di website publik. Konfirmasi dulu."}
	}
	ops, err := s.userdb.PendingOps(ctx, p.Slug)
	if err != nil {
		return nil, err
	}
	// Database dulu: bila gagal, database prod dikembalikan dan file belum berubah.
	if err := s.userdb.ApplyOps(ctx, userdb.ProdKey(p.Slug), ops); err != nil {
		var he *httpx.Error
		if errors.As(err, &he) {
			return nil, httpx.Errorf(409, "Perubahan tabel tidak bisa diterapkan ke versi publik: %s. Tidak ada yang berubah.", he.Message)
		}
		return nil, err
	}
	if err := s.userdb.ClearLog(ctx, p.Slug); err != nil {
		return nil, err
	}
	if err := replaceTree(s.cfg.SiteRoot(p.Slug), s.cfg.PublishedRoot(p.Slug), true); err != nil {
		return nil, err
	}
	p.PublishedAt = time.Now().UnixMilli()
	if err := s.store.SetPublishMode(p.ID, p.Mode, p.PublishedAt); err != nil {
		return nil, err
	}
	return s.Status(ctx, p)
}

// Remove membuang versi prod (project dihapus).
func (s *Service) Remove(slug string) error {
	s.userdb.Remove(userdb.ProdKey(slug))
	return os.RemoveAll(s.cfg.PublishedRoot(slug))
}

// ---------- File ----------

// skipUploads: path relatif di folder upload gambar.
func skipUploads(rel string) bool { return rel == uploads || strings.HasPrefix(rel, uploads+"/") }

// listFiles: file biasa di dalam root (path relatif, garis miring /), tanpa folder upload.
func listFiles(root string) (map[string]string, error) {
	out := map[string]string{}
	err := filepath.WalkDir(root, func(abs string, d fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) && abs == root {
				return filepath.SkipDir
			}
			return err
		}
		rel, _ := filepath.Rel(root, abs)
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}
		if skipUploads(rel) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Type().IsRegular() {
			out[rel] = abs
		}
		return nil
	})
	return out, err
}

// diffTrees: file dev yang berbeda dari prod (tanpa folder upload).
func diffTrees(dev, prod string) ([]FileChange, error) {
	a, err := listFiles(dev)
	if err != nil {
		return nil, err
	}
	b, err := listFiles(prod)
	if err != nil {
		return nil, err
	}
	out := []FileChange{}
	for rel, abs := range a {
		other, ok := b[rel]
		switch {
		case !ok:
			out = append(out, FileChange{rel, "added"})
		default:
			same, err := sameFile(abs, other)
			if err != nil {
				return nil, err
			}
			if !same {
				out = append(out, FileChange{rel, "changed"})
			}
		}
	}
	for rel := range b {
		if _, ok := a[rel]; !ok {
			out = append(out, FileChange{rel, "removed"})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

func sameFile(a, b string) (bool, error) {
	ia, err := os.Stat(a)
	if err != nil {
		return false, err
	}
	ib, err := os.Stat(b)
	if err != nil {
		return false, err
	}
	if ia.Size() != ib.Size() {
		return false, nil
	}
	x, err := os.ReadFile(a)
	if err != nil {
		return false, err
	}
	y, err := os.ReadFile(b)
	return bytes.Equal(x, y), err
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// replaceTree mengganti isi dst dengan salinan src. keepUploads: folder upload milik dst dipertahankan
// (publikasi); tanpanya folder upload src ikut disalin (awal mode manual: prod = keadaan sekarang).
// Dibangun di folder sementara lalu ditukar, supaya pengunjung tidak melihat website setengah jadi.
func replaceTree(src, dst string, keepUploads bool) error {
	parent := filepath.Dir(dst)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return err
	}
	tmp, err := os.MkdirTemp(parent, "."+filepath.Base(dst)+"-new-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	err = filepath.WalkDir(src, func(abs string, d fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) && abs == src {
				return filepath.SkipDir
			}
			return err
		}
		rel, _ := filepath.Rel(src, abs)
		if rel == "." {
			return nil
		}
		if keepUploads && skipUploads(filepath.ToSlash(rel)) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		switch {
		case d.IsDir():
			return os.MkdirAll(filepath.Join(tmp, rel), 0o755)
		case d.Type().IsRegular():
			return copyFile(abs, filepath.Join(tmp, rel))
		}
		return nil // symlink & lainnya tidak pernah disalin
	})
	if err != nil {
		return err
	}
	if keepUploads {
		if err := moveUploads(dst, tmp); err != nil {
			return err
		}
	}
	old := tmp + "-old"
	if err := os.Rename(dst, old); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := os.Rename(tmp, dst); err != nil {
		os.Rename(old, dst) // kembalikan versi lama
		return err
	}
	return os.RemoveAll(old)
}

// moveUploads memindahkan folder upload from -> to (menggantikan folder upload to).
func moveUploads(from, to string) error {
	src := filepath.Join(from, uploads)
	if _, err := os.Stat(src); errors.Is(err, fs.ErrNotExist) {
		return os.RemoveAll(filepath.Join(to, uploads))
	}
	if err := os.RemoveAll(filepath.Join(to, uploads)); err != nil {
		return err
	}
	if err := os.MkdirAll(to, 0o755); err != nil {
		return err
	}
	return os.Rename(src, filepath.Join(to, uploads))
}

// ---------- Ringkasan perubahan struktur ----------

type simTable struct {
	inProd bool
	cols   map[string]bool // kolom -> sudah ada di versi publik
}

func name(v any) string { return strings.ToLower(strings.TrimSpace(jsconv.String(v))) }

// describe: perubahan struktur yang belum dipublikasikan, dalam kalimat. Ditandai Destructive bila
// menghapus tabel/kolom yang ada (dan berisi data) di versi publik.
func describe(ops []userdb.Op, prod map[string][]string) []SchemaChange {
	sim := map[string]*simTable{}
	for t, cols := range prod {
		st := &simTable{inProd: true, cols: map[string]bool{}}
		for _, c := range cols {
			st.cols[c] = true
		}
		sim[t] = st
	}
	out := []SchemaChange{}
	add := func(destructive bool, format string, args ...any) {
		out = append(out, SchemaChange{fmt.Sprintf(format, args...), destructive})
	}
	for _, op := range ops {
		t := sim[op.Table]
		if t == nil {
			t = &simTable{cols: map[string]bool{}}
		}
		switch op.Kind {
		case "create":
			var cols []string
			list, _ := op.Input["columns"].([]any)
			for _, c := range list {
				m, _ := c.(map[string]any)
				cols = append(cols, name(m["name"]))
				t.cols[name(m["name"])] = false
			}
			sim[op.Table] = &simTable{cols: t.cols}
			if len(cols) > 0 {
				add(false, "Tabel baru %s (kolom %s)", op.Table, strings.Join(cols, ", "))
			} else {
				add(false, "Tabel baru %s", op.Table)
			}
		case "delete":
			if t.inProd {
				add(true, "Hapus tabel %s beserta semua datanya", op.Table)
			} else {
				add(false, "Hapus tabel %s", op.Table)
			}
			delete(sim, op.Table)
		case "update":
			list, _ := op.Input["addColumns"].([]any)
			for _, c := range list {
				m, _ := c.(map[string]any)
				t.cols[name(m["name"])] = false
				add(false, "Kolom baru %s.%s", op.Table, name(m["name"]))
			}
			drops, _ := op.Input["dropColumns"].([]any)
			for _, c := range drops {
				col := name(c)
				if t.inProd && t.cols[col] {
					add(true, "Hapus kolom %s.%s beserta datanya", op.Table, col)
				} else {
					add(false, "Hapus kolom %s.%s", op.Table, col)
				}
				delete(t.cols, col)
			}
			renames, _ := op.Input["renameColumns"].([]any)
			for _, r := range renames {
				m, _ := r.(map[string]any)
				from, to := name(m["from"]), name(m["to"])
				if from == to {
					continue
				}
				t.cols[to] = t.cols[from]
				delete(t.cols, from)
				add(false, "Ganti nama kolom %s.%s → %s", op.Table, from, to)
			}
			if flags, _ := op.Input["columnFlags"].(map[string]any); len(flags) > 0 {
				cols := make([]string, 0, len(flags))
				for c := range flags {
					cols = append(cols, c)
				}
				sort.Strings(cols)
				add(false, "Ubah pengaturan kolom %s: %s", op.Table, strings.Join(cols, ", "))
			}
			if rules, ok := op.Input["rules"]; ok && rules != nil && rules != false {
				add(false, "Ubah aturan akses tabel %s", op.Table)
			}
			if rawTo, ok := op.Input["rename"]; ok {
				if to := name(rawTo); to != "" && to != op.Table {
					delete(sim, op.Table)
					sim[to] = t
					add(false, "Ganti nama tabel %s → %s", op.Table, to)
					continue
				}
			}
			sim[op.Table] = t
		}
	}
	return out
}

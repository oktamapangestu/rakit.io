// Package versions: riwayat versi project. Setiap versi = daftar file (path -> hash isi). Isi file
// disimpan sekali per hash di data/versions/<slug>/<2 huruf>/<hash>, jadi file yang tidak berubah
// tidak memakan tempat lagi. Database project tidak ikut (isinya bisa berupa kiriman pengunjung yang
// tidak boleh hilang saat restore). Padanan src/versions.js; format manifest sama, karena server Node
// masih membuat versi 'ai' sebelum perubahan AI diterapkan.
//
// Versi dibuat:
//   - 'edit'    otomatis sebelum user mengedit, maks. sekali per autoInterval (atau setelah AI/restore)
//   - 'ai'      otomatis sebelum perubahan AI diterapkan
//   - 'manual'  lewat tombol "Simpan versi"
//   - 'restore' otomatis sebelum mengembalikan versi, supaya restore bisa dibatalkan
package versions

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"rakit.icu/server/internal/config"
	"rakit.icu/server/internal/files"
	"rakit.icu/server/internal/httpx"
	"rakit.icu/server/internal/jsconv"
	"rakit.icu/server/internal/plans"
	"rakit.icu/server/internal/store"
)

const (
	autoInterval = 10 * time.Minute
	labelMax     = 80
	dayMs        = 24 * 60 * 60 * 1000
)

// FileEntry: h = hash isi (sha256), s = ukuran, m = waktu ubah (ms) saat dipotret.
type FileEntry struct {
	H string  `json:"h"`
	S int64   `json:"s"`
	M float64 `json:"m"`
}

type Manifest struct {
	Files map[string]FileEntry `json:"files"`
	Dirs  []string             `json:"dirs"`
}

type Service struct {
	cfg   *config.Config
	db    *store.Store
	plans *plans.Plans

	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func New(cfg *config.Config, db *store.Store, p *plans.Plans) *Service {
	return &Service{cfg: cfg, db: db, plans: p, locks: map[string]*sync.Mutex{}}
}

func (s *Service) root(slug string) string { return filepath.Join(s.cfg.DataDir, "versions", slug) }
func (s *Service) blobPath(slug, hash string) string {
	return filepath.Join(s.root(slug), hash[:2], hash)
}

// Satu operasi riwayat per project pada satu waktu (snapshot, restore), supaya tidak tumpang tindih.
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

func parseManifest(v *store.Version) (*Manifest, error) {
	m := &Manifest{}
	if err := json.Unmarshal([]byte(v.Manifest), m); err != nil {
		return nil, err
	}
	if m.Files == nil {
		m.Files = map[string]FileEntry{}
	}
	return m, nil
}

// ---------- Snapshot ----------

// snapshot memotret kondisi project sekarang. Isi file baru disalin ke penyimpanan versi.
func (s *Service) snapshot(slug string, previous *Manifest) (*Manifest, error) {
	root := s.cfg.SiteRoot(slug)
	entries, err := files.ListTree(root)
	if err != nil {
		return nil, err
	}
	m := &Manifest{Files: map[string]FileEntry{}, Dirs: []string{}}
	for _, entry := range entries {
		if entry.Dir {
			m.Dirs = append(m.Dirs, entry.Path)
			continue
		}
		if files.ContentType(entry.Path) == "" {
			continue
		}
		abs, err := files.ResolveIn(root, entry.Path)
		if err != nil {
			return nil, err
		}
		info, err := files.LstatOrNil(abs)
		if err != nil {
			return nil, err
		}
		if info == nil || !info.Mode().IsRegular() {
			continue
		}
		mtime := float64(info.ModTime().UnixNano()) / 1e6
		// Ukuran & waktu ubah sama dengan versi sebelumnya: pakai hash lama tanpa membaca ulang file.
		if previous != nil {
			if prev, ok := previous.Files[entry.Path]; ok && prev.S == info.Size() && prev.M == mtime {
				m.Files[entry.Path] = prev
				continue
			}
		}
		buf, err := os.ReadFile(abs)
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(buf)
		hash := hex.EncodeToString(sum[:])
		target := s.blobPath(slug, hash)
		if _, err := os.Lstat(target); err != nil {
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return nil, err
			}
			if err := os.WriteFile(target, buf, 0o644); err != nil {
				return nil, err
			}
		}
		m.Files[entry.Path] = FileEntry{H: hash, S: int64(len(buf)), M: mtime}
	}
	return m, nil
}

func sameContent(a, b *Manifest) bool {
	if len(a.Files) != len(b.Files) {
		return false
	}
	for p, f := range a.Files {
		if other, ok := b.Files[p]; !ok || other.H != f.H {
			return false
		}
	}
	return true
}

func (s *Service) latest(project *store.Project) (*store.Version, *Manifest, error) {
	v, err := s.db.LatestVersion(project.ID)
	if err != nil || v == nil {
		return nil, nil, err
	}
	m, err := parseManifest(v)
	return v, m, err
}

var spacesRE = regexp.MustCompile(`\s+`)

// create membuat versi baru; mengembalikan 0 bila tidak ada yang berubah sejak versi terakhir
// (kecuali force, untuk simpan manual). Pemanggil sudah memegang kunci project.
func (s *Service) create(project *store.Project, userID int64, kind, label string, force bool) (int64, error) {
	_, latest, err := s.latest(project)
	if err != nil {
		return 0, err
	}
	manifest, err := s.snapshot(project.Slug, latest)
	if err != nil {
		return 0, err
	}
	if !force && latest != nil && sameContent(manifest, latest) {
		return 0, nil
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		return 0, err
	}
	clean := jsconv.Slice(strings.TrimSpace(spacesRE.ReplaceAllString(label, " ")), labelMax)
	id, err := s.db.InsertVersion(project.ID, userID, kind, clean, string(raw), len(manifest.Files))
	if err != nil {
		return 0, err
	}
	return id, s.prune(project)
}

// prune menghapus versi di luar batas paket (umur & jumlah), lalu isi file yang tidak dipakai versi mana pun.
func (s *Service) prune(project *store.Project) error {
	history := s.plans.HistoryFor(project.UserID)
	removed, err := s.db.PruneVersions(project.ID, time.Now().UnixMilli()-int64(history.Days)*dayMs, history.Max)
	if err != nil || removed == 0 {
		return err
	}
	all, err := s.db.Versions(project.ID)
	if err != nil {
		return err
	}
	used := map[string]bool{}
	for _, v := range all {
		m, err := parseManifest(v)
		if err != nil {
			return err
		}
		for _, f := range m.Files {
			used[f.H] = true
		}
	}
	prefixes, _ := os.ReadDir(s.root(project.Slug))
	for _, prefix := range prefixes {
		dir := filepath.Join(s.root(project.Slug), prefix.Name())
		blobs, _ := os.ReadDir(dir)
		for _, blob := range blobs {
			if !used[blob.Name()] {
				os.Remove(filepath.Join(dir, blob.Name()))
			}
		}
	}
	return nil
}

// AutoBeforeEdit menyimpan versi otomatis sebelum user mengedit. Paling sering sekali per 10 menit,
// kecuali versi terakhir dibuat oleh AI/restore (kondisi hasil AI/restore perlu ikut tersimpan
// sebelum diedit lagi). Tidak pernah menggagalkan simpan.
func (s *Service) AutoBeforeEdit(project *store.Project, userID int64) {
	latest, err := s.db.LatestVersion(project.ID)
	if err == nil && latest != nil && (latest.Kind == "edit" || latest.Kind == "manual") &&
		time.Now().UnixMilli()-latest.CreatedAt < autoInterval.Milliseconds() {
		return
	}
	if err == nil {
		unlock := s.lock(project.Slug)
		_, err = s.create(project, userID, "edit", "", false)
		unlock()
	}
	if err != nil {
		log.Printf("Versi otomatis %s gagal: %v", project.Slug, err)
	}
}

// CreateManual: tombol "Simpan versi" — selalu dibuat.
func (s *Service) CreateManual(project *store.Project, userID int64, label string) (int64, error) {
	defer s.lock(project.Slug)()
	return s.create(project, userID, "manual", label, true)
}

// Remove menghapus seluruh riwayat project (baris versi ikut terhapus lewat CASCADE).
func (s *Service) Remove(slug string) error { return os.RemoveAll(s.root(slug)) }

// ---------- Daftar & perbandingan ----------

type Summary struct {
	ID        int64  `json:"id"`
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	FileCount int64  `json:"fileCount"`
	CreatedAt int64  `json:"createdAt"`
}

func (s *Service) List(project *store.Project) ([]Summary, plans.History, error) {
	all, err := s.db.Versions(project.ID)
	out := make([]Summary, 0, len(all))
	for _, v := range all {
		out = append(out, Summary{ID: v.ID, Kind: v.Kind, Label: v.Label, FileCount: v.FileCount, CreatedAt: v.CreatedAt})
	}
	return out, s.plans.HistoryFor(project.UserID), err
}

// Get mengambil versi milik project; id berupa teks dari URL.
func (s *Service) Get(project *store.Project, id string) (*store.Version, *Manifest, error) {
	notFound := httpx.Errorf(404, "Versi tidak ditemukan. Mungkin sudah terhapus karena melewati batas riwayat.")
	n := jsconv.Number(id)
	if !jsconv.IsInteger(n) || n < 1 || n > jsconv.MaxSafeInteger || strings.TrimSpace(id) == "" {
		return nil, nil, notFound
	}
	v, err := s.db.VersionByID(int64(n), project.ID)
	if err != nil {
		return nil, nil, err
	}
	if v == nil {
		return nil, nil, notFound
	}
	m, err := parseManifest(v)
	return v, m, err
}

type FileStatus struct {
	Path   string `json:"path"`
	Status string `json:"status"` // missing | new | same | changed
	Size   int64  `json:"size"`
	Image  bool   `json:"image"`
}

// Compare: status tiap file versi dibanding kondisi sekarang.
func (s *Service) Compare(project *store.Project, target *Manifest) ([]FileStatus, error) {
	defer s.lock(project.Slug)()
	now, err := s.snapshot(project.Slug, target)
	if err != nil {
		return nil, err
	}
	paths := map[string]bool{}
	for p := range target.Files {
		paths[p] = true
	}
	for p := range now.Files {
		paths[p] = true
	}
	sorted := make([]string, 0, len(paths))
	for p := range paths {
		sorted = append(sorted, p)
	}
	sort.Strings(sorted)
	out := make([]FileStatus, 0, len(sorted))
	for _, p := range sorted {
		then, inVersion := target.Files[p]
		current, exists := now.Files[p]
		st := FileStatus{Path: p, Size: then.S, Image: files.IsImageFile(p)}
		switch {
		case !exists:
			st.Status = "missing" // ada di versi ini, sekarang sudah tidak ada
		case !inVersion:
			st.Status, st.Size = "new", current.S // dibuat setelah versi ini
		case then.H == current.H:
			st.Status = "same"
		default:
			st.Status = "changed"
		}
		out = append(out, st)
	}
	return out, nil
}

// Blob membaca isi satu file di sebuah versi.
func (s *Service) Blob(slug string, entry FileEntry) ([]byte, error) {
	buf, err := os.ReadFile(s.blobPath(slug, entry.H))
	if err != nil {
		return nil, httpx.Errorf(410, "Isi file di versi ini sudah tidak tersedia")
	}
	return buf, nil
}

// ---------- Restore ----------

var months = []string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}

// describe: "versi 1 Okt, 21.05" (WIB).
func describe(v *store.Version) string {
	t := time.UnixMilli(v.CreatedAt).UTC().Add(7 * time.Hour)
	return fmt.Sprintf("versi %d %s, %02d.%02d", t.Day(), months[t.Month()-1], t.Hour(), t.Minute())
}

func writeFile(root, rel string, buf []byte) error {
	clean, err := files.CleanPath(rel)
	if err != nil {
		return err
	}
	abs, err := files.ResolveIn(root, clean)
	if err != nil {
		return err
	}
	// Ada folder dengan nama sama: singkirkan dulu.
	if info, _ := files.LstatOrNil(abs); info != nil && !info.Mode().IsRegular() {
		if err := os.RemoveAll(abs); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	return os.WriteFile(abs, buf, 0o644)
}

func mb(n int64) string { return fmt.Sprintf("%g", float64(n)/1024/1024) }

// Restore mengembalikan seluruh project (atau satu file, bila onlyPath diisi) ke isi versi.
// Mengembalikan path yang berubah.
func (s *Service) Restore(project *store.Project, userID int64, version *store.Version, target *Manifest, onlyPath string) ([]string, error) {
	defer s.lock(project.Slug)()
	root := s.cfg.SiteRoot(project.Slug)
	limits := s.plans.StorageFor(project.Slug)

	if onlyPath != "" {
		if _, inVersion := target.Files[onlyPath]; !inVersion {
			abs, err := files.ResolveIn(root, onlyPath)
			if err != nil {
				return nil, err
			}
			if info, _ := files.LstatOrNil(abs); info == nil {
				return nil, httpx.Errorf(404, "File tidak ditemukan di versi ini")
			}
		}
	} else {
		// Pastikan hasil restore muat di kuota paket sekarang.
		var total int64
		for _, f := range target.Files {
			total += f.S
		}
		if count := int64(len(target.Files) + len(target.Dirs)); total > limits.TotalSize || count > limits.Entries {
			return nil, httpx.Errorf(413, "Versi ini terlalu besar untuk kuota paketmu sekarang (%s MB, %d file & folder).", mb(limits.TotalSize), limits.Entries)
		}
	}

	// Kondisi sekarang disimpan dulu, supaya restore bisa dibatalkan.
	if _, err := s.create(project, userID, "restore", "Sebelum dikembalikan ke "+describe(version), false); err != nil {
		return nil, err
	}
	_, latest, err := s.latest(project)
	if err != nil {
		return nil, err
	}
	now, err := s.snapshot(project.Slug, latest)
	if err != nil {
		return nil, err
	}

	paths := []string{onlyPath}
	if onlyPath == "" {
		seen := map[string]bool{}
		paths = paths[:0]
		for p := range target.Files {
			seen[p] = true
			paths = append(paths, p)
		}
		for p := range now.Files {
			if !seen[p] {
				paths = append(paths, p)
			}
		}
		sort.Strings(paths)
	}
	touched := []string{}
	for _, p := range paths {
		then, inVersion := target.Files[p]
		current, exists := now.Files[p]
		if inVersion && exists && current.H == then.H {
			continue
		}
		if !inVersion {
			abs, err := files.ResolveIn(root, p)
			if err != nil {
				return nil, err
			}
			if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
				return nil, err
			}
		} else {
			if onlyPath != "" {
				var used int64
				for _, f := range now.Files {
					used += f.S
				}
				if used-current.S+then.S > limits.TotalSize {
					return nil, httpx.Errorf(413, "Kuota penyimpanan %s MB penuh", mb(limits.TotalSize))
				}
			}
			buf, err := s.Blob(project.Slug, then)
			if err != nil {
				return nil, err
			}
			if err := writeFile(root, p, buf); err != nil {
				return nil, err
			}
		}
		touched = append(touched, p)
	}

	if onlyPath == "" {
		keep := map[string]bool{}
		for _, dir := range target.Dirs {
			keep[dir] = true
			abs, err := files.ResolveIn(root, dir)
			if err != nil {
				return nil, err
			}
			if err := os.MkdirAll(abs, 0o755); err != nil {
				return nil, err
			}
		}
		// Folder yang tidak ada di versi dan kini kosong ikut dihapus (terdalam dulu).
		entries, err := files.ListTree(root)
		if err != nil {
			return nil, err
		}
		var extra []string
		for _, e := range entries {
			if e.Dir && !keep[e.Path] {
				extra = append(extra, e.Path)
			}
		}
		sort.Slice(extra, func(i, j int) bool { return len(extra[i]) > len(extra[j]) })
		for _, dir := range extra {
			if abs, err := files.ResolveIn(root, dir); err == nil {
				os.Remove(abs) // hanya berhasil bila kosong
			}
		}
	}
	return touched, nil
}

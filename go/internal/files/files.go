// Package files: aturan path dan penyimpanan file website project (data/sites/<slug>).
// Padanan src/files.js.
package files

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/plans"
)

const maxDepth = 8

// Tidak boleh diawali titik: menolak ".", "..", dan dotfile.
var segmentRE = regexp.MustCompile(`^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$`)

// ImageTypes: gambar yang boleh diunggah & disajikan.
var ImageTypes = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".svg":  "image/svg+xml",
	".ico":  "image/x-icon",
	".avif": "image/avif",
}

// TextTypes: file teks yang bisa diedit di editor & ditulis AI.
var TextTypes = map[string]string{
	".html": "text/html; charset=utf-8",
	".css":  "text/css; charset=utf-8",
	".js":   "text/javascript; charset=utf-8",
}

func Ext(rel string) string { return strings.ToLower(path.Ext(rel)) }

// ContentType mengembalikan Content-Type untuk file yang boleh disajikan, atau "".
func ContentType(rel string) string {
	ext := Ext(rel)
	if t, ok := TextTypes[ext]; ok {
		return t
	}
	return ImageTypes[ext]
}

// CleanPath memvalidasi path relatif dan mengembalikannya dengan pemisah "/".
func CleanPath(input string) (string, error) {
	var parts []string
	for _, p := range strings.Split(strings.ReplaceAll(input, `\`, "/"), "/") {
		if p != "" {
			parts = append(parts, p)
		}
	}
	if len(parts) == 0 {
		return "", httpx.Errorf(400, "Path wajib diisi")
	}
	if len(parts) > maxDepth {
		return "", httpx.Errorf(400, "Kedalaman folder maksimal %d level", maxDepth)
	}
	for _, p := range parts {
		if !segmentRE.MatchString(p) {
			return "", httpx.Errorf(400, `Nama "%s" tidak valid. Gunakan huruf, angka, titik, - atau _`, p)
		}
	}
	return strings.Join(parts, "/"), nil
}

// ResolveIn mengubah path relatif menjadi path absolut yang pasti berada di dalam root.
func ResolveIn(root, rel string) (string, error) {
	abs := filepath.Join(root, filepath.FromSlash(rel))
	if !strings.HasPrefix(abs, root+string(filepath.Separator)) {
		return "", httpx.Errorf(400, "Path tidak valid")
	}
	return abs, nil
}

func lstatOrNil(abs string) (os.FileInfo, error) {
	info, err := os.Lstat(abs)
	if err != nil {
		// ENOENT / ENOTDIR: dianggap tidak ada.
		if os.IsNotExist(err) || strings.Contains(err.Error(), "not a directory") {
			return nil, nil
		}
		return nil, err
	}
	return info, nil
}

// Entry: satu file/folder di dalam project.
type Entry struct {
	Path string
	Dir  bool
	Size int64
}

// ListTree mengembalikan semua file & folder project (nama yang tidak valid dilewati).
func ListTree(root string) ([]Entry, error) {
	// os.Root: folder symlink tidak pernah diikuti ke luar root (salinan kerja mode Agen bisa berisi symlink).
	r, err := os.OpenRoot(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer r.Close()
	fsys := r.FS()
	var out []Entry
	var walk func(dir, prefix string) error
	walk = func(dir, prefix string) error {
		items, err := fs.ReadDir(fsys, dir)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
		for _, item := range items {
			if !segmentRE.MatchString(item.Name()) {
				continue
			}
			rel := item.Name()
			if prefix != "" {
				rel = prefix + "/" + rel
			}
			switch {
			case item.IsDir():
				out = append(out, Entry{Path: rel, Dir: true})
				if err := walk(rel, rel); err != nil {
					return err
				}
			case item.Type().IsRegular():
				info, err := item.Info()
				if err != nil {
					return err
				}
				out = append(out, Entry{Path: rel, Size: info.Size()})
			}
		}
		return nil
	}
	return out, walk(".", "")
}

// OpenRegular membuka file biasa rel (path bersih, pemisah "/") di dalam root tanpa pernah keluar dari root:
// symlink di ujung path ditolak dan folder symlink yang menunjuk ke luar root gagal dibuka (os.Root), juga bila
// file ditukar di tengah jalan. Dipakai untuk folder yang isinya bisa dibuat pihak lain (salinan kerja mode Agen).
// File yang tidak ada / bukan file biasa: error fs.ErrNotExist.
func OpenRegular(root, rel string) (*os.File, os.FileInfo, error) {
	r, err := os.OpenRoot(root)
	if err != nil {
		return nil, nil, err
	}
	defer r.Close()
	if info, err := r.Lstat(rel); err != nil || !info.Mode().IsRegular() {
		return nil, nil, fs.ErrNotExist
	}
	f, err := r.Open(rel)
	if err != nil {
		return nil, nil, fs.ErrNotExist
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		return nil, nil, fs.ErrNotExist
	}
	return f, info, nil
}

// ReadRegular: isi file biasa rel di dalam root (lihat OpenRegular). maxBytes > 0: file yang lebih besar ditolak
// dengan ErrTooLarge.
func ReadRegular(root, rel string, maxBytes int64) ([]byte, error) {
	f, info, err := OpenRegular(root, rel)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if maxBytes > 0 && info.Size() > maxBytes {
		return nil, ErrTooLarge
	}
	return io.ReadAll(f)
}

// ErrTooLarge: file melewati batas ReadRegular.
var ErrTooLarge = errors.New("file terlalu besar")

// IsDirIn: apakah rel folder (bukan symlink) di dalam root.
func IsDirIn(root, rel string) bool {
	r, err := os.OpenRoot(root)
	if err != nil {
		return false
	}
	defer r.Close()
	info, err := r.Lstat(rel)
	return err == nil && info.IsDir()
}

func mb(n int64) string { return fmt.Sprintf("%g", float64(n)/1024/1024) }

// checkQuota memastikan menambah `rel` (addBytes byte) tidak melampaui kuota paket pemilik.
func checkQuota(root, rel string, limits plans.Storage, addBytes, removeBytes int64) error {
	entries, err := ListTree(root)
	if err != nil {
		return err
	}
	existing := make(map[string]bool, len(entries))
	var size int64
	for _, e := range entries {
		existing[e.Path] = true
		size += e.Size
	}
	added := 0
	parts := strings.Split(rel, "/")
	for i := 1; i <= len(parts); i++ {
		if !existing[strings.Join(parts[:i], "/")] {
			added++
		}
	}
	if added > 0 && int64(len(entries)+added) > limits.Entries {
		return httpx.Errorf(413, "Maksimal %d file & folder", limits.Entries)
	}
	// Mengecilkan file tetap boleh walau kuota terlampaui (mis. setelah langganan berakhir).
	if addBytes > removeBytes && size-removeBytes+addBytes > limits.TotalSize {
		return httpx.Errorf(413, "Kuota penyimpanan %s MB penuh", mb(limits.TotalSize))
	}
	return nil
}

// Pastikan semua folder induk ada & bukan file.
func ensureParents(root, rel string) error {
	parts := strings.Split(rel, "/")
	parts = parts[:len(parts)-1]
	for i := 1; i <= len(parts); i++ {
		prefix := strings.Join(parts[:i], "/")
		abs, err := ResolveIn(root, prefix)
		if err != nil {
			return err
		}
		info, err := lstatOrNil(abs)
		if err != nil {
			return err
		}
		if info != nil && !info.IsDir() {
			return httpx.Errorf(409, `"%s" adalah file`, prefix)
		}
	}
	if len(parts) == 0 {
		return nil
	}
	abs, err := ResolveIn(root, strings.Join(parts, "/"))
	if err != nil {
		return err
	}
	return os.MkdirAll(abs, 0o755)
}

var svgRE = regexp.MustCompile(`(?is)^\s*(<\?xml[^>]*>\s*)?(<!--.*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]`)

// Cocokkan isi file dengan ekstensinya, supaya yang diunggah benar-benar gambar.
func looksLikeImage(ext string, buf []byte) bool {
	at := func(a, b int) string {
		if len(buf) < b {
			return ""
		}
		return string(buf[a:b])
	}
	switch ext {
	case ".png":
		return len(buf) > 8 && at(0, 4) == "\x89PNG"
	case ".jpg", ".jpeg":
		return len(buf) > 3 && at(0, 3) == "\xff\xd8\xff"
	case ".gif":
		return at(0, 4) == "GIF8"
	case ".webp":
		return at(0, 4) == "RIFF" && at(8, 12) == "WEBP"
	case ".ico":
		return len(buf) > 4 && at(0, 4) == "\x00\x00\x01\x00"
	case ".avif":
		return at(4, 8) == "ftyp" && (at(8, 12) == "avif" || at(8, 12) == "avis")
	case ".svg":
		head := buf
		if len(head) > 4096 {
			head = head[:4096]
		}
		return svgRE.Match(bytes.TrimPrefix(head, []byte("\xef\xbb\xbf")))
	}
	return false
}

// MaxImageBytes: batas upload satu gambar (bawaan server; per project mengikuti paket).
const MaxImageBytes = 10 * 1024 * 1024

// MaxFileSize: batas satu file teks.
const MaxFileSize = 512 * 1024

// Limits: batas untuk satu project, dalam bentuk yang dikirim ke editor.
type Limits struct {
	FileSize  int64 `json:"fileSize"`
	TotalSize int64 `json:"totalSize"`
	Entries   int64 `json:"entries"`
	ImageSize int64 `json:"imageSize"`
	Depth     int   `json:"depth"`
}

func LimitsOf(s plans.Storage) Limits {
	return Limits{FileSize: MaxFileSize, TotalSize: s.TotalSize, Entries: s.Entries, ImageSize: s.ImageSize, Depth: maxDepth}
}

// IsTextFile / IsImageFile: jenis file dari ekstensinya.
func IsTextFile(rel string) bool  { _, ok := TextTypes[Ext(rel)]; return ok }
func IsImageFile(rel string) bool { _, ok := ImageTypes[Ext(rel)]; return ok }

const imageExtList = ".png, .jpg, .jpeg, .gif, .webp, .svg, .ico, .avif"

var errNotText = httpx.Errorf(400, "Hanya file .html, .css, dan .js yang diizinkan")

// LstatOrNil: info file/folder, atau nil bila tidak ada.
func LstatOrNil(abs string) (os.FileInfo, error) { return lstatOrNil(abs) }

// ReadText membaca isi file teks project.
func ReadText(root, input string) (string, error) {
	rel, err := CleanPath(input)
	if err != nil {
		return "", err
	}
	if !IsTextFile(rel) {
		return "", errNotText
	}
	abs, err := ResolveIn(root, rel)
	if err != nil {
		return "", err
	}
	info, err := lstatOrNil(abs)
	if err != nil {
		return "", err
	}
	if info == nil || !info.Mode().IsRegular() {
		return "", httpx.Errorf(404, "File tidak ditemukan")
	}
	data, err := os.ReadFile(abs)
	return strings.ToValidUTF8(string(data), "\uFFFD"), err
}

// WriteText menyimpan file teks. content nil = bukan teks. create: buat file baru (gagal bila sudah ada);
// tanpa create: file harus sudah ada.
func WriteText(root, input string, content *string, create bool, limits plans.Storage) (string, error) {
	rel, err := CleanPath(input)
	if err != nil {
		return "", err
	}
	if !IsTextFile(rel) {
		return "", errNotText
	}
	if content == nil {
		return "", httpx.Errorf(400, "Konten harus berupa teks")
	}
	size := int64(len(*content))
	if size > MaxFileSize {
		return "", httpx.Errorf(413, "Ukuran file maksimal %d KB", MaxFileSize/1024)
	}
	abs, err := ResolveIn(root, rel)
	if err != nil {
		return "", err
	}
	info, err := lstatOrNil(abs)
	if err != nil {
		return "", err
	}
	switch {
	case info != nil && !info.Mode().IsRegular():
		return "", httpx.Errorf(409, "Sudah ada folder dengan nama itu")
	case info != nil && create:
		return "", httpx.Errorf(409, "File sudah ada")
	case info == nil && !create:
		return "", httpx.Errorf(404, "File tidak ditemukan")
	}
	var old int64
	if info != nil {
		old = info.Size()
	}
	if err := checkQuota(root, rel, limits, size, old); err != nil {
		return "", err
	}
	if err := ensureParents(root, rel); err != nil {
		return "", err
	}
	return rel, os.WriteFile(abs, []byte(*content), 0o644)
}

func CreateDir(root, input string, limits plans.Storage) (string, error) {
	rel, err := CleanPath(input)
	if err != nil {
		return "", err
	}
	abs, err := ResolveIn(root, rel)
	if err != nil {
		return "", err
	}
	if info, err := lstatOrNil(abs); err != nil {
		return "", err
	} else if info != nil {
		return "", httpx.Errorf(409, "Sudah ada file/folder dengan nama itu")
	}
	if err := checkQuota(root, rel, limits, 0, 0); err != nil {
		return "", err
	}
	if err := ensureParents(root, rel); err != nil {
		return "", err
	}
	return rel, os.Mkdir(abs, 0o755)
}

func RenameEntry(root, fromInput, toInput string) (string, error) {
	from, err := CleanPath(fromInput)
	if err != nil {
		return "", err
	}
	to, err := CleanPath(toInput)
	if err != nil {
		return "", err
	}
	if from == to {
		return to, nil
	}
	fromAbs, err := ResolveIn(root, from)
	if err != nil {
		return "", err
	}
	toAbs, err := ResolveIn(root, to)
	if err != nil {
		return "", err
	}
	info, err := lstatOrNil(fromAbs)
	if err != nil {
		return "", err
	}
	if info == nil {
		return "", httpx.Errorf(404, "File/folder tidak ditemukan")
	}
	// Jenis file tidak boleh berubah lewat rename (gambar tetap gambar, teks tetap teks).
	if info.Mode().IsRegular() && IsImageFile(from) {
		if !IsImageFile(to) {
			return "", httpx.Errorf(400, "Gambar harus berakhiran %s", imageExtList)
		}
	} else if info.Mode().IsRegular() && !IsTextFile(to) {
		return "", errNotText
	}
	if strings.HasPrefix(to, from+"/") {
		return "", httpx.Errorf(400, "Tidak bisa memindahkan folder ke dalam dirinya sendiri")
	}
	if existing, err := lstatOrNil(toAbs); err != nil {
		return "", err
	} else if existing != nil {
		return "", httpx.Errorf(409, "Sudah ada file/folder dengan nama itu")
	}
	if err := ensureParents(root, to); err != nil {
		return "", err
	}
	return to, os.Rename(fromAbs, toAbs)
}

func RemoveEntry(root, input string) error {
	rel, err := CleanPath(input)
	if err != nil {
		return err
	}
	abs, err := ResolveIn(root, rel)
	if err != nil {
		return err
	}
	if info, err := lstatOrNil(abs); err != nil {
		return err
	} else if info == nil {
		return httpx.Errorf(404, "File/folder tidak ditemukan")
	}
	return os.RemoveAll(abs)
}

// SeedTemplate mengisi project baru dengan file awal. File yang sudah ada tidak pernah ditimpa.
func SeedTemplate(root, templateDir, slug, host string) error {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	items, err := os.ReadDir(templateDir)
	if err != nil {
		return err
	}
	fill := strings.NewReplacer("{{username}}", slug, "{{host}}", host)
	for _, item := range items {
		text, err := os.ReadFile(filepath.Join(templateDir, item.Name()))
		if err != nil {
			return err
		}
		f, err := os.OpenFile(filepath.Join(root, item.Name()), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err != nil {
			if os.IsExist(err) {
				continue
			}
			return err
		}
		_, err = f.WriteString(fill.Replace(string(text)))
		if closeErr := f.Close(); err == nil {
			err = closeErr
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// WriteImage menyimpan gambar yang diunggah di `input` (relatif ke root). Tanpa overwrite, file yang
// sudah ada ditolak (409).
func WriteImage(root, input string, buf []byte, overwrite bool, limits plans.Storage) (string, error) {
	rel, err := CleanPath(input)
	if err != nil {
		return "", err
	}
	ext := Ext(rel)
	if _, ok := ImageTypes[ext]; !ok {
		return "", httpx.Errorf(400, "Format gambar tidak didukung. Pakai %s", imageExtList)
	}
	if len(buf) == 0 {
		return "", httpx.Errorf(400, "File gambar kosong")
	}
	if int64(len(buf)) > limits.ImageSize {
		return "", httpx.Errorf(413, "Ukuran gambar maksimal %s MB per file di paketmu", mb(limits.ImageSize))
	}
	if !looksLikeImage(ext, buf) {
		return "", httpx.Errorf(400, "Isi file bukan gambar %s yang valid", strings.ToUpper(ext[1:]))
	}
	abs, err := ResolveIn(root, rel)
	if err != nil {
		return "", err
	}
	info, err := lstatOrNil(abs)
	if err != nil {
		return "", err
	}
	if info != nil && !info.Mode().IsRegular() {
		return "", httpx.Errorf(409, "Sudah ada folder dengan nama itu")
	}
	if info != nil && !overwrite {
		return "", httpx.Errorf(409, "File sudah ada")
	}
	var old int64
	if info != nil {
		old = info.Size()
	}
	if err := checkQuota(root, rel, limits, int64(len(buf)), old); err != nil {
		return "", err
	}
	if err := ensureParents(root, rel); err != nil {
		return "", err
	}
	return rel, os.WriteFile(abs, buf, 0o644)
}

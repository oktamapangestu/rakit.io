// Package files: aturan path dan penyimpanan file website project (data/sites/<slug>).
// Padanan src/files.js.
package files

import (
	"bytes"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"rakit.icu/server/internal/httpx"
	"rakit.icu/server/internal/plans"
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
	var out []Entry
	var walk func(dir, prefix string) error
	walk = func(dir, prefix string) error {
		items, err := os.ReadDir(dir)
		if err != nil {
			if os.IsNotExist(err) {
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
			abs := filepath.Join(dir, item.Name())
			switch {
			case item.IsDir():
				out = append(out, Entry{Path: rel, Dir: true})
				if err := walk(abs, rel); err != nil {
					return err
				}
			case item.Type().IsRegular():
				info, err := os.Stat(abs)
				if err != nil {
					return err
				}
				out = append(out, Entry{Path: rel, Size: info.Size()})
			}
		}
		return nil
	}
	return out, walk(root, "")
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

// WriteImage menyimpan gambar baru di `input` (relatif ke root). File yang sudah ada ditolak (409).
func WriteImage(root, input string, buf []byte, limits plans.Storage) (string, error) {
	rel, err := CleanPath(input)
	if err != nil {
		return "", err
	}
	ext := Ext(rel)
	if _, ok := ImageTypes[ext]; !ok {
		return "", httpx.Errorf(400, "Format gambar tidak didukung. Pakai .png, .jpg, .jpeg, .gif, .webp, .svg, .ico, .avif")
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
	if info != nil {
		return "", httpx.Errorf(409, "File sudah ada")
	}
	if err := checkQuota(root, rel, limits, int64(len(buf)), 0); err != nil {
		return "", err
	}
	if err := ensureParents(root, rel); err != nil {
		return "", err
	}
	return rel, os.WriteFile(abs, buf, 0o644)
}

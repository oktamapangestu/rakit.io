package sites

import (
	"errors"
	"net/url"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

// Aturan path file project — sama dengan src/files.js.

const maxDepth = 8

// Tidak boleh diawali titik: menolak ".", "..", dan dotfile.
var segmentRE = regexp.MustCompile(`^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$`)

var errBadPath = errors.New("path tidak valid")

// File teks (.html/.css/.js) dan gambar yang boleh disajikan, beserta Content-Type-nya.
var mimeTypes = map[string]string{
	".html": "text/html; charset=utf-8",
	".css":  "text/css; charset=utf-8",
	".js":   "text/javascript; charset=utf-8",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".svg":  "image/svg+xml",
	".ico":  "image/x-icon",
	".avif": "image/avif",
}

func extOf(rel string) string { return strings.ToLower(path.Ext(rel)) }

// cleanPath memvalidasi path relatif dan mengembalikannya dengan pemisah "/".
func cleanPath(input string) (string, error) {
	var parts []string
	for _, p := range strings.Split(strings.ReplaceAll(input, `\`, "/"), "/") {
		if p != "" {
			parts = append(parts, p)
		}
	}
	if len(parts) == 0 || len(parts) > maxDepth {
		return "", errBadPath
	}
	for _, p := range parts {
		if !segmentRE.MatchString(p) {
			return "", errBadPath
		}
	}
	return strings.Join(parts, "/"), nil
}

// resolveIn mengubah path relatif menjadi path absolut yang pasti berada di dalam root.
func resolveIn(root, rel string) (string, error) {
	abs := filepath.Join(root, filepath.FromSlash(rel))
	if !strings.HasPrefix(abs, root+string(filepath.Separator)) {
		return "", errBadPath
	}
	return abs, nil
}

func isDotSegment(seg string) (single, double bool) {
	s := strings.ReplaceAll(strings.ReplaceAll(seg, "%2e", "."), "%2E", ".")
	return s == ".", s == ".."
}

// decodedPathname meniru `decodeURIComponent(new URL(req.url).pathname)` di Node: segmen "." dan ".."
// (juga bentuk %2e) diselesaikan dulu pada path yang masih ter-encode, baru kemudian di-decode.
func decodedPathname(escaped string) (string, error) {
	segs := strings.Split(strings.ReplaceAll(escaped, `\`, "/"), "/")
	out := make([]string, 0, len(segs))
	for i, seg := range segs {
		last := i == len(segs)-1
		single, double := isDotSegment(seg)
		switch {
		case double:
			if len(out) > 1 {
				out = out[:len(out)-1]
			}
			if last {
				out = append(out, "")
			}
		case single:
			if last {
				out = append(out, "")
			}
		default:
			out = append(out, seg)
		}
	}
	joined := strings.Join(out, "/")
	if !strings.HasPrefix(joined, "/") {
		joined = "/" + joined
	}
	return url.PathUnescape(joined)
}

package sites

import (
	"net/url"
	"strings"
)

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

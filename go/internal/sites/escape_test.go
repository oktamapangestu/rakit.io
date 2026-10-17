package sites

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rakit.io/server/internal/config"
)

// Salinan kerja agen bisa berisi symlink buatan agen: folder yang menunjuk ke luar root tidak boleh diikuti.
func TestServeDoesNotFollowSymlinkOutOfRoot(t *testing.T) {
	base := t.TempDir()
	root, other := filepath.Join(base, "ws"), filepath.Join(base, "lain")
	os.MkdirAll(root, 0o755)
	os.MkdirAll(other, 0o755)
	os.WriteFile(filepath.Join(other, "rahasia.html"), []byte("RAHASIA-PROJECT-LAIN"), 0o644)
	os.Symlink(other, filepath.Join(root, "x"))
	h := New(&config.Config{AppOrigin: "http://localhost"}, nil)
	for _, p := range []string{"/x/rahasia.html", "/x/rahasia"} {
		w := httptest.NewRecorder()
		h.ServeTarget(w, httptest.NewRequest("GET", p, nil), &Target{Root: root})
		if strings.Contains(w.Body.String(), "RAHASIA") {
			t.Fatalf("%s: isi di luar root tersaji (status %d)", p, w.Code)
		}
	}
}

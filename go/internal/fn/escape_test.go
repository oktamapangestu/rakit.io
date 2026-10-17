package fn

import (
	"os"
	"path/filepath"
	"testing"
)

// Salinan kerja mode Agen bisa berisi folder functions berupa symlink ke project lain: kodenya tidak boleh dimuat.
func TestLoadCodeDoesNotFollowSymlinkOutOfRoot(t *testing.T) {
	base := t.TempDir()
	root, other := filepath.Join(base, "ws"), filepath.Join(base, "lain")
	os.MkdirAll(filepath.Join(other, Dir), 0o755)
	os.MkdirAll(root, 0o755)
	os.WriteFile(filepath.Join(other, Dir, "rahasia.js"), []byte("export default () => 'RAHASIA'"), 0o644)
	os.Symlink(filepath.Join(other, Dir), filepath.Join(root, Dir))
	if code, err := (&Service{}).loadCode(root, "rahasia"); err == nil {
		t.Fatalf("kode fungsi project lain dimuat: %q", code)
	}

	os.Remove(filepath.Join(root, Dir))
	os.MkdirAll(filepath.Join(root, Dir), 0o755)
	os.WriteFile(filepath.Join(root, Dir, "halo.js"), []byte("export default () => 1"), 0o644)
	if code, err := (&Service{}).loadCode(root, "halo"); err != nil || code != "export default () => 1" {
		t.Fatalf("fungsi sendiri: %q %v", code, err)
	}
}

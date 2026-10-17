package ai

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Salinan kerja agen bisa berisi symlink buatan agen: isi di luar folder tidak boleh terbaca jadi "perubahan".
func TestAgentDiffIgnoresSymlinksOutOfWorkspace(t *testing.T) {
	base := t.TempDir()
	before, ws, other := filepath.Join(base, "before"), filepath.Join(base, "ws"), filepath.Join(base, "lain")
	for _, d := range []string{before, ws, other} {
		os.MkdirAll(d, 0o755)
	}
	os.WriteFile(filepath.Join(before, "index.html"), []byte("<h1>Halo</h1>"), 0o644)
	os.WriteFile(filepath.Join(ws, "index.html"), []byte("<h1>Halo</h1>"), 0o644)
	os.WriteFile(filepath.Join(other, "index.html"), []byte("RAHASIA-PROJECT-LAIN"), 0o644)
	os.Symlink(filepath.Join(other, "index.html"), filepath.Join(ws, "curi.html")) // symlink file
	os.Symlink(other, filepath.Join(ws, "lain"))                                   // symlink folder
	os.MkdirAll(filepath.Join(ws, "css"), 0o755)
	os.Symlink("../index.html", filepath.Join(ws, "css", "dalam.html")) // symlink di dalam workspace: tetap bukan file biasa

	changes, _, err := agentDiff(before, ws)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range changes {
		if strings.Contains(c.Content, "RAHASIA") || c.Path != "" && strings.HasPrefix(c.Path, "lain/") {
			t.Fatalf("isi di luar salinan kerja terbaca: %+v", c)
		}
	}
	if len(changes) != 0 {
		t.Fatalf("symlink dianggap perubahan: %+v", changes)
	}
}

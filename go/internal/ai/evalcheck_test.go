package ai

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTree(t *testing.T, root string, tree map[string]string) {
	t.Helper()
	for rel, content := range tree {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRunCheckCommand(t *testing.T) {
	before, after := t.TempDir(), t.TempDir()
	page := `<!doctype html><html><head><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script></head><body>`
	writeTree(t, before, map[string]string{
		"index.html": page + `<p>Halo</p></body></html>`,
		"lama.js":    "const a = 1;\n",
		"tetap.css":  "body { color: red; }\n",
	})
	// index.html memakai komponen yang tidak terdaftar dan app.js baru salah sintaks; lama.js dihapus; tetap.css sama.
	writeTree(t, after, map[string]string{
		"index.html": page + `<div x-data="keranjang"></div><script src="app.js"></script></body></html>`,
		"app.js":     "function rusak( {\n",
		"tetap.css":  "body { color: red; }\n",
	})
	in, _ := json.Marshal(checkInput{Before: before, After: after, Tables: []string{}})
	var out bytes.Buffer
	if err := RunCheckCommand(bytes.NewReader(in), &out); err != nil {
		t.Fatal(err)
	}
	var got checkOutput
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if strings.Join(got.Changes, ",") != "delete lama.js,write app.js,write index.html" {
		t.Errorf("changes = %v", got.Changes)
	}
	if got.Left["js"] == 0 || got.Left["alpine"] == 0 {
		t.Errorf("left = %v, problems = %v", got.Left, got.Problems)
	}
	if len(got.Problems["tetap.css"]) != 0 {
		t.Errorf("file yang tidak berubah ikut diperiksa: %v", got.Problems["tetap.css"])
	}
}

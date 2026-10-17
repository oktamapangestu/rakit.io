package ai

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

func TestSearchFiles(t *testing.T) {
	ws := testWorkspace(t, map[string]string{
		"index.html":        "<h1>Toko</h1>\n<script src=\"app.js\"></script>",
		"app.js":            "fetch('/api/db/produk')\nconst x = 1;",
		"functions/beli.js": "export default async () => fetch('/api/db/pesanan')",
		"logo.png":          "bukan teks",
	})
	ws.st.set(change{Action: "write", Path: "admin.js", Content: "// admin\nfetch('/API/DB/produk', { method: 'DELETE' })"})
	ws.st.set(change{Action: "delete", Path: "index.html"})

	got, err := searchFiles(map[string]any{"pattern": "/api/db/"}, ws)
	if err != nil {
		t.Fatal(err)
	}
	want := "admin.js:2: fetch('/API/DB/produk', { method: 'DELETE' })\napp.js:1: fetch('/api/db/produk')\nfunctions/beli.js:1: export default async () => fetch('/api/db/pesanan')"
	if got != want {
		t.Errorf("searchFiles =\n%s", got)
	}
	if got, _ := searchFiles(map[string]any{"pattern": `db/\w+'\)$`, "regex": true, "path": "functions/"}, ws); !strings.HasPrefix(got, "functions/beli.js:1:") {
		t.Errorf("regex + path: %s", got)
	}
	if got, _ := searchFiles(map[string]any{"pattern": "Toko"}, ws); !strings.HasPrefix(got, "Tidak ada") {
		t.Errorf("file yang dihapus ikut dicari: %s", got)
	}
	if _, err := searchFiles(map[string]any{"pattern": "(", "regex": true}, ws); err == nil {
		t.Error("regex rusak tidak ditolak")
	}
}

func TestLabTools(t *testing.T) {
	for _, browser := range []bool{false, true} {
		var tools []struct {
			Function struct {
				Name       string `json:"name"`
				Parameters struct {
					Required []string `json:"required"`
				} `json:"parameters"`
			} `json:"function"`
		}
		if err := json.Unmarshal([]byte(labToolsJSON(browser)), &tools); err != nil {
			t.Fatal(err)
		}
		var names []string
		for _, tool := range tools {
			names = append(names, tool.Function.Name)
		}
		want := "test_api,search_files"
		if browser {
			want += ",check_page"
		}
		if strings.Join(names, ",") != want {
			t.Errorf("browser=%v: %v", browser, names)
		}
		prompt := labPrompt(browser)
		if strings.Contains(prompt, "check_page") != browser {
			t.Errorf("browser=%v: prompt %q", browser, prompt)
		}
	}
}

func TestScratchFunction(t *testing.T) {
	ws := testWorkspace(t, map[string]string{"functions/test-kirim.js": "export default async () => 1", "index.html": "<p></p>"})
	ws.st.set(change{Action: "write", Path: "functions/zz-diag.js", Content: "export default async () => 1"})
	ws.st.set(change{Action: "write", Path: "functions/debug.js", Content: "export default async () => 1"})
	ws.st.set(change{Action: "write", Path: "functions/coba-bayar.js", Content: "export default async () => 1"})
	ws.st.set(change{Action: "write", Path: "functions/testimoni.js", Content: "export default async () => 1"})
	ws.st.set(change{Action: "write", Path: "app.js", Content: "fetch('/api/fn/coba-bayar')"})
	byFile, _ := ws.finalProblems()
	var got []string
	for path, list := range byFile {
		for _, p := range list {
			if p.kind == "scratch" {
				got = append(got, path)
			}
		}
	}
	// coba-bayar dipanggil halaman, testimoni bukan nama percobaan, test-kirim sudah ada sebelumnya.
	slices.Sort(got)
	if strings.Join(got, ",") != "functions/debug.js,functions/zz-diag.js" {
		t.Errorf("fungsi percobaan = %v", got)
	}
}

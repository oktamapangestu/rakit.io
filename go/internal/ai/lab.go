package ai

// Tool uji Builder — tiruan cara mesin agen menguji hasilnya sendiri (cek-halaman, curl ke /api/db & /api/fn,
// grep), tanpa container: semuanya berjalan di proses server.
//   - test_api: request HTTP ke website project (in-process, lewat AgentSite);
//   - check_page: membuka halaman di Chromium bersama (internal/pagecheck) dengan layar HP;
//   - search_files: cari teks/regex di file project (stageToolCall, tidak butuh lab).
// Website yang diuji = salinan kerja per job (file asli + perubahan yang sudah dicatat model). Tabel yang dicatat
// dibuat lebih awal di database project supaya bisa diuji; tabel itu masuk snapshot (Batalkan menghapusnya) dan
// dikembalikan bila job gagal atau dihentikan — sama seperti create_table mode Agen.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"time"

	"rakit.io/server/internal/files"
)

const (
	labResultMax  = 4000 // karakter hasil tool yang dikirim ke model
	labAPITimeout = 30 * time.Second
	labMaxPages   = 5
)

// labToolsJSON: definisi tool uji (format function calling OpenAI). check_page hanya bila ada browser.
func labToolsJSON(browser bool) string {
	tools := []map[string]any{
		labTool("test_api", "Send a real HTTP request to this project's website as it is right now, including the changes you made in this answer "+
			"(tables you created already exist). Use it to check that the /api/db/<table> and /api/fn/<name> calls your pages make really work: "+
			"GET what a page lists, POST what a form sends, call a function with the body and headers the page uses. "+
			"It runs for real on the project's database and functions (with the project's secrets) as an anonymous visitor: "+
			"delete rows you create only for testing (DELETE /api/db/<table>/<id>), and do not call functions that send messages, emails or payments unless the user asked for it.",
			map[string]any{
				"method":  map[string]any{"type": "string", "enum": []string{"GET", "POST", "PUT", "PATCH", "DELETE"}},
				"path":    map[string]any{"type": "string", "description": `Path on the website, e.g. "/api/db/produk?limit=5" or "/api/fn/checkout".`},
				"body":    map[string]any{"type": "object", "description": "JSON body for POST/PUT/PATCH."},
				"headers": map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}, "description": `Extra request headers, e.g. {"x-admin-password": "..."}.`},
			}, "method", "path"),
		labTool("search_files", "Search the current project files (including your changes in this answer) for text or a regular expression. "+
			"Returns matching lines with file name and line number. Use it to find where something is defined or used.",
			map[string]any{
				"pattern": map[string]any{"type": "string", "description": "Text to find (case-insensitive), or a regular expression when regex is true."},
				"regex":   map[string]any{"type": "boolean"},
				"path":    map[string]any{"type": "string", "description": `Only files whose path starts with this, e.g. "functions/".`},
			}, "pattern"),
	}
	if browser {
		tools = append(tools, labTool("check_page", "Open pages of this project's website in a real headless browser on a phone-sized screen (390px wide), "+
			"as they are right now including your changes, and report JavaScript errors, Alpine errors, console errors, failed requests "+
			"(HTTP 4xx/5xx, missing files, wrong API paths) and pages wider than the phone screen. Data comes from the project's real database. "+
			"Requests to other websites are blocked during the check, except common CDNs (jsdelivr, unpkg, cdnjs, Google Fonts, Unsplash).",
			map[string]any{
				"path": map[string]any{"type": "string", "description": `Page path, e.g. "/" or "/admin.html". Several pages: separate with commas (max 5).`},
			}, "path"))
	}
	raw, _ := marshal(tools)
	return string(raw)
}

func labTool(name, description string, props map[string]any, required ...string) map[string]any {
	return map[string]any{"type": "function", "function": map[string]any{"name": name, "description": description,
		"parameters": map[string]any{"type": "object", "properties": props, "required": required}}}
}

// labPrompt: ditambahkan ke prompt Builder bila tool uji aktif.
func labPrompt(browser bool) string {
	tools := "test_api"
	if browser {
		tools = "check_page and test_api"
	}
	return "\n\nTesting your work (" + tools + "):\n" +
		"- Test like a developer before you write the summary whenever you created or changed pages with scripts, forms, database tables or functions: " +
		strings.Join(slices.DeleteFunc([]string{
			map[bool]string{true: "call check_page for every page you created or changed", false: ""}[browser],
			"call test_api for the endpoints those pages use (e.g. GET /api/db/<table>, POST to a function with the body the page sends, with and without the admin password)",
		}, func(s string) bool { return s == "" }), ", and ") + ". Fix what the tests report, then test again.\n" +
		"- Skip testing for changes to text, colors or layout only.\n" +
		"- Trust the documented function format above instead of probing the runtime with experiments. Delete any file or function you created only for testing before you finish.\n" +
		"- Use search_files to find where something is defined or used instead of reading many files."
}

// lab: salinan kerja satu job Builder untuk tool uji.
type lab struct {
	s     *Service
	slug  string
	ws    *workspace
	jobID int64

	dir     string            // salinan kerja; "" = belum dibuat (dibuat saat tool uji pertama dipanggil)
	applied map[string]change // tabel yang sudah dibuat lebih awal, versi terakhir yang diterapkan
	tables  []tableSnapshot   // snapshot tabel itu (masuk snapshot pesan; dikembalikan bila job gagal)
}

func (s *Service) newLab(slug string, ws *workspace, jobID int64) *lab {
	if !s.cfg.AI.Tests || s.AgentSite == nil {
		return nil
	}
	return &lab{s: s, slug: slug, ws: ws, jobID: jobID, applied: map[string]change{}}
}

func (l *lab) close() {
	if l != nil && l.dir != "" {
		os.RemoveAll(l.dir)
	}
}

// revert: hapus lagi tabel/kolom yang dibuat lebih awal (job gagal, dihentikan, atau penerapan gagal).
func (l *lab) revert() {
	if l == nil {
		return
	}
	for i := len(l.tables) - 1; i >= 0; i-- {
		if err := l.s.revertTable(context.Background(), l.slug, l.tables[i]); err != nil {
			log.Printf("ai: mengembalikan tabel uji %s: %v", l.tables[i].Table, err)
		}
	}
	l.tables = nil
}

// sync menyamakan salinan kerja dengan perubahan yang sudah dicatat dan membuat tabel yang dicatat.
func (l *lab) sync(ctx context.Context) error {
	if l.dir == "" {
		jobsDir := filepath.Join(l.s.cfg.DataDir, "agent-jobs")
		if err := os.MkdirAll(jobsDir, 0o755); err != nil {
			return err
		}
		dir, err := os.MkdirTemp(jobsDir, fmt.Sprintf("%d-lab-", l.jobID))
		if err != nil {
			return err
		}
		if err := linkTree(l.ws.root, dir); err != nil {
			os.RemoveAll(dir)
			return err
		}
		l.dir = dir
	}
	var pending []change
	for _, c := range l.ws.st.list() {
		target := filepath.Join(l.dir, filepath.FromSlash(c.Path))
		switch c.Action {
		case "write":
			// Hapus dulu: file salinan bisa berupa hard link ke file asli project.
			os.Remove(target)
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(target, []byte(c.Content), 0o644); err != nil {
				return err
			}
		case "delete":
			os.Remove(target)
		case "table":
			if prev, ok := l.applied[c.Name]; !ok || !reflect.DeepEqual(prev, c) {
				pending = append(pending, c)
			}
		}
	}
	if len(pending) == 0 {
		return nil
	}
	snaps, err := l.s.applyTables(ctx, l.slug, pending)
	l.tables = append(l.tables, snaps...)
	if err != nil {
		return fmt.Errorf("membuat tabel untuk diuji: %w", err)
	}
	for _, c := range pending {
		l.applied[c.Name] = c
	}
	return nil
}

// linkTree: salinan folder dengan hard link (cepat, tanpa tambahan ruang disk); salin biasa bila tidak bisa.
func linkTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		switch {
		case d.IsDir():
			return os.MkdirAll(target, 0o755)
		case d.Type().IsRegular():
			if os.Link(p, target) == nil {
				return nil
			}
			in, err := os.Open(p)
			if err != nil {
				return err
			}
			defer in.Close()
			out, err := os.Create(target)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, in); err != nil {
				out.Close()
				return err
			}
			return out.Close()
		}
		return nil
	})
}

// run menjalankan tool uji. ok = false bila nama tool bukan tool uji.
func (l *lab) run(ctx context.Context, call toolCall) (result string, found []problem, ok bool) {
	if l == nil || (call.Name != "test_api" && call.Name != "check_page") {
		return "", nil, false
	}
	args := map[string]any{}
	if err := json.Unmarshal([]byte(cmpOr(call.Arguments, "{}")), &args); err != nil {
		return "Error: argumen bukan JSON yang valid. Panggil tool ini lagi dengan JSON yang benar.", []problem{{"tool", "json"}}, true
	}
	if err := l.sync(ctx); err != nil {
		if ctx.Err() != nil {
			return "Error: dihentikan.", nil, true
		}
		return "Error: " + err.Error(), []problem{{"tool", err.Error()}}, true
	}
	if call.Name == "test_api" {
		result = l.testAPI(ctx, args)
	} else {
		result, found = l.checkPage(ctx, args)
	}
	if r := []rune(result); len(r) > labResultMax {
		result = string(r[:labResultMax]) + "\n… (dipotong)"
	}
	return result, found, true
}

func cmpOr(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}

func (l *lab) testAPI(ctx context.Context, args map[string]any) string {
	method := strings.ToUpper(strings.TrimSpace(argText(args["method"])))
	if method == "" {
		method = http.MethodGet
	}
	if !slices.Contains([]string{"GET", "POST", "PUT", "PATCH", "DELETE"}, method) {
		return "Error: method harus GET, POST, PUT, PATCH, atau DELETE."
	}
	path := strings.TrimSpace(argText(args["path"]))
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
		return `Error: path harus diawali "/", misalnya "/api/db/produk".`
	}
	var body io.Reader
	if v, has := args["body"]; has && v != nil {
		raw, err := marshal(v)
		if err != nil {
			return "Error: body tidak bisa dijadikan JSON."
		}
		body = bytes.NewReader(raw)
	}
	ctx, cancel := context.WithTimeout(ctx, labAPITimeout)
	defer cancel()
	req := httptest.NewRequestWithContext(ctx, method, "http://"+l.slug+".lab"+path, body)
	req.RemoteAddr = "127.0.0.1:1"
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if headers, ok := args["headers"].(map[string]any); ok {
		for k, v := range headers {
			switch strings.ToLower(k) {
			case "host", "cookie", "content-length", "x-forwarded-for":
				continue
			}
			req.Header.Set(k, argText(v))
		}
	}
	rec := httptest.NewRecorder()
	l.s.AgentSite(l.slug, l.dir).ServeHTTP(rec, req)
	res := rec.Result()
	raw, _ := io.ReadAll(res.Body)
	text := strings.TrimSpace(string(raw))
	var compact bytes.Buffer
	if json.Compact(&compact, raw) == nil {
		text = compact.String()
	}
	if text == "" {
		text = "(body kosong)"
	}
	out := fmt.Sprintf("HTTP %d %s\n%s", res.StatusCode, http.StatusText(res.StatusCode), text)
	if res.StatusCode >= 500 && strings.HasPrefix(strings.ToLower(path), "/api/fn/") {
		out += "\n" + fnFormatHint
	}
	return out
}

// fnFormatHint: pengingat format fungsi saat fungsi gagal — model cenderung menulis gaya Node/Express lalu menebak
// runtime-nya dengan fungsi percobaan.
const fnFormatHint = "Reminder — rakit functions are not Node.js or Express: `export default async function (req, { db, env, fetch, ai }) { … return value; }`. " +
	"req = { method, query, headers, body } (JSON body already parsed). Return a plain value (sent as JSON with status 200) or `Response.json(data, { status })` / `new Response(text, { status, headers })` — there is no res.json() / res.status(). " +
	"db.list(table, { sort, limit, offset, filter }) -> { rows, total }, db.get(table, id), db.insert(table, data), db.update(table, id, data), db.delete(table, id). " +
	"Secrets: env.NAME (no process.env, no require). Fix the function to this format instead of probing the runtime."

// argText: nilai argumen sebagai teks (selain string: JSON-nya).
func argText(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case nil:
		return ""
	}
	raw, _ := json.Marshal(v)
	return string(raw)
}

func (l *lab) checkPage(ctx context.Context, args map[string]any) (string, []problem) {
	if l.s.pages == nil {
		return "Error: pemeriksaan halaman tidak tersedia di server ini.", nil
	}
	var paths []string
	for _, p := range strings.Split(argText(args["path"]), ",") {
		if p = strings.TrimSpace(p); p == "" {
			continue
		}
		if !strings.HasPrefix(p, "/") {
			p = "/" + p
		}
		if !slices.Contains(paths, p) {
			paths = append(paths, p)
		}
	}
	if len(paths) == 0 {
		paths = []string{"/"}
	}
	if len(paths) > labMaxPages {
		paths = paths[:labMaxPages]
	}
	reports, err := l.s.pages.Check(ctx, l.s.AgentSite(l.slug, l.dir), paths)
	if err != nil {
		if ctx.Err() != nil {
			return "Error: dihentikan.", nil
		}
		log.Printf("ai: check_page: %v", err)
		return "Error: browser pemeriksa sedang bermasalah, lewati pemeriksaan halaman kali ini.", nil
	}
	var b strings.Builder
	var found []problem
	blocked := map[string]bool{}
	var missing []string
	total := 0
	for _, r := range reports {
		total += len(r.Problems)
		if len(r.Problems) == 0 {
			fmt.Fprintf(&b, "%s → tidak ada error\n", r.Path)
		} else {
			fmt.Fprintf(&b, "%s → %d masalah:\n", r.Path, len(r.Problems))
			for _, p := range r.Problems {
				fmt.Fprintf(&b, "  - %s\n", p)
				found = append(found, problem{"page", p})
			}
		}
		if len(r.Dialogs) > 0 {
			fmt.Fprintf(&b, "  (dialog yang muncul dan ditutup otomatis: %s)\n", strings.Join(r.Dialogs, ", "))
		}
		for _, h := range r.Blocked {
			blocked[h] = true
		}
		for _, m := range r.Missing {
			if !slices.Contains(missing, m) {
				missing = append(missing, m)
			}
		}
	}
	if len(blocked) > 0 {
		fmt.Fprintf(&b, "Catatan: request ke %s diblokir selama pemeriksaan (bukan kesalahan kodemu); error yang hanya akibat itu boleh diabaikan.\n",
			strings.Join(sortedKeys(blocked), ", "))
	}
	if len(missing) > 0 {
		fmt.Fprintf(&b, "Gambar yang belum ada (kamu tidak bisa membuat gambar; bukan masalah kode — sebutkan di ringkasan supaya pengguna mengunggahnya): %s\n",
			strings.Join(missing, ", "))
	}
	text := strings.TrimSpace(b.String())
	if total > 0 {
		return fmt.Sprintf("Ditemukan %d masalah. Perbaiki, lalu panggil check_page lagi.\n%s", total, text), found
	}
	return text, nil
}

// ---------- search_files (tanpa lab) ----------

const searchMaxLines = 60

func searchFiles(args map[string]any, ws *workspace) (string, error) {
	pattern := argText(args["pattern"])
	if strings.TrimSpace(pattern) == "" {
		return "", errors.New("pattern tidak boleh kosong.")
	}
	expr := "(?i)" + regexp.QuoteMeta(pattern)
	if truthy(args["regex"]) {
		expr = "(?i)" + pattern
	}
	re, err := regexp.Compile(expr)
	if err != nil {
		return "", fmt.Errorf("regex tidak valid: %v", err)
	}
	prefix := strings.TrimPrefix(argText(args["path"]), "/")
	var paths []string
	seen := map[string]bool{}
	for _, p := range append(sortedKeys(ws.disk), ws.st.order...) {
		if !seen[p] && files.IsTextFile(p) && strings.HasPrefix(p, prefix) && ws.exists(p) {
			seen[p] = true
			paths = append(paths, p)
		}
	}
	slices.Sort(paths)
	var b strings.Builder
	lines, matched := 0, 0
	for _, p := range paths {
		content, ok := ws.read(p)
		if !ok {
			continue
		}
		for i, line := range strings.Split(content, "\n") {
			if !re.MatchString(line) {
				continue
			}
			matched++
			if lines >= searchMaxLines {
				continue
			}
			lines++
			line = strings.TrimSpace(line)
			if r := []rune(line); len(r) > 200 {
				line = string(r[:200]) + "…"
			}
			fmt.Fprintf(&b, "%s:%d: %s\n", p, i+1, line)
		}
	}
	if matched == 0 {
		return fmt.Sprintf("Tidak ada yang cocok dengan %q.", pattern), nil
	}
	if matched > lines {
		fmt.Fprintf(&b, "… dan %d baris lain (persempit pattern atau path).\n", matched-lines)
	}
	return strings.TrimSpace(b.String()), nil
}

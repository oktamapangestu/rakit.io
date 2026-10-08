package ai

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"rakit.io/server/internal/aimodels"
	"rakit.io/server/internal/files"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/plans"
	"rakit.io/server/internal/store"
)

// Baca Alur Kode: AI menjelaskan satu file langkah demi langkah, berurutan seperti kode itu berjalan, beserta
// baris yang dimaksud, contoh nilai, istilah, dan rujukan ke file lain di project. Gratis — tidak memakai
// kredit — tapi dibatasi AI_EXPLAIN_DAILY_LIMIT permintaan per akun per hari. Hasilnya disimpan per file
// (tabel code_explanations) beserta hash isi file, jadi membuka ulang file yang sama tidak bertanya ke AI.

const (
	explainTimeout     = 240 * time.Second // di bawah proxy_read_timeout nginx (300 detik)
	explainAskTimeout  = 90 * time.Second
	explainMaxTokens   = 16_000
	explainAskTokens   = 2_000
	maxExplainFile     = 120_000 // karakter file yang dijelaskan
	maxExplainRelated  = 6       // file terkait yang ikut dikirim
	maxRelatedChars    = 12_000  // per file terkait
	maxExplainSteps    = 30
	maxExplainQuestion = 1_000
	maxExplainHistory  = 6
)

const explainPrompt = `You explain how ONE source file of a beginner's website project on rakit.io works, as an interactive step-by-step
walkthrough called "Baca Alur Kode". rakit.io projects are static HTML/CSS/JS pages; data is stored through rakit.io's built-in
/api/db/<table> REST API, and functions/<name>.js are serverless functions served at /api/fn/<name>.

The reader is a beginner who is learning to code. Write everything in Indonesian: friendly, concrete, short sentences, and explain
every technical word the first time it appears. Never invent code, files or behaviour that is not in the files you are given.

Order the steps in the order things HAPPEN when the code runs, not the order of the lines:
- JavaScript: code that runs when the file loads, then what happens on each event (click, submit, input, timer), following function
  calls into the function body, then async work (fetch, await) and what happens when the answer arrives or fails.
- HTML: what the browser builds from top to bottom, which CSS/JS it loads and when, then what the visitor can do (links, forms,
  buttons) and which script or page handles it.
- CSS: the main parts (variables, base styles, layout, components, animations, @media for small screens) and what each changes on
  the page; explain the cascade or specificity where it matters.
- Serverless function (functions/*.js): the request coming in, checks, database or fetch calls, and the response.
Cover EVERY meaningful part of the file, in 3-25 steps; one step is one idea. Give every if/else, ternary, early return
and switch its own step with kind "decision" and labeled branches in next, and every loop its own step with kind "loop" — these
decisions are what beginners need to see. Do not merge a whole function into one step when it contains decisions.

Fields:
- summary: 2-3 sentences: what the file is for and how it fits in the project.
- steps[].lines: real line numbers from the numbered file, as [start, end] ranges (at most 3 ranges per step).
- steps[].kind: one of start, input, process, decision, loop, function, event, request, output, end.
- steps[].explain: what happens and WHY, 2-5 sentences. Mention variable and function names in backticks.
- steps[].example: a concrete trace with sample values, e.g. "Jika keranjang berisi 2 kue @ Rp10.000, total menjadi Rp20.000." ("" if
  nothing to trace).
- steps[].terms: at most 3 programming terms in this step that a beginner may not know, each with a one-sentence meaning.
- steps[].refs: links from this step to OTHER project files: the HTML element a script grabs, the script that handles a form, the
  function behind /api/fn/..., the page a link opens, the CSS class used. Only paths from the project file list; add the line in that
  file when you can see it. Only link what really matches (same id, class, file name or URL); if the element or file the code
  expects does not exist, do NOT link something else — report it in notes as a bug instead. [] if none.
- steps[].next: where the flow goes after this step, as [{"to": <step id>, "label": "<short label>"}]. For a decision give each branch
  ("ya"/"tidak", "berhasil"/"gagal"); for a loop add an edge back labeled "ulang"; for an event handler that waits, the step it waits
  for. Use [] when the flow simply continues to the next step.
- related: how this file is connected to other project files (loaded by, loads, calls, called by, styles), with the line in that
  file when known.
- complexity: how fast/efficient the code is, in plain words; mention Big-O only with an explanation. "" for HTML and CSS.
- notes: real problems or improvements: level bug (will break), warn (risky), tip (better way) or info; with the line. At most 5;
  [] if the code is fine.

Reply with ONE ` + "```json" + ` block and nothing else, exactly in the shape given at the end of the user message.`

// explainShape: bentuk jawaban. Diulang di akhir pesan user (bagian yang paling diperhatikan model), karena
// model cenderung memakai kunci sendiri ("flow", "action", "detail") bila bentuknya hanya ada di prompt sistem.
const explainShape = `{"summary": "Ringkasan 2-3 kalimat dalam bahasa Indonesia.",
 "steps": [{"id": 1, "title": "Judul singkat", "kind": "start", "lines": [[1, 5]],
            "explain": "Apa yang terjadi dan kenapa.", "example": "Contoh dengan nilai nyata.",
            "terms": [{"term": "addEventListener", "meaning": "Arti satu kalimat."}],
            "refs": [{"path": "index.html", "line": 12, "note": "elemen yang dipakai langkah ini"}],
            "next": [{"to": 2, "label": ""}]}],
 "related": [{"path": "index.html", "line": 12, "note": "memuat file ini lewat <script src>"}],
 "complexity": "Penjelasan kecepatan dengan bahasa sederhana.",
 "notes": [{"level": "tip", "line": 8, "text": "Saran perbaikan."}]}`

// explainRules: penutup pesan user (dan permintaan ulang bila format salah).
var explainRules = `Rules:
1. Write ALL text values in Indonesian (Bahasa Indonesia).
2. Every step MUST have "lines" with real line numbers from the numbered file.
3. Every if/else, early return and ternary is its OWN step with kind "decision" and one labeled edge per branch in "next"
   (e.g. "ya"/"tidak"); every loop is its OWN step with kind "loop". Never hide a decision inside a bigger step.
4. refs only when the id, class, file name or URL really matches in that file. If what the code expects does not exist
   (e.g. getElementById('x') but no id="x" in the HTML), do not link anything else: add a "bug" note instead.
5. notes only for problems you are sure of after re-reading the exact lines.
Use exactly these keys. Reply with ONE ` + "```json" + ` block and nothing else, in exactly this shape:
` + explainShape

const explainAskPrompt = `You are a patient programming tutor inside rakit.io's "Baca Alur Kode" panel. The user is reading an explanation
of one file of their website and asks a question about it. Answer in Indonesian, short (at most ~150 words), concrete, for a
beginner. You may use **bold**, ` + "`code`" + `, short lists and small code blocks. Refer to lines as "baris 12" so the editor can link
them. Only talk about the code you are given; if the question is about something else, say so briefly.`

// Explanation: hasil Baca Alur Kode satu file.
type Explanation struct {
	Summary    string        `json:"summary"`
	Steps      []ExplainStep `json:"steps"`
	Related    []ExplainRef  `json:"related"`
	Complexity string        `json:"complexity"`
	Notes      []ExplainNote `json:"notes"`
}

type ExplainStep struct {
	ID      int           `json:"id"`
	Title   string        `json:"title"`
	Kind    string        `json:"kind"`
	Lines   [][2]int      `json:"lines"`
	Explain string        `json:"explain"`
	Example string        `json:"example"`
	Terms   []ExplainTerm `json:"terms"`
	Refs    []ExplainRef  `json:"refs"`
	Next    []ExplainEdge `json:"next"`
}

type ExplainTerm struct {
	Term    string `json:"term"`
	Meaning string `json:"meaning"`
}

type ExplainRef struct {
	Path string `json:"path"`
	Line int    `json:"line,omitempty"`
	Note string `json:"note"`
}

type ExplainEdge struct {
	To    int    `json:"to"`
	Label string `json:"label"`
}

type ExplainNote struct {
	Level string `json:"level"`
	Line  int    `json:"line,omitempty"`
	Text  string `json:"text"`
}

var explainKinds = map[string]bool{
	"start": true, "input": true, "process": true, "decision": true, "loop": true,
	"function": true, "event": true, "request": true, "output": true, "end": true,
}

var explainLevels = map[string]bool{"bug": true, "warn": true, "tip": true, "info": true}

// HashContent: sidik isi file (hex SHA-256), sama dengan yang dihitung editor untuk tahu penjelasan sudah usang.
func HashContent(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

func numbered(content string) string {
	lines := strings.Split(content, "\n")
	width := len(strconv.Itoa(len(lines)))
	var b strings.Builder
	for i, line := range lines {
		fmt.Fprintf(&b, "%*d| %s\n", width, i+1, line)
	}
	return b.String()
}

func lineCount(content string) int { return strings.Count(content, "\n") + 1 }

// ---------- File terkait ----------

// fnName: nama fungsi untuk functions/<nama>.js, "" untuk file lain.
func fnName(rel string) string {
	if dir, file := path.Split(rel); dir == "functions/" && strings.HasSuffix(file, ".js") {
		return strings.TrimSuffix(file, ".js")
	}
	return ""
}

// mentions: apakah isi file menyebut file `rel` (nama file-nya, atau alamat /api/fn/<nama> untuk fungsi).
func mentions(content, rel string) bool {
	if name := fnName(rel); name != "" && strings.Contains(content, "/api/fn/"+name) {
		return true
	}
	return strings.Contains(content, path.Base(rel))
}

// relatedFiles: file teks project yang disebut file ini (dimuat, dipanggil) lalu yang menyebut file ini,
// maksimal maxExplainRelated. Isinya ikut dikirim supaya AI bisa menautkan langkah ke file lain.
func relatedFiles(root, target, content string, texts []string) (map[string]string, []string) {
	contents := map[string]string{}
	var outgoing, incoming []string
	for _, p := range texts {
		if p == target {
			continue
		}
		text, err := files.ReadText(root, p)
		if err != nil {
			continue
		}
		switch {
		case mentions(content, p):
			outgoing = append(outgoing, p)
		case mentions(text, target):
			incoming = append(incoming, p)
		default:
			continue
		}
		contents[p] = text
	}
	order := append(outgoing, incoming...)
	if len(order) > maxExplainRelated {
		order = order[:maxExplainRelated]
	}
	return contents, order
}

// ---------- Membaca jawaban AI ----------

var jsonBlockRE = regexp.MustCompile("(?s)```[ \\t]*(?:json)?[ \\t]*\\r?\\n(.*?)```")

// extractJSON: isi blok ```json, atau objek JSON pertama-terakhir bila model tidak memakai blok.
func extractJSON(text string) string {
	if m := jsonBlockRE.FindStringSubmatch(text); m != nil {
		return strings.TrimSpace(m[1])
	}
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return ""
	}
	return text[start : end+1]
}

func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case string:
		i, err := strconv.Atoi(strings.TrimSpace(n))
		return i, err == nil
	}
	return 0, false
}

func toText(v any, limit int) string {
	s, _ := v.(string)
	return jsconv.Slice(strings.TrimSpace(s), limit)
}

func toList(v any) []any {
	list, _ := v.([]any)
	return list
}

var rangeTextRE = regexp.MustCompile(`^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$`)

// parseRanges menerima [[1,5],[8,9]], [1,5], atau "1-5"; hasilnya dijepit ke 1..total.
func parseRanges(v any, total int) [][2]int {
	var raw [][2]int
	add := func(a, b int) { raw = append(raw, [2]int{a, b}) }
	switch x := v.(type) {
	case string:
		if m := rangeTextRE.FindStringSubmatch(x); m != nil {
			a, _ := strconv.Atoi(m[1])
			b := a
			if m[2] != "" {
				b, _ = strconv.Atoi(m[2])
			}
			add(a, b)
		}
	case []any:
		if len(x) == 2 {
			if a, ok := toInt(x[0]); ok {
				if b, ok := toInt(x[1]); ok {
					add(a, b)
					break
				}
			}
		}
		for _, item := range x {
			switch r := item.(type) {
			case []any:
				if len(r) == 0 {
					continue
				}
				a, ok := toInt(r[0])
				b := a
				if len(r) > 1 {
					b, _ = toInt(r[1])
				}
				if ok {
					add(a, b)
				}
			case float64, string:
				if a, ok := toInt(r); ok {
					add(a, a)
				}
			}
		}
	}
	out := [][2]int{}
	for _, r := range raw {
		a, b := min(r[0], r[1]), max(r[0], r[1])
		a, b = max(a, 1), min(b, total)
		if a <= b && len(out) < 3 {
			out = append(out, [2]int{a, b})
		}
	}
	return out
}

// pick: nilai kunci pertama yang ada (model kadang memakai nama kunci lain).
func pick(m map[string]any, keys ...string) any {
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			return v
		}
	}
	return nil
}

// Tanda jawaban berbahasa Inggris padahal diminta bahasa Indonesia.
var (
	englishRE    = regexp.MustCompile(`(?i)\b(the|and|this|with|is|are|when|which)\b`)
	indonesianRE = regexp.MustCompile(`(?i)\b(yang|dan|ini|dengan|untuk|akan|saat|di|ke)\b`)
)

// parseExplanation membaca dan merapikan JSON dari AI: id langkah diurutkan ulang, baris dijepit ke isi file,
// dan rujukan hanya ke file yang benar-benar ada di project. problem: jawaban bisa dipakai tapi kurang baik
// (tanpa nomor baris, bukan bahasa Indonesia) — pemanggil boleh meminta perbaikan sekali.
func parseExplanation(text string, total int, known map[string]int) (*Explanation, string, error) {
	raw := extractJSON(text)
	var doc map[string]any
	if raw == "" || json.Unmarshal([]byte(raw), &doc) != nil {
		return nil, "", &failure{"bad_output", "AI tidak mengirim penjelasan yang bisa dibaca. Coba lagi."}
	}
	refs := func(v any, limit int) []ExplainRef {
		out := []ExplainRef{}
		for _, item := range toList(v) {
			m, _ := item.(map[string]any)
			p := strings.TrimPrefix(strings.TrimSpace(jsconv.String(m["path"])), "/")
			lines, ok := known[p]
			if !ok || len(out) == limit {
				continue
			}
			ref := ExplainRef{Path: p, Note: toText(pick(m, "note", "reason", "relation"), 200)}
			if n, ok := toInt(m["line"]); ok && n >= 1 && (lines == 0 || n <= lines) {
				ref.Line = n
			}
			out = append(out, ref)
		}
		return out
	}

	ex := &Explanation{
		Summary:    toText(pick(doc, "summary", "ringkasan"), 800),
		Complexity: toText(doc["complexity"], 500),
		Related:    refs(doc["related"], 10),
		Steps:      []ExplainStep{},
		Notes:      []ExplainNote{},
	}
	ids := map[int]int{} // id dari AI -> id baru (1..n)
	var nexts [][]any
	for _, item := range toList(pick(doc, "steps", "flow", "langkah")) {
		m, _ := item.(map[string]any)
		title := toText(pick(m, "title", "action", "name", "judul"), 80)
		if m == nil || title == "" || len(ex.Steps) == maxExplainSteps {
			continue
		}
		step := ExplainStep{
			ID:      len(ex.Steps) + 1,
			Title:   title,
			Kind:    strings.ToLower(toText(m["kind"], 20)),
			Lines:   parseRanges(pick(m, "lines", "line", "range", "baris"), total),
			Explain: toText(pick(m, "explain", "detail", "description", "penjelasan"), 1500),
			Example: toText(m["example"], 600),
			Terms:   []ExplainTerm{},
			Refs:    refs(m["refs"], 4),
			Next:    []ExplainEdge{},
		}
		if !explainKinds[step.Kind] {
			step.Kind = "process"
		}
		for _, t := range toList(m["terms"]) {
			tm, _ := t.(map[string]any)
			term, meaning := toText(tm["term"], 40), toText(tm["meaning"], 250)
			if term != "" && meaning != "" && len(step.Terms) < 3 {
				step.Terms = append(step.Terms, ExplainTerm{term, meaning})
			}
		}
		if old, ok := toInt(pick(m, "id", "step")); ok {
			if _, dup := ids[old]; !dup {
				ids[old] = step.ID
			}
		}
		ex.Steps = append(ex.Steps, step)
		nexts = append(nexts, toList(m["next"]))
	}
	if len(ex.Steps) == 0 {
		return nil, "", &failure{"bad_output", "AI tidak mengirim langkah-langkah alur kode. Coba lagi."}
	}
	for i, list := range nexts {
		seen := map[int]bool{}
		for _, item := range list {
			var to int
			var label string
			switch e := item.(type) {
			case map[string]any:
				n, ok := toInt(e["to"])
				if !ok {
					continue
				}
				to, label = n, toText(e["label"], 30)
			default:
				n, ok := toInt(e)
				if !ok {
					continue
				}
				to = n
			}
			mapped, ok := ids[to]
			if !ok || seen[mapped] || len(ex.Steps[i].Next) == 4 {
				continue
			}
			seen[mapped] = true
			ex.Steps[i].Next = append(ex.Steps[i].Next, ExplainEdge{mapped, label})
		}
	}
	for _, item := range toList(doc["notes"]) {
		m, _ := item.(map[string]any)
		if plain, ok := item.(string); ok {
			m = map[string]any{"text": plain}
		}
		text := toText(m["text"], 400)
		if text == "" || len(ex.Notes) == 5 {
			continue
		}
		note := ExplainNote{Level: strings.ToLower(toText(m["level"], 10)), Text: text}
		if !explainLevels[note.Level] {
			note.Level = "info"
		}
		if n, ok := toInt(m["line"]); ok && n >= 1 && n <= total {
			note.Line = n
		}
		ex.Notes = append(ex.Notes, note)
	}
	var problems []string
	withLines := 0
	for _, st := range ex.Steps {
		if len(st.Lines) > 0 {
			withLines++
		}
	}
	if withLines*2 < len(ex.Steps) {
		problems = append(problems, `most steps have no "lines" (line numbers from the numbered file)`)
	}
	sample := ex.Summary
	for _, st := range ex.Steps {
		sample += " " + st.Explain
	}
	if len(englishRE.FindAllString(sample, -1)) > 2*len(indonesianRE.FindAllString(sample, -1))+3 {
		problems = append(problems, "the text is in English, but it must be in Indonesian")
	}
	return ex, strings.Join(problems, "; "), nil
}

// ---------- Kuota & penyimpanan ----------

type savedExplanation struct {
	Explanation *Explanation `json:"explanation"`
	Hash        string       `json:"hash"`
	CreatedAt   int64        `json:"createdAt"`
}

func (s *Service) savedExplanation(projectID int64, rel string) (*savedExplanation, error) {
	var raw string
	out := &savedExplanation{}
	err := s.db.QueryRow("SELECT hash, result, created_at FROM code_explanations WHERE project_id = ? AND path = ?", projectID, rel).
		Scan(&out.Hash, &raw, &out.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	if json.Unmarshal([]byte(raw), &out.Explanation) != nil {
		return nil, nil
	}
	return out, nil
}

// explainQuota: sisa permintaan hari ini. Error 503 bila fitur mati, 429 bila habis.
func (s *Service) explainQuota(user *store.User) (day string, remaining int, err error) {
	limit := s.cfg.AI.ExplainDailyLimit
	if !s.models.Enabled() || limit == 0 {
		return "", 0, httpx.Errorf(503, "Baca Alur Kode belum tersedia di server ini")
	}
	day, _ = plans.WIBDay(time.Now().UnixMilli())
	var used int
	s.db.QueryRow("SELECT count FROM ai_explain_usage WHERE user_id = ? AND day = ?", user.ID, day).Scan(&used)
	if used >= limit {
		return day, 0, &httpx.Error{Status: 429, Message: "Batas Baca Alur Kode hari ini sudah habis. Terisi lagi besok pukul 00.00 WIB.", Code: "explain_limit"}
	}
	return day, limit - used, nil
}

func (s *Service) countExplain(user *store.User, day string, tokens int) {
	s.db.Exec(`
		INSERT INTO ai_explain_usage (user_id, day, count, tokens) VALUES (?, ?, 1, ?)
		ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1, tokens = tokens + excluded.tokens`,
		user.ID, day, tokens)
}

// explainRemaining: sisa hari ini tanpa error (untuk ditampilkan).
func (s *Service) explainRemaining(user *store.User) int {
	_, remaining, _ := s.explainQuota(user)
	return remaining
}

// lockExplain: satu Baca Alur Kode berjalan per akun (terpisah dari job AI & prediksi kode).
func (s *Service) lockExplain(user *store.User) (func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.explaining[user.ID] {
		return nil, &httpx.Error{Status: 429, Message: "Penjelasan sebelumnya masih dibuat. Tunggu sebentar.", Code: "explain_busy"}
	}
	s.explaining[user.ID] = true
	return func() {
		s.mu.Lock()
		delete(s.explaining, user.ID)
		s.mu.Unlock()
	}, nil
}

// explainInput: path & isi file dari editor (isi dikirim editor, jadi perubahan yang belum tersimpan ikut).
func explainInput(body map[string]any) (string, string, error) {
	rel, err := files.CleanPath(jsconv.String(body["path"]))
	if err != nil {
		return "", "", err
	}
	if !files.IsTextFile(rel) {
		return "", "", httpx.Errorf(400, "Baca Alur Kode hanya untuk file kode (.html, .css, .js)")
	}
	content, ok := body["content"].(string)
	if !ok {
		return "", "", httpx.Errorf(400, "Isi file wajib dikirim")
	}
	if strings.TrimSpace(content) == "" {
		return "", "", httpx.Errorf(400, "File ini masih kosong. Tulis kodenya dulu.")
	}
	if len(content) > maxExplainFile {
		return "", "", httpx.Errorf(413, "File terlalu besar untuk dijelaskan sekaligus (maks. %d KB)", maxExplainFile/1000)
	}
	return rel, content, nil
}

// ---------- API ----------

// SavedExplanation: penjelasan tersimpan untuk satu file (atau null) dan sisa kuota hari ini.
func (s *Service) SavedExplanation(user *store.User, project *store.Project, rawPath string) (any, error) {
	rel, err := files.CleanPath(rawPath)
	if err != nil {
		return nil, err
	}
	saved, err := s.savedExplanation(project.ID, rel)
	if err != nil {
		return nil, err
	}
	return map[string]any{"saved": saved, "remaining": s.explainRemaining(user), "limit": s.cfg.AI.ExplainDailyLimit}, nil
}

// Explain membuat penjelasan alur satu file. Bila isi file sama dengan penjelasan tersimpan dan tidak
// diminta ulang (force), yang tersimpan dikembalikan tanpa bertanya ke AI.
func (s *Service) Explain(ctx context.Context, user *store.User, project *store.Project, body map[string]any) (any, error) {
	rel, content, err := explainInput(body)
	if err != nil {
		return nil, err
	}
	hash := HashContent(content)
	force, _ := body["force"].(bool)
	if saved, err := s.savedExplanation(project.ID, rel); err != nil {
		return nil, err
	} else if saved != nil && saved.Hash == hash && !force {
		return map[string]any{"saved": saved, "cached": true, "remaining": s.explainRemaining(user), "limit": s.cfg.AI.ExplainDailyLimit}, nil
	}
	day, remaining, err := s.explainQuota(user)
	if err != nil {
		return nil, err
	}
	unlock, err := s.lockExplain(user)
	if err != nil {
		return nil, err
	}
	defer unlock()

	root := s.cfg.SiteRoot(project.Slug)
	entries, err := files.ListTree(root)
	if err != nil {
		return nil, err
	}
	known := map[string]int{} // path -> jumlah baris (0 = gambar)
	var texts, tree []string
	for _, e := range entries {
		switch {
		case e.Dir:
		case files.IsTextFile(e.Path):
			texts = append(texts, e.Path)
			tree = append(tree, "- "+e.Path)
			known[e.Path] = 0
		case files.IsImageFile(e.Path):
			tree = append(tree, "- "+e.Path)
			known[e.Path] = 0
		}
	}
	if _, ok := known[rel]; !ok {
		known[rel] = 0
		tree = append(tree, "- "+rel+" (belum disimpan)")
	}
	known[rel] = lineCount(content)
	contents, related := relatedFiles(root, rel, content, texts)

	sections := []string{"Project files:\n" + strings.Join(tree, "\n")}
	if strings.Contains(content, "/api/db") || fnName(rel) != "" {
		if schema, err := s.userdb.SchemaSummary(ctx, project.Slug); err == nil && schema != "" {
			sections = append(sections, "Database tables:\n"+schema)
		}
	}
	for _, p := range related {
		text := contents[p]
		known[p] = lineCount(text)
		note := ""
		if jsconv.Len(text) > maxRelatedChars {
			text, note = jsconv.Slice(text, maxRelatedChars), " (dipotong)"
		}
		sections = append(sections, fmt.Sprintf("<related path=\"%s\"%s>\n%s</related>", p, note, numbered(text)))
	}
	sections = append(sections, fmt.Sprintf("FILE TO EXPLAIN: %s (%d lines)\n<file path=\"%s\">\n%s</file>", rel, known[rel], rel, numbered(content)))
	ask := strings.Join(sections, "\n\n") + "\n\n---\n\nExplain the flow of " + rel + " as described in the instructions.\n" + explainRules

	ctx, cancel := context.WithTimeout(ctx, explainTimeout)
	defer cancel()
	convo := []message{{"role": "system", "content": explainPrompt}, {"role": "user", "content": ask}}
	tokens := 0
	var ex *Explanation
	for attempt := 0; ; attempt++ {
		r, err := s.callAI(request{task: aimodels.TaskExplain, messages: convo, maxTokens: explainMaxTokens}, hooks{ctx: ctx})
		if err != nil {
			return nil, explainError(ctx, err, rel)
		}
		tokens += r.PromptTokens + r.CompletionTokens
		if err := checkFinish(r); err != nil {
			return nil, explainError(ctx, err, rel)
		}
		if os.Getenv("AI_DEBUG") != "" {
			log.Printf("----- AI baca alur %s (%s) -----\n%s", rel, r.FinishReason, r.Text)
		}
		var problem string
		ex, problem, err = parseExplanation(r.Text, known[rel], known)
		// Bisa dipakai tapi kurang (mis. tanpa nomor baris): minta perbaikan sekali; percobaan kedua diterima apa adanya.
		if err == nil && (problem == "" || attempt > 0) {
			break
		}
		if attempt > 0 || r.FinishReason == "length" {
			s.countExplain(user, day, tokens)
			if r.FinishReason == "length" {
				return nil, httpx.Errorf(422, "File ini terlalu panjang untuk dijelaskan sekaligus. Coba pecah menjadi beberapa file.")
			}
			return nil, explainError(ctx, err, rel)
		}
		// Format salah: minta sekali lagi dalam percakapan yang sama.
		if problem == "" {
			problem = "it was not valid JSON in the required shape"
		}
		convo = append(convo, message{"role": "assistant", "content": r.Text}, message{"role": "user", "content": "Your answer cannot be used: " + problem + ".\n" + explainRules})
	}
	s.countExplain(user, day, tokens)

	raw, _ := json.Marshal(ex)
	now := time.Now().UnixMilli()
	if _, err := s.db.Exec(`
		INSERT INTO code_explanations (project_id, path, hash, result, created_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (project_id, path) DO UPDATE SET hash = excluded.hash, result = excluded.result, created_at = excluded.created_at`,
		project.ID, rel, hash, string(raw), now); err != nil {
		return nil, err
	}
	saved := &savedExplanation{Explanation: ex, Hash: hash, CreatedAt: now}
	return map[string]any{"saved": saved, "cached": false, "remaining": max(0, remaining-1), "limit": s.cfg.AI.ExplainDailyLimit}, nil
}

func explainError(ctx context.Context, err error, rel string) error {
	var f *failure
	var he *httpx.Error
	var pe *providerError
	switch {
	case errors.As(err, &f):
		return &httpx.Error{Status: 422, Message: f.message}
	case errors.As(err, &he):
		return he
	case ctx.Err() != nil:
		return httpx.Errorf(504, "AI terlalu lama menjelaskan file ini. Coba lagi.")
	case errors.As(err, &pe) && pe.busy():
		return httpx.Errorf(503, "AI sedang sibuk atau tidak tersedia. Coba lagi sebentar lagi.")
	}
	log.Printf("ai: baca alur %s: %v", rel, err)
	return httpx.Errorf(502, "Terjadi kesalahan saat menghubungi AI.")
}

// AskExplain menjawab pertanyaan lanjutan tentang file (dan langkah yang sedang dibuka) di panel Baca Alur Kode.
func (s *Service) AskExplain(ctx context.Context, user *store.User, project *store.Project, body map[string]any) (any, error) {
	rel, content, err := explainInput(body)
	if err != nil {
		return nil, err
	}
	question := strings.TrimSpace(jsconv.String(body["question"]))
	if question == "" {
		return nil, httpx.Errorf(400, "Tulis pertanyaannya dulu")
	}
	question = jsconv.Slice(question, maxExplainQuestion)
	day, remaining, err := s.explainQuota(user)
	if err != nil {
		return nil, err
	}
	unlock, err := s.lockExplain(user)
	if err != nil {
		return nil, err
	}
	defer unlock()

	parts := []string{fmt.Sprintf("<file path=\"%s\">\n%s</file>", rel, numbered(content))}
	if saved, err := s.savedExplanation(project.ID, rel); err == nil && saved != nil && saved.Hash == HashContent(content) {
		parts = append(parts, "Explanation shown to the user: "+saved.Explanation.Summary)
		if n, ok := toInt(body["step"]); ok && n >= 1 && n <= len(saved.Explanation.Steps) {
			st := saved.Explanation.Steps[n-1]
			parts = append(parts, fmt.Sprintf("The user is looking at step %d \"%s\" (lines %v): %s", st.ID, st.Title, st.Lines, st.Explain))
		}
	}
	convo := []message{{"role": "system", "content": explainAskPrompt}, {"role": "user", "content": strings.Join(parts, "\n\n")}, {"role": "assistant", "content": "Baik, saya sudah membaca file dan penjelasannya."}}
	history := toList(body["history"])
	if len(history) > maxExplainHistory {
		history = history[len(history)-maxExplainHistory:]
	}
	for _, item := range history {
		m, _ := item.(map[string]any)
		q, a := toText(m["q"], maxExplainQuestion), toText(m["a"], 3000)
		if q != "" && a != "" {
			convo = append(convo, message{"role": "user", "content": q}, message{"role": "assistant", "content": a})
		}
	}
	convo = append(convo, message{"role": "user", "content": question})

	ctx, cancel := context.WithTimeout(ctx, explainAskTimeout)
	defer cancel()
	r, err := s.callAI(request{task: aimodels.TaskExplain, messages: convo, maxTokens: explainAskTokens}, hooks{ctx: ctx})
	if err != nil {
		return nil, explainError(ctx, err, rel)
	}
	s.countExplain(user, day, r.PromptTokens+r.CompletionTokens)
	if err := checkFinish(r); err != nil {
		return nil, explainError(ctx, err, rel)
	}
	answer := strings.TrimSpace(r.Text)
	if answer == "" {
		return nil, httpx.Errorf(422, "AI tidak memberi jawaban. Coba tanyakan dengan kalimat lain.")
	}
	return map[string]any{"answer": answer, "remaining": max(0, remaining-1)}, nil
}

package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"
	"time"

	"rakit.io/server/internal/aimodels"
	"rakit.io/server/internal/credits"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/store"
)

// Diagram project (UML, ERD, peta halaman, alur data) dibuat AI dalam kode Mermaid dan disimpan per
// project & jenis. Dibuat ulang hanya saat user menekan "Update diagram" (memakai kredit seperti prompt).
// Bila Mermaid gagal menggambar hasilnya, editor boleh minta perbaikan gratis beberapa kali.

const (
	diagramTimeout      = 280 * time.Second // di bawah proxy_read_timeout nginx (300 detik)
	maxDiagramFacts     = 30_000
	maxDiagramCode      = 60_000
	maxDiagramNotes     = 4
	maxFreeDiagramFixes = 2
)

type diagramKind struct {
	header []string // baris pertama kode yang diterima
	ask    string
}

// Tiap jenis punya batas ukuran: diagram untuk pemula harus bisa dipahami sekilas, bukan peta lengkap kode.
var diagramKinds = map[string]diagramKind{
	"usecase": {[]string{"flowchart", "graph"}, `a USE CASE diagram.
Size: 2-3 actors, at most 6 use cases. Actors: "Pengunjung", "Pemilik" (the owner manages data and content in the rakit.io editor), plus an external service only if the code really calls one.
Each use case is one goal a person has ("Melihat menu kue", "Memesan kue"), not a step or UI detail. Merge overlapping goals. No include/extend arrows.
Layout: flowchart LR; actors as P(["👤 Pengunjung"]) outside, use cases as U1(["Memesan kue"]) inside one subgraph named after the website.`},
	"activity": {[]string{"flowchart", "graph"}, `an ACTIVITY diagram of the ONE most important process a visitor goes through (e.g. placing an order or sending the form).
Size: at most 10 steps and at most 2 decisions. Steps are what the person or the website does, in plain words ("Mengisi form pesanan", "Data pesanan tersimpan") — no file names, URLs, function names or HTTP methods. No loops back unless the process really repeats.
Layout: flowchart TD, start S(("Mulai")), end E(("Selesai")), decisions D{"Data lengkap?"} with labeled branches.`},
	"sequence": {[]string{"sequenceDiagram"}, `a SEQUENCE diagram of the ONE most important interaction (usually the main form or data request).
Size: at most 4 participants and at most 8 messages. Participants: the visitor (actor), the page, the rakit.io API, and the database or an external service. Messages in plain Indonesian; a short path like /api/db/pesanan is fine.
Use autonumber; at most one alt block for the failure case.`},
	"class": {[]string{"classDiagram", "classDiagram-v2"}, `a CLASS diagram.
Size: at most 6 classes. One class per database table with all its columns as attributes (+tipe nama; include +number id and +date created_at). Add a class for a JavaScript file only when it has real functions; list those functions as methods, at most 4.
Relations only where they really exist (a reference column, or a script that reads/writes a table), with a short label.`},
	"state": {[]string{"stateDiagram-v2", "stateDiagram"}, `a STATE diagram of the ONE object whose status changes the most (e.g. an order: Baru → Diproses → Selesai, or a form: Diisi → Dikirim → Berhasil/Gagal).
Size: at most 6 states, every state reachable, with [*] start and end. Only states the code or data really supports; if a status column exists, use its values.`},
	"erd": {[]string{"erDiagram"}, `an ERD of the database tables: every table with all its columns (types, PK/FK, "wajib"/"privat" as comment), plus relationships with correct cardinality from reference columns.
Every table always has "number id PK" and "date created_at". Nothing that is not a table.`},
	"site": {[]string{"flowchart", "graph"}, `a SITE MAP.
Size: every HTML page (label = page title, then the file name on a second line), the links between pages, and the CSS/JS files each page loads, drawn once each with a different shape, e.g. C[/"style.css"/].
Draw a link between two pages once (no duplicate arrows in both directions — use A <--> B). Mark broken links/missing files with a dashed edge -.-> labeled "rusak". Use flowchart LR.`},
	"flow": {[]string{"flowchart", "graph"}, `a DATA FLOW diagram: which pages (and functions/ files) read or write which database tables or external services.
Size: at most 12 edges. Only pages, scripts and functions that really call /api/db or /api/fn (see "calls" in the analysis) — leave out pages that do not use data. Merge a page with the script it loads into one node ("Halaman Pesan (pesan.js)"). Edge label = the operation in Indonesian (baca / tambah / ubah / hapus).
Only requests the analysis marks as "missing" or "owner_only" get a dashed edge labeled "ditolak". Use flowchart LR, pages on the left, tables on the right.`},
}

// ValidDiagramKind: jenis diagram yang dikenal.
func ValidDiagramKind(kind string) bool { _, ok := diagramKinds[kind]; return ok }

const diagramPrompt = `You draw ONE software diagram of a user's website project on rakit.io (an online editor where beginners learn to build
websites; pages are static HTML/CSS/JS, data is stored through rakit.io's built-in /api/db/<table> REST API, and functions/<name>.js
are serverless functions at /api/fn/<name>). You get the project's files, its database tables and an automatic analysis.

The reader is a beginner. The diagram must be understandable at a glance:
- SIMPLE beats complete. Stay within the size limits of the requested diagram; leave out minor details rather than crowding it.
- Only what really exists in the files/tables. Never invent features, pages, actors or tables.
- All labels in Indonesian, short (at most ~5 words), written for people. Use "Pengunjung" and "Pemilik", never "Visitor"/"User"/"Admin".
- No styling (no classDef/style) except marking a problem in red.

Answer in exactly this format and nothing else:
` + "```mermaid" + `
<the Mermaid code>
` + "```" + `
- [level] note

Notes: 1-4 short notes in Indonesian for a beginner about THIS diagram: what it shows (info/ok), and real problems worth
fixing (warn/error): tables anyone can change or delete (public update/delete), broken links, missing files, requests that
will be rejected, unused tables, pages nobody links to. Do NOT warn about normal, intended setups: a public "create" for a form,
private columns, owner-only reading, or empty tables. level is one of ok, info, warn, error. Never draw the diagram with box-drawing or ASCII characters — only Mermaid code.

If the project has nothing that this kind of diagram can show (e.g. ERD without tables), answer with one line instead:
NONE: <reason in Indonesian, one sentence, and what the user can build so this diagram becomes meaningful>

Mermaid rules (version 12, rendered with securityLevel strict — invalid syntax breaks the whole diagram):
- The first line is the diagram type. No %%{init}%% directives, no click, no links, no Markdown inside labels; <br/> is the only HTML allowed.
- Node/participant/class/state/entity ids: ASCII letters, digits and underscore only, starting with a letter. Never use
  reserved words as ids (end, graph, subgraph, flowchart, class, state, style, default, direction).
- flowchart: put EVERY label in double quotes, e.g. A["Halaman Beranda"], B{"Valid?"}, edge labels as A -->|"simpan"| B.
  Labels must not contain double quotes or backticks; replace them with single quotes. Every subgraph has a matching end.
- erDiagram: entity and attribute names use only [A-Za-z0-9_]; attribute type is one word; keys are PK, FK or PK, FK;
  attribute comments in double quotes; relationship label in double quotes, e.g. a ||--o{ b : "punya".
- sequenceDiagram: participant P as Label (no quotes); message text after the colon must not contain ; or #. Every alt/opt/loop
  has a matching end.
- classDiagram: class names [A-Za-z0-9_]; members like +String nama or +simpan(); a label on a relation goes after a colon.
- stateDiagram-v2: state ids [A-Za-z0-9_]; long names via state "Menunggu pembayaran" as Menunggu; transitions Id1 --> Id2 : label.`

// DiagramNote: satu catatan di samping diagram.
type DiagramNote struct {
	Level string `json:"level"`
	Text  string `json:"text"`
}

type savedDiagram struct {
	Code      string        `json:"code"`
	Notes     []DiagramNote `json:"notes"`
	UpdatedAt int64         `json:"updatedAt"`
	CanFix    bool          `json:"canFix"` // masih boleh minta perbaikan gratis
}

func (s *Service) diagram(projectID int64, kind string) (*savedDiagram, error) {
	var d savedDiagram
	var notes string
	var fixes int
	err := s.db.QueryRow("SELECT code, notes, fixes, updated_at FROM project_diagrams WHERE project_id = ? AND kind = ?", projectID, kind).
		Scan(&d.Code, &notes, &fixes, &d.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	json.Unmarshal([]byte(notes), &d.Notes)
	if d.Notes == nil {
		d.Notes = []DiagramNote{}
	}
	d.CanFix = fixes < maxFreeDiagramFixes
	return &d, nil
}

// Diagrams: semua diagram tersimpan project, per jenis.
func (s *Service) Diagrams(project *store.Project) (any, error) {
	out := map[string]*savedDiagram{}
	for kind := range diagramKinds {
		d, err := s.diagram(project.ID, kind)
		if err != nil {
			return nil, err
		}
		if d != nil {
			out[kind] = d
		}
	}
	return map[string]any{"diagrams": out}, nil
}

var (
	mermaidBlockRE = regexp.MustCompile("(?s)```[ \\t]*(?:mermaid)?[ \\t]*\\r?\\n(.*?)```")
	// Catatan: "- [warn] teks", tapi model kadang menulis "1. **teks**" tanpa level — tetap diterima (level info).
	diagramNoteRE = regexp.MustCompile(`(?m)^[ \t]*(?:[-*•]|\d+[.)])[ \t]+(?:\[(ok|info|warn|error)\][ \t]*)?(.+?)[ \t]*$`)
	markdownRE    = regexp.MustCompile("\\*\\*|__|`")
	diagramNoneRE = regexp.MustCompile(`(?m)^[ \t]*NONE:[ \t]*(.+)$`)
)

// parseDiagram memisahkan kode Mermaid dan catatan dari jawaban AI.
func parseDiagram(kind, text string) (string, []DiagramNote, error) {
	var m []string
	for _, block := range mermaidBlockRE.FindAllStringSubmatch(text, -1) {
		if m == nil || strings.HasPrefix(strings.TrimSpace(block[0]), "```mermaid") {
			m = block
		}
		if strings.HasPrefix(strings.TrimSpace(block[0]), "```mermaid") {
			break
		}
	}
	if m == nil {
		if none := diagramNoneRE.FindStringSubmatch(text); none != nil {
			return "", nil, &failure{"ok", "Belum ada yang bisa digambar: " + jsconv.Slice(strings.TrimSpace(none[1]), 300) + " Kredit dikembalikan."}
		}
		return "", nil, &failure{"bad_output", "AI tidak mengirim kode diagram. Coba lagi. Kredit dikembalikan."}
	}
	code := strings.TrimSpace(m[1])
	first := strings.Fields(diagramHeader(code))
	ok := false
	for _, h := range diagramKinds[kind].header {
		ok = ok || (len(first) > 0 && first[0] == h)
	}
	if !ok || len(code) > maxDiagramCode {
		return "", nil, &failure{"bad_output", "AI mengirim diagram yang tidak sesuai. Coba lagi. Kredit dikembalikan."}
	}
	notes := []DiagramNote{}
	rest := strings.Replace(text, m[0], "", 1)
	for _, n := range diagramNoteRE.FindAllStringSubmatch(rest, -1) {
		text := strings.TrimSpace(markdownRE.ReplaceAllString(n[2], ""))
		if text == "" || len(notes) == maxDiagramNotes {
			continue
		}
		level := n[1]
		if level == "" {
			level = "info"
		}
		notes = append(notes, DiagramNote{level, jsconv.Slice(text, 300)})
	}
	return code, notes, nil
}

// diagramHeader: baris pertama yang berisi kode (melewati front matter "---" dan komentar "%%").
func diagramHeader(code string) string {
	lines := strings.Split(code, "\n")
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "---" {
			for i++; i < len(lines) && strings.TrimSpace(lines[i]) != "---"; i++ {
			}
			continue
		}
		if line != "" && !strings.HasPrefix(line, "%%") {
			return line
		}
	}
	return ""
}

// GenerateDiagram membuat (atau, bila renderError diisi, memperbaiki) diagram satu jenis lalu menyimpannya.
// facts: hasil analisis otomatis project (bahan diagram lama), dikirim ke AI sebagai bantuan.
func (s *Service) GenerateDiagram(ctx context.Context, user *store.User, project *store.Project, kind string, facts any, renderError string) (any, error) {
	if !s.models.Enabled() {
		return nil, httpx.Errorf(503, "Fitur AI belum dikonfigurasi di server")
	}
	spec, ok := diagramKinds[kind]
	if !ok {
		return nil, httpx.Errorf(400, "Jenis diagram tidak dikenal")
	}
	fixing := renderError != ""
	var previous *savedDiagram
	if fixing {
		var err error
		if previous, err = s.diagram(project.ID, kind); err != nil {
			return nil, err
		}
		if previous == nil {
			return nil, httpx.Errorf(404, "Diagram belum dibuat")
		}
		if !previous.CanFix {
			return nil, httpx.Errorf(429, "Batas perbaikan gratis sudah habis. Tekan Update diagram untuk membuat ulang.")
		}
	}

	// Satu pekerjaan AI per akun (sama dengan prompt editor).
	s.mu.Lock()
	if s.running[user.ID] {
		s.mu.Unlock()
		return nil, httpx.Errorf(429, "AI masih mengerjakan permintaan lain. Tunggu sampai selesai.")
	}
	s.running[user.ID] = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.running, user.ID)
		s.mu.Unlock()
	}()

	var reservation *credits.Reservation
	if !fixing {
		var err error
		if reservation, err = s.credits.Reserve(user.ID, s.cfg.AI.CreditsPerPrompt); err != nil {
			return nil, err
		}
	}

	ctx, cancel := context.WithTimeout(ctx, diagramTimeout)
	defer cancel()
	status := "error"
	usedModel, _ := s.models.For(aimodels.TaskDiagram)
	inTokens, outTokens := 0, 0
	code, notes, err := func() (string, []DiagramNote, error) {
		projectContext, err := s.projectContext(ctx, project.Slug, "", nil)
		if err != nil {
			return "", nil, err
		}
		rawFacts, _ := json.Marshal(facts)
		ask := fmt.Sprintf("%s\n\nAutomatic analysis (from the files; dynamic URLs may be missing):\n%s\n\n---\n\nDraw %s\n\n"+
			"Reply with a ```mermaid code block whose first line is %s. After the block, write 1-4 notes in Indonesian, each line exactly like:\n"+
			"- [info] Satu produk bisa dipesan berkali-kali.\n- [warn] Siapa pun bisa menghapus data di tabel pesanan.\nNo heading, no other text. "+
			"Use warn only for real problems; a form that lets visitors add data (public create) and private columns are correct and need no warning.",
			projectContext, jsconv.Slice(string(rawFacts), maxDiagramFacts), spec.ask, spec.header[0])
		convo := []message{{"role": "system", "content": diagramPrompt}, {"role": "user", "content": ask}}
		if fixing {
			convo = append(convo,
				message{"role": "assistant", "content": "```mermaid\n" + previous.Code + "\n```"},
				message{"role": "user", "content": "Mermaid could not render that diagram:\n" + jsconv.Slice(renderError, 1000) +
					"\n\nFix the syntax (keep the content) and answer again in the same format."})
		}
		// Format salah (mis. digambar dengan karakter ASCII): minta sekali lagi, tanpa kredit tambahan.
		for attempt := 0; ; attempt++ {
			r, err := s.callAI(request{task: aimodels.TaskDiagram, messages: convo}, hooks{ctx: ctx, onModel: func(model string) { usedModel = model }})
			if err != nil {
				return "", nil, err
			}
			inTokens += r.PromptTokens
			outTokens += r.CompletionTokens
			if err := checkFinish(r); err != nil {
				return "", nil, err
			}
			if r.FinishReason == "length" {
				return "", nil, &failure{"bad_output", "Diagram terlalu besar untuk dibuat sekaligus. Kredit dikembalikan."}
			}
			if os.Getenv("AI_DEBUG") != "" {
				log.Printf("----- AI diagram %s (%s) -----\n%s", kind, r.FinishReason, r.Text)
			}
			code, notes, err := parseDiagram(kind, r.Text)
			var f *failure
			if attempt == 0 && errors.As(err, &f) && f.aiStatus == "bad_output" {
				convo = append(convo, message{"role": "assistant", "content": r.Text}, message{"role": "user", "content": fmt.Sprintf(
					"That is not in the required format. Reply again with only a ```mermaid code block whose first line is %s, followed by 1-4 notes.", spec.header[0])})
				continue
			}
			status = "ok"
			return code, notes, err
		}
	}()
	defer func() {
		detail := kind
		if fixing {
			detail += " (perbaiki)"
		}
		s.logRequest(user.ID, project.ID, "diagram", detail, usedModel, status, inTokens, outTokens)
	}()

	if err != nil {
		s.credits.Refund(user.ID, reservation)
		var f *failure
		var he *httpx.Error
		var pe *providerError
		switch {
		case errors.As(err, &f):
			if f.aiStatus != "ok" {
				status = f.aiStatus
			}
			return nil, &httpx.Error{Status: 422, Message: f.message}
		case errors.As(err, &he):
			return nil, he
		case ctx.Err() != nil:
			status = "aborted"
			return nil, httpx.Errorf(504, "AI terlalu lama membuat diagram. Coba lagi. Kredit dikembalikan.")
		case errors.As(err, &pe) && pe.busy():
			return nil, httpx.Errorf(503, "AI sedang sibuk atau tidak tersedia. Coba lagi sebentar lagi. Kredit dikembalikan.")
		default:
			log.Printf("ai: diagram %s/%s: %v", project.Slug, kind, err)
			return nil, httpx.Errorf(502, "Terjadi kesalahan saat menghubungi AI. Kredit dikembalikan.")
		}
	}

	rawNotes, _ := json.Marshal(notes)
	now := time.Now().UnixMilli()
	if fixing {
		_, err = s.db.Exec("UPDATE project_diagrams SET code = ?, notes = ?, fixes = fixes + 1 WHERE project_id = ? AND kind = ?",
			code, string(rawNotes), project.ID, kind)
	} else {
		_, err = s.db.Exec(`
			INSERT INTO project_diagrams (project_id, kind, code, notes, fixes, updated_at) VALUES (?, ?, ?, ?, 0, ?)
			ON CONFLICT (project_id, kind) DO UPDATE SET code = excluded.code, notes = excluded.notes, fixes = 0, updated_at = excluded.updated_at`,
			project.ID, kind, code, string(rawNotes), now)
	}
	if err != nil {
		s.credits.Refund(user.ID, reservation)
		return nil, err
	}
	saved, err := s.diagram(project.ID, kind)
	if err != nil {
		return nil, err
	}
	return map[string]any{"diagram": saved, "credits": s.credits.Info(user.ID)}, nil
}

package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

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
	maxDiagramNotes     = 8
	maxFreeDiagramFixes = 2
)

type diagramKind struct {
	header []string // baris pertama kode yang diterima
	ask    string
}

var diagramKinds = map[string]diagramKind{
	"usecase": {[]string{"flowchart"}, "a USE CASE diagram: actors (visitor, owner/admin, external services the code calls) on the left, " +
		"the use cases they can perform inside a `subgraph` for the system boundary. Use `flowchart LR`; actors as `A([\"👤 Name\"])`, use cases as `U1([\"Name\"])`."},
	"activity": {[]string{"flowchart"}, "an ACTIVITY diagram of the main process(es) a visitor goes through (e.g. open page → fill form → submit → data saved → result shown), " +
		"with start `S((\" \"))`/end `E(((\" \")))` nodes, decisions as `D{\"Question?\"}` and labeled branches. Use `flowchart TD`."},
	"sequence": {[]string{"sequenceDiagram"}, "a SEQUENCE diagram of the most important interaction(s): visitor, browser page/script, the rakit.io API (/api/db, /api/fn) " +
		"and the database or external services, in order. Use `sequenceDiagram` with `autonumber`; use `alt`/`opt` for failures or conditions where it matters."},
	"class": {[]string{"classDiagram"}, "a CLASS diagram: one class per database table (attributes with types; include `id` and `created_at`) and per important " +
		"JavaScript module/object/function group (methods), with associations between them."},
	"state": {[]string{"stateDiagram-v2", "stateDiagram"}, "a STATE diagram of the most important object whose status changes (e.g. an order, a form submission, " +
		"a booking, or the page UI: loading → loaded → error). Use `stateDiagram-v2` with `[*]` start/end."},
	"erd": {[]string{"erDiagram"}, "an ERD of the database tables: every table with all its columns (types, PK/FK, \"wajib\"/\"privat\" as comment), plus " +
		"relationships with correct cardinality. Every table always has `number id PK` and `date created_at`."},
	"site": {[]string{"flowchart"}, "a SITE MAP: every HTML page (label = page title + file name), the links between pages, and the CSS/JS files each page loads " +
		"(draw assets with a different shape, e.g. `C[/\"style.css\"/]`). Mark broken links/missing files clearly (dashed edge `-.->` and a label). Use `flowchart LR`."},
	"flow": {[]string{"flowchart"}, "a DATA FLOW diagram: which pages/scripts/functions read or write which database tables and external services, with the " +
		"operation on each edge (baca/tambah/ubah/hapus). Requests the server will reject (table missing or access not public) get a dashed edge and \"ditolak\" in the label. Use `flowchart LR`."},
}

// ValidDiagramKind: jenis diagram yang dikenal.
func ValidDiagramKind(kind string) bool { _, ok := diagramKinds[kind]; return ok }

const diagramPrompt = `You draw software diagrams of a user's website project on rakit.io (an online editor where beginners build websites;
pages are static HTML/CSS/JS, data is stored through rakit.io's built-in /api/db/<table> REST API, and functions/<name>.js are
serverless functions at /api/fn/<name>). You get the project's files, its database tables and an automatic analysis.

Describe the project exactly as it is: only things that exist in the files/tables. Never invent features. Prefer the most
important ~30 nodes over drawing everything; group related things with subgraph where it helps. All labels are in Indonesian.

Answer in exactly this format and nothing else:
` + "```mermaid" + `
<the Mermaid code>
` + "```" + `
- [level] note
- [level] note

Notes: 0-8 short notes in Indonesian for a beginner about what the diagram reveals (security problems such as tables anyone can
change/delete, broken links, missing files, requests that will be rejected, unused tables, pages nobody links to). level is
one of ok, info, warn, error. No other text before or after.

If the project has nothing that this kind of diagram can show (e.g. ERD without tables), answer with one line instead:
NONE: <reason in Indonesian, one sentence, and what the user can build so this diagram becomes meaningful>

Mermaid rules (version 12, rendered with securityLevel strict — invalid syntax breaks the whole diagram):
- The first line is the diagram type. No %%{init}%% directives, no click, no links, no HTML tags, no Markdown inside labels.
- Node/participant/class/state/entity ids: ASCII letters, digits and underscore only, starting with a letter. Never use
  reserved words as ids (end, graph, subgraph, flowchart, class, state, style, default, direction).
- flowchart: put EVERY label in double quotes, e.g. A["Halaman Beranda"], B{"Valid?"}, edge labels as A -->|"simpan"| B.
  Labels must not contain double quotes or backticks; replace them with single quotes. Every subgraph has a matching end.
  You may style with classDef/class (colors in hex), e.g. classDef warn stroke:#ef4444,color:#fecaca.
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
	diagramNoteRE  = regexp.MustCompile(`(?m)^[ \t]*[-*][ \t]*\[(ok|info|warn|error)\][ \t]*(.+?)[ \t]*$`)
	diagramNoneRE  = regexp.MustCompile(`(?m)^[ \t]*NONE:[ \t]*(.+)$`)
)

// parseDiagram memisahkan kode Mermaid dan catatan dari jawaban AI.
func parseDiagram(kind, text string) (string, []DiagramNote, error) {
	m := mermaidBlockRE.FindStringSubmatch(text)
	if m == nil {
		if none := diagramNoneRE.FindStringSubmatch(text); none != nil {
			return "", nil, &failure{"ok", "Belum ada yang bisa digambar: " + jsconv.Slice(strings.TrimSpace(none[1]), 300) + " Kredit dikembalikan."}
		}
		return "", nil, &failure{"bad_output", "AI tidak mengirim kode diagram. Coba lagi. Kredit dikembalikan."}
	}
	code := strings.TrimSpace(m[1])
	first := strings.Fields(strings.SplitN(code, "\n", 2)[0])
	ok := false
	for _, h := range diagramKinds[kind].header {
		ok = ok || (len(first) > 0 && first[0] == h)
	}
	if !ok || len(code) > maxDiagramCode {
		return "", nil, &failure{"bad_output", "AI mengirim diagram yang tidak sesuai. Coba lagi. Kredit dikembalikan."}
	}
	notes := []DiagramNote{}
	rest := strings.Replace(text, m[0], "", 1)
	for _, n := range diagramNoteRE.FindAllStringSubmatch(rest, maxDiagramNotes) {
		notes = append(notes, DiagramNote{n[1], jsconv.Slice(n[2], 300)})
	}
	return code, notes, nil
}

// GenerateDiagram membuat (atau, bila renderError diisi, memperbaiki) diagram satu jenis lalu menyimpannya.
// facts: hasil analisis otomatis project (bahan diagram lama), dikirim ke AI sebagai bantuan.
func (s *Service) GenerateDiagram(ctx context.Context, user *store.User, project *store.Project, kind string, facts any, renderError string) (any, error) {
	if !s.cfg.AI.Enabled {
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
	status, usedModel := "error", s.models.Get().Model
	inTokens, outTokens := 0, 0
	code, notes, err := func() (string, []DiagramNote, error) {
		projectContext, err := s.projectContext(ctx, project.Slug, "", nil)
		if err != nil {
			return "", nil, err
		}
		rawFacts, _ := json.Marshal(facts)
		ask := fmt.Sprintf("%s\n\nAutomatic analysis (from the files; dynamic URLs may be missing):\n%s\n\n---\n\nDraw %s",
			projectContext, jsconv.Slice(string(rawFacts), maxDiagramFacts), spec.ask)
		convo := []message{{"role": "system", "content": diagramPrompt}, {"role": "user", "content": ask}}
		if fixing {
			convo = append(convo,
				message{"role": "assistant", "content": "```mermaid\n" + previous.Code + "\n```"},
				message{"role": "user", "content": "Mermaid could not render that diagram:\n" + jsconv.Slice(renderError, 1000) +
					"\n\nFix the syntax (keep the content) and answer again in the same format."})
		}
		r, err := s.callAI(request{messages: convo}, hooks{ctx: ctx, onModel: func(model string) { usedModel = model }})
		if err != nil {
			return "", nil, err
		}
		inTokens, outTokens = r.PromptTokens, r.CompletionTokens
		if err := checkFinish(r); err != nil {
			return "", nil, err
		}
		if r.FinishReason == "length" {
			return "", nil, &failure{"bad_output", "Diagram terlalu besar untuk dibuat sekaligus. Kredit dikembalikan."}
		}
		status = "ok"
		return parseDiagram(kind, r.Text)
	}()
	defer func() {
		s.db.Exec("INSERT INTO ai_requests (user_id, created_at, model, status, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?)",
			user.ID, time.Now().UnixMilli(), usedModel, status, inTokens, outTokens)
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

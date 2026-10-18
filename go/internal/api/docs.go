package api

import (
	"regexp"
	"slices"
	"strings"

	"rakit.io/server/internal/ai"
	"rakit.io/server/internal/fn"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/store"
)

// Tab Dokumentasi (GET /api/docs): dokumentasi project yang disusun otomatis tanpa AI — API database per tabel,
// API fungsi serverless (method, parameter, rahasia & tabel yang dipakai, dibaca dari kodenya), struktur database,
// dan konfigurasi (alamat website, rahasia, provider AI, jadwal). Bahan tabel & pemakaiannya sama dengan diagram
// (projectFacts). Masalah yang ketahuan (rahasia belum diisi, tabel/fungsi tidak ada) dikirim sebagai issues; teksnya
// disusun editor (assets-source/editor/docs).

var (
	fnCallRE      = regexp.MustCompile(`/api/fn/([a-z0-9][a-z0-9_-]{0,39})`)
	fnMethodRE    = regexp.MustCompile(`req\.method\s*[!=]==?\s*['"]([A-Za-z]+)['"]|case\s+['"](GET|POST|PUT|PATCH|DELETE|CRON)['"]`)
	fnFieldRE     = regexp.MustCompile(`req\.(query|body)(?:\.([A-Za-z_$][\w$]*)|\[\s*['"]([^'"]+)['"]\s*\])`)
	fnDestructRE  = regexp.MustCompile(`\{([^{}]*)\}\s*=\s*(req\.query|req\.body|env)\b`)
	fnEnvRE       = regexp.MustCompile(`\benv(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([^'"]+)['"]\s*\])`)
	fnDBRE        = regexp.MustCompile("\\bdb\\.(list|get|insert|update|delete)\\(\\s*['\"`]([a-z][a-z0-9_]*)['\"`]")
	fnAIRE        = regexp.MustCompile(`\bai\.(chat|json|embed)\s*\(`)
	fnFetchRE     = regexp.MustCompile("\\bfetch\\(\\s*['\"`]https?://([^/'\"`\\s$:]+)")
	fnLineNoteRE  = regexp.MustCompile(`^\s*//\s?(.*)$`)
	fnBlockNoteRE = regexp.MustCompile(`(?s)^\s*/\*+(.*?)\*/`)
	identRE       = regexp.MustCompile(`^[A-Za-z_$][\w$]*`)
	metaRE        = regexp.MustCompile(`(?i)<meta\b[^>]*>`)
	metaNameRE    = regexp.MustCompile(`(?i)\bname\s*=\s*["']description["']`)
	metaContentRE = regexp.MustCompile(`(?i)\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'`)
)

// docPage: satu halaman di Peta Halaman — tautan keluar & masuk, file CSS/JS, dan form.
type docPage struct {
	Path        string      `json:"path"`
	Title       string      `json:"title"`
	Description string      `json:"description"` // <meta name="description">
	Orphan      bool        `json:"orphan"`      // tidak ditautkan dari halaman lain (selain index.html & 404.html)
	Links       []pageLink  `json:"links"`
	LinkedFrom  []string    `json:"linkedFrom"`
	Assets      []pageAsset `json:"assets"`
	Forms       []pageForm  `json:"forms"`
}

// pageDescription: isi <meta name="description"> ("" bila tidak ada).
func pageDescription(html string) string {
	for _, tag := range metaRE.FindAllString(html, -1) {
		if !metaNameRE.MatchString(tag) {
			continue
		}
		if m := metaContentRE.FindStringSubmatch(tag); m != nil {
			return plainText(m[1]+m[2], 300)
		}
	}
	return ""
}

// docPages menyusun Peta Halaman dari bahan diagram (projectFacts) beserta masalahnya: tautan rusak, file CSS/JS
// yang tidak ada, dan halaman yang tidak ditautkan dari mana pun.
func docPages(facts map[string]any, contents map[string]string) ([]*docPage, []docIssue) {
	pages := []*docPage{}
	byPath := map[string]*docPage{}
	for _, p := range facts["pages"].([]*diagramPage) {
		d := &docPage{Path: p.Path, Title: p.Title, Description: pageDescription(contents[p.Path]), Orphan: p.Orphan,
			Links: []pageLink{}, LinkedFrom: []string{}, Assets: []pageAsset{}, Forms: []pageForm{}}
		pages = append(pages, d)
		byPath[p.Path] = d
	}
	issues := []docIssue{}
	for _, l := range facts["links"].([]pageLink) {
		if d := byPath[l.From]; d != nil {
			d.Links = append(d.Links, l)
		}
		if l.Broken {
			issues = append(issues, docIssue{Kind: "broken_link", Name: l.To, File: l.From})
		} else if d := byPath[l.To]; d != nil {
			d.LinkedFrom = append(d.LinkedFrom, l.From)
		}
	}
	for _, a := range facts["assets"].([]pageAsset) {
		if d := byPath[a.From]; d != nil {
			d.Assets = append(d.Assets, a)
		}
		if a.Missing {
			issues = append(issues, docIssue{Kind: "missing_asset", Name: a.To, File: a.From})
		}
	}
	for _, f := range facts["forms"].([]pageForm) {
		if d := byPath[f.Page]; d != nil {
			d.Forms = append(d.Forms, f)
		}
	}
	for _, d := range pages {
		if d.Orphan {
			issues = append(issues, docIssue{Kind: "orphan_page", Name: d.Path, File: d.Path})
		}
	}
	return pages, issues
}

var dbOpOf = map[string]string{"list": "list", "get": "view", "insert": "create", "update": "update", "delete": "delete"}

var methodOrder = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "CRON"}

type docTableUse struct {
	Table string   `json:"table"`
	Ops   []string `json:"ops"`
}

type docFunction struct {
	Name     string        `json:"name"`
	Path     string        `json:"path"`
	URL      string        `json:"url"`
	Summary  string        `json:"summary"` // komentar di awal file
	Methods  []string      `json:"methods"` // kosong = tidak memeriksa req.method (semua method diterima)
	Query    []string      `json:"query"`
	Body     []string      `json:"body"`
	Secrets  []string      `json:"secrets"`
	Tables   []docTableUse `json:"tables"`
	AI       []string      `json:"ai"`      // fungsi library ai yang dipanggil
	Fetches  []string      `json:"fetches"` // host layanan luar yang dipanggil
	Schedule *fn.Schedule  `json:"schedule"`
	UsedBy   []string      `json:"usedBy"` // file website yang memanggil /api/fn/<nama>
}

type docSecret struct {
	Name      string   `json:"name"`
	UpdatedAt int64    `json:"updatedAt"`
	UsedBy    []string `json:"usedBy"`
}

type docProvider struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Model   string `json:"model"`
	Default bool   `json:"default"`
}

// docIssue: masalah yang ketahuan dari kode. Kind: missing_secret (Fn memakai env.Name yang belum diisi),
// missing_table (File/Fn memakai tabel Name yang tidak ada), missing_function (File memanggil fungsi Name yang
// tidak ada), owner_only (File memakai operasi Op pada tabel Name yang hanya untuk pemilik), broken_link (halaman
// File menautkan ke Name yang tidak ada), missing_asset (halaman File memuat CSS/JS Name yang tidak ada),
// orphan_page (halaman Name tidak ditautkan dari halaman lain).
type docIssue struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
	File string `json:"file,omitempty"`
	Fn   string `json:"fn,omitempty"`
	Op   string `json:"op,omitempty"`
}

// addUnique menambah v ke list bila belum ada.
func addUnique(list []string, v string) []string {
	if v == "" || slices.Contains(list, v) {
		return list
	}
	return append(list, v)
}

// destructured: nama variabel dari pola { a, b: c, d = 1, ...rest }.
func destructured(inner string) []string {
	var out []string
	for _, part := range strings.Split(inner, ",") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "...") {
			continue
		}
		if name := identRE.FindString(part); name != "" {
			out = addUnique(out, name)
		}
	}
	return out
}

// fnSummary: komentar di awal file fungsi (baris // atau satu blok /* */), digabung jadi satu paragraf.
func fnSummary(code string) string {
	code = strings.TrimPrefix(code, "\uFEFF")
	var lines []string
	if m := fnBlockNoteRE.FindStringSubmatch(code); m != nil {
		for _, l := range strings.Split(m[1], "\n") {
			lines = append(lines, strings.TrimLeft(strings.TrimSpace(l), "* "))
		}
	} else {
		for _, l := range strings.Split(code, "\n") {
			m := fnLineNoteRE.FindStringSubmatch(l)
			if m == nil {
				if strings.TrimSpace(l) == "" && len(lines) == 0 {
					continue
				}
				break
			}
			lines = append(lines, strings.TrimSpace(m[1]))
		}
	}
	text := strings.Join(strings.Fields(strings.Join(lines, " ")), " ")
	if jsconv.Len(text) > 400 {
		text = strings.TrimSpace(jsconv.Slice(text, 399)) + "…"
	}
	return text
}

// analyzeFunction membaca kode fungsi: method yang diperiksa, isian query/body, rahasia, tabel, AI, dan layanan luar.
func analyzeFunction(code string) docFunction {
	d := docFunction{Summary: fnSummary(code), Methods: []string{}, Query: []string{}, Body: []string{}, Secrets: []string{},
		Tables: []docTableUse{}, AI: []string{}, Fetches: []string{}, UsedBy: []string{}}
	methods := map[string]bool{}
	for _, m := range fnMethodRE.FindAllStringSubmatch(code, -1) {
		methods[strings.ToUpper(m[1]+m[2])] = true
	}
	for _, name := range methodOrder {
		if methods[name] {
			d.Methods = append(d.Methods, name)
		}
	}
	for _, m := range fnFieldRE.FindAllStringSubmatch(code, -1) {
		field := m[2] + m[3]
		if m[1] == "query" {
			d.Query = addUnique(d.Query, field)
		} else {
			d.Body = addUnique(d.Body, field)
		}
	}
	for _, m := range fnDestructRE.FindAllStringSubmatch(code, -1) {
		for _, name := range destructured(m[1]) {
			switch m[2] {
			case "req.query":
				d.Query = addUnique(d.Query, name)
			case "req.body":
				d.Body = addUnique(d.Body, name)
			default:
				d.Secrets = addUnique(d.Secrets, name)
			}
		}
	}
	for _, m := range fnEnvRE.FindAllStringSubmatch(code, -1) {
		d.Secrets = addUnique(d.Secrets, m[1]+m[2])
	}
	for _, m := range fnDBRE.FindAllStringSubmatch(code, -1) {
		op, table := dbOpOf[m[1]], m[2]
		i := slices.IndexFunc(d.Tables, func(t docTableUse) bool { return t.Table == table })
		if i < 0 {
			d.Tables = append(d.Tables, docTableUse{Table: table, Ops: []string{}})
			i = len(d.Tables) - 1
		}
		d.Tables[i].Ops = addUnique(d.Tables[i].Ops, op)
	}
	for _, m := range fnAIRE.FindAllStringSubmatch(code, -1) {
		d.AI = addUnique(d.AI, m[1])
	}
	for _, m := range fnFetchRE.FindAllStringSubmatch(code, -1) {
		d.Fetches = addUnique(d.Fetches, strings.ToLower(m[1]))
	}
	return d
}

// Rute: GET /api/docs (dokumentasi + Catatan Project), PUT /api/docs/notes { notes } (simpan catatan),
// POST /api/docs/notes/draft { notes? } (draf catatan buatan AI, 1 kredit, tidak disimpan).
func (h *Handler) docs(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	if !q.is("GET") && !q.is("PUT", "notes") && !q.is("POST", "notes", "draft") {
		return errNotFound
	}
	project, err := h.loadProject(q)
	if err != nil {
		return err
	}
	switch {
	case q.is("PUT", "notes"):
		if err := q.load(); err != nil {
			return err
		}
		notes, ok := q.body["notes"].(string)
		if !ok {
			return httpx.Errorf(400, "Catatan harus berupa teks")
		}
		saved, err := h.svc.AI.SaveNotes(project, notes)
		if err != nil {
			return err
		}
		return q.json(200, map[string]any{"notes": saved})
	case q.is("POST", "notes", "draft"):
		if err := q.load(); err != nil {
			return err
		}
		// Dasar draf: isi kotak teks editor bila dikirim (boleh belum disimpan), selain itu catatan tersimpan.
		current, ok := q.body["notes"].(string)
		if !ok {
			current = h.svc.AI.ProjectNotes(project.ID)
		}
		out, err := h.projectDocs(q, project)
		if err != nil {
			return err
		}
		draft, err := h.svc.AI.DraftNotes(q.r.Context(), q.user, project, notesFacts(out), current, q.lang())
		if err != nil {
			return err
		}
		return q.json(200, draft)
	}
	out, err := h.projectDocs(q, project)
	if err != nil {
		return err
	}
	out["notes"] = h.svc.AI.ProjectNotes(project.ID)
	out["notesMax"] = ai.MaxNotes
	return q.json(200, out)
}

// notesFacts: ringkasan dokumentasi untuk draf Catatan Project (tanpa isi rahasia, URL, dan contoh).
func notesFacts(docs map[string]any) map[string]any {
	type fnFact struct {
		Name    string        `json:"name"`
		Summary string        `json:"summary,omitempty"`
		Methods []string      `json:"methods,omitempty"`
		Tables  []docTableUse `json:"tables,omitempty"`
		AI      bool          `json:"usesAi,omitempty"`
		Fetches []string      `json:"externalServices,omitempty"`
		UsedBy  []string      `json:"calledFrom,omitempty"`
	}
	fns := []fnFact{}
	for _, f := range docs["functions"].([]docFunction) {
		fns = append(fns, fnFact{f.Name, f.Summary, f.Methods, f.Tables, len(f.AI) > 0, f.Fetches, f.UsedBy})
	}
	tables := []map[string]any{}
	for _, t := range docs["tables"].([]map[string]any) {
		tables = append(tables, map[string]any{"name": t["name"], "columns": t["columns"], "rules": t["rules"], "rowCount": t["rowCount"]})
	}
	pages := []map[string]any{}
	for _, p := range docs["pages"].([]*docPage) {
		pages = append(pages, map[string]any{"path": p.Path, "title": p.Title, "description": p.Description})
	}
	return map[string]any{"pages": pages, "tables": tables, "relations": docs["relations"], "functions": fns}
}

func (h *Handler) projectDocs(q *request, project *store.Project) (map[string]any, error) {
	paths, contents, err := readProject(h.cfg.SiteRoot(project.Slug))
	if err != nil {
		return nil, err
	}
	facts, err := h.projectFacts(q.r.Context(), project, paths, contents)
	if err != nil {
		return nil, err
	}
	overview, err := h.svc.Fn.Overview(project)
	if err != nil {
		return nil, err
	}

	// Tabel + file website yang memakainya (calls dari projectFacts).
	calls := facts["calls"].([]dbCall)
	tableNames := map[string]bool{}
	tables := facts["tables"].([]map[string]any)
	for _, t := range tables {
		name := t["name"].(string)
		tableNames[name] = true
		used := []dbCall{}
		for _, c := range calls {
			if c.Table == name {
				used = append(used, c)
			}
		}
		t["usedBy"] = used
	}
	issues := []docIssue{}
	for _, c := range calls {
		switch c.Status {
		case "missing":
			issues = append(issues, docIssue{Kind: "missing_table", Name: c.Table, File: c.File})
		case "owner_only":
			issues = append(issues, docIssue{Kind: "owner_only", Name: c.Table, File: c.File, Op: c.Op})
		}
	}

	// Fungsi: analisis kode + halaman yang memanggilnya.
	fnNames := map[string]bool{}
	for _, info := range overview.Functions {
		fnNames[info.Name] = true
	}
	callers := map[string][]string{}
	for _, p := range paths {
		if fn.Hidden(p) || !codeFileRE.MatchString(p) {
			continue
		}
		for _, m := range fnCallRE.FindAllStringSubmatch(contents[p], -1) {
			name := m[1]
			if !slices.Contains(callers[name], p) {
				callers[name] = append(callers[name], p)
				if !fnNames[name] {
					issues = append(issues, docIssue{Kind: "missing_function", Name: name, File: p})
				}
			}
		}
	}
	secretSet := map[string]bool{}
	for _, s := range overview.Secrets {
		secretSet[s.Name] = true
	}
	secretUsers := map[string][]string{}
	functions := []docFunction{}
	for _, info := range overview.Functions {
		d := analyzeFunction(contents[info.Path])
		d.Name, d.Path, d.URL, d.Schedule = info.Name, info.Path, info.URL, info.Schedule
		if c := callers[info.Name]; c != nil {
			d.UsedBy = c
		}
		for _, name := range d.Secrets {
			secretUsers[name] = append(secretUsers[name], info.Name)
			if !secretSet[name] {
				issues = append(issues, docIssue{Kind: "missing_secret", Name: name, Fn: info.Name})
			}
		}
		for _, t := range d.Tables {
			if !tableNames[t.Table] {
				issues = append(issues, docIssue{Kind: "missing_table", Name: t.Table, Fn: info.Name})
			}
		}
		functions = append(functions, d)
	}
	secrets := []docSecret{}
	for _, s := range overview.Secrets {
		used := secretUsers[s.Name]
		if used == nil {
			used = []string{}
		}
		secrets = append(secrets, docSecret{Name: s.Name, UpdatedAt: s.UpdatedAt, UsedBy: used})
	}
	pages, pageIssues := docPages(facts, contents)
	issues = append(issues, pageIssues...)
	providers := []docProvider{}
	for _, p := range overview.AIProviders {
		providers = append(providers, docProvider{Name: p.Name, Kind: overview.AIKinds[p.Kind], Model: p.Model, Default: p.Default})
	}

	return map[string]any{
		"project":     h.public(project),
		"pages":       pages,
		"tables":      tables,
		"relations":   facts["relations"],
		"functions":   functions,
		"secrets":     secrets,
		"aiProviders": providers,
		"cron":        overview.Cron,
		"issues":      issues,
	}, nil
}

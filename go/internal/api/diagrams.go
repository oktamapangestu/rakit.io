package api

import (
	"path"
	"regexp"
	"strings"

	"rakit.icu/server/internal/files"
	"rakit.icu/server/internal/jsconv"
	"rakit.icu/server/internal/userdb"
)

// Bahan untuk diagram otomatis project aktif: ERD, peta halaman, dan alur data.
// Semua dihitung dari file & database project (tanpa AI), lalu digambar di editor.

const maxDiagramFiles = 300

var (
	externalRE  = regexp.MustCompile(`(?i)^(?:[a-z][a-z0-9+.-]*:|//)`) // http:, mailto:, tel:, javascript:, //cdn…
	webLinkRE   = regexp.MustCompile(`(?i)^(https?:)?//`)
	titleRE     = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	h1RE        = regexp.MustCompile(`(?is)<h1[^>]*>(.*?)</h1>`)
	buttonRE    = regexp.MustCompile(`(?is)<button\b[^>]*>(.*?)</button>`)
	tagRE       = regexp.MustCompile(`<[^>]+>`)
	spaceRE     = regexp.MustCompile(`\s+`)
	anchorRE    = regexp.MustCompile(`(?i)<a\b[^>]*>`)
	linkRE      = regexp.MustCompile(`(?i)<link\b[^>]*>`)
	scriptRE    = regexp.MustCompile(`(?i)<script\b[^>]*>`)
	formRE      = regexp.MustCompile(`(?i)<form\b[^>]*>`)
	stylesheet  = regexp.MustCompile(`(?i)stylesheet`)
	dbCallRE    = regexp.MustCompile("/api/db/([a-z][a-z0-9_]*)(/[^'\"`?\\s)]*)?")
	nextCallRE  = regexp.MustCompile(`fetch\s*\(|/api/db/`)
	methodRE    = regexp.MustCompile("(?i)method\\s*:\\s*['\"`](GET|POST|PATCH|PUT|DELETE)['\"`]")
	codeFileRE  = regexp.MustCompile(`\.(js|html)$`)
	attrREs     = map[string]*regexp.Regexp{}
	leadSlashRE = regexp.MustCompile(`^/+`)
)

func init() {
	for _, name := range []string{"href", "rel", "src", "action", "method"} {
		attrREs[name] = regexp.MustCompile(`(?i)\b` + name + `\s*=\s*["']([^"']*)["']`)
	}
}

// attr: nilai atribut di sebuah tag; ok = false bila tidak ada.
func attr(tag, name string) (string, bool) {
	m := attrREs[name].FindStringSubmatch(tag)
	if m == nil {
		return "", false
	}
	return m[1], true
}

func plainText(html string, limit int) string {
	return jsconv.Slice(strings.TrimSpace(spaceRE.ReplaceAllString(tagRE.ReplaceAllString(html, ""), " ")), limit)
}

func pageTitle(html string) string {
	m := titleRE.FindStringSubmatch(html)
	if m == nil {
		m = h1RE.FindStringSubmatch(html)
	}
	if m == nil {
		return ""
	}
	return plainText(m[1], 60)
}

type ref struct {
	target string
	exists bool
}

// resolveRef mengubah href/src relatif dari sebuah file menjadi path file di project
// (nil bila eksternal/anchor).
func resolveRef(raw, fromPath string, fileSet map[string]bool) *ref {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.HasPrefix(raw, "#") || externalRE.MatchString(raw) || strings.HasPrefix(raw, "data:") {
		return nil
	}
	clean, _, _ := strings.Cut(raw, "#")
	clean, _, _ = strings.Cut(clean, "?")
	if clean == "" {
		return nil
	}
	base := clean
	if !strings.HasPrefix(clean, "/") {
		base = path.Join(path.Dir(fromPath), clean)
	}
	target := leadSlashRE.ReplaceAllString(path.Clean(base), "")
	if target == "." {
		target = ""
	}
	target = strings.TrimPrefix(target, "./")
	if strings.HasPrefix(target, "..") {
		return &ref{target: clean}
	}
	var candidates []string
	if target == "" || strings.HasSuffix(clean, "/") {
		candidates = []string{"index.html"}
		if target != "" {
			candidates = []string{target + "/index.html"}
		}
	} else {
		candidates = []string{target, target + ".html", target + "/index.html"}
	}
	for _, c := range candidates {
		if fileSet[c] {
			return &ref{target: c, exists: true}
		}
	}
	return &ref{target: candidates[0]}
}

type dbCall struct {
	File   string `json:"file"`
	Table  string `json:"table"`
	Op     string `json:"op"`
	Status string `json:"status"`
}

// dbCalls mencari pemakaian API database di kode: /api/db/<tabel>[/<id>] dan metode fetch di dekatnya.
func dbCalls(text string) [][2]string {
	var calls [][2]string
	for _, m := range dbCallRE.FindAllStringSubmatchIndex(text, -1) {
		// Cari opsi method hanya di pemanggilan ini: berhenti di fetch( atau /api/db/ berikutnya.
		around := text[m[1]:min(len(text), max(m[1], m[0]+400))]
		if next := nextCallRE.FindStringIndex(around); next != nil {
			around = around[:next[0]]
		}
		method := "GET"
		if mm := methodRE.FindStringSubmatch(around); mm != nil {
			method = strings.ToUpper(mm[1])
		}
		hasID := m[4] >= 0 && text[m[4]:m[5]] != "/"
		op := map[string]string{"POST": "create", "PATCH": "update", "PUT": "update", "DELETE": "delete"}[method]
		if op == "" {
			op = "list"
			if hasID {
				op = "view"
			}
		}
		calls = append(calls, [2]string{text[m[2]:m[3]], op})
	}
	return calls
}

type relation struct {
	From   string `json:"from"`
	Column string `json:"column"`
	To     string `json:"to"`
}

// inferRelations: relasi resmi dari kolom bertipe `reference` didahulukan; sisanya ditebak dari nama
// kolom (<tabel>_id atau <tabel>) sebagai pelengkap untuk database lama tanpa kolom relasi.
func inferRelations(tables []*userdb.TableInfo) []relation {
	names := map[string]bool{}
	for _, t := range tables {
		names[t.Name] = true
	}
	out := []relation{}
	seen := map[relation]bool{}
	add := func(r relation) {
		if !seen[r] {
			seen[r] = true
			out = append(out, r)
		}
	}
	for _, t := range tables {
		for _, c := range t.Columns {
			if c.Type == "reference" && c.RefTable != "" && names[c.RefTable] {
				add(relation{t.Name, c.Name, c.RefTable})
			}
		}
	}
	for _, t := range tables {
		for _, c := range t.Columns {
			if c.Type != "number" && c.Type != "text" {
				continue
			}
			target := strings.TrimSuffix(c.Name, "_id")
			if target != t.Name && names[target] {
				add(relation{t.Name, c.Name, target})
			}
		}
	}
	return out
}

type diagramPage struct {
	Path   string `json:"path"`
	Title  string `json:"title"`
	Orphan bool   `json:"orphan"`
}

type pageLink struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Broken bool   `json:"broken"`
}

type pageAsset struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Kind    string `json:"kind"`
	Missing bool   `json:"missing"`
}

type pageForm struct {
	Page   string  `json:"page"`
	Action *string `json:"action"`
	Method string  `json:"method"`
}

type pageText struct {
	Page string `json:"page"`
	Text string `json:"text"`
}

func (h *Handler) diagrams(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	project, err := h.loadProject(q)
	if err != nil {
		return err
	}
	if !q.is("GET") {
		return errNotFound
	}
	slug := project.Slug
	root := h.cfg.SiteRoot(slug)
	entries, err := files.ListTree(root)
	if err != nil {
		return err
	}
	var paths []string
	for _, e := range entries {
		if !e.Dir && len(paths) < maxDiagramFiles {
			paths = append(paths, e.Path)
		}
	}
	fileSet := map[string]bool{}
	contents := map[string]string{}
	for _, p := range paths {
		fileSet[p] = true
		contents[p], _ = files.ReadText(root, p) // gambar & file tak terbaca = kosong
	}

	tables := []*userdb.TableInfo{}
	if h.userdb.HasDatabase(slug) {
		if tables, err = h.userdb.ListTables(q.r.Context(), slug); err != nil {
			return err
		}
	}
	tableMap := map[string]*userdb.TableInfo{}
	for _, t := range tables {
		tableMap[t.Name] = t
	}

	// ---- Peta halaman ----
	pages := []*diagramPage{}
	links, assets, forms := []pageLink{}, []pageAsset{}, []pageForm{}
	headings, buttons := []pageText{}, []pageText{}
	external := 0
	for _, p := range paths {
		if !strings.HasSuffix(p, ".html") {
			continue
		}
		html := contents[p]
		pages = append(pages, &diagramPage{Path: p, Title: pageTitle(html)})
		seen := map[string]bool{}
		for _, tag := range anchorRE.FindAllString(html, -1) {
			href, ok := attr(tag, "href")
			if !ok {
				continue
			}
			target := resolveRef(href, p, fileSet)
			if target == nil {
				if trimmed := strings.TrimSpace(href); externalRE.MatchString(trimmed) && webLinkRE.MatchString(trimmed) {
					external++
				}
				continue
			}
			if target.target == p || seen[target.target] {
				continue
			}
			seen[target.target] = true
			links = append(links, pageLink{From: p, To: target.target, Broken: !target.exists})
		}
		for _, tag := range linkRE.FindAllString(html, -1) {
			if rel, _ := attr(tag, "rel"); !stylesheet.MatchString(rel) {
				continue
			}
			href, _ := attr(tag, "href")
			if target := resolveRef(href, p, fileSet); target != nil {
				assets = append(assets, pageAsset{From: p, To: target.target, Kind: "css", Missing: !target.exists})
			}
		}
		for _, tag := range scriptRE.FindAllString(html, -1) {
			src, _ := attr(tag, "src")
			if src == "" {
				continue
			}
			if target := resolveRef(src, p, fileSet); target != nil {
				assets = append(assets, pageAsset{From: p, To: target.target, Kind: "js", Missing: !target.exists})
			}
		}
		// Form: aksi utama (kirim data) untuk diagram aktivitas & use case.
		for _, tag := range formRE.FindAllString(html, -1) {
			form := pageForm{Page: p, Method: "get"}
			if action, ok := attr(tag, "action"); ok {
				form.Action = &action
			}
			if method, ok := attr(tag, "method"); ok {
				form.Method = strings.ToLower(method)
			}
			forms = append(forms, form)
		}
		// Judul & tombol: sumber "fitur" untuk use case & aktivitas.
		for _, m := range h1RE.FindAllStringSubmatch(html, -1) {
			if text := plainText(m[1], 50); text != "" {
				headings = append(headings, pageText{p, text})
			}
		}
		for _, m := range buttonRE.FindAllStringSubmatch(html, -1) {
			if text := plainText(m[1], 40); text != "" {
				buttons = append(buttons, pageText{p, text})
			}
		}
	}
	linkedTo := map[string]bool{}
	for _, l := range links {
		if !l.Broken {
			linkedTo[l.To] = true
		}
	}
	for _, page := range pages {
		page.Orphan = page.Path != "index.html" && page.Path != "404.html" && !linkedTo[page.Path]
	}

	// ---- Alur data: file mana memakai tabel apa, dan apakah aksesnya mengizinkan ----
	calls := []dbCall{}
	seenCall := map[[3]string]bool{}
	for _, p := range paths {
		if !codeFileRE.MatchString(p) {
			continue
		}
		for _, call := range dbCalls(contents[p]) {
			key := [3]string{p, call[0], call[1]}
			if seenCall[key] {
				continue
			}
			seenCall[key] = true
			status := "missing"
			if t := tableMap[call[0]]; t != nil {
				status = "owner_only"
				if t.Rules[call[1]] == "public" {
					status = "ok"
				}
			}
			calls = append(calls, dbCall{File: p, Table: call[0], Op: call[1], Status: status})
		}
	}

	tableViews := make([]map[string]any, 0, len(tables))
	for _, t := range tables {
		tableViews = append(tableViews, map[string]any{"name": t.Name, "columns": t.Columns, "rules": t.Rules, "rowCount": t.RowCount})
	}
	return q.json(200, map[string]any{
		"project":   map[string]string{"slug": slug, "name": project.Name},
		"pages":     pages,
		"links":     links,
		"assets":    assets,
		"forms":     forms,
		"headings":  headings,
		"buttons":   buttons,
		"external":  external,
		"tables":    tableViews,
		"relations": inferRelations(tables),
		"calls":     calls,
	})
}

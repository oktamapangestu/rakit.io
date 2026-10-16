package ai

// Pemeriksaan kode hasil Builder yang tidak bergantung pada kepatuhan model (lihat juga htmlquality.go dan
// apiPathProblems). Masalahnya dikirim balik ke model untuk diperbaiki:
//   - per file saat ditulis (stageToolCall): sintaks JavaScript — file .js, <script> di HTML, fungsi serverless;
//     ekspresi & <template> Alpine di atribut (alpinecheck.go); struktur CSS (csscheck.go);
//   - sekali saat model menyatakan selesai (finalProblems): rujukan antar-file (script/link/halaman yang tidak
//     ada, komponen Alpine yang tidak terdaftar, urutan tag Alpine, fungsi /api/fn/ yang tidak ada), nama kolom
//     database (columncheck.go). Dicek di akhir karena file/tabel yang dirujuk boleh dibuat belakangan di jawaban
//     yang sama.
// Gambar yang dirujuk tapi belum ada tidak dikembalikan ke model (model tidak bisa membuat gambar); gambar itu
// disebut di ringkasan supaya pengguna mengunggahnya (missingImages).

import (
	"encoding/json"
	"fmt"
	"net/url"
	"path"
	"regexp"
	"slices"
	"sort"
	"strings"

	"golang.org/x/net/html"

	"rakit.io/server/internal/files"
	"rakit.io/server/internal/jscheck"
)

// problem: satu masalah beserta jenisnya (jenis dicatat di statistik dashboard owner, lihat buildStats).
type problem struct {
	kind string // js | css | ref | alpine | column | fn | api | link | contrast | edit | tool | claim | loss | shrink
	text string
}

func texts(list []problem) []string {
	out := make([]string, len(list))
	for i, p := range list {
		out[i] = p.text
	}
	return out
}

// ---------- Tampilan project bagi Builder: file di disk + perubahan yang sudah dicatat ----------

type workspace struct {
	root    string
	disk    map[string]bool // semua file di disk (teks & gambar), path relatif
	tables  []string
	columns map[string][]string // kolom tabel di database (lihat knownColumns); nil = tidak diketahui
	st      *staged
}

func newWorkspace(root string, tables []string) *workspace {
	ws := &workspace{root: root, disk: map[string]bool{}, tables: tables, st: &staged{items: map[string]change{}}}
	if entries, err := files.ListTree(root); err == nil {
		for _, e := range entries {
			if !e.Dir {
				ws.disk[e.Path] = true
			}
		}
	}
	return ws
}

func (ws *workspace) exists(rel string) bool {
	if c, ok := ws.st.items[rel]; ok {
		return c.Action == "write"
	}
	return ws.disk[rel]
}

// read: isi terbaru file teks (versi yang sudah dicatat bila ada). ok = false bila tidak ada.
func (ws *workspace) read(rel string) (string, bool) {
	if c, ok := ws.st.items[rel]; ok {
		return c.Content, c.Action == "write"
	}
	if !ws.disk[rel] || !files.IsTextFile(rel) {
		return "", false
	}
	content, err := files.ReadText(ws.root, rel)
	return content, err == nil
}

// pages: semua halaman HTML terbaru (disk + yang dicatat, tanpa yang dihapus), urut nama.
func (ws *workspace) pages() []string {
	seen := map[string]bool{}
	var out []string
	add := func(p string) {
		if !seen[p] && strings.HasSuffix(strings.ToLower(p), ".html") && ws.exists(p) {
			seen[p] = true
			out = append(out, p)
		}
	}
	for p := range ws.disk {
		add(p)
	}
	for _, k := range ws.st.order {
		add(k)
	}
	sort.Strings(out)
	return out
}

// ---------- Sintaks JavaScript ----------

var (
	moduleSyntaxRE  = regexp.MustCompile(`(?m)^\s*(import\s*[\w{*'"]|export\s)`)
	exportDefaultRE = regexp.MustCompile(`\bexport\s+default\b`)
)

func isFunctionFile(rel string) bool { return strings.HasPrefix(rel, "functions/") }

// syntaxProblems: kesalahan sintaks JS di file .js atau di <script> sebuah halaman HTML, ekspresi Alpine di atribut
// (alpinecheck.go), dan struktur CSS di file .css atau <style> (csscheck.go).
func syntaxProblems(rel, content string) []problem {
	lower := strings.ToLower(rel)
	switch {
	case strings.HasSuffix(lower, ".js"):
		kind := jscheck.Script
		if isFunctionFile(rel) || moduleSyntaxRE.MatchString(content) {
			kind = jscheck.Module
		}
		var out []problem
		if err := jscheck.Check(content, kind, rel); err != nil {
			out = append(out, problem{"js", fmt.Sprintf("%s (kode ini tidak bisa dijalankan sama sekali)", err.Error())})
		}
		if isFunctionFile(rel) && !exportDefaultRE.MatchString(content) {
			out = append(out, problem{"js", "fungsi serverless harus punya export default async function (req, { db, env, fetch, ai })"})
		}
		return out
	case strings.HasSuffix(lower, ".css"):
		var out []problem
		for _, p := range cssProblems(content, 1) {
			out = append(out, problem{"css", p})
		}
		return out
	case strings.HasSuffix(lower, ".html"):
		var out []problem
		info := parsePage(content)
		for _, st := range info.styles {
			for _, p := range cssProblems(st.code, st.line) {
				out = append(out, problem{"css", "<style>: " + p})
			}
		}
		out = append(out, alpineProblemsIn(content)...)
		for _, s := range info.scripts {
			if s.src != "" || strings.TrimSpace(s.code) == "" {
				continue
			}
			switch s.typ {
			case "", "text/javascript", "application/javascript", "module":
				kind := jscheck.Script
				if s.typ == "module" {
					kind = jscheck.Module
				}
				if err := jscheck.Check(s.code, kind, rel); err != nil {
					line := s.line
					if err.Line > 0 {
						line += err.Line - 1
					}
					out = append(out, problem{"js", fmt.Sprintf("<script> baris %d: %s (skrip ini tidak dijalankan browser)", line, err.Message)})
				}
			case "importmap", "application/ld+json", "application/json":
				if !json.Valid([]byte(s.code)) {
					out = append(out, problem{"js", fmt.Sprintf(`<script type="%s"> baris %d berisi JSON yang tidak valid`, s.typ, s.line)})
				}
			}
		}
		return out
	}
	return nil
}

// ---------- Membaca halaman HTML ----------

type pageScript struct {
	src, typ string
	deferred bool
	code     string // isi skrip inline
	line     int    // baris tempat isi skrip mulai
}

type pageRef struct {
	tag, attr, value string
}

// pageStyle: isi <style> beserta baris tempat isinya mulai.
type pageStyle struct {
	code string
	line int
}

type pageInfo struct {
	scripts []pageScript
	styles  []pageStyle
	refs    []pageRef // rujukan file lokal & tautan
	xData   []string  // nilai x-data yang berupa nama komponen
	alpine  bool      // ada atribut x-data (halaman memakai Alpine)
}

var componentRE = regexp.MustCompile(`^\s*([A-Za-z_$][\w$]*)\s*(\(.*\))?\s*$`)

func parsePage(content string) pageInfo {
	var info pageInfo
	z := html.NewTokenizer(strings.NewReader(content))
	offset := 0
	var open *pageScript
	var style *pageStyle
	for {
		tt := z.Next()
		raw := z.Raw()
		start := offset
		offset += len(raw)
		switch tt {
		case html.ErrorToken:
			return info
		case html.TextToken:
			if open != nil {
				open.code += string(raw)
			}
			if style != nil {
				style.code += string(raw)
			}
		case html.EndTagToken:
			name, _ := z.TagName()
			if string(name) == "script" && open != nil {
				info.scripts = append(info.scripts, *open)
				open = nil
			}
			if string(name) == "style" && style != nil {
				info.styles = append(info.styles, *style)
				style = nil
			}
		case html.StartTagToken, html.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			tag := string(name)
			attrs := map[string]string{}
			for hasAttr {
				var k, v []byte
				k, v, hasAttr = z.TagAttr()
				attrs[string(k)] = string(v)
			}
			if v, ok := attrs["x-data"]; ok {
				info.alpine = true
				if m := componentRE.FindStringSubmatch(v); m != nil {
					info.xData = append(info.xData, m[1])
				}
			}
			switch tag {
			case "style":
				if tt == html.StartTagToken {
					style = &pageStyle{line: strings.Count(content[:start+len(raw)], "\n") + 1}
				}
			case "script":
				_, deferred := attrs["defer"]
				s := pageScript{src: strings.TrimSpace(attrs["src"]), typ: strings.ToLower(strings.TrimSpace(attrs["type"])), deferred: deferred}
				s.line = strings.Count(content[:start+len(raw)], "\n") + 1
				if s.src != "" {
					info.refs = append(info.refs, pageRef{tag, "src", s.src})
				}
				if tt == html.SelfClosingTagToken {
					info.scripts = append(info.scripts, s)
				} else {
					open = &s
				}
			case "link":
				rel := strings.ToLower(attrs["rel"])
				if strings.Contains(rel, "stylesheet") || strings.Contains(rel, "icon") || strings.Contains(rel, "modulepreload") {
					info.refs = append(info.refs, pageRef{tag, "href", attrs["href"]})
				}
			case "img", "source", "video", "audio", "iframe", "embed":
				if v, ok := attrs["src"]; ok {
					info.refs = append(info.refs, pageRef{tag, "src", v})
				}
				if v, ok := attrs["poster"]; ok {
					info.refs = append(info.refs, pageRef{tag, "poster", v})
				}
			case "a":
				if v, ok := attrs["href"]; ok {
					info.refs = append(info.refs, pageRef{tag, "href", v})
				}
			}
		}
	}
}

// ---------- Rujukan file ----------

var schemeRE = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*:`)

// localTarget: path file di project yang dituju rujukan value dari halaman page; "" bila bukan file lokal
// (URL luar, anchor, mailto:, ekspresi template, API, unggahan database).
func localTarget(page, value string) string {
	v := strings.TrimSpace(value)
	if v == "" || strings.HasPrefix(v, "#") || strings.HasPrefix(v, "//") || schemeRE.MatchString(v) ||
		strings.ContainsAny(v, "{}$`") {
		return ""
	}
	if i := strings.IndexAny(v, "?#"); i >= 0 {
		v = v[:i]
	}
	if decoded, err := url.PathUnescape(v); err == nil {
		v = decoded
	}
	var joined string
	if strings.HasPrefix(v, "/") {
		joined = path.Clean(v)
	} else {
		joined = path.Clean("/" + path.Join(path.Dir(page), v))
	}
	if strings.HasPrefix(joined, "/api/") || strings.HasPrefix(joined, "/uploads/") {
		return ""
	}
	rel := strings.TrimPrefix(joined, "/")
	if rel == "" || strings.HasSuffix(v, "/") {
		rel = strings.TrimSuffix(rel, "/")
		if rel != "" {
			rel += "/"
		}
		rel += "index.html"
	}
	return rel
}

// pageExists: tautan ke halaman, dengan aturan URL bersih yang sama seperti penyajian website (/about ->
// about.html, /blog -> blog/index.html).
func (ws *workspace) pageExists(rel string) bool {
	if ws.exists(rel) {
		return true
	}
	return path.Ext(rel) == "" && (ws.exists(rel+".html") || ws.exists(rel+"/index.html"))
}

var cssURLRE = regexp.MustCompile(`url\(\s*['"]?([^'")]+)['"]?\s*\)`)

// pageRefs: rujukan ke file yang tidak ada di halaman page (script, stylesheet, halaman lain), dan gambar yang
// belum ada.
func (ws *workspace) pageRefs(page string, info pageInfo) (missing []problem, images []string) {
	seen := map[string]bool{}
	for _, r := range info.refs {
		rel := localTarget(page, r.value)
		if rel == "" || seen[rel] {
			continue
		}
		seen[rel] = true
		switch {
		case files.IsImageFile(rel):
			if !ws.exists(rel) {
				images = append(images, rel)
			}
		case r.tag == "a" || r.tag == "iframe":
			if !ws.pageExists(rel) {
				missing = append(missing, problem{"ref", fmt.Sprintf(`tautan <a href="%s"> menuju halaman yang tidak ada (buat filenya, atau ubah/hapus tautannya)`, r.value)})
			}
		case !ws.exists(rel):
			missing = append(missing, problem{"ref", fmt.Sprintf(`<%s %s="%s"> menunjuk file "%s" yang tidak ada di project`, r.tag, r.attr, r.value, rel)})
		}
	}
	return missing, images
}

// cssImages: gambar lokal di url(...) sebuah file CSS yang belum ada.
func (ws *workspace) cssImages(file, content string) []string {
	var out []string
	for _, m := range cssURLRE.FindAllStringSubmatch(content, -1) {
		if rel := localTarget(file, m[1]); rel != "" && files.IsImageFile(rel) && !ws.exists(rel) {
			out = append(out, rel)
		}
	}
	return out
}

// ---------- Alpine.js ----------

var (
	alpineCoreRE   = regexp.MustCompile(`(?i)/alpinejs@[^/]*/dist/cdn(\.min)?\.js|/alpinejs(@[^/]*)?/?$`)
	alpinePluginRE = regexp.MustCompile(`(?i)@alpinejs/([a-z-]+)`)
)

// alpineProblems: komponen x-data yang tidak terdaftar di skrip halaman, dan urutan/atribut tag Alpine yang
// membuat komponen tidak pernah terdaftar.
func (ws *workspace) alpineProblems(page string, info pageInfo) []problem {
	var out []problem
	core := -1
	cores := 0
	var code strings.Builder // semua kode yang dijalankan halaman ini: inline + file lokal yang dimuat
	for i, s := range info.scripts {
		if s.src == "" {
			code.WriteString(s.code + "\n")
			continue
		}
		if alpinePluginRE.MatchString(s.src) {
			if core >= 0 {
				out = append(out, problem{"alpine", fmt.Sprintf(`plugin Alpine "%s" harus dimuat SEBELUM tag Alpine.js`, alpinePluginRE.FindStringSubmatch(s.src)[0])})
			}
			continue
		}
		if alpineCoreRE.MatchString(s.src) {
			cores++
			if core < 0 {
				core = i
			}
			if !s.deferred {
				out = append(out, problem{"alpine", "tag <script> Alpine.js harus memakai atribut defer"})
			}
			continue
		}
		rel := localTarget(page, s.src)
		if rel == "" {
			continue
		}
		js, ok := ws.read(rel)
		if !ok {
			continue // sudah dilaporkan sebagai rujukan yang tidak ada
		}
		code.WriteString(js + "\n")
		// Skrip defer/module dijalankan berurutan sesudah halaman dibaca: bila letaknya sesudah Alpine, event
		// alpine:init sudah lewat saat komponennya didaftarkan.
		if core >= 0 && (s.deferred || s.typ == "module") && strings.Contains(js, "alpine:init") {
			out = append(out, problem{"alpine", fmt.Sprintf(`"%s" mendaftarkan komponen di alpine:init tapi dimuat SESUDAH tag Alpine.js — pindahkan tag script-nya ke sebelum tag Alpine`, s.src)})
		}
	}
	if cores > 1 {
		out = append(out, problem{"alpine", fmt.Sprintf("Alpine.js dimuat %d kali di halaman ini — cukup satu tag", cores)})
	}
	if !info.alpine {
		return out
	}
	all := code.String()
	if core < 0 && !strings.Contains(all, "alpinejs") && !strings.Contains(all, "Alpine.start") {
		return append(out, problem{"alpine", "halaman memakai x-data tapi tidak memuat Alpine.js"})
	}
	var undefined []string
	for _, name := range info.xData {
		if slices.Contains(undefined, name) {
			continue
		}
		q := regexp.QuoteMeta(name)
		re := regexp.MustCompile(`Alpine\.data\(\s*['"` + "`" + `]` + q + `['"` + "`" + `]|\bfunction\s+` + q + `\b|\b(var|let|const)\s+` + q + `\s*=|window\.` + q + `\s*=`)
		if !re.MatchString(all) {
			undefined = append(undefined, name)
		}
	}
	for _, name := range undefined {
		out = append(out, problem{"alpine", fmt.Sprintf(`x-data="%s" dipakai, tapi Alpine.data('%s', …) tidak ada di skrip yang dimuat halaman ini`, name, name)})
	}
	return out
}

// ---------- Pemeriksaan akhir ----------

var fnCallRE = regexp.MustCompile(`/api/fn/([a-z0-9_-]+)`)

// finalProblems: masalah di file yang ditulis Builder (per path), setelah semua perubahannya dicatat.
// images: gambar yang dirujuk tapi belum ada (untuk ringkasan, bukan untuk diperbaiki model).
func (ws *workspace) finalProblems() (byFile map[string][]problem, images []string) {
	byFile = map[string][]problem{}
	add := func(file string, list ...problem) {
		byFile[file] = append(byFile[file], list...)
	}
	tables := knownTables(ws.tables, ws.st)
	columns := ws.knownColumns()
	seenImage := map[string]bool{}
	addImages := func(list []string) {
		for _, img := range list {
			if !seenImage[img] {
				seenImage[img] = true
				images = append(images, img)
			}
		}
	}
	deleted := map[string]bool{}
	for _, c := range ws.st.list() {
		if c.Action == "delete" {
			deleted[c.Path] = true
		}
		if c.Action != "write" {
			continue
		}
		add(c.Path, syntaxProblems(c.Path, c.Content)...)
		original := ""
		if ws.disk[c.Path] {
			original, _ = files.ReadText(ws.root, c.Path)
		}
		add(c.Path, placeholderProblems(original, c.Content)...)
		for _, p := range apiPathProblems(c.Content, tables) {
			add(c.Path, problem{"api", p})
		}
		for _, m := range fnCallRE.FindAllStringSubmatch(c.Content, -1) {
			if !ws.exists("functions/" + m[1] + ".js") {
				add(c.Path, problem{"fn", fmt.Sprintf(`memanggil /api/fn/%s, tapi functions/%s.js tidak ada`, m[1], m[1])})
			}
		}
		add(c.Path, bodyColumnProblems(c.Content, columns)...)
		lower := strings.ToLower(c.Path)
		switch {
		case strings.HasSuffix(lower, ".html"):
			info := parsePage(c.Content)
			missing, imgs := ws.pageRefs(c.Path, info)
			add(c.Path, missing...)
			add(c.Path, ws.alpineProblems(c.Path, info)...)
			add(c.Path, loopColumnProblems(c.Content, ws.pageCode(c.Path, c.Content, info), columns)...)
			addImages(imgs)
		case strings.HasSuffix(lower, ".css"):
			addImages(ws.cssImages(c.Path, c.Content))
		}
	}
	// File yang dihapus tapi masih dirujuk halaman lain (yang tidak ditulis ulang Builder).
	if len(deleted) > 0 {
		for _, page := range ws.pages() {
			if _, written := ws.st.items[page]; written {
				continue
			}
			content, ok := ws.read(page)
			if !ok {
				continue
			}
			for _, r := range parsePage(content).refs {
				rel := localTarget(page, r.value)
				gone := rel != "" && (deleted[rel] || deleted[rel+".html"] || deleted[rel+"/index.html"])
				if gone && !ws.pageExists(rel) {
					add(page, problem{"ref", fmt.Sprintf(`<%s %s="%s"> masih menunjuk "%s" yang kamu hapus — perbarui halaman ini juga`, r.tag, r.attr, r.value, rel)})
				}
			}
		}
	}
	for file, list := range ws.lostDefinitions() {
		add(file, list...)
	}
	for k, v := range byFile {
		if len(v) == 0 {
			delete(byFile, k)
		}
	}
	return byFile, images
}

// problemList: daftar baris "- path: masalah", urut path, untuk dikirim ke model.
func problemList(byFile map[string][]problem) []string {
	paths := make([]string, 0, len(byFile))
	for p := range byFile {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	var out []string
	for _, p := range paths {
		for _, pr := range byFile[p] {
			out = append(out, "- "+p+": "+pr.text)
		}
	}
	return out
}

// imagesNote: catatan di ringkasan untuk gambar yang perlu diunggah pengguna.
func imagesNote(images []string) string {
	if len(images) == 0 {
		return ""
	}
	list := make([]string, len(images))
	for i, img := range images {
		list[i] = "`/" + img + "`"
	}
	return "_Gambar yang dipakai tapi belum ada di project — unggah dengan nama ini: " + strings.Join(list, ", ") + "._"
}

package ai

// Pemeriksaan nama kolom database di kode Builder (bagian dari finalProblems). Salah nama kolom tidak pernah memunculkan
// error JavaScript: data yang dibaca tampil kosong, dan data yang dikirim ditolak server ("Kolom tidak dikenal") tanpa
// terlihat bila kodenya tidak memeriksa jawaban. Dua pola yang diperiksa:
//   - body JSON.stringify({ ... }) yang dikirim ke /api/db/<tabel>: setiap kunci harus kolom tabel itu;
//   - <template x-for="p in ..."> di halaman yang memakai /api/db/: p.<nama> harus kolom salah satu tabel, atau kunci
//     yang didefinisikan sendiri di kode halaman (data statis, hasil olahan).
// Pemeriksaan sengaja longgar (lebih baik melewatkan kesalahan daripada menyuruh model "memperbaiki" kode yang benar).

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"

	"golang.org/x/net/html"
)

// knownColumns: kolom setiap tabel yang diketahui (di database + yang dibuat/diperluas create_table di job ini), termasuk
// kolom otomatis id & created_at.
func (ws *workspace) knownColumns() map[string]map[string]bool {
	out := map[string]map[string]bool{}
	add := func(table string, cols ...string) {
		if out[table] == nil {
			out[table] = map[string]bool{"id": true, "created_at": true}
		}
		for _, c := range cols {
			out[table][c] = true
		}
	}
	for table, cols := range ws.columns {
		add(table, cols...)
	}
	for _, c := range ws.st.items {
		if c.Action == "table" {
			add(c.Name)
			for _, col := range c.Columns {
				add(c.Name, col.Name)
				if col.Type == "reference" {
					add(c.Name, col.Name+"__ref") // ?expand=<kolom> menambah <kolom>__ref
				}
			}
		}
	}
	return out
}

func columnList(cols map[string]bool) string {
	var names []string
	for c := range cols {
		if c != "id" && c != "created_at" && !strings.HasSuffix(c, "__ref") {
			names = append(names, c)
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		return "(belum ada kolom)"
	}
	return strings.Join(names, ", ")
}

var (
	apiDBRE     = regexp.MustCompile(`/api/db/([a-z][a-z0-9_]*)`)
	stringifyRE = regexp.MustCompile(`JSON\.stringify\(\s*\{`)
	nextRequest = regexp.MustCompile(`fetch\(|/api/|XMLHttpRequest`)
	identRE     = regexp.MustCompile(`^[A-Za-z_$][\w$]*`)
	forAliasRE  = regexp.MustCompile(`^\(?\s*([A-Za-z_$][\w$]*)`)
	// Nama daftar di x-for: bagian terakhir path (produk, $store.toko.produk -> produk), tanpa pemanggilan/filter.
	listNameRE    = regexp.MustCompile(`[A-Za-z_$][\w$]*$`)
	otherSourceRE = regexp.MustCompile("/api/fn/|fetch\\(\\s*['\"`]https?:")
	jsBuiltinKey  = map[string]bool{"length": true, "toString": true, "valueOf": true, "map": true, "filter": true,
		"find": true, "slice": true, "includes": true, "toFixed": true, "toLocaleString": true, "toUpperCase": true,
		"toLowerCase": true, "trim": true, "split": true, "join": true, "replace": true, "startsWith": true, "endsWith": true}
)

// objectKeys: kunci tingkat atas objek literal yang dimulai di s[0] == '{'. ok = false bila ada kunci yang tidak bisa
// diketahui (spread ...x, [kunci terhitung]) atau objeknya tidak tertutup.
func objectKeys(s string) (keys []string, ok bool) {
	depth := 0
	expectKey := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '"', '\'', '`':
			j := i + 1
			for j < len(s) && s[j] != c {
				if s[j] == '\\' {
					j++
				}
				j++
			}
			if j >= len(s) {
				return nil, false
			}
			if depth == 1 && expectKey {
				rest := strings.TrimLeft(s[j+1:], " \t\r\n")
				if c != '`' && strings.HasPrefix(rest, ":") {
					keys = append(keys, s[i+1:j])
				}
				expectKey = false
			}
			i = j
			continue
		case '{', '[', '(':
			if depth == 1 && expectKey && c == '[' {
				return nil, false
			}
			depth++
			expectKey = depth == 1
			continue
		case '}', ']', ')':
			depth--
			if depth == 0 {
				return keys, true
			}
			continue
		case ',':
			expectKey = depth == 1
			continue
		case ' ', '\t', '\r', '\n':
			continue
		}
		if depth != 1 || !expectKey {
			continue
		}
		expectKey = false
		if strings.HasPrefix(s[i:], "...") {
			return nil, false
		}
		name := identRE.FindString(s[i:])
		if name == "" {
			continue
		}
		rest := strings.TrimLeft(s[i+len(name):], " \t\r\n")
		// nama: nilai, atau singkatan { nama } / { nama, harga }. Metode nama() { } bukan kolom.
		if strings.HasPrefix(rest, ":") || strings.HasPrefix(rest, ",") || strings.HasPrefix(rest, "}") {
			keys = append(keys, name)
		}
		i += len(name) - 1
	}
	return nil, false
}

// bodyColumnProblems: kunci body JSON yang dikirim ke /api/db/<tabel> tapi bukan kolom tabel itu.
func bodyColumnProblems(content string, columns map[string]map[string]bool) []problem {
	var out []problem
	seen := map[string]bool{}
	for _, m := range apiDBRE.FindAllStringSubmatchIndex(content, -1) {
		table := content[m[2]:m[3]]
		cols := columns[table]
		if cols == nil {
			continue // tabel yang belum ada sudah dilaporkan apiPathProblems
		}
		// Body milik request ini: sebelum request berikutnya, dan tidak jauh.
		window := content[m[1]:min(len(content), m[1]+800)]
		if next := nextRequest.FindStringIndex(window); next != nil {
			window = window[:next[0]]
		}
		at := stringifyRE.FindStringIndex(window)
		if at == nil {
			continue
		}
		keys, ok := objectKeys(window[at[1]-1:])
		if !ok {
			continue
		}
		for _, k := range keys {
			if cols[k] || seen[table+"."+k] {
				continue
			}
			seen[table+"."+k] = true
			out = append(out, problem{"column", fmt.Sprintf(`data yang dikirim ke /api/db/%s berisi "%s", tapi tabel %s tidak punya kolom itu (kolomnya: %s) — server menolak request ini dengan "Kolom tidak dikenal"; pakai nama kolom yang ada, atau tambahkan kolomnya dengan create_table`, table, k, table, columnList(cols))})
		}
	}
	return out
}

// pageCode: isi halaman beserta skrip lokal yang dimuatnya.
func (ws *workspace) pageCode(page, content string, info pageInfo) string {
	var b strings.Builder
	b.WriteString(content)
	for _, s := range info.scripts {
		if s.src == "" {
			continue
		}
		if rel := localTarget(page, s.src); rel != "" {
			if js, ok := ws.read(rel); ok {
				b.WriteString("\n" + js)
			}
		}
	}
	return b.String()
}

// loopColumnProblems: p.<nama> di dalam <template x-for="p in …"> yang bukan kolom tabel mana pun dan tidak
// didefinisikan di kode halaman.
func loopColumnProblems(content, code string, columns map[string]map[string]bool) []problem {
	if len(columns) == 0 || !strings.Contains(code, "/api/db/") || !strings.Contains(content, "x-for") {
		return nil
	}
	doc, err := html.Parse(strings.NewReader(content))
	if err != nil {
		return nil
	}
	allColumns := map[string]bool{}
	for _, cols := range columns {
		for c := range cols {
			allColumns[c] = true
		}
	}
	// Tabel yang dipakai halaman ini, untuk daftar kolom di pesan.
	var used []string
	for _, m := range apiDBRE.FindAllStringSubmatch(code, -1) {
		if columns[m[1]] != nil && !slices.Contains(used, m[1]) {
			used = append(used, m[1])
		}
	}
	// Halaman yang juga mengambil data dari tempat lain (fungsi serverless, API luar): hanya daftar yang namanya sama
	// dengan nama tabel yang diperiksa, terhadap kolom tabel itu saja.
	otherSources := otherSourceRE.MatchString(code)
	defined := func(name string) bool {
		q := regexp.QuoteMeta(name)
		return regexp.MustCompile(`(?:^|[^\w$.])` + q + `\s*:|['"]` + q + `['"]\s*:|\.` + q + `\s*=[^=]|\b(?:let|const|var)\s+` + q + `\b`).MatchString(code)
	}
	var out []problem
	reported := map[string]bool{}
	walk(doc, func(n *html.Node) {
		if n.Data != "template" {
			return
		}
		value, ok := attr(n, "x-for")
		if !ok {
			return
		}
		m := xForRE.FindStringSubmatch(value)
		if m == nil {
			return
		}
		alias := forAliasRE.FindStringSubmatch(m[1])
		list := strings.TrimSpace(m[2])
		if alias == nil || strings.HasPrefix(list, "[") || identRE.FindString(list) == "" {
			return // destrukturisasi, array literal, atau angka (x-for="i in 5")
		}
		known, tables := allColumns, used
		if otherSources {
			name := listNameRE.FindString(list)
			if columns[name] == nil {
				return
			}
			known, tables = columns[name], []string{name}
		}
		fieldRE := regexp.MustCompile(`(?:^|[^\w$.])` + regexp.QuoteMeta(alias[1]) + `\??\.([A-Za-z_$][\w$]*)`)
		walk(n, func(el *html.Node) {
			for _, a := range el.Attr {
				if !alpineExprAttrRE.MatchString(a.Key) {
					continue
				}
				for _, f := range fieldRE.FindAllStringSubmatch(a.Val, -1) {
					name := f[1]
					if known[name] || jsBuiltinKey[name] || reported[name] || defined(name) {
						continue
					}
					reported[name] = true
					var hint []string
					for _, t := range tables {
						hint = append(hint, t+": "+columnList(columns[t]))
					}
					where := "di database"
					if len(hint) > 0 {
						where += " (" + strings.Join(hint, "; ") + ")"
					}
					out = append(out, problem{"column", fmt.Sprintf(`<template x-for="%s"> memakai %s.%s, tapi tidak ada kolom "%s" %s — nilainya akan selalu kosong`,
						clipText(value, 60), alias[1], name, name, where)})
				}
			}
		})
	})
	return out
}

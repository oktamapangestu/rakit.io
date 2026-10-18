package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"regexp"
	"slices"
	"sort"
	"strings"

	"rakit.io/server/internal/aimodels"
	"rakit.io/server/internal/files"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/userdb"
)

const (
	maxBuildRounds     = 30
	maxTruncatedRounds = 3
	wrapUpRounds       = 3 // sisa putaran saat model diminta mulai menyelesaikan (lihat wrapUpNote)
	wrapUpNote         = "\n\n(Note from the server: only %d turns are left for this answer. Finish the most important remaining " +
		"change now, skip further testing, and write the summary — mention anything that is still unfinished.)"
	truncatedNote = "\n\n_(Jawaban terpotong karena terlalu panjang.)_"
	roundsNote    = "⚠️ AI berhenti karena mencapai batas langkah untuk satu prompt, jadi sebagian pekerjaan mungkin belum selesai. Cek hasilnya, lalu kirim \"lanjutkan\" untuk meneruskan."
)

// change: satu perubahan dari mode Builder — tulis/hapus file, atau buat/perluas tabel.
type change struct {
	Action  string // write | delete | table
	Path    string
	Content string
	Name    string
	Columns []userdb.Column
	Public  []string
}

// Bentuk JSON-nya sama dengan yang disimpan server Node di ai_messages.changes.
func (c change) MarshalJSON() ([]byte, error) {
	switch c.Action {
	case "table":
		columns, public := c.Columns, c.Public
		if columns == nil {
			columns = []userdb.Column{}
		}
		if public == nil {
			public = []string{}
		}
		return marshal(struct {
			Action  string          `json:"action"`
			Name    string          `json:"name"`
			Columns []userdb.Column `json:"columns"`
			Public  []string        `json:"public"`
		}{c.Action, c.Name, columns, public})
	case "delete":
		return marshal(struct {
			Path   string `json:"path"`
			Action string `json:"action"`
		}{c.Path, c.Action})
	}
	return marshal(struct {
		Path    string `json:"path"`
		Action  string `json:"action"`
		Content string `json:"content"`
	}{c.Path, c.Action, c.Content})
}

func (c *change) UnmarshalJSON(raw []byte) error {
	var v struct {
		Action  string          `json:"action"`
		Path    string          `json:"path"`
		Content string          `json:"content"`
		Name    string          `json:"name"`
		Columns []userdb.Column `json:"columns"`
		Public  []string        `json:"public"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return err
	}
	*c = change{v.Action, v.Path, v.Content, v.Name, v.Columns, v.Public}
	return nil
}

// marshal: JSON tanpa meng-escape <, >, & (isi file HTML harus utuh).
func marshal(v any) ([]byte, error) {
	var buf strings.Builder
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return []byte(strings.TrimSuffix(buf.String(), "\n")), nil
}

func (c change) key() string {
	if c.Action == "table" {
		return "table:" + c.Name
	}
	return c.Path
}

// staged: perubahan yang sudah dicatat (belum ditulis ke disk), urut sesuai yang terakhir menulis.
type staged struct {
	order []string
	items map[string]change
}

func (s *staged) set(c change) {
	key := c.key()
	if _, exists := s.items[key]; exists {
		// File yang sama ditulis dua kali: pakai versi terakhir, di urutan terakhir.
		for i, k := range s.order {
			if k == key {
				s.order = append(s.order[:i], s.order[i+1:]...)
				break
			}
		}
	}
	s.order = append(s.order, key)
	s.items[key] = c
}

// effectiveChanges: perubahan yang benar-benar mengubah project. File yang ditulis ulang dengan isi sama persis
// seperti semula, atau dibuat lalu dihapus lagi di jawaban yang sama, tidak diterapkan dan tidak ditampilkan
// sebagai perubahan.
func (ws *workspace) effectiveChanges() []change {
	var out []change
	for _, c := range ws.st.list() {
		switch c.Action {
		case "delete":
			if !ws.disk[c.Path] {
				continue
			}
		case "write":
			if ws.disk[c.Path] {
				if before, err := files.ReadText(ws.root, c.Path); err == nil && before == c.Content {
					continue
				}
			}
		}
		out = append(out, c)
	}
	return out
}

func (s *staged) list() []change {
	out := make([]change, 0, len(s.order))
	for _, key := range s.order {
		out = append(out, s.items[key])
	}
	return out
}

var tableNameRE = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

func lowerTrim(v any) string { return strings.ToLower(strings.TrimSpace(jsconv.String(v))) }

func display(obj map[string]any, key string) string {
	v, present := obj[key]
	switch {
	case !present:
		return "undefined"
	case v == nil:
		return "null"
	}
	return jsconv.String(v)
}

func validateTable(args map[string]any) (change, error) {
	name := lowerTrim(args["name"])
	if !tableNameRE.MatchString(name) || strings.HasPrefix(name, "sqlite_") || strings.HasPrefix(name, "_rakit") {
		return change{}, fmt.Errorf(`Nama tabel "%s" tidak valid: pakai huruf kecil, angka, dan _, diawali huruf (awalan sqlite_ dan _rakit dicadangkan).`, display(args, "name"))
	}
	list, isList := args["columns"].([]any)
	if !isList {
		return change{}, errors.New("columns harus berupa array.")
	}
	columns := make([]userdb.Column, 0, len(list))
	for _, item := range list {
		c, _ := item.(map[string]any)
		col := lowerTrim(c["name"])
		if !tableNameRE.MatchString(col) {
			return change{}, fmt.Errorf(`Nama kolom "%s" tidak valid.`, display(c, "name"))
		}
		if col == "id" || col == "created_at" {
			return change{}, fmt.Errorf(`Kolom "%s" sudah otomatis, jangan ditulis.`, col)
		}
		kind, _ := c["type"].(string)
		known := false
		for _, t := range userdb.ColumnTypes {
			known = known || t == kind
		}
		if !known {
			return change{}, fmt.Errorf(`Tipe kolom "%s" tidak dikenal. Pilih: %s.`, display(c, "type"), strings.Join(userdb.ColumnTypes, ", "))
		}
		column := userdb.Column{Name: col, Type: kind, Required: truthy(c["required"]), Private: truthy(c["private"])}
		if kind == "reference" {
			ref := strings.TrimSpace(jsconv.String(c["refTable"]))
			if ref == "" {
				return change{}, fmt.Errorf(`Kolom relasi "%s" harus menyertakan refTable (nama tabel yang ditunjuk).`, col)
			}
			column.RefTable = strings.ToLower(ref)
		}
		columns = append(columns, column)
	}
	var public, unknown []string
	seen := map[string]bool{}
	ops, _ := args["public"].([]any)
	for _, raw := range ops {
		op, _ := raw.(string)
		valid := false
		for _, known := range userdb.Operations {
			valid = valid || known == op
		}
		if !valid {
			unknown = append(unknown, jsconv.String(raw))
		} else if !seen[op] {
			seen[op] = true
			public = append(public, op)
		}
	}
	if len(unknown) > 0 {
		return change{}, fmt.Errorf("Operasi tidak dikenal: %s. Pilih dari: %s.", strings.Join(unknown, ", "), strings.Join(userdb.Operations, ", "))
	}
	return change{Action: "table", Name: name, Columns: columns, Public: public}, nil
}

func truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case float64:
		return t != 0
	case string:
		return t != ""
	}
	return true
}

func validateFile(action string, args map[string]any) (change, error) {
	raw, _ := args["path"].(string)
	clean, err := files.CleanPath(raw)
	if err != nil {
		return change{}, err
	}
	if !files.IsTextFile(clean) {
		return change{}, fmt.Errorf(`"%s": hanya file .html, .css, dan .js yang diizinkan.`, clean)
	}
	if action == "delete" {
		return change{Action: "delete", Path: clean}, nil
	}
	content, isString := args["content"].(string)
	if !isString {
		return change{}, errors.New("content harus berupa teks.")
	}
	if len(content) > files.MaxFileSize {
		return change{}, fmt.Errorf(`"%s" melebihi %d KB.`, clean, files.MaxFileSize/1024)
	}
	return change{Action: "write", Path: clean, Content: content}, nil
}

var (
	apiAnyRE   = regexp.MustCompile(`/api/([a-z][a-z0-9_]*)`)
	apiTableRE = regexp.MustCompile(`/api/db/([a-z][a-z0-9_]*)`)
)

// apiPathProblems memeriksa pemakaian API database di isi file: model sering lupa awalan /api/db/.
func apiPathProblems(content string, tables map[string]bool) []string {
	var problems []string
	seen := map[string]bool{}
	add := func(p string) {
		if !seen[p] {
			seen[p] = true
			problems = append(problems, p)
		}
	}
	for _, m := range apiAnyRE.FindAllStringSubmatchIndex(content, -1) {
		// "/api/db/..." adalah bentuk yang benar; yang dicari "/api/<tabel>" tanpa db.
		if strings.HasPrefix(content[m[0]+len("/api/"):], "db/") {
			continue
		}
		if name := content[m[2]:m[3]]; tables[name] {
			add(fmt.Sprintf(`alamat "/api/%s" salah, seharusnya "/api/db/%s"`, name, name))
		}
	}
	for _, m := range apiTableRE.FindAllStringSubmatch(content, -1) {
		if !tables[m[1]] {
			add(fmt.Sprintf(`tabel "%s" belum ada, panggil create_table untuk membuatnya`, m[1]))
		}
	}
	return problems
}

func knownTables(existing []string, st *staged) map[string]bool {
	out := map[string]bool{}
	for _, name := range existing {
		out[name] = true
	}
	for _, c := range st.items {
		if c.Action == "table" {
			out[c.Name] = true
		}
	}
	return out
}

// stageToolCall menjalankan satu panggilan tool: read_file dijawab langsung, yang lain dicatat sebagai perubahan
// (belum ditulis ke disk). Hasilnya dikirim balik ke model; found = masalah yang ditemukan (untuk statistik).
func stageToolCall(call toolCall, ws *workspace, truncated bool) (result string, found []problem) {
	args := map[string]any{}
	raw := call.Arguments
	if raw == "" {
		raw = "{}"
	}
	var parsed any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		if truncated {
			return "Error: panggilan ini terpotong karena jawabanmu melebihi batas panjang, jadi tidak disimpan. " +
				"Panggil tool ini lagi dengan isi lengkap. Kalau filenya sangat besar, pecah jadi beberapa file lebih kecil " +
				"(misalnya CSS atau JS terpisah) dan tulis satu file per panggilan, atau ubah sebagian saja dengan edit_file.", []problem{{"tool", "terpotong"}}
		}
		return "Error: argumen bukan JSON yang valid. Panggil tool ini lagi dengan JSON yang benar.", []problem{{"tool", "json"}}
	}
	if obj, isObject := parsed.(map[string]any); isObject {
		args = obj
	}

	var valid change
	var err error
	switch call.Name {
	case "read_file":
		return readFile(args, ws), nil
	case "search_files":
		text, err := searchFiles(args, ws)
		if err != nil {
			return "Error: " + err.Error(), []problem{{"tool", err.Error()}}
		}
		return text, nil
	case "write_file":
		valid, err = validateFile("write", args)
	case "edit_file":
		valid, err = editFile(args, ws)
	case "delete_file":
		valid, err = validateFile("delete", args)
	case "create_table":
		valid, err = validateTable(args)
	default:
		return fmt.Sprintf(`Error: tool "%s" tidak dikenal.`, call.Name), []problem{{"tool", "unknown"}}
	}
	if err != nil {
		kind := "tool"
		if call.Name == "edit_file" {
			kind = "edit"
		}
		return "Error: " + err.Error(), []problem{{kind, err.Error()}}
	}
	previous, _ := ws.read(valid.Path) // isi sebelum panggilan ini (untuk placeholder)
	ws.st.set(valid)
	switch valid.Action {
	case "table":
		return fmt.Sprintf(`OK: tabel "%s" akan dibuat/diperbarui. Pakai dari JavaScript situs dengan fetch('/api/db/%s').`, valid.Name, valid.Name), nil
	case "delete":
		return fmt.Sprintf(`OK: "%s" akan dihapus.`, valid.Path), nil
	}
	code := syntaxProblems(valid.Path, valid.Content)
	for _, p := range apiPathProblems(valid.Content, knownTables(ws.tables, ws.st)) {
		code = append(code, problem{"api", p})
	}
	code = append(code, placeholderProblems(previous, valid.Content)...)
	if len(code) > 0 {
		return fmt.Sprintf(`Ditulis, TAPI ada masalah di "%s": %s. Perbaiki lalu panggil write_file lagi.`, valid.Path, strings.Join(texts(code), "; ")), code
	}
	note := "" // dibandingkan dengan isi sebelum jawaban ini, bukan tulisan model sebelumnya
	if call.Name == "write_file" && ws.disk[valid.Path] {
		if original, err := files.ReadText(ws.root, valid.Path); err == nil {
			note = shrinkNote(valid.Path, original, valid.Content)
		}
	}
	if list := htmlProblems(valid.Path, valid.Content); len(list) > 0 {
		for _, p := range list {
			kind := "link"
			if strings.Contains(p, "kontras") {
				kind = "contrast"
			}
			found = append(found, problem{kind, p})
		}
		return fmt.Sprintf(`Ditulis, TAPI ada masalah kualitas di "%s": %s. Perbaiki lalu panggil write_file lagi.`, valid.Path, strings.Join(list, "; ")) + note, found
	}
	if call.Name == "edit_file" {
		return fmt.Sprintf(`OK: "%s" diubah (%d karakter sekarang).`, valid.Path, jsconv.Len(valid.Content)), nil
	}
	if note != "" {
		found = append(found, problem{"shrink", note})
	}
	return fmt.Sprintf(`OK: "%s" ditulis (%d karakter).`, valid.Path, jsconv.Len(valid.Content)) + note, found
}

// readFile: isi terbaru sebuah file teks — termasuk perubahan yang sudah dibuat model di job ini.
func readFile(args map[string]any, ws *workspace) string {
	raw, _ := args["path"].(string)
	clean, err := files.CleanPath(raw)
	if err != nil {
		return "Error: " + err.Error()
	}
	if truthy(args["original"]) {
		if !ws.disk[clean] {
			return fmt.Sprintf(`Error: "%s" belum ada sebelum jawaban ini.`, clean)
		}
		if !files.IsTextFile(clean) {
			return fmt.Sprintf(`Error: "%s" bukan file teks (.html, .css, .js).`, clean)
		}
		content, err := files.ReadText(ws.root, clean)
		if err != nil {
			return "Error: " + err.Error()
		}
		return fmt.Sprintf("Isi \"%s\" sebelum jawaban ini:\n%s", clean, content)
	}
	content, ok := ws.read(clean)
	if !ok {
		if ws.exists(clean) {
			return fmt.Sprintf(`Error: "%s" bukan file teks (.html, .css, .js).`, clean)
		}
		return fmt.Sprintf(`Error: "%s" tidak ada di project.`, clean)
	}
	return fmt.Sprintf("Isi terbaru \"%s\":\n%s", clean, content)
}

// editFile: ganti bagian file yang sudah ada. Setiap old_text harus cocok persis di satu tempat; bila satu saja
// gagal, tidak ada yang diubah.
func editFile(args map[string]any, ws *workspace) (change, error) {
	raw, _ := args["path"].(string)
	clean, err := files.CleanPath(raw)
	if err != nil {
		return change{}, err
	}
	if !files.IsTextFile(clean) {
		return change{}, fmt.Errorf(`"%s": hanya file .html, .css, dan .js yang diizinkan.`, clean)
	}
	content, ok := ws.read(clean)
	if !ok {
		return change{}, fmt.Errorf(`"%s" belum ada. Pakai write_file untuk membuat file baru.`, clean)
	}
	list, _ := args["edits"].([]any)
	if len(list) == 0 {
		return change{}, errors.New("edits harus berisi minimal satu { old_text, new_text }.")
	}
	crlf := strings.Contains(content, "\r\n")
	for i, item := range list {
		e, _ := item.(map[string]any)
		old, okOld := e["old_text"].(string)
		repl, okNew := e["new_text"].(string)
		if !okOld || !okNew || old == "" {
			return change{}, fmt.Errorf("edit ke-%d: old_text dan new_text harus berupa teks, dan old_text tidak boleh kosong. Tidak ada yang diubah.", i+1)
		}
		if crlf && !strings.Contains(old, "\r\n") {
			old = strings.ReplaceAll(old, "\n", "\r\n")
			repl = strings.ReplaceAll(repl, "\n", "\r\n")
		}
		switch n := strings.Count(content, old); {
		case n == 0:
			return change{}, fmt.Errorf(`edit ke-%d: old_text tidak ditemukan persis di "%s" (perhatikan spasi, indentasi, dan tanda kutip). Tidak ada yang diubah — panggil read_file untuk melihat isi terbarunya, lalu salin teksnya persis.`, i+1, clean)
		case n > 1:
			return change{}, fmt.Errorf(`edit ke-%d: old_text muncul %d kali di "%s". Sertakan baris di sekitarnya supaya hanya cocok di satu tempat. Tidak ada yang diubah.`, i+1, n, clean)
		}
		content = strings.Replace(content, old, repl, 1)
	}
	if len(content) > files.MaxFileSize {
		return change{}, fmt.Errorf(`"%s" melebihi %d KB.`, clean, files.MaxFileSize/1024)
	}
	return change{Action: "write", Path: clean, Content: content}, nil
}

var (
	messageTagRE = regexp.MustCompile(`(?s)<message>(.*?)</message>`)
	fileBlockRE  = regexp.MustCompile(`(?s)<file\s[^>]*>.*?</file>`)
	tableBlockRE = regexp.MustCompile(`(?s)<db-table.*?</db-table>`)
	blankLinesRE = regexp.MustCompile(`\n{3,}`)
)

// planMessage: Plan hanya menghasilkan teks; buang sisa blok <file>/<db-table> kalau model tetap menulisnya.
func planMessage(text string) string {
	if m := messageTagRE.FindStringSubmatch(text); m != nil {
		text = m[1]
	}
	text = tableBlockRE.ReplaceAllString(fileBlockRE.ReplaceAllString(text, ""), "")
	return strings.TrimSpace(blankLinesRE.ReplaceAllString(text, "\n\n"))
}

var (
	// claimRE: baris "(Perubahan: tulis a.js, hapus b.html, tabel x)" — bentuk catatan riwayat lama yang kadang
	// ditiru model sebagai teks tanpa memanggil tool. Setiap bagiannya harus berupa claimItemRE.
	claimRE     = regexp.MustCompile(`(?im)^[ \t]*\(?(?:perubahan|jawaban ai sebelumnya memanggil tool)(?: ini)?:[ \t]*(.+?)\)?\.?[ \t]*$`)
	claimItemRE = regexp.MustCompile(`(?i)^(tulis|hapus)[ \t]+/?([\w./-]+\.(?:html|css|js))$|^(tabel)[ \t]+([a-z][a-z0-9_]*)$`)
	// claimDetailRE: blok "Isi perubahan (- sebelum, + sesudah):" sampai akhir teks, juga tiruan catatan riwayat.
	claimDetailRE = regexp.MustCompile(`(?is)[ \t]*isi perubahan \(- sebelum, \+ sesudah\):.*$`)
)

// claimLines: baris "(Perubahan: …)" di teks model beserta isinya (key staged: path, atau "table:<nama>").
func claimLines(text string) (lines []string, keys []string) {
	for _, m := range claimRE.FindAllStringSubmatch(text, -1) {
		var found []string
		for _, part := range strings.Split(m[1], ",") {
			item := claimItemRE.FindStringSubmatch(strings.TrimSpace(part))
			if item == nil {
				found = nil
				break
			}
			if item[2] != "" {
				found = append(found, item[2])
			} else {
				found = append(found, "table:"+strings.ToLower(item[4]))
			}
		}
		if len(found) > 0 {
			lines = append(lines, m[0])
			keys = append(keys, found...)
		}
	}
	return lines, keys
}

// unstagedClaims: file/tabel yang disebut di baris "(Perubahan: …)" di teks model tapi tidak pernah diubah lewat
// tool di job ini — model mengira sudah mengubahnya padahal belum.
func unstagedClaims(text string, st *staged) []string {
	var out []string
	_, keys := claimLines(text)
	for _, key := range keys {
		if _, done := st.items[key]; !done && !slices.Contains(out, key) {
			out = append(out, key)
		}
	}
	for i, key := range out {
		if name, isTable := strings.CutPrefix(key, "table:"); isTable {
			out[i] = "tabel " + name
		}
	}
	return out
}

// stripClaims membuang tiruan catatan riwayat dari ringkasan: daftar perubahan sudah ditampilkan editor sendiri.
func stripClaims(text string) string {
	lines, _ := claimLines(text)
	if len(lines) == 0 {
		return text
	}
	for _, line := range lines {
		text = strings.Replace(text, line, "", 1)
	}
	text = claimDetailRE.ReplaceAllString(text, "")
	return strings.TrimSpace(blankLinesRE.ReplaceAllString(text, "\n\n"))
}

func checkFinish(r *reply) error {
	if r.FinishReason == "content_filter" {
		return &failure{"refusal", "Permintaan ini tidak bisa diproses oleh AI."}
	}
	return nil
}

type buildResult struct {
	message          string
	changes          []change
	inTokens, outTok int
	peakIn           int      // token input terbesar satu panggilan model = isi jendela konteks (lihat saveContext)
	images           []string // gambar yang dirujuk tapi belum ada (lihat imagesNote)
	stats            buildStats
}

// buildStats: hasil pemeriksaan kode satu job Builder, disimpan di ai_requests.checks untuk dashboard owner.
// Found = berapa kali tiap jenis masalah dikembalikan ke model; Left = yang masih ada saat selesai.
type buildStats struct {
	Found  map[string]int `json:"found,omitempty"`
	Left   map[string]int `json:"left,omitempty"`
	Rounds int            `json:"rounds"`
	Tools  map[string]int `json:"tools,omitempty"` // berapa kali tiap tool dipanggil
}

func (b *buildStats) count(target *map[string]int, list []problem) {
	for _, p := range list {
		if *target == nil {
			*target = map[string]int{}
		}
		(*target)[p.kind]++
	}
}

// slimNote menggantikan isi file di putaran lanjut (lihat slimContext).
const slimNote = "(File contents from the first turn are left out here. Call read_file to see a file's current content, including your own changes.)"

// slimContext membuang blok isi file (<file path="...">…</file>) dari konteks project.
// Dipakai pada putaran lanjut runBuilder: konteks penuh hanya perlu sekali, putaran
// berikutnya cukup struktur/daftar file supaya biaya token input tidak membengkak berulang.
// Isi terbaru sebuah file bisa dibaca model dengan read_file.
func slimContext(content string) string {
	loc := fileBlockRE.FindStringIndex(content)
	if loc == nil {
		return content
	}
	slim := content[:loc[0]] + slimNote + fileBlockRE.ReplaceAllString(content[loc[0]:], "")
	return blankLinesRE.ReplaceAllString(slim, "\n\n")
}

// messageText mengambil isi teks sebuah pesan (kosong bila bukan string).
func messageText(m message) string {
	s, _ := m["content"].(string)
	return s
}

// withText mengembalikan salinan pesan dengan isi teks diganti.
func withText(m message, content string) message {
	out := make(message, len(m))
	for k, v := range m {
		out[k] = v
	}
	out["content"] = content
	return out
}

func debugCut(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}

// runBuilder: mode Builder — ulangi permintaan sampai model selesai memanggil tool dan menulis ringkasan.
// lb: tool uji (test_api, check_page); nil = tidak aktif.
func (s *Service) runBuilder(messages []message, ws *workspace, lb *lab, h hooks) (*buildResult, error) {
	convo := append([]message(nil), messages...)
	// Pesan terakhir berisi konteks project + permintaan. Konteks penuh hanya dikirim di
	// putaran pertama; putaran lanjut memakai versi ringkas. Pesan setelahnya (jawaban &
	// hasil tool) selalu ikut utuh.
	ctxIdx := len(convo) - 1
	hasContext := ctxIdx >= 0 && strings.Contains(messageText(convo[ctxIdx]), "<file")
	out := &buildResult{}
	text := ""
	truncatedRounds := 0
	lastNudge := "" // masalah yang terakhir dikembalikan di pemeriksaan akhir
	claimNudged := false
	finished := false // model menyatakan selesai (bukan berhenti karena batas putaran)

	for round := 0; round < maxBuildRounds; round++ {
		out.stats.Rounds = round + 1
		payload := convo
		if round > 0 && hasContext {
			payload = make([]message, len(convo))
			copy(payload, convo)
			payload[ctxIdx] = withText(payload[ctxIdx], slimContext(messageText(payload[ctxIdx])))
		}
		r, err := s.callAI(request{task: aimodels.TaskBuilder, messages: payload, tools: true}, h)
		if err != nil {
			return nil, err
		}
		out.inTokens += r.PromptTokens
		out.outTok += r.CompletionTokens
		out.peakIn = max(out.peakIn, r.PromptTokens)
		if os.Getenv("AI_DEBUG") != "" {
			log.Printf("----- AI builder round %d (%s) -----\n%s", round+1, r.FinishReason, r.Text)
		}
		if err := checkFinish(r); err != nil {
			return nil, err
		}
		// Terpotong karena batas token: simpan yang sudah lengkap, lalu minta model melanjutkan.
		truncated := r.FinishReason == "length"
		if truncated {
			truncatedRounds++
		} else {
			truncatedRounds = 0
		}
		if truncatedRounds >= maxTruncatedRounds {
			return nil, &failure{"max_tokens", "Jawaban AI terus terpotong karena terlalu panjang. Coba pecah permintaan jadi lebih kecil."}
		}
		if strings.TrimSpace(r.Text) != "" {
			text = r.Text
			if truncated && len(r.ToolCalls) == 0 {
				text += truncatedNote
			}
		}

		if len(r.ToolCalls) == 0 {
			// Ringkasan menyebut file yang diubah, tapi tool untuk file itu tidak pernah dipanggil: minta sekali lagi.
			if missing := unstagedClaims(r.Text, ws.st); len(missing) > 0 && !claimNudged && round < maxBuildRounds-1 {
				claimNudged = true
				out.stats.count(&out.stats.Found, []problem{{"claim", strings.Join(missing, ", ")}})
				if h.onNote != nil {
					h.onNote("AI menyebut perubahan yang belum dibuat — AI diminta mengerjakannya")
				}
				convo = append(convo,
					message{"role": "assistant", "content": r.Text},
					message{"role": "user", "content": "Kamu menulis bahwa " + strings.Join(missing, ", ") + " diubah, tapi belum ada tool yang " +
						"dipanggil untuk itu — belum ada yang berubah. Menulis daftar perubahan di teks tidak mengubah apa pun. " +
						"Kalau memang perlu diubah, panggil write_file/edit_file/delete_file/create_table sekarang, lalu tulis " +
						"ringkasan lagi. Kalau ternyata tidak perlu, tulis ulang jawabanmu tanpa menyebut perubahan itu."})
				continue
			}
			// Pemeriksaan akhir atas semua file yang ditulis: model memperbaiki masalahnya sebelum selesai. Masalah
			// yang sama persis dengan pengembalian sebelumnya tidak dikirim lagi (model menganggapnya disengaja atau
			// tidak bisa memperbaikinya), supaya tidak berputar sampai batas putaran.
			byFile, _ := ws.finalProblems()
			problems := problemList(byFile)
			nudge := strings.Join(problems, "\n")
			if len(problems) == 0 || round >= maxBuildRounds-1 || nudge == lastNudge {
				finished = true
				break
			}
			lastNudge = nudge
			for _, list := range byFile {
				out.stats.count(&out.stats.Found, list)
			}
			if h.onNote != nil {
				h.onNote(fmt.Sprintf("Pemeriksaan otomatis menemukan %d masalah — AI memperbaikinya", len(problems)))
			}
			content := r.Text
			if content == "" {
				content = "(selesai)"
			}
			convo = append(convo,
				message{"role": "assistant", "content": content},
				message{"role": "user", "content": "Sebelum selesai, perbaiki masalah ini dengan tool, lalu tulis ringkasan lagi:\n" + nudge})
			continue
		}

		echoed := make([]map[string]any, 0, len(r.ToolCalls))
		for _, c := range r.ToolCalls {
			// Argumen yang terpotong bukan JSON valid; kirim "{}" supaya provider tidak menolak riwayatnya.
			arguments := c.Arguments
			if arguments == "" || !json.Valid([]byte(arguments)) {
				arguments = "{}"
				if c.Arguments == "" {
					arguments = c.Arguments
				}
			}
			echoed = append(echoed, map[string]any{"id": c.ID, "type": "function", "function": map[string]string{"name": c.Name, "arguments": arguments}})
		}
		assistant := message{"role": "assistant", "content": r.Text, "tool_calls": echoed}
		if r.Reasoning != "" {
			assistant["reasoning_content"] = r.Reasoning
		}
		convo = append(convo, assistant)
		for n, c := range r.ToolCalls {
			result, found, tested := lb.run(h.ctx, c)
			if !tested {
				result, found = stageToolCall(c, ws, truncated)
			}
			if out.stats.Tools == nil {
				out.stats.Tools = map[string]int{}
			}
			out.stats.Tools[c.Name]++
			if os.Getenv("AI_DEBUG") != "" {
				log.Printf("----- tool %s %s\n%s", c.Name, debugCut(c.Arguments, 300), debugCut(result, 1500))
			}
			out.stats.count(&out.stats.Found, found)
			if h.onToolResult != nil {
				h.onToolResult(n, c, result)
			}
			convo = append(convo, message{"role": "tool", "tool_call_id": c.ID, "content": result})
		}
		// Jatah putaran hampir habis: ingatkan model lewat hasil tool terakhir (pesan user di antara hasil tool
		// dan giliran asisten ditolak sebagian provider), supaya ia sempat menulis ringkasan sendiri.
		if left := maxBuildRounds - 1 - round; left == wrapUpRounds {
			last := convo[len(convo)-1]
			convo[len(convo)-1] = withText(last, messageText(last)+fmt.Sprintf(wrapUpNote, left))
		}
	}
	if !finished {
		text = strings.TrimSpace(text + "\n\n" + roundsNote)
	}
	byFile, images := ws.finalProblems()
	for _, list := range byFile {
		out.stats.count(&out.stats.Left, list)
	}
	if missing := unstagedClaims(text, ws.st); len(missing) > 0 {
		out.stats.count(&out.stats.Left, []problem{{"claim", strings.Join(missing, ", ")}})
	}
	out.images = images
	out.message = stripClaims(planMessage(text))
	out.changes = ws.effectiveChanges()
	return out, nil
}

// ---------- Menerapkan perubahan ----------
// Perubahan Builder diterapkan langsung di server, dengan snapshot untuk Batalkan. Snapshot disimpan
// di database bersama pesan AI, jadi Batalkan tetap bisa walau browser di-refresh.

type fileSnapshot struct {
	Path   string  `json:"path"`
	Before *string `json:"before"` // nil = file baru
}

type tableSnapshot struct {
	Table        string            `json:"table"`
	Existed      bool              `json:"existed"`
	AddedColumns []string          `json:"addedColumns,omitempty"`
	BeforeRules  map[string]string `json:"beforeRules,omitempty"`
}

type snapshot struct {
	Files      []fileSnapshot  `json:"files"`
	Tables     []tableSnapshot `json:"tables"`
	DirsBefore []string        `json:"dirsBefore"`
}

func (s *Service) fileExists(root, rel string) bool {
	abs, err := files.ResolveIn(root, rel)
	if err != nil {
		return false
	}
	info, _ := files.LstatOrNil(abs)
	return info != nil && info.Mode().IsRegular()
}

func columnInputs(columns []userdb.Column) []any {
	out := make([]any, 0, len(columns))
	for _, c := range columns {
		item := map[string]any{"name": c.Name, "type": c.Type, "required": c.Required, "private": c.Private}
		if c.RefTable != "" {
			item["refTable"] = c.RefTable
		}
		out = append(out, item)
	}
	return out
}

func (s *Service) findTable(ctx context.Context, slug, name string) (*userdb.TableInfo, error) {
	if !s.userdb.HasDatabase(slug) {
		return nil, nil
	}
	tables, err := s.userdb.ListTables(ctx, slug)
	if err != nil {
		return nil, err
	}
	for _, t := range tables {
		if t.Name == name {
			return t, nil
		}
	}
	return nil, nil
}

func (s *Service) applyTable(ctx context.Context, slug string, c change, columns []userdb.Column) (tableSnapshot, error) {
	existing, err := s.findTable(ctx, slug, c.Name)
	if err != nil {
		return tableSnapshot{}, err
	}
	rules := map[string]any{}
	for _, op := range c.Public {
		rules[op] = "public"
	}
	if existing == nil {
		_, err := s.userdb.CreateTable(ctx, slug, map[string]any{"name": c.Name, "columns": columnInputs(columns), "rules": rules})
		return tableSnapshot{Table: c.Name}, err
	}
	var added []userdb.Column
	for _, col := range columns {
		found := false
		for _, e := range existing.Columns {
			found = found || e.Name == col.Name
		}
		if !found {
			added = append(added, col)
		}
	}
	widened := false
	for _, op := range c.Public {
		widened = widened || existing.Rules[op] != "public"
	}
	if len(added) > 0 || widened {
		if _, err := s.userdb.UpdateTable(ctx, slug, c.Name, map[string]any{"addColumns": columnInputs(added), "rules": rules}); err != nil {
			return tableSnapshot{}, err
		}
	}
	names := []string{}
	for _, col := range added {
		names = append(names, col.Name)
	}
	return tableSnapshot{Table: c.Name, Existed: true, AddedColumns: names, BeforeRules: existing.Rules}, nil
}

func (s *Service) revertTable(ctx context.Context, slug string, entry tableSnapshot) error {
	var err error
	if !entry.Existed {
		err = s.userdb.DeleteTable(ctx, slug, entry.Table)
	} else {
		drops := make([]any, 0, len(entry.AddedColumns))
		for _, name := range entry.AddedColumns {
			drops = append(drops, name)
		}
		patch := map[string]any{"dropColumns": drops}
		if entry.BeforeRules != nil {
			rules := map[string]any{}
			for op, v := range entry.BeforeRules {
				rules[op] = v
			}
			patch["rules"] = rules
		}
		_, err = s.userdb.UpdateTable(ctx, slug, entry.Table, patch)
	}
	// Tabel/kolom sudah dihapus pemiliknya: tidak ada yang perlu dikembalikan.
	var he *httpx.Error
	if errors.As(err, &he) && he.Status == 404 {
		return nil
	}
	return err
}

// applyTables membuat/memperluas tabel. Fase 1: tabel + kolom biasa. Fase 2: kolom relasi, setelah semua tabel
// tujuan ada. Snapshot yang sudah terkumpul ikut dikembalikan walau gagal di tengah (untuk dikembalikan).
func (s *Service) applyTables(ctx context.Context, slug string, tableChanges []change) ([]tableSnapshot, error) {
	var snaps []tableSnapshot
	for _, c := range tableChanges {
		var plain []userdb.Column
		for _, col := range c.Columns {
			if col.Type != "reference" {
				plain = append(plain, col)
			}
		}
		entry, err := s.applyTable(ctx, slug, c, plain)
		if err != nil {
			return snaps, err
		}
		snaps = append(snaps, entry)
	}
	for _, c := range tableChanges {
		existing, err := s.findTable(ctx, slug, c.Name)
		if err != nil {
			return snaps, err
		}
		var missing []userdb.Column
		for _, col := range c.Columns {
			if col.Type != "reference" {
				continue
			}
			found := false
			if existing != nil {
				for _, e := range existing.Columns {
					found = found || e.Name == col.Name
				}
			}
			if !found {
				missing = append(missing, col)
			}
		}
		if len(missing) == 0 {
			continue
		}
		if _, err := s.userdb.UpdateTable(ctx, slug, c.Name, map[string]any{"addColumns": columnInputs(missing)}); err != nil {
			return snaps, err
		}
		// existed: true → revert cukup menghapus kolom relasi yang barusan ditambahkan.
		names := []string{}
		for _, col := range missing {
			names = append(names, col.Name)
		}
		snaps = append(snaps, tableSnapshot{Table: c.Name, Existed: true, AddedColumns: names})
	}
	return snaps, nil
}

// applyChanges menerapkan perubahan. Bila gagal di tengah jalan, semuanya dikembalikan lalu
// kesalahannya dikembalikan ke pemanggil.
func (s *Service) applyChanges(ctx context.Context, slug string, changes []change) (*snapshot, error) {
	root := s.cfg.SiteRoot(slug)
	snap := &snapshot{Files: []fileSnapshot{}, Tables: []tableSnapshot{}, DirsBefore: []string{}}
	var fileChanges, tableChanges []change
	for _, c := range changes {
		if c.Action == "table" {
			tableChanges = append(tableChanges, c)
			continue
		}
		fileChanges = append(fileChanges, c)
		entry := fileSnapshot{Path: c.Path}
		if s.fileExists(root, c.Path) {
			before, err := files.ReadText(root, c.Path)
			if err != nil {
				return nil, err
			}
			entry.Before = &before
		}
		snap.Files = append(snap.Files, entry)
	}
	entries, err := files.ListTree(root)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if e.Dir {
			snap.DirsBefore = append(snap.DirsBefore, e.Path)
		}
	}

	apply := func() error {
		// Tabel dulu, supaya halaman yang memakai datanya langsung berfungsi di preview.
		tables, err := s.applyTables(ctx, slug, tableChanges)
		snap.Tables = append(snap.Tables, tables...)
		if err != nil {
			return err
		}
		limits := s.plans.StorageFor(slug)
		for _, c := range fileChanges {
			exists := s.fileExists(root, c.Path)
			if c.Action == "delete" {
				if exists {
					if err := files.RemoveEntry(root, c.Path); err != nil {
						return err
					}
				}
				continue
			}
			content := c.Content
			if _, err := files.WriteText(root, c.Path, &content, !exists, limits); err != nil {
				return err
			}
		}
		return nil
	}
	if err := apply(); err != nil {
		s.revertChanges(ctx, slug, snap)
		return nil, err
	}
	return snap, nil
}

// revertChanges mengembalikan semua file dan tabel ke isi sebelum perubahan.
func (s *Service) revertChanges(ctx context.Context, slug string, snap *snapshot) error {
	root := s.cfg.SiteRoot(slug)
	for i := len(snap.Tables) - 1; i >= 0; i-- {
		if err := s.revertTable(ctx, slug, snap.Tables[i]); err != nil {
			return err
		}
	}
	limits := s.plans.StorageFor(slug)
	for i := len(snap.Files) - 1; i >= 0; i-- {
		entry := snap.Files[i]
		exists := s.fileExists(root, entry.Path)
		if entry.Before == nil {
			if exists {
				if err := files.RemoveEntry(root, entry.Path); err != nil {
					return err
				}
			}
			continue
		}
		if _, err := files.WriteText(root, entry.Path, entry.Before, !exists, limits); err != nil {
			return err
		}
	}

	// Folder yang dibuat oleh perubahan AI dan kini kosong ikut dihapus (terdalam dulu).
	before := map[string]bool{}
	for _, dir := range snap.DirsBefore {
		before[dir] = true
	}
	entries, err := files.ListTree(root)
	if err != nil {
		return err
	}
	var created []string
	for _, e := range entries {
		if e.Dir && !before[e.Path] {
			created = append(created, e.Path)
		}
	}
	sort.Slice(created, func(i, j int) bool { return len(created[i]) > len(created[j]) })
	for _, dir := range created {
		if abs, err := files.ResolveIn(root, dir); err == nil {
			os.Remove(abs) // hanya berhasil bila kosong
		}
	}
	return nil
}

// touchedPaths: path file yang disentuh perubahan (untuk memberi tahu editor agar memuat ulang).
func touchedPaths(changes []change) []string {
	out := []string{}
	for _, c := range changes {
		if c.Action != "table" {
			out = append(out, c.Path)
		}
	}
	return out
}

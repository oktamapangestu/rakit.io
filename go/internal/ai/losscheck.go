package ai

// Pemeriksaan kode yang hilang saat Builder menimpa file yang sudah ada — kesalahan model yang paling sering
// merusak fitur yang tadinya jalan:
//   - placeholder: model menulis "// ... kode lainnya tetap sama" atau "<!-- sisa sama -->" alih-alih isi lengkap,
//     sehingga isi file terpotong (dicek per file saat ditulis, dan sekali lagi di pemeriksaan akhir);
//   - file menyusut drastis lewat write_file: catatan saja, karena bisa memang diminta (shrinkNote);
//   - definisi yang hilang tapi masih dipakai: komponen/store Alpine, fungsi global, dan id elemen yang ada di
//     isi file sebelum job ini, tidak ada lagi di file mana pun, tapi masih dipanggil/dicari di file lain
//     (lostDefinitions, di pemeriksaan akhir).
// Kode fungsi serverless (functions/) berjalan terpisah dari halaman, jadi tidak ikut dicocokkan dengan halaman.

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"rakit.io/server/internal/files"
)

// ---------- Placeholder ----------

var (
	htmlCommentRE  = regexp.MustCompile(`(?s)<!--(.*?)-->`)
	blockCommentRE = regexp.MustCompile(`(?s)/\*(.*?)\*/`)
	// Komentar satu baris; "//" sesudah ":" (https://…) atau "\" bukan komentar.
	lineCommentRE = regexp.MustCompile(`(?m)(?:^|[^:\\/])//([^\n]*)`)
	ellipsisRE    = regexp.MustCompile(`\.{3}|…`)
	onlyDotsRE    = regexp.MustCompile(`^[\s.…]*$`)
	// Kata yang menandai "bagian ini sengaja tidak ditulis ulang".
	placeholderWordRE = regexp.MustCompile(`(?i)\b(existing|unchanged|rest|remaining|same|previous|omitted|other|sisa|sisanya|sama|tetap|lain|lainnya|sebelumnya|berubah|dst|seterusnya|seperti)\b`)
)

// placeholders: komentar placeholder di content (teks komentarnya, tanpa duplikat).
func placeholders(content string) []string {
	var out []string
	seen := map[string]bool{}
	for _, re := range []*regexp.Regexp{htmlCommentRE, blockCommentRE, lineCommentRE} {
		for _, m := range re.FindAllStringSubmatch(content, -1) {
			text := strings.TrimSpace(m[1])
			if !ellipsisRE.MatchString(text) || !(onlyDotsRE.MatchString(text) || placeholderWordRE.MatchString(text)) {
				continue
			}
			if !seen[text] {
				seen[text] = true
				out = append(out, text)
			}
		}
	}
	return out
}

// placeholderProblems: placeholder baru di after yang belum ada di before (komentar "..." yang memang sudah ada
// di kode pengguna tidak dilaporkan).
func placeholderProblems(before, after string) []problem {
	old := map[string]bool{}
	for _, p := range placeholders(before) {
		old[p] = true
	}
	var out []problem
	for _, p := range placeholders(after) {
		if old[p] {
			continue
		}
		shown := p
		if len([]rune(shown)) > 60 {
			shown = string([]rune(shown)[:60]) + "…"
		}
		out = append(out, problem{"loss", fmt.Sprintf(`ada komentar placeholder "%s" — isi file ditulis apa adanya, jadi bagian yang diwakilinya HILANG. `+
			`Tulis isi lengkapnya (read_file dengan original: true menampilkan isi sebelum jawaban ini), atau ubah sebagian saja dengan edit_file`, shown)})
	}
	return out
}

// ---------- File menyusut ----------

const (
	shrinkMinLines = 60 // file lebih pendek dari ini tidak dicek
	shrinkPercent  = 40 // catatan bila isi baru < 40% baris isi lama
)

// shrinkNote: catatan bila write_file membuat file yang sudah ada jauh lebih pendek. Bukan masalah yang wajib
// diperbaiki — menghapus bagian bisa memang diminta pengguna.
func shrinkNote(path, before, after string) string {
	a, b := lineCount(strings.TrimRight(before, "\n")), lineCount(strings.TrimRight(after, "\n"))
	if a < shrinkMinLines || b*100 >= a*shrinkPercent {
		return ""
	}
	return fmt.Sprintf(` Catatan: "%s" sekarang %d baris, sebelumnya %d. Kalau ada bagian yang tidak sengaja hilang, `+
		`kembalikan (read_file dengan original: true menampilkan isi sebelum jawaban ini). Kalau memang sengaja dihapus, lanjutkan.`, path, b, a)
}

// ---------- Definisi yang hilang tapi masih dipakai ----------

var (
	componentDefRE = regexp.MustCompile(`Alpine\.data\(\s*['"` + "`" + `]([A-Za-z_$][\w$]*)`)
	storeDefRE     = regexp.MustCompile(`Alpine\.store\(\s*['"` + "`" + `]([A-Za-z_$][\w$]*)['"` + "`" + `]\s*,`)
	// Fungsi global: deklarasi di awal baris, atau const/let/var/window.x = function/arrow.
	functionDefRE = regexp.MustCompile(`(?m)^[ \t]*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|` +
		`(?m)^[ \t]*(?:(?:const|let|var)\s+|window\.)([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)`)
	xDataNameRE = regexp.MustCompile(`(?i)\sx-data\s*=\s*["']\s*([A-Za-z_$][\w$]*)\s*(?:\(|["'])`)
)

// definitions: nama yang disediakan isi sebuah file untuk file lain.
type definitions struct {
	components, stores, functions, ids map[string]bool
}

func definitionsIn(path, content string) definitions {
	d := definitions{map[string]bool{}, map[string]bool{}, map[string]bool{}, map[string]bool{}}
	lower := strings.ToLower(path)
	if !strings.HasSuffix(lower, ".js") && !strings.HasSuffix(lower, ".html") {
		return d
	}
	for _, m := range componentDefRE.FindAllStringSubmatch(content, -1) {
		d.components[m[1]] = true
	}
	for _, m := range storeDefRE.FindAllStringSubmatch(content, -1) {
		d.stores[m[1]] = true
	}
	for _, m := range functionDefRE.FindAllStringSubmatch(content, -1) {
		d.functions[m[1]+m[2]] = true
	}
	if strings.HasSuffix(lower, ".html") {
		for _, m := range idAttrRE.FindAllStringSubmatch(content, -1) {
			d.ids[m[1]] = true
		}
	}
	return d
}

func missingFrom(before, after map[string]bool) []string {
	var out []string
	for name := range before {
		if !after[name] {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out
}

// textFiles: isi terbaru semua file .html/.js project di luar functions/ (disk + perubahan job ini).
func (ws *workspace) textFiles() map[string]string {
	out := map[string]string{}
	add := func(p string) {
		lower := strings.ToLower(p)
		if _, done := out[p]; done || isFunctionFile(p) || !(strings.HasSuffix(lower, ".html") || strings.HasSuffix(lower, ".js")) {
			return
		}
		if content, ok := ws.read(p); ok {
			out[p] = content
		}
	}
	for p := range ws.disk {
		add(p)
	}
	for _, k := range ws.st.order {
		add(k)
	}
	return out
}

// usedIn: file (urut nama) yang isinya cocok dengan re.
func usedIn(all map[string]string, re *regexp.Regexp) []string {
	var out []string
	for p, content := range all {
		if re.MatchString(content) {
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out
}

// definedAnywhere: nama fungsi yang masih didefinisikan di salah satu file — juga sebagai method komponen
// ("hapus() {"), yang ikut terjangkau dari ekspresi Alpine di dalam komponen itu.
func definedAnywhere(all map[string]string, name string) bool {
	q := regexp.QuoteMeta(name)
	method := regexp.MustCompile(`(?m)(?:^|[\s,{])(?:async\s+)?` + q + `\s*\([^()]*\)\s*\{|(?:^|[\s,{])` + q + `\s*:\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*=>)`)
	for p, content := range all {
		if definitionsIn(p, content).functions[name] || method.MatchString(content) {
			return true
		}
	}
	return false
}

func fileList(paths []string) string {
	if len(paths) > 3 {
		return strings.Join(paths[:3], ", ") + fmt.Sprintf(" (+%d file lain)", len(paths)-3)
	}
	return strings.Join(paths, ", ")
}

// lostDefinitions: komponen/store Alpine, fungsi global, dan id elemen yang ada di file sebelum job ini, dihapus
// atau hilang saat file itu ditulis ulang, tapi masih dipakai di project. Per path file yang kehilangan definisi.
func (ws *workspace) lostDefinitions() map[string][]problem {
	out := map[string][]problem{}
	var all map[string]string // dibaca sekali, hanya bila ada definisi yang hilang
	for _, c := range ws.st.list() {
		if c.Action == "table" || !ws.disk[c.Path] || isFunctionFile(c.Path) || !files.IsTextFile(c.Path) {
			continue
		}
		original, err := files.ReadText(ws.root, c.Path)
		if err != nil {
			continue
		}
		before := definitionsIn(c.Path, original)
		after := definitionsIn(c.Path, c.Content) // kosong bila file dihapus
		if c.Action == "delete" {
			after = definitionsIn("", "")
		}
		lostComponents := missingFrom(before.components, after.components)
		lostStores := missingFrom(before.stores, after.stores)
		lostFunctions := missingFrom(before.functions, after.functions)
		lostIDs := missingFrom(before.ids, after.ids)
		if len(lostComponents)+len(lostStores)+len(lostFunctions)+len(lostIDs) == 0 {
			continue
		}
		if all == nil {
			all = ws.textFiles()
		}
		where := "dihapus dari " + c.Path
		if c.Action == "delete" {
			where = "ada di " + c.Path + " yang kamu hapus"
		}
		add := func(text string) {
			out[c.Path] = append(out[c.Path], problem{"loss", text})
		}
		for _, name := range lostComponents {
			q := regexp.QuoteMeta(name)
			if len(usedIn(all, regexp.MustCompile(`Alpine\.data\(\s*['"`+"`"+`]`+q+`['"`+"`"+`]`))) > 0 {
				continue // dipindah ke file lain
			}
			if users := usedIn(all, regexp.MustCompile(`(?i)\sx-data\s*=\s*["']\s*`+q+`\s*(?:\(|["'])`)); len(users) > 0 {
				add(fmt.Sprintf(`komponen Alpine.data('%s') %s, tapi x-data="%s" masih dipakai di %s — kembalikan komponennya atau perbarui halaman itu`, name, where, name, fileList(users)))
			}
		}
		for _, name := range lostStores {
			q := regexp.QuoteMeta(name)
			if len(usedIn(all, regexp.MustCompile(`Alpine\.store\(\s*['"`+"`"+`]`+q+`['"`+"`"+`]\s*,`))) > 0 {
				continue
			}
			if users := usedIn(all, regexp.MustCompile(`\$store\.`+q+`\b|Alpine\.store\(\s*['"`+"`"+`]`+q+`['"`+"`"+`]\s*\)`)); len(users) > 0 {
				add(fmt.Sprintf(`Alpine.store('%s') %s, tapi $store.%s masih dipakai di %s`, name, where, name, fileList(users)))
			}
		}
		for _, name := range lostFunctions {
			if definedAnywhere(all, name) {
				continue
			}
			// Panggilan name( yang bukan method obj.name( dan bukan deklarasi function name(.
			call := regexp.MustCompile(`(?:^|[^\w$.])` + regexp.QuoteMeta(name) + `\s*\(`)
			decl := regexp.MustCompile(`function\s*\*?\s*` + regexp.QuoteMeta(name) + `\s*\(`)
			var users []string
			for p, content := range all {
				if call.MatchString(decl.ReplaceAllString(content, "")) {
					users = append(users, p)
				}
			}
			sort.Strings(users)
			if len(users) > 0 {
				add(fmt.Sprintf(`fungsi %s() %s, tapi masih dipanggil di %s — kembalikan fungsinya atau perbarui pemanggilnya`, name, where, fileList(users)))
			}
		}
		if len(lostIDs) > 0 {
			ids := map[string]bool{}
			for p, content := range all {
				for id := range definitionsIn(p, content).ids {
					ids[id] = true
				}
			}
			for _, id := range lostIDs {
				if ids[id] {
					continue
				}
				q := regexp.QuoteMeta(id)
				lookup := regexp.MustCompile(`getElementById\(\s*['"` + "`" + `]` + q + `['"` + "`" + `]\s*\)|querySelector(?:All)?\(\s*['"` + "`" + `]#` + q + `(?:[^\w-]|$)`)
				if users := usedIn(all, lookup); len(users) > 0 {
					add(fmt.Sprintf(`elemen id="%s" %s, tapi masih dicari JavaScript di %s (getElementById/querySelector) — hasilnya null dan kodenya error`, id, where, fileList(users)))
				}
			}
		}
	}
	return out
}

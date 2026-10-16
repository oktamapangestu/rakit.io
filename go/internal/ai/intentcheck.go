package ai

// Pemeriksaan "hasil sesuai maksud" yang terbukti sering dilewatkan model walau aturannya tertulis di prompt
// (evaluasi scripts/ai-eval, 2026-10): form isian pengunjung yang datanya tidak disimpan/dikirim ke mana pun, dan
// permintaan chatbot pengunjung yang dibuat sendiri alih-alih memakai widget asisten bawaan. Keduanya dilaporkan di
// pemeriksaan akhir (finalProblems) supaya model memperbaikinya sebelum selesai.

import (
	"fmt"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

// Tujuan data form yang sah: database & fungsi rakit, API chat asisten, atau layanan kirim yang jelas.
var formSinkRE = regexp.MustCompile(`/api/(db|fn)/|/api/ai/chat|mailto:|wa\.me/|api\.whatsapp\.com|formspree\.io|getform\.io|web3forms\.com|formsubmit\.co|script\.google\.com`)

// visitorForm: ringkasan satu <form> yang mengumpulkan data pengunjung (bukan pencarian/filter).
type visitorForm struct {
	fields []string // nama/label field, untuk pesan
}

// visitorForms: form di halaman yang isinya data pengunjung — punya textarea, input email/tel, atau ≥ 2 isian teks —
// dan tidak dikirim ke alamat lain lewat atribut action. Form pencarian/filter (role="search", hanya input search,
// method GET) dilewati.
func visitorForms(content string) []visitorForm {
	doc, err := html.Parse(strings.NewReader(content))
	if err != nil {
		return nil
	}
	var out []visitorForm
	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "form" {
			if f, ok := inspectForm(n); ok {
				out = append(out, f)
			}
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return out
}

func inspectForm(form *html.Node) (visitorForm, bool) {
	if role, _ := attr(form, "role"); role == "search" {
		return visitorForm{}, false
	}
	if method, _ := attr(form, "method"); strings.EqualFold(strings.TrimSpace(method), "get") {
		return visitorForm{}, false
	}
	if action, ok := attr(form, "action"); ok {
		if a := strings.TrimSpace(action); a != "" && a != "#" {
			return visitorForm{}, false // dikirim ke halaman/layanan lain
		}
	}
	var f visitorForm
	strong, texts := false, 0
	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			name := firstAttr(n, "name", "x-model", "id", "placeholder")
			switch n.Data {
			case "textarea":
				strong = true
				f.fields = append(f.fields, name)
			case "select":
				f.fields = append(f.fields, name)
			case "input":
				kind, _ := attr(n, "type")
				switch strings.ToLower(strings.TrimSpace(kind)) {
				case "email", "tel":
					strong = true
					f.fields = append(f.fields, name)
				case "", "text", "number", "date", "datetime-local", "time", "url":
					texts++
					f.fields = append(f.fields, name)
				case "search":
					// pencarian — bukan data pengunjung
				default: // hidden, checkbox, radio, range, submit, button, file …
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(form)
	return f, strong || texts >= 2
}

func firstAttr(n *html.Node, keys ...string) string {
	for _, k := range keys {
		if v, ok := attr(n, k); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return n.Data
}

// scriptCode: kode JavaScript halaman — skrip inline dan file .js lokal yang dimuat. Tujuan pengiriman form dicari
// di sini saja: tautan mailto:/wa.me biasa di markup (tombol kontak) bukan tempat data form dikirim.
func (ws *workspace) scriptCode(page, content string) string {
	var b strings.Builder
	for _, s := range parsePage(content).scripts {
		b.WriteString(s.code + "\n")
		if rel := localTarget(page, s.src); s.src != "" && rel != "" {
			if js, ok := ws.read(rel); ok {
				b.WriteString(js + "\n")
			}
		}
	}
	return b.String()
}

// unsavedForms: form data pengunjung di halaman yang kode JavaScript-nya tidak menyimpan/mengirim ke mana pun.
// Hanya yang baru dibanding isi sebelumnya — form lama milik pengguna yang memang begitu tidak diungkit.
func (ws *workspace) unsavedForms(page, content, original string) []problem {
	forms := visitorForms(content)
	if len(forms) == 0 || formSinkRE.MatchString(ws.scriptCode(page, content)) {
		return nil
	}
	if original != "" && len(visitorForms(original)) >= len(forms) && !formSinkRE.MatchString(ws.scriptCode(page, original)) {
		return nil
	}
	var out []problem
	for _, f := range forms {
		fields := strings.Join(f.fields, ", ")
		if len(f.fields) > 6 {
			fields = strings.Join(f.fields[:6], ", ") + ", …"
		}
		out = append(out, problem{"form", fmt.Sprintf(`form (isian: %s) tidak menyimpan atau mengirim datanya — saat ini isian pengunjung hilang begitu dikirim. `+
			`Simpan ke database: buat tabelnya dengan create_table (public "create"), POST ke /api/db/<tabel> saat submit, `+
			`lalu tampilkan pesan berhasil/gagal (atau kirim lewat fungsi /api/fn/<nama> bila perlu rahasia/notifikasi)`, fields)})
	}
	return out
}

// Permintaan chatbot untuk pengunjung — dan permintaan yang memang ingin memakai provider/API key sendiri.
var (
	chatbotAskRE = regexp.MustCompile(`(?i)chat\s*bot|\bbot\s+(ai|cs|customer)|asisten\s+(ai|virtual|chat)|ai\s+assistant|virtual\s+assistant|customer\s+service\s+(bot|ai|otomatis)|\bcs\s+(bot|ai|otomatis)|live\s*chat\s+ai|chat\s+(ai|dengan\s+ai)`)
	ownChatRE    = regexp.MustCompile(`\bai\.(chat|json)\(|api\.openai\.com|generativelanguage|api\.anthropic\.com`)
	chatFnCallRE = regexp.MustCompile(`/api/fn/[A-Za-z0-9_-]*(chat|bot|tanya|asisten|cs)`)
	ownAIKeyRE   = regexp.MustCompile(`(?i)api\s*key|kunci\s+api|provider|openai|\bgpt|gemini|claude|anthropic|deepseek|groq|openrouter|ai\.chat|model\s+(sendiri|saya)`)
)

// chatbotProblems: permintaan chatbot pengunjung, tapi hasilnya tidak memakai widget asisten bawaan
// (/api/ai/widget.js) maupun API chat-nya (/api/ai/chat). Kalau pengguna menyebut provider/API key sendiri, chatbot
// lewat fungsi + ai.* memang yang diminta, jadi tidak dilaporkan.
func (ws *workspace) chatbotProblems() (string, []problem) {
	if !chatbotAskRE.MatchString(ws.request) || ownAIKeyRE.MatchString(ws.request) {
		return "", nil
	}
	page, widget := "", false
	for path, content := range ws.textFiles() {
		lower := strings.ToLower(path)
		if strings.Contains(content, "/api/ai/widget.js") || strings.Contains(content, "/api/ai/chat") {
			widget = true
		}
		if strings.HasSuffix(lower, ".html") && (page == "" || path == "index.html") {
			page = path
		}
	}
	if page == "" {
		page = "index.html"
	}
	if widget {
		// Widget sudah dipasang, tapi chat buatan sendiri dari jawaban ini masih tertinggal.
		var extra []string
		for _, c := range ws.st.list() {
			if c.Action != "write" {
				continue
			}
			if (isFunctionFile(c.Path) && ownChatRE.MatchString(c.Content)) || (!isFunctionFile(c.Path) && chatFnCallRE.MatchString(c.Content)) {
				extra = append(extra, c.Path)
			}
		}
		if len(extra) == 0 {
			return "", nil
		}
		return extra[0], []problem{{"chatbot", fmt.Sprintf(`widget asisten sudah dipasang, jadi chat buatan sendiri tidak diperlukan dan membingungkan pengunjung — `+
			`hapus fungsi chat dengan delete_file dan buang UI/kode chat buatan sendiri dari: %s`, strings.Join(extra, ", "))}}
	}
	return page, []problem{{"chatbot", `permintaan chatbot untuk pengunjung: pakai widget asisten bawaan — tambahkan ` +
		`<script src="/api/ai/widget.js" defer></script> tepat sebelum </body> di halaman yang perlu. Jangan membuat chat ` +
		`sendiri: hapus UI chat, CSS/JS chat, dan fungsi chat buatan sendiri bila sudah dibuat. Tidak perlu API key; di ` +
		`ringkasan, minta pemilik mengaktifkan asisten di menu avatar → "Asisten AI website"`}}
}

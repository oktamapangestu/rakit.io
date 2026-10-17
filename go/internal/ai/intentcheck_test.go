package ai

import (
	"strings"
	"testing"
)

func TestUnsavedForms(t *testing.T) {
	form := `<form @submit.prevent="kirim"><input x-model="nama"><input type="email" x-model="email"><textarea x-model="pesan"></textarea><button>Kirim</button></form>`
	page := `<!doctype html><html><head><script defer src="/app.js"></script></head><body>` + form + `</body></html>`

	ws := testWorkspace(t, map[string]string{"app.js": "Alpine.data('f', () => ({ kirim() { this.ok = true } }))"})
	got := ws.unsavedForms("index.html", page, "")
	if len(got) != 1 || got[0].kind != "form" || !strings.Contains(got[0].text, "nama, email, pesan") {
		t.Fatalf("form tanpa penyimpanan: %v", got)
	}

	// Disimpan lewat /api/db di file JS yang dimuat halaman → tidak dilaporkan.
	ws = testWorkspace(t, map[string]string{"app.js": "fetch('/api/db/pesan', { method: 'POST' })"})
	if got := ws.unsavedForms("index.html", page, ""); len(got) != 0 {
		t.Errorf("form yang menyimpan ke /api/db: %v", got)
	}
	// Dikirim lewat fungsi atau WhatsApp → tidak dilaporkan.
	for _, sink := range []string{"fetch('/api/fn/kontak')", "location.href = 'https://wa.me/62812?text=' + t"} {
		ws = testWorkspace(t, map[string]string{"app.js": sink})
		if got := ws.unsavedForms("index.html", page, ""); len(got) != 0 {
			t.Errorf("%s: %v", sink, got)
		}
	}

	ws = testWorkspace(t, nil)
	for name, html := range map[string]string{
		"pencarian":       `<form role="search"><input type="search" name="q"></form>`,
		"method get":      `<form method="get"><input name="q"><input name="kota"></form>`,
		"action ke luar":  `<form action="https://formspree.io/f/x"><input name="a"><textarea name="b"></textarea></form>`,
		"satu isian teks": `<form><input name="kode"></form>`,
		"filter checkbox": `<form><input type="checkbox" name="a"><input type="range" name="b"></form>`,
		"form lama sama":  "",
	} {
		original := ""
		if name == "form lama sama" {
			html, original = form, form // form pengguna yang memang belum menyimpan: tidak diungkit
		}
		if got := ws.unsavedForms("index.html", "<body>"+html+"</body>", original); len(got) != 0 {
			t.Errorf("%s: %v", name, got)
		}
	}
}

func TestChatbotProblems(t *testing.T) {
	ws := testWorkspace(t, map[string]string{"index.html": "<body><h1>Toko</h1></body>"})
	ws.request = "Tambahkan chatbot AI untuk menjawab pertanyaan pengunjung."
	ws.st.set(change{Action: "write", Path: "functions/chat.js", Content: "export default async (req, { ai }) => ai.chat(req.body.q)"})
	page, got := ws.chatbotProblems()
	if page != "index.html" || len(got) != 1 || got[0].kind != "chatbot" || !strings.Contains(got[0].text, "/api/ai/widget.js") {
		t.Fatalf("chatbot buatan sendiri: %q %v", page, got)
	}
	// Widget dipasang, tapi fungsi chat buatan sendiri masih ada → diminta dihapus.
	ws.st.set(change{Action: "write", Path: "index.html", Content: `<body><h1>Toko</h1><script src="/api/ai/widget.js" defer></script></body>`})
	if page, got := ws.chatbotProblems(); page != "functions/chat.js" || len(got) != 1 || !strings.Contains(got[0].text, "hapus fungsi chat") {
		t.Errorf("widget + chat sendiri: %q %v", page, got)
	}
	// Chat sendiri dihapus → beres.
	ws.st.set(change{Action: "delete", Path: "functions/chat.js"})
	if _, got := ws.chatbotProblems(); len(got) != 0 {
		t.Errorf("widget saja: %v", got)
	}
	// Provider/API key sendiri diminta → fungsi + ai.* memang benar.
	ws = testWorkspace(t, map[string]string{"index.html": "<body></body>"})
	ws.request = "Buat chatbot CS pakai API key OpenAI saya sendiri"
	if _, got := ws.chatbotProblems(); len(got) != 0 {
		t.Errorf("chatbot dengan key sendiri: %v", got)
	}
	// Bukan permintaan chatbot.
	ws.request = "Tambahkan form kontak"
	if _, got := ws.chatbotProblems(); len(got) != 0 {
		t.Errorf("bukan chatbot: %v", got)
	}
}

func TestEffectiveChanges(t *testing.T) {
	ws := testWorkspace(t, map[string]string{"index.html": "<h1>Asli</h1>", "app.js": "const a = 1;\n"})
	ws.st.set(change{Action: "write", Path: "index.html", Content: "<h1>Asli</h1>"}) // ditulis ulang tanpa perubahan
	ws.st.set(change{Action: "write", Path: "app.js", Content: "const a = 2;\n"})
	ws.st.set(change{Action: "write", Path: "functions/chat.js", Content: "x"})
	ws.st.set(change{Action: "delete", Path: "functions/chat.js"}) // dibuat lalu dihapus lagi
	got := ws.effectiveChanges()
	if len(got) != 1 || got[0].Path != "app.js" {
		t.Errorf("effectiveChanges = %+v", got)
	}
}

func TestUnknownAPIProblems(t *testing.T) {
	code := `fetch('/api/functions/admin-login'); fetch("/api/upload", {}); fetch('/api/db/produk'); fetch('/api/fn/kontak');
		fetch('/api/ai/chat'); fetch('https://contoh.com/api/v1/x'); fetch('/api/produk'); fetch('/functions/admin-masuk', {})`
	got := unknownAPIProblems(code, map[string]bool{"produk": true})
	if len(got) != 3 || !strings.Contains(got[0].text, `/api/fn/admin-masuk`) || !strings.Contains(got[1].text, `"/api/functions/admin-login"`) || !strings.Contains(got[2].text, `"/api/upload"`) {
		t.Errorf("unknownAPIProblems = %v", got)
	}
}

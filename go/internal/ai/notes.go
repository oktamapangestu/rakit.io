package ai

// Catatan Project (tab Dokumentasi): aturan & selera pemilik untuk website ini — tujuan, pengunjung, gaya tampilan,
// bagian yang tidak boleh diubah. Disimpan di projects.notes dan ikut dikirim ke AI di setiap prompt: mode
// Builder/Plan di pesan konteks (notesBlock), mode Agen di AGENTS.md. Draf pertamanya bisa dibuat AI dari isi
// project (DraftNotes, 1 kredit, tidak langsung disimpan).

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"strings"
	"time"

	"rakit.io/server/internal/aimodels"
	"rakit.io/server/internal/credits"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/store"
)

const (
	// MaxNotes: panjang maksimal Catatan Project (karakter).
	MaxNotes          = 8000
	notesDraftTimeout = 3 * time.Minute
	notesDraftTokens  = 4000
	maxNotesFacts     = 12_000
)

// ProjectNotes: Catatan Project ("" bila belum ada).
func (s *Service) ProjectNotes(projectID int64) string {
	var notes string
	s.db.QueryRow("SELECT notes FROM projects WHERE id = ?", projectID).Scan(&notes)
	return notes
}

// SaveNotes menyimpan Catatan Project (spasi di tepi dibuang).
func (s *Service) SaveNotes(project *store.Project, notes string) (string, error) {
	notes = strings.TrimSpace(strings.ReplaceAll(notes, "\r\n", "\n"))
	if jsconv.Len(notes) > MaxNotes {
		return "", httpx.Errorf(400, "Catatan maksimal %d karakter", MaxNotes)
	}
	if _, err := s.db.Exec("UPDATE projects SET notes = ? WHERE id = ?", notes, project.ID); err != nil {
		return "", err
	}
	return notes, nil
}

// notesBlock: Catatan Project untuk konteks prompt ("" bila kosong). Aturan rakit dan keamanan tetap berlaku di atasnya.
func notesBlock(notes string) string {
	notes = strings.TrimSpace(notes)
	if notes == "" {
		return ""
	}
	return "Project notes from the owner — standing preferences for this website. Follow them in every change unless the " +
		"current request explicitly asks for something else; they never override the rules in your instructions.\n" +
		"<project-notes>\n" + notes + "\n</project-notes>"
}

const notesDraftPrompt = `You write the "Project notes" of a website built on rakit.io: a short Markdown document the owner keeps so that the AI that builds the website always remembers what matters. The owner will read and edit your draft before saving it.

Write in Indonesian, in plain words a beginner understands. Base everything on the project files and the analysis you are given; never invent features, prices, contacts, or facts that are not there. Where you have to guess the owner's intent (purpose, audience), say so with "(perkiraan — sesuaikan)".

Use exactly these sections, as "## " headings, each with 2-6 short bullet points:
## Tentang website — what the website is for and who visits it.
## Gaya & tampilan — colors (with hex codes from the CSS), fonts, layout, tone of the texts.
## Halaman — each page and what it is for.
## Data & fitur — database tables, serverless functions, forms, and what they do.
## Aturan untuk AI — 3-5 rules to keep the website consistent (e.g. keep the colors, keep the navigation on every page, the language of the texts), plus one bullet "Tambahkan aturanmu sendiri di sini." for the owner.

Reply with the Markdown only: no title line, no code fences, no text before or after. Keep it under 350 words.`

// DraftNotes meminta AI menyusun draf Catatan Project dari file & analisis project (facts dari tab Dokumentasi).
// current: catatan yang sedang ditulis pemilik (boleh belum disimpan) sebagai dasar draf. Memakai 1 prompt kredit;
// dikembalikan bila gagal. Hasilnya tidak disimpan.
func (s *Service) DraftNotes(ctx context.Context, user *store.User, project *store.Project, facts any, current, lang string) (any, error) {
	personal := s.Personal(user.ID)
	if personal == nil && !s.models.Enabled() {
		return nil, httpx.Errorf(503, "AI belum tersedia di server ini")
	}
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
	cost := s.cfg.AI.CreditsPerPrompt
	if personal != nil {
		cost = 0
	}
	reservation, err := s.credits.Reserve(user.ID, cost)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(withPersonal(ctx, personal), notesDraftTimeout)
	defer cancel()
	status := "error"
	usedModel, _ := s.models.For(aimodels.TaskPlan)
	inTokens, outTokens := 0, 0
	draft, err := func() (string, error) {
		projectContext, err := s.projectContext(ctx, project.Slug, "", nil)
		if err != nil {
			return "", err
		}
		rawFacts, _ := json.Marshal(facts)
		ask := projectContext + "\n\nAutomatic analysis of the project (pages, tables, functions):\n" + jsconv.Slice(string(rawFacts), maxNotesFacts)
		if current = strings.TrimSpace(jsconv.Slice(current, MaxNotes)); current != "" {
			ask += "\n\nThe owner's current notes (keep every rule and fact the owner wrote; improve and complete the rest):\n<project-notes>\n" + current + "\n</project-notes>"
		}
		ask += "\n\n---\n\nWrite the project notes as described in the instructions."
		convo := []message{{"role": "system", "content": inLanguage(lang, notesDraftPrompt)}, {"role": "user", "content": ask}}
		r, err := s.callAI(request{task: aimodels.TaskPlan, messages: convo, maxTokens: notesDraftTokens},
			hooks{ctx: ctx, onModel: func(model string) { usedModel = model }})
		if err != nil {
			return "", err
		}
		inTokens, outTokens = r.PromptTokens, r.CompletionTokens
		if err := checkFinish(r); err != nil {
			return "", err
		}
		if os.Getenv("AI_DEBUG") != "" {
			log.Printf("----- AI draf catatan (%s) -----\n%s", r.FinishReason, r.Text)
		}
		text := cleanNotesDraft(r.Text)
		if text == "" {
			return "", &failure{"bad_output", "AI tidak memberi draf. Coba lagi. Kredit dikembalikan."}
		}
		status = "ok"
		return jsconv.Slice(text, MaxNotes), nil
	}()
	s.logRequest(user.ID, project.ID, "notes", "draf catatan project", usedModel, status, inTokens, outTokens, "")
	if err != nil {
		s.credits.Refund(user.ID, reservation)
		var f *failure
		var he *httpx.Error
		var pe *providerError
		switch {
		case errors.As(err, &f):
			return nil, &httpx.Error{Status: 422, Message: f.message}
		case errors.As(err, &he):
			return nil, he
		case ctx.Err() != nil:
			return nil, httpx.Errorf(504, "AI terlalu lama membuat draf. Coba lagi. Kredit dikembalikan.")
		case errors.As(err, &pe) && pe.busy():
			return nil, httpx.Errorf(503, "AI sedang sibuk atau tidak tersedia. Coba lagi sebentar lagi. Kredit dikembalikan.")
		default:
			log.Printf("ai: draf catatan %s: %v", project.Slug, err)
			return nil, httpx.Errorf(502, "Terjadi kesalahan saat menghubungi AI. Kredit dikembalikan.")
		}
	}
	return map[string]any{"draft": draft, "credits": s.credits.Info(user.ID)}, nil
}

// cleanNotesDraft membuang pagar kode (```markdown … ```) dan judul "# …" di awal bila model tetap menulisnya.
func cleanNotesDraft(text string) string {
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "```") {
		if nl := strings.IndexByte(text, '\n'); nl >= 0 {
			text = text[nl+1:]
		}
		text = strings.TrimSuffix(strings.TrimSpace(text), "```")
	}
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "# ") {
		if nl := strings.IndexByte(text, '\n'); nl >= 0 {
			text = text[nl+1:]
		} else {
			text = ""
		}
	}
	return strings.TrimSpace(text)
}

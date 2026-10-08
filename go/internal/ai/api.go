package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"rakit.io/server/internal/blocks"
	"rakit.io/server/internal/files"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/store"
)

// ---------- Percakapan ----------

type thread struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

func (s *Service) thread(id, userID, projectID int64) (*thread, error) {
	t := &thread{}
	err := s.db.QueryRow("SELECT id, title, created_at, updated_at FROM ai_threads WHERE id = ? AND user_id = ? AND project_id = ?", id, userID, projectID).
		Scan(&t.ID, &t.Title, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return t, err
}

type activeJob struct {
	ID          int64  `json:"id"`
	ThreadID    int64  `json:"threadId"`
	ProjectSlug string `json:"projectSlug"`
}

// activeJob: kredit & jatah 1 prompt berjalan berlaku per akun, jadi job aktif dicari di semua project.
func (s *Service) activeJob(userID int64) (*activeJob, error) {
	a := &activeJob{}
	err := s.db.QueryRow(`
		SELECT m.id, m.thread_id, p.slug FROM ai_messages m
		JOIN ai_threads t ON t.id = m.thread_id JOIN projects p ON p.id = t.project_id
		WHERE m.user_id = ? AND m.role = 'assistant' AND m.status IN ('queued', 'running') ORDER BY m.id DESC LIMIT 1`, userID).
		Scan(&a.ID, &a.ThreadID, &a.ProjectSlug)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return a, err
}

func (s *Service) busy(userID int64) (bool, error) {
	s.mu.Lock()
	running := s.running[userID]
	s.mu.Unlock()
	if running {
		return true, nil
	}
	active, err := s.activeJob(userID)
	return active != nil, err
}

// Threads: daftar percakapan di project aktif + job yang sedang berjalan.
func (s *Service) Threads(user *store.User, project *store.Project) (any, error) {
	rows, err := s.db.Query("SELECT id, title, created_at, updated_at FROM ai_threads WHERE user_id = ? AND project_id = ? ORDER BY updated_at DESC LIMIT ?", user.ID, project.ID, maxThreadsPerUser)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	threads := []thread{}
	for rows.Next() {
		var t thread
		if err := rows.Scan(&t.ID, &t.Title, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		threads = append(threads, t)
	}
	active, err := s.activeJob(user.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"threads": threads, "activeJob": active}, rows.Err()
}

// id: meniru Number(teks) untuk parameter URL; 0 bila bukan bilangan bulat positif.
func id(text string) int64 {
	n := jsconv.Number(text)
	if !jsconv.IsInteger(n) || n < 1 || n > jsconv.MaxSafeInteger || strings.TrimSpace(text) == "" {
		return 0
	}
	return int64(n)
}

// Thread: satu percakapan beserta pesan-pesan terakhirnya.
func (s *Service) Thread(user *store.User, project *store.Project, rawID string) (any, error) {
	t, err := s.thread(id(rawID), user.ID, project.ID)
	if err != nil {
		return nil, err
	}
	if t == nil {
		return nil, httpx.Errorf(404, "Percakapan tidak ditemukan")
	}
	rows, err := s.db.Query("SELECT "+messageColumns+" FROM ai_messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?", t.ID, threadPage)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		list = append([]map[string]any{publicMessage(m)}, list...)
	}
	if list == nil {
		list = []map[string]any{}
	}
	return map[string]any{"thread": t, "messages": list}, rows.Err()
}

// DeleteThreads menghapus seluruh riwayat percakapan di project aktif.
func (s *Service) DeleteThreads(user *store.User, project *store.Project) (any, error) {
	if busy, err := s.busy(user.ID); err != nil {
		return nil, err
	} else if busy {
		return nil, httpx.Errorf(409, "Tunggu AI selesai (atau tekan Stop) sebelum menghapus riwayat.")
	}
	res, err := s.db.Exec("DELETE FROM ai_threads WHERE user_id = ? AND project_id = ?", user.ID, project.ID)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	return map[string]int64{"deleted": n}, nil
}

var spacesRE = regexp.MustCompile(`\s+`)

// Prompt menerima satu prompt: memotong kredit, menyimpan pesan, lalu menjalankan job di latar.
func (s *Service) Prompt(user *store.User, project *store.Project, body map[string]any) (any, error) {
	if !s.models.Enabled() {
		return nil, httpx.Errorf(503, "Fitur AI belum dikonfigurasi di server")
	}
	prompt := strings.TrimSpace(jsconv.String(body["prompt"]))
	mode := "build"
	if body["mode"] == "plan" {
		mode = "plan"
	}
	if prompt == "" {
		return nil, httpx.Errorf(400, "Prompt tidak boleh kosong")
	}
	if jsconv.Len(prompt) > maxPromptChars {
		return nil, httpx.Errorf(400, "Prompt maksimal %d karakter", maxPromptChars)
	}
	if busy, err := s.busy(user.ID); err != nil {
		return nil, err
	} else if busy {
		return nil, httpx.Errorf(429, "Masih ada prompt yang sedang diproses")
	}

	// Path tidak valid diabaikan.
	activePath := ""
	if raw, _ := body["activePath"].(string); raw != "" {
		activePath, _ = files.CleanPath(raw)
	}
	var threadID int64
	if n, isNumber := body["threadId"].(float64); isNumber {
		threadID = int64(n)
	} else if text, isText := body["threadId"].(string); isText {
		threadID = id(text)
	}
	if threadID != 0 {
		if t, err := s.thread(threadID, user.ID, project.ID); err != nil {
			return nil, err
		} else if t == nil {
			threadID = 0
		}
	}

	// Blok halaman yang dipilih di preview: AI diarahkan hanya mengubah bagian itu.
	picked, err := blocks.Parse(body["blocks"], func(pathname string) string {
		if s.ResolvePage == nil {
			return ""
		}
		return s.ResolvePage(project.Slug, pathname)
	})
	if err != nil {
		return nil, err
	}

	// Lampiran gambar (maks. 3): gambar ukuran kerja untuk AI + thumbnail kecil untuk riwayat chat.
	rawImages, hasImages := body["images"]
	images, err := s.parseImages(rawImages, hasImages, imageMaxBytes)
	if err != nil {
		return nil, err
	}
	if len(images) > 0 && s.models.Get().Vision == "" {
		return nil, httpx.Errorf(400, "Lampiran gambar belum tersedia di server ini")
	}
	thumbs := []string{}
	if len(images) > 0 {
		rawThumbs, hasThumbs := body["thumbs"]
		if thumbs, err = s.parseImages(rawThumbs, hasThumbs, thumbMaxBytes); err != nil {
			return nil, err
		}
		if thumbs == nil {
			thumbs = []string{}
		}
		if len(thumbs) > len(images) {
			thumbs = thumbs[:len(images)]
		}
	}

	cost := s.cfg.AI.CreditsPerPrompt
	if len(images) > 0 {
		cost = s.cfg.AI.ImagePromptCredits
	}
	// Jatah 1 prompt berjalan per akun dikunci dulu, baru kredit dipotong.
	s.mu.Lock()
	if s.running[user.ID] {
		s.mu.Unlock()
		return nil, httpx.Errorf(429, "Masih ada prompt yang sedang diproses")
	}
	s.running[user.ID] = true
	s.mu.Unlock()
	started := false
	defer func() {
		if !started {
			s.mu.Lock()
			delete(s.running, user.ID)
			s.mu.Unlock()
		}
	}()
	reservation, err := s.credits.Reserve(user.ID, cost)
	if err != nil {
		return nil, err
	}
	fail := func(err error) (any, error) {
		s.credits.Refund(user.ID, reservation)
		return nil, err
	}

	now := time.Now().UnixMilli()
	// Prompt baru = perubahan sebelumnya yang belum dikonfirmasi dianggap disimpan.
	s.db.Exec("UPDATE ai_messages SET apply_state = 'kept' WHERE user_id = ? AND apply_state = 'pending'", user.ID)
	if threadID == 0 {
		title := jsconv.Slice(spacesRE.ReplaceAllString(prompt, " "), 80)
		res, err := s.db.Exec("INSERT INTO ai_threads (user_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", user.ID, project.ID, title, now, now)
		if err != nil {
			return fail(err)
		}
		threadID, _ = res.LastInsertId()
		s.db.Exec(`
			DELETE FROM ai_threads WHERE project_id = ? AND id NOT IN (
				SELECT id FROM ai_threads WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?)`, project.ID, project.ID, maxThreadsPerUser)
	} else {
		s.db.Exec("UPDATE ai_threads SET updated_at = ? WHERE id = ?", now, threadID)
	}
	userMessageID, err := s.insertMessage(threadID, user.ID, "user", mode, prompt, "sent", nil)
	if err != nil {
		return fail(err)
	}
	if len(images) > 0 || len(picked) > 0 {
		raw, _ := marshal(attachments{Thumbs: thumbs, Blocks: blockRefs(picked)})
		s.db.Exec("UPDATE ai_messages SET attachments = ? WHERE id = ?", string(raw), userMessageID)
	}
	credit, _ := json.Marshal(reservation)
	messageID, err := s.insertMessage(threadID, user.ID, "assistant", mode, "", "queued", string(credit))
	if err != nil {
		return fail(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	j := &job{userID: user.ID, ctx: ctx, cancel: cancel, listeners: map[*listener]bool{}}
	s.mu.Lock()
	s.jobs[messageID] = j
	s.mu.Unlock()
	started = true
	go s.runJob(j, jobInput{
		user: user, project: project, messageID: messageID, userMessageID: userMessageID, threadID: threadID,
		prompt: prompt, mode: mode, activePath: activePath, reservation: reservation, images: images, thumbs: thumbs,
		blocks: picked,
	})

	userMessage, err := s.message(userMessageID, user.ID)
	if err != nil {
		return nil, err
	}
	assistantMessage, err := s.message(messageID, user.ID)
	if err != nil {
		return nil, err
	}
	// Status saat diterima selalu "queued", walau job di latar sudah sempat mulai.
	view := publicMessage(assistantMessage)
	view["status"] = "queued"
	return map[string]any{
		"threadId":         threadID,
		"userMessage":      publicMessage(userMessage),
		"assistantMessage": view,
		"credits":          s.credits.Info(user.ID),
	}, nil
}

// Events mengikuti progres job (NDJSON). Bisa disambung ulang kapan saja; event yang sudah lewat
// dikirim ulang.
func (s *Service) Events(w http.ResponseWriter, r *http.Request, user *store.User, rawID string) error {
	messageID := id(rawID)
	row, err := s.message(messageID, user.ID)
	if err != nil {
		return err
	}
	if row == nil || row.Role != "assistant" {
		return httpx.Errorf(404, "Job tidak ditemukan")
	}
	h := w.Header()
	h.Set("Content-Type", "application/x-ndjson; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	write := func(ev event) {
		raw, _ := marshal(ev)
		w.Write(append(raw, '\n'))
		if flusher != nil {
			flusher.Flush()
		}
	}

	s.mu.Lock()
	j := s.jobs[messageID]
	s.mu.Unlock()
	if j == nil {
		// Sudah lama selesai (atau server sempat restart): kirim keadaan akhir dari database.
		msg := publicMessage(row)
		if row.Status == "done" {
			write(event{"type": "done", "message": msg, "touched": []string{}, "credits": s.credits.Info(user.ID)})
		} else {
			text := "Job tidak berjalan lagi. Silakan kirim ulang."
			if row.Error.Valid && row.Error.String != "" {
				text = row.Error.String
			}
			write(event{"type": "error", "error": text, "message": msg, "credits": s.credits.Info(user.ID)})
		}
		return nil
	}

	l := &listener{signal: make(chan struct{}, 1)}
	j.mu.Lock()
	l.queue = append(l.queue, j.events...)
	finished := j.finished
	if !finished {
		j.listeners[l] = true
	}
	j.mu.Unlock()
	defer func() {
		j.mu.Lock()
		delete(j.listeners, l) // editor ditutup: job tetap jalan
		j.mu.Unlock()
	}()
	for {
		j.mu.Lock()
		pending := l.queue
		l.queue = nil
		finished = j.finished
		j.mu.Unlock()
		for _, ev := range pending {
			write(ev)
		}
		if finished {
			return nil
		}
		select {
		case <-l.signal:
		case <-r.Context().Done():
			return nil
		}
	}
}

// Cancel: tombol Stop.
func (s *Service) Cancel(user *store.User, rawID string) error {
	s.mu.Lock()
	j := s.jobs[id(rawID)]
	s.mu.Unlock()
	if j == nil || j.userID != user.ID {
		return httpx.Errorf(404, "Job tidak ditemukan")
	}
	j.cancel()
	return nil
}

func (s *Service) pendingMessage(user *store.User, rawID string) (*messageRow, error) {
	row, err := s.message(id(rawID), user.ID)
	if err != nil {
		return nil, err
	}
	if row == nil || row.Role != "assistant" {
		return nil, httpx.Errorf(404, "Pesan tidak ditemukan")
	}
	if row.ApplyState.String != "pending" {
		return nil, httpx.Errorf(409, "Perubahan ini sudah dikonfirmasi sebelumnya")
	}
	return row, nil
}

func (s *Service) setApplyState(user *store.User, messageID int64, state string) (map[string]any, error) {
	if _, err := s.db.Exec("UPDATE ai_messages SET apply_state = ? WHERE id = ?", state, messageID); err != nil {
		return nil, err
	}
	row, err := s.message(messageID, user.ID)
	if err != nil || row == nil {
		return nil, errors.Join(err, errors.New("pesan AI hilang"))
	}
	return publicMessage(row), nil
}

// Keep: perubahan Builder disimpan.
func (s *Service) Keep(user *store.User, rawID string) (any, error) {
	row, err := s.pendingMessage(user, rawID)
	if err != nil {
		return nil, err
	}
	msg, err := s.setApplyState(user, row.ID, "kept")
	return map[string]any{"message": msg}, err
}

// Revert: perubahan Builder dibatalkan — file dan tabel dikembalikan dari snapshot.
func (s *Service) Revert(ctx context.Context, user *store.User, rawID string) (any, error) {
	row, err := s.pendingMessage(user, rawID)
	if err != nil {
		return nil, err
	}
	var slug string
	err = s.db.QueryRow(`
		SELECT p.slug FROM ai_messages m JOIN ai_threads t ON t.id = m.thread_id JOIN projects p ON p.id = t.project_id
		WHERE m.id = ?`, row.ID).Scan(&slug)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httpx.Errorf(404, "Project untuk perubahan ini sudah dihapus")
	}
	if err != nil {
		return nil, err
	}
	var snap snapshot
	if err := json.Unmarshal([]byte(row.Snapshot.String), &snap); err != nil {
		return nil, err
	}
	if err := s.revertChanges(ctx, slug, &snap); err != nil {
		return nil, err
	}
	msg, err := s.setApplyState(user, row.ID, "reverted")
	if err != nil {
		return nil, err
	}
	var changes []change
	json.Unmarshal([]byte(row.Changes.String), &changes)
	return map[string]any{"message": msg, "touched": touchedPaths(changes)}, nil
}

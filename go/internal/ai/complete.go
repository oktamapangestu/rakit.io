package ai

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/plans"
	"rakit.io/server/internal/store"
)

// Prediksi kode saat user mengetik di editor (teks abu-abu, Tab untuk menerima). Gratis — tidak memakai
// kredit — tapi dibatasi AI_COMPLETE_DAILY_LIMIT permintaan per akun per hari, satu permintaan berjalan
// per akun, dan tidak lewat antrean prompt supaya tidak menghalangi job AI lain.

const (
	completeTimeout   = 12 * time.Second
	completeMaxTokens = 256
	maxCompletePrefix = 6000
	maxCompleteSuffix = 2000
	maxCompletion     = 1500
)

// Model chat cenderung menjelaskan atau mengulang kode; jawaban wajib dibungkus <insert>…</insert> dan yang di
// luar tag diabaikan (dicoba dengan model flash: tanpa tag ia menulis ulang seluruh file plus penjelasan).
const completePrompt = `You are an inline code completion engine (like GitHub Copilot) inside a web code editor.
You get a file with a <CURSOR> marker. Predict the text the developer will type next at <CURSOR>.
Rules:
- Output ONLY <insert>the text to insert at the cursor</insert>. Nothing before or after the tags.
- Never repeat code that is already before or after the cursor; the text is inserted exactly at <CURSOR>.
- Keep it short: finish the current line, or at most ~8 lines when the next lines are obvious.
- Match the file's indentation, quotes and style. User-facing text in Indonesian.
- If unsure, output <insert></insert>.`

var insertRE = regexp.MustCompile(`(?s)<insert>(.*?)(?:</insert>|$)`)

// cleanCompletion mengambil isi <insert> dan membuang bagian yang sudah ada di sekitar kursor.
func cleanCompletion(text, prefix, suffix string) string {
	m := insertRE.FindStringSubmatch(text)
	if m == nil {
		return ""
	}
	text = strings.TrimRight(m[1], " \t\r\n")
	// Baris yang sedang diketik ditulis ulang dari awal: buang bagian yang sudah ada.
	current := prefix[strings.LastIndex(prefix, "\n")+1:]
	if t := strings.TrimSpace(current); t != "" && strings.HasPrefix(strings.TrimSpace(text), t) {
		text = strings.TrimPrefix(strings.TrimLeft(text, " \t"), strings.TrimLeft(current, " \t"))
	}
	// Sisa baris sesudah kursor (mis. penutup tag/kurung) ikut ditulis: buang ekornya.
	rest := strings.TrimSpace(strings.SplitN(suffix, "\n", 2)[0])
	if rest != "" && strings.HasSuffix(strings.TrimSpace(text), rest) {
		text = strings.TrimRight(strings.TrimSuffix(strings.TrimRight(text, " \t"), rest), " \t")
	}
	if strings.TrimSpace(text) == "" {
		return ""
	}
	if jsconv.Len(text) > maxCompletion {
		text = jsconv.Slice(text, maxCompletion)
		if i := strings.LastIndex(text, "\n"); i > 0 {
			text = text[:i]
		}
	}
	return text
}

func (s *Service) completeModels() []string {
	if s.cfg.AI.CompleteModel != "" {
		return []string{s.cfg.AI.CompleteModel}
	}
	m := s.models.Get()
	for _, list := range [][]string{s.models.Order(m.Vision, m.VisionFallbacks), s.models.Order(m.Model, m.Fallbacks)} {
		if len(list) > 0 {
			return list
		}
	}
	return nil
}

// Complete: prediksi teks untuk disisipkan di posisi kursor.
func (s *Service) Complete(ctx context.Context, user *store.User, body map[string]any) (any, error) {
	limit := s.cfg.AI.CompleteDailyLimit
	if !s.cfg.AI.Enabled || limit == 0 {
		return nil, httpx.Errorf(503, "Prediksi kode belum tersedia di server ini")
	}
	prefix, _ := body["prefix"].(string)
	suffix, _ := body["suffix"].(string)
	path, _ := body["path"].(string)
	// Yang terdekat dengan kursor saja: ujung prefix dan awal suffix.
	if n := len([]rune(prefix)); n > maxCompletePrefix {
		prefix = string([]rune(prefix)[n-maxCompletePrefix:])
	}
	if n := len([]rune(suffix)); n > maxCompleteSuffix {
		suffix = string([]rune(suffix)[:maxCompleteSuffix])
	}
	if strings.TrimSpace(prefix) == "" {
		return map[string]any{"completion": ""}, nil
	}

	day, _ := plans.WIBDay(time.Now().UnixMilli())
	var used int
	s.db.QueryRow("SELECT count FROM ai_complete_usage WHERE user_id = ? AND day = ?", user.ID, day).Scan(&used)
	if used >= limit {
		return nil, &httpx.Error{Status: 429, Message: "Batas prediksi kode hari ini sudah habis. Terisi lagi besok pukul 00.00 WIB.", Code: "complete_limit"}
	}

	key := -user.ID // jatah terpisah dari job AI (s.running memakai id positif)
	s.mu.Lock()
	if s.running[key] {
		s.mu.Unlock()
		return nil, &httpx.Error{Status: 429, Message: "Prediksi sebelumnya masih berjalan", Code: "complete_busy"}
	}
	s.running[key] = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.running, key)
		s.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(ctx, completeTimeout)
	defer cancel()
	temperature := 0.2
	ask := "File: " + jsconv.Slice(path, 200) + "\n\n" + prefix + "<CURSOR>" + suffix + "\n\nReply with <insert>...</insert> only."
	req := request{
		messages:    []message{{"role": "system", "content": completePrompt}, {"role": "user", "content": ask}},
		maxTokens:   completeMaxTokens,
		temperature: &temperature,
	}
	var r *reply
	var err error
	for _, model := range s.completeModels() {
		req.model = model
		if r, err = s.chatCompletion(req, hooks{ctx: ctx}); err == nil || ctx.Err() != nil {
			break
		}
	}
	if r == nil && err == nil {
		err = errors.New("tidak ada model AI yang dikonfigurasi")
	}
	if err != nil {
		if ctx.Err() != nil {
			return map[string]any{"completion": ""}, nil // dibatalkan editor (user lanjut mengetik) atau terlalu lama
		}
		return nil, httpx.Errorf(503, "Prediksi kode sedang tidak tersedia")
	}
	s.db.Exec(`
		INSERT INTO ai_complete_usage (user_id, day, count, tokens) VALUES (?, ?, 1, ?)
		ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1, tokens = tokens + excluded.tokens`,
		user.ID, day, r.PromptTokens+r.CompletionTokens)
	return map[string]any{"completion": cleanCompletion(r.Text, prefix, suffix), "remaining": max(0, limit-used-1)}, nil
}

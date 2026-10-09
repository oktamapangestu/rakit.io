package api

import (
	"context"
	"fmt"
	"html"
	"log"
	"strings"
	"time"

	"rakit.io/server/internal/auth"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/i18n"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/mail"
	"rakit.io/server/internal/store"
)

const (
	resetTTL = time.Hour
	// resetsPerHour: link lupa password maksimal per akun per jam (permintaan selebihnya diam-diam diabaikan).
	resetsPerHour = 3
)

// forgotPassword mengirim link ganti password ke email akun (dicari dari email atau username). Jawabannya
// selalu sama, ada akunnya atau tidak, dan email dikirim di latar supaya waktu jawab juga tidak membocorkannya.
func (h *Handler) forgotPassword(q *request) error {
	if !q.is("POST") {
		return errNotFound
	}
	if !h.authLimiter.Allow(q.w, httpx.ClientIP(q.r)) {
		return nil
	}
	if !h.svc.Mail.Enabled() {
		return httpx.Errorf(503, "Fitur lupa password belum aktif. Hubungi admin.")
	}
	if err := q.load(); err != nil {
		return err
	}
	login := strings.ToLower(strings.TrimSpace(q.text("login")))
	if login == "" || jsconv.Len(login) > 254 {
		return httpx.Errorf(400, "Isi email atau username akunmu")
	}
	user, err := h.db.UserByLogin(login)
	if err != nil {
		return err
	}
	if user != nil {
		if err := h.sendReset(user, q.lang()); err != nil {
			return err
		}
	}
	return q.json(200, map[string]bool{"ok": true})
}

// sendReset membuat link lupa password dan mengirimnya di latar.
func (h *Handler) sendReset(user *store.User, lang string) error {
	now := time.Now()
	if n, err := h.db.RecentResets(user.ID, now.Add(-time.Hour).UnixMilli()); err != nil || n >= resetsPerHour {
		return err
	}
	token, hash, err := auth.NewToken()
	if err != nil {
		return err
	}
	if err := h.db.InsertReset(hash, user.ID, now.Add(resetTTL).UnixMilli()); err != nil {
		return err
	}
	// Token di fragmen (#): tidak terkirim ke server atau lewat Referer saat halaman dibuka.
	link := h.cfg.AppOrigin + i18n.Path(lang, "/") + "#reset=" + token
	msg := resetEmail(lang, h.cfg.BaseDomain, user, link)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := h.svc.Mail.Send(ctx, msg); err != nil {
			log.Printf("lupa password: mengirim email ke akun %d: %v", user.ID, err)
		}
	}()
	return nil
}

func resetEmail(lang, brand string, user *store.User, link string) mail.Message {
	minutes := int(resetTTL.Minutes())
	t := struct{ subject, greeting, body, button, ignore string }{
		subject:  "Ganti password " + brand,
		greeting: "Halo " + user.Username + ",",
		body:     fmt.Sprintf("Kami menerima permintaan untuk mengganti password akun %s kamu. Buka link di bawah untuk membuat password baru. Link ini berlaku %d menit dan hanya bisa dipakai sekali.", brand, minutes),
		button:   "Buat password baru",
		ignore:   "Kalau kamu tidak meminta ini, abaikan saja email ini. Password kamu tidak berubah.",
	}
	if lang == i18n.EN {
		t.subject = "Reset your " + brand + " password"
		t.greeting = "Hi " + user.Username + ","
		t.body = fmt.Sprintf("We received a request to reset the password for your %s account. Open the link below to choose a new password. It expires in %d minutes and can only be used once.", brand, minutes)
		t.button = "Choose a new password"
		t.ignore = "If you didn't ask for this, you can ignore this email. Your password won't change."
	}
	text := t.greeting + "\n\n" + t.body + "\n\n" + link + "\n\n" + t.ignore + "\n"
	esc := html.EscapeString
	page := `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f4f1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1320">` +
		`<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">` +
		`<p style="margin:0 0 16px;font-size:16px">` + esc(t.greeting) + `</p>` +
		`<p style="margin:0 0 24px;font-size:15px;line-height:1.55">` + esc(t.body) + `</p>` +
		`<p style="margin:0 0 24px"><a href="` + esc(link) + `" style="display:inline-block;background:#1a1320;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">` + esc(t.button) + `</a></p>` +
		`<p style="margin:0 0 16px;font-size:13px;color:#6b6470;word-break:break-all">` + esc(link) + `</p>` +
		`<p style="margin:0;font-size:13px;color:#6b6470">` + esc(t.ignore) + `</p>` +
		`</div></body></html>`
	return mail.Message{To: user.Email, Subject: t.subject, Text: text, HTML: page}
}

// resetPassword memasang password baru dari link lupa password, mengeluarkan semua sesi lama, lalu
// langsung masuk.
func (h *Handler) resetPassword(q *request) error {
	if !q.is("POST") {
		return errNotFound
	}
	if !h.authLimiter.Allow(q.w, httpx.ClientIP(q.r)) {
		return nil
	}
	if err := q.load(); err != nil {
		return err
	}
	password := q.text("password")
	if n := jsconv.Len(password); n < 8 || n > 200 {
		return httpx.Errorf(400, "Password minimal 8 karakter")
	}
	invalid := httpx.Errorf(400, "Link ganti password tidak valid atau sudah kedaluwarsa. Minta link baru.")
	token := strings.TrimSpace(q.text("token"))
	if token == "" || len(token) > 100 {
		return invalid
	}
	hash := auth.HashToken(token)
	now := time.Now().UnixMilli()
	user, err := h.db.ResetUser(hash, now)
	if err != nil {
		return err
	}
	if user == nil {
		return invalid
	}
	passwordHash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	if ok, err := h.db.ResetPassword(hash, user.ID, passwordHash, now); err != nil {
		return err
	} else if !ok {
		return invalid
	}
	if err := h.auth.Login(q.w, user.ID); err != nil {
		return err
	}
	return q.json(200, map[string]any{"user": publicUser{user.Username, user.Email}})
}

// testMail (dashboard owner): kirim email tes ke { to } atau ke email owner sendiri.
func (h *Handler) testMail(q *request) map[string]any {
	to := strings.TrimSpace(q.text("to"))
	if to == "" {
		to = q.user.Email
	}
	if !emailRE.MatchString(to) {
		return map[string]any{"ok": false, "error": "Alamat tujuan tidak valid"}
	}
	ctx, cancel := context.WithTimeout(q.r.Context(), time.Minute)
	defer cancel()
	brand := h.cfg.BaseDomain
	err := h.svc.Mail.Send(ctx, mail.Message{
		To:      to,
		Subject: "Email tes dari " + brand,
		Text:    "Pengaturan email " + brand + " sudah benar: email ini terkirim lewat API email dari dashboard pemilik.\n",
	})
	if err != nil {
		return map[string]any{"ok": false, "error": err.Error()}
	}
	return map[string]any{"ok": true, "to": to}
}

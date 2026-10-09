// Package mail: email dari platform (lupa password) lewat API flaz (MAIL_API_URL). Alamat pengirim dan
// API key diatur owner di dashboard (tabel settings, kunci "mail"); tanpa keduanya fitur email mati.
//
// API menerima { sender, recipients, raw } dengan raw = pesan RFC 5322 dalam base64, header
// Authorization: Bearer <key>, dan Idempotency-Key yang sama untuk setiap percobaan ulang pesan yang sama.
package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/quotedprintable"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"rakit.io/server/internal/config"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/store"
)

const settingKey = "mail"

// Settings: pengaturan pengirim dari dashboard.
type Settings struct {
	Sender     string `json:"sender"`     // alamat pengirim (domain terverifikasi di API)
	SenderName string `json:"senderName"` // nama yang tampil, mis. "rakit.io"
	APIKey     string `json:"apiKey"`
}

type Service struct {
	cfg    *config.Config
	db     *store.Store
	client *http.Client
	// retryDelays: jeda sebelum percobaan ulang (jumlahnya = percobaan ulang maksimal).
	retryDelays []time.Duration
}

func New(cfg *config.Config, db *store.Store) *Service {
	return &Service{cfg: cfg, db: db, client: &http.Client{Timeout: 20 * time.Second},
		retryDelays: []time.Duration{time.Second, 3 * time.Second}}
}

func (s *Service) Settings() Settings {
	var out Settings
	if raw, ok := s.db.Setting(settingKey); ok {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	return out
}

// Enabled: pengirim dan API key sudah diatur.
func (s *Service) Enabled() bool {
	st := s.Settings()
	return st.Sender != "" && st.APIKey != ""
}

// ---------- Dashboard owner ----------

// View: pengaturan untuk dashboard. API key tidak pernah dikirim balik, hanya 4 karakter terakhir.
type View struct {
	Sender     string `json:"sender"`
	SenderName string `json:"senderName"`
	HasKey     bool   `json:"hasKey"`
	KeyHint    string `json:"keyHint"`
	Enabled    bool   `json:"enabled"`
	APIURL     string `json:"apiUrl"`
}

func (s *Service) View() View {
	st := s.Settings()
	v := View{Sender: st.Sender, SenderName: st.SenderName, HasKey: st.APIKey != "", APIURL: s.cfg.MailAPIURL}
	v.Enabled = v.Sender != "" && v.HasKey
	if v.HasKey {
		v.KeyHint = "…" + st.APIKey[max(0, len(st.APIKey)-4):]
	}
	return v
}

// Save menyimpan pengaturan dari dashboard: { sender, senderName, apiKey }. apiKey kosong = key lama tetap
// dipakai; clearKey = hapus key (fitur email mati).
func (s *Service) Save(input map[string]any) (View, error) {
	str := func(key string) string { return strings.TrimSpace(jsconv.String(input[key])) }
	st := s.Settings()
	st.Sender = strings.ToLower(str("sender"))
	st.SenderName = jsconv.Slice(str("senderName"), 60)
	if st.Sender != "" {
		if addr, err := mail.ParseAddress(st.Sender); err != nil || addr.Address != st.Sender || len(st.Sender) > 254 {
			return View{}, httpx.Errorf(400, "Alamat pengirim tidak valid")
		}
	}
	if strings.ContainsAny(st.SenderName, "\r\n") {
		return View{}, httpx.Errorf(400, "Nama pengirim tidak valid")
	}
	if key := str("apiKey"); key != "" {
		if len(key) > 500 || strings.ContainsAny(key, " \t\r\n") {
			return View{}, httpx.Errorf(400, "API key tidak valid")
		}
		st.APIKey = key
	}
	if jsconv.Truthy(input["clearKey"]) {
		st.APIKey = ""
	}
	raw, err := json.Marshal(st)
	if err != nil {
		return View{}, err
	}
	if err := s.db.SetSetting(settingKey, string(raw)); err != nil {
		return View{}, err
	}
	return s.View(), nil
}

// ---------- Mengirim ----------

// Message: satu email. HTML boleh kosong (hanya teks).
type Message struct {
	To, Subject, Text, HTML string
}

// Send mengirim pesan. Gangguan jaringan, 429, dan 5xx dicoba ulang dengan Idempotency-Key yang sama,
// jadi API tidak mengirim email dua kali.
func (s *Service) Send(ctx context.Context, msg Message) error {
	st := s.Settings()
	if st.Sender == "" || st.APIKey == "" {
		return fmt.Errorf("pengirim email belum diatur di dashboard")
	}
	raw, err := build(st, msg, time.Now())
	if err != nil {
		return err
	}
	body, err := json.Marshal(map[string]any{
		"sender":     st.Sender,
		"recipients": []string{msg.To},
		"raw":        base64.StdEncoding.EncodeToString(raw),
	})
	if err != nil {
		return err
	}
	key := randomHex(16)
	for attempt := 0; ; attempt++ {
		retry, err := s.post(ctx, st.APIKey, key, body)
		if err == nil || !retry || attempt >= len(s.retryDelays) {
			return err
		}
		select {
		case <-ctx.Done():
			return err
		case <-time.After(s.retryDelays[attempt]):
		}
	}
}

// post: satu percobaan. retry = kegagalan sementara yang layak dicoba ulang.
func (s *Service) post(ctx context.Context, apiKey, idempotencyKey string, body []byte) (retry bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.MailAPIURL, bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Idempotency-Key", idempotencyKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := s.client.Do(req)
	if err != nil {
		return ctx.Err() == nil, fmt.Errorf("tidak bisa terhubung ke API email: %w", err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return false, nil
	}
	return res.StatusCode == 429 || res.StatusCode >= 500,
		fmt.Errorf("API email menjawab %d: %s", res.StatusCode, apiError(data))
}

// apiError: pesan kesalahan dari jawaban API ({ error: "..." } / { error: { message } } / { message }), atau
// cuplikan body apa adanya.
func apiError(data []byte) string {
	var parsed struct {
		Error   any    `json:"error"`
		Message string `json:"message"`
	}
	if json.Unmarshal(data, &parsed) == nil {
		switch e := parsed.Error.(type) {
		case string:
			if e != "" {
				return e
			}
		case map[string]any:
			if m, ok := e["message"].(string); ok && m != "" {
				return m
			}
		}
		if parsed.Message != "" {
			return parsed.Message
		}
	}
	return jsconv.Slice(strings.TrimSpace(string(data)), 300)
}

// build menyusun pesan RFC 5322: teks saja, atau multipart/alternative (teks + HTML), UTF-8 quoted-printable.
func build(st Settings, msg Message, now time.Time) ([]byte, error) {
	to, err := mail.ParseAddress(msg.To)
	if err != nil {
		return nil, fmt.Errorf("alamat tujuan tidak valid: %w", err)
	}
	from := (&mail.Address{Name: st.SenderName, Address: st.Sender}).String()
	domain := st.Sender[strings.LastIndexByte(st.Sender, '@')+1:]

	var b bytes.Buffer
	header := func(k, v string) { b.WriteString(k + ": " + v + "\r\n") }
	header("From", from)
	header("To", to.String())
	header("Subject", mime.QEncoding.Encode("utf-8", msg.Subject))
	header("Date", now.Format(time.RFC1123Z))
	header("Message-ID", "<"+randomHex(16)+"@"+domain+">")
	header("MIME-Version", "1.0")
	if msg.HTML == "" {
		writePart(&b, "text/plain", msg.Text)
		return b.Bytes(), nil
	}
	boundary := "b_" + randomHex(12)
	header("Content-Type", `multipart/alternative; boundary="`+boundary+`"`)
	b.WriteString("\r\n")
	for _, part := range [][2]string{{"text/plain", msg.Text}, {"text/html", msg.HTML}} {
		b.WriteString("--" + boundary + "\r\n")
		writePart(&b, part[0], part[1])
		b.WriteString("\r\n")
	}
	b.WriteString("--" + boundary + "--\r\n")
	return b.Bytes(), nil
}

func writePart(b *bytes.Buffer, contentType, content string) {
	b.WriteString("Content-Type: " + contentType + "; charset=utf-8\r\n")
	b.WriteString("Content-Transfer-Encoding: quoted-printable\r\n\r\n")
	w := quotedprintable.NewWriter(b)
	w.Write([]byte(strings.ReplaceAll(strings.ReplaceAll(content, "\r\n", "\n"), "\n", "\r\n")))
	w.Close()
}

func randomHex(n int) string {
	buf := make([]byte, n)
	rand.Read(buf)
	return hex.EncodeToString(buf)
}

// Package billing: isi ulang kredit, Saldo Asisten, dan langganan lewat QRIS (Kasera Pay).
// Padanan src/billing.js.
package billing

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	qrcode "github.com/skip2/go-qrcode"

	"rakit.icu/server/internal/config"
	"rakit.icu/server/internal/credits"
	"rakit.icu/server/internal/httpx"
	"rakit.icu/server/internal/plans"
	"rakit.icu/server/internal/store"
)

const (
	paymentTTLMinutes  = 30
	signatureTolerance = 5 * 60 // detik
)

type Service struct {
	cfg     *config.Config
	db      *sql.DB
	plans   *plans.Plans
	credits *credits.Service
	client  *http.Client

	mu          sync.Mutex
	lastChecked map[string]time.Time // payment id -> waktu cek terakhir ke Kasera
}

func New(cfg *config.Config, db *store.Store, p *plans.Plans, c *credits.Service) *Service {
	return &Service{cfg: cfg, db: db.DB(), plans: p, credits: c, client: &http.Client{Timeout: 20 * time.Second}, lastChecked: map[string]time.Time{}}
}

// ---------- Kasera Pay API ----------

// transaction: objek transaksi Kasera.
type transaction struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	Amount  int    `json:"amount"`
	Payment *struct {
		Type     string `json:"type"`
		QRString string `json:"qr_string"`
	} `json:"payment"`
	CheckoutURL  *string         `json:"checkout_url"`
	Instructions json.RawMessage `json:"instructions"`
	ExpiresAt    *string         `json:"expires_at"`
	PaidAt       string          `json:"paid_at"`
}

func (s *Service) kasera(ctx context.Context, method, path string, body any, idempotencyKey string) (*transaction, error) {
	var payload io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		payload = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.cfg.Billing.BaseURL+path, payload)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.Billing.APIKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		var failure struct {
			Error struct{ Code, Message string } `json:"error"`
		}
		json.Unmarshal(raw, &failure)
		return nil, fmt.Errorf("Kasera %s %s %d: %s %s", method, path, res.StatusCode, failure.Error.Code, failure.Error.Message)
	}
	trx := &transaction{}
	json.Unmarshal(raw, trx)
	return trx, nil
}

// ---------- Baris pembayaran ----------

type payment struct {
	credits.Payment
	ProviderID   sql.NullString
	Status       string
	QRString     sql.NullString
	CheckoutURL  sql.NullString
	Instructions sql.NullString
	ExpiresAt    sql.NullString
	Livemode     bool
}

const paymentColumns = "id, provider_id, user_id, package_id, credits, amount, status, qr_string, checkout_url, instructions, expires_at, livemode"

func (s *Service) paymentWhere(where string, args ...any) (*payment, error) {
	p := &payment{}
	err := s.db.QueryRow("SELECT "+paymentColumns+" FROM payments WHERE "+where, args...).Scan(
		&p.ID, &p.ProviderID, &p.UserID, &p.PackageID, &p.Credits, &p.Amount, &p.Status, &p.QRString, &p.CheckoutURL, &p.Instructions, &p.ExpiresAt, &p.Livemode)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return p, err
}

// syncFromProvider menyimpan status terbaru dari transaksi Kasera ke pembayaran lokal.
func (s *Service) syncFromProvider(p *payment, id, status string, amount int, paidAt string) error {
	switch status {
	case "succeeded":
		if amount != p.Amount {
			log.Printf("Kasera: nominal %s (%d) tidak cocok dengan %s (%d)", id, amount, p.ID, p.Amount)
			return nil
		}
		_, err := s.credits.CreditPayment(&p.Payment, paidAt)
		return err
	case "failed", "expired", "canceled":
		_, err := s.db.Exec("UPDATE payments SET status = ? WHERE id = ? AND status = 'pending'", status, p.ID)
		return err
	}
	return nil
}

// ---------- Tampilan untuk klien ----------

type view struct {
	ID           string          `json:"id"`
	Status       string          `json:"status"`
	Credits      int             `json:"credits"`
	Plan         *string         `json:"plan"`
	Assistant    bool            `json:"assistant"` // isi ulang Saldo Asisten (nominal = amount)
	Amount       int             `json:"amount"`
	ExpiresAt    *string         `json:"expiresAt"`
	CheckoutURL  *string         `json:"checkoutUrl"`
	Instructions json.RawMessage `json:"instructions"`
	Livemode     bool            `json:"livemode"`
	QR           *string         `json:"qr"`
}

func nullable(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	return &v.String
}

// qrSVG menggambar QR (koreksi kesalahan M, margin 1 modul) sebagai SVG.
func qrSVG(content string) (string, error) {
	qr, err := qrcode.New(content, qrcode.Medium)
	if err != nil {
		return "", err
	}
	qr.DisableBorder = true
	bitmap := qr.Bitmap()
	size := len(bitmap) + 2
	var path strings.Builder
	for y, row := range bitmap {
		for x := 0; x < len(row); x++ {
			if !row[x] {
				continue
			}
			start := x
			for x+1 < len(row) && row[x+1] {
				x++
			}
			fmt.Fprintf(&path, "M%d %dh%dv1H%dz", start+1, y+1, x-start+1, start+1)
		}
	}
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges"><path fill="#ffffff" d="M0 0h%dv%dH0z"/><path fill="#000000" d="%s"/></svg>`,
		size, size, size, size, path.String()), nil
}

func (s *Service) view(p *payment) (*view, error) {
	v := &view{
		ID: p.ID, Status: p.Status, Credits: p.Credits, Assistant: strings.HasPrefix(p.PackageID, "asst:"), Amount: p.Amount,
		ExpiresAt: nullable(p.ExpiresAt), CheckoutURL: nullable(p.CheckoutURL), Instructions: json.RawMessage("null"), Livemode: p.Livemode,
	}
	if strings.HasPrefix(p.PackageID, "plan:") {
		if plan := s.plans.FromPackageID(p.PackageID); plan != nil {
			v.Plan = &plan.Name
		}
	}
	if p.Instructions.Valid && json.Valid([]byte(p.Instructions.String)) {
		v.Instructions = json.RawMessage(p.Instructions.String)
	}
	if p.Status == "pending" && p.QRString.Valid && p.QRString.String != "" {
		svg, err := qrSVG(p.QRString.String)
		if err != nil {
			return nil, err
		}
		data := "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(svg))
		v.QR = &data
	}
	return v, nil
}

// ---------- Untuk user ----------

// Packages: daftar yang bisa dibeli + kredit akun.
func (s *Service) Packages(userID int64) map[string]any {
	return map[string]any{
		"enabled":           s.cfg.Billing.Enabled,
		"livemode":          s.cfg.Billing.Livemode,
		"packages":          s.cfg.Billing.Packages,
		"plans":             s.plans.Public(),
		"assistantPackages": s.cfg.Assistant.Packages,
		// Pembanding "× lipat" di promosi langganan.
		"free":    map[string]any{"storage": plans.FreeStorage, "history": plans.FreeHistory},
		"credits": s.credits.Info(userID),
	}
}

func uuid() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	h := hex.EncodeToString(b)
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

// rupiah: angka dengan pemisah ribuan titik, seperti toLocaleString('id-ID').
func rupiah(n int) string {
	s := strconv.Itoa(n)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "." + s[i:]
	}
	return s
}

// create membuat tagihan QRIS untuk satu item. Mengembalikan status HTTP (200 = QRIS lama dipakai ulang).
func (s *Service) create(ctx context.Context, user *store.User, packageID string, creditCount, price int, label string) (int, *view, error) {
	if !s.cfg.Billing.Enabled {
		return 0, nil, httpx.Errorf(503, "Pembayaran belum dikonfigurasi di server")
	}
	// Pakai ulang QRIS yang masih berlaku untuk paket yang sama, supaya user tidak dapat banyak tagihan.
	existing, err := s.paymentWhere("user_id = ? AND package_id = ? AND status = 'pending' AND provider_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", user.ID, packageID)
	if err != nil {
		return 0, nil, err
	}
	if existing != nil && existing.Amount == price && existing.QRString.String != "" {
		if expires, err := time.Parse(time.RFC3339, existing.ExpiresAt.String); err == nil && time.Until(expires) > 2*time.Minute {
			v, err := s.view(existing)
			return 200, v, err
		}
	}

	id := uuid()
	livemode := 0
	if s.cfg.Billing.Livemode {
		livemode = 1
	}
	if _, err := s.db.Exec(`
		INSERT INTO payments (id, user_id, package_id, credits, amount, status, livemode, created_at)
		VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`, id, user.ID, packageID, creditCount, price, livemode, time.Now().UnixMilli()); err != nil {
		return 0, nil, err
	}
	trx, err := s.kasera(ctx, "POST", "/transactions", map[string]any{
		"amount":             price,
		"description":        label + " rakit.icu",
		"external_id":        id,
		"merchant_ref":       fmt.Sprintf("user-%d", user.ID),
		"payment_methods":    []string{"qris"},
		"expires_in_minutes": paymentTTLMinutes,
		"customer":           map[string]string{"name": user.Username, "email": user.Email},
		"order_items":        []map[string]any{{"name": label, "price": price, "quantity": 1}},
	}, id)
	if err != nil {
		s.db.Exec("DELETE FROM payments WHERE id = ?", id)
		log.Print(err)
		return 0, nil, httpx.Errorf(502, "Gagal membuat pembayaran QRIS. Coba lagi sebentar lagi.")
	}
	var qr any
	if trx.Payment != nil && trx.Payment.Type == "qr" {
		qr = trx.Payment.QRString
	}
	instructions := "null"
	if len(trx.Instructions) > 0 {
		instructions = string(trx.Instructions)
	}
	if _, err := s.db.Exec(`
		UPDATE payments SET provider_id = ?, status = ?, qr_string = ?, checkout_url = ?, instructions = ?, expires_at = ?
		WHERE id = ?`, trx.ID, trx.Status, qr, trx.CheckoutURL, instructions, trx.ExpiresAt, id); err != nil {
		return 0, nil, err
	}
	saved, err := s.paymentWhere("id = ?", id)
	if err != nil {
		return 0, nil, err
	}
	v, err := s.view(saved)
	return 201, v, err
}

func (s *Service) Topup(ctx context.Context, user *store.User, packageID string) (int, any, error) {
	for _, pkg := range s.cfg.Billing.Packages {
		if pkg.ID == packageID {
			return s.wrap(s.create(ctx, user, pkg.ID, pkg.Credits, pkg.Price, fmt.Sprintf("%d kredit AI", pkg.Credits)))
		}
	}
	return 0, nil, httpx.Errorf(400, "Paket tidak ditemukan")
}

// AssistantTopup: isi ulang Saldo Asisten AI website (Rupiah dibayar = saldo yang didapat).
func (s *Service) AssistantTopup(ctx context.Context, user *store.User, packageID string) (int, any, error) {
	for _, pkg := range s.cfg.Assistant.Packages {
		if pkg.ID == packageID {
			return s.wrap(s.create(ctx, user, pkg.ID, 0, pkg.Amount, "Saldo Asisten AI "+rupiah(pkg.Amount)))
		}
	}
	return 0, nil, httpx.Errorf(400, "Paket saldo asisten tidak ditemukan")
}

func (s *Service) Subscribe(ctx context.Context, user *store.User, planID string) (int, any, error) {
	plan := s.plans.ForSale(planID)
	if plan == nil {
		return 0, nil, httpx.Errorf(400, "Paket langganan ini sedang tidak dijual")
	}
	if err := s.plans.AssertCanBuy(user.ID, plan); err != nil {
		return 0, nil, err
	}
	return s.wrap(s.create(ctx, user, plans.PackageID(plan.ID), 0, plan.Price, "Langganan "+plan.Name+" 30 hari"))
}

func (s *Service) wrap(status int, v *view, err error) (int, any, error) {
	if err != nil {
		return 0, nil, err
	}
	return status, map[string]any{"payment": v}, nil
}

// Payment: status satu pembayaran milik user. Webhook adalah jalur utama; cek langsung ke Kasera
// sebagai cadangan (mis. di localhost tanpa webhook).
func (s *Service) Payment(ctx context.Context, user *store.User, id string) (any, error) {
	p, err := s.paymentWhere("id = ?", id)
	if err != nil {
		return nil, err
	}
	if p == nil || p.UserID != user.ID {
		return nil, httpx.Errorf(404, "Pembayaran tidak ditemukan")
	}
	if p.Status == "pending" && p.ProviderID.Valid {
		s.mu.Lock()
		due := time.Since(s.lastChecked[p.ID]) > 5*time.Second
		if due {
			s.lastChecked[p.ID] = time.Now()
		}
		s.mu.Unlock()
		if due {
			trx, err := s.kasera(ctx, "GET", "/transactions/"+p.ProviderID.String, nil, "")
			if err == nil {
				err = s.syncFromProvider(p, trx.ID, trx.Status, trx.Amount, trx.PaidAt)
			}
			if err != nil {
				log.Print(err)
			} else if p, err = s.paymentWhere("id = ?", id); err != nil || p == nil {
				return nil, errors.Join(err, errors.New("pembayaran hilang"))
			}
		}
	}
	if p.Status != "pending" {
		s.mu.Lock()
		delete(s.lastChecked, p.ID)
		s.mu.Unlock()
	}
	v, err := s.view(p)
	if err != nil {
		return nil, err
	}
	return map[string]any{"payment": v, "credits": s.credits.Info(user.ID)}, nil
}

// ---------- Webhook ----------

func (s *Service) verifySignature(header string, rawBody []byte) bool {
	if s.cfg.Billing.WebhookSecret == "" || header == "" {
		return false
	}
	var timestamp float64
	var signatures []string
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), "=")
		value := ""
		if len(fields) > 1 {
			value = fields[1]
		}
		switch fields[0] {
		case "t":
			timestamp, _ = strconv.ParseFloat(value, 64)
		case "v1":
			if value != "" {
				signatures = append(signatures, value)
			}
		}
	}
	if timestamp == 0 || math.Abs(float64(time.Now().UnixMilli())/1000-timestamp) > signatureTolerance {
		return false
	}
	mac := hmac.New(sha256.New, []byte(s.cfg.Billing.WebhookSecret))
	mac.Write([]byte(strconv.FormatFloat(timestamp, 'f', -1, 64) + "."))
	mac.Write(rawBody)
	expected := mac.Sum(nil)
	// Saat rotasi secret, Kasera mengirim dua v1: terima kalau salah satunya cocok.
	for _, sig := range signatures {
		if given, err := hex.DecodeString(sig); err == nil && hmac.Equal(given, expected) {
			return true
		}
	}
	return false
}

// Webhook menerima event Kasera. Tanda tangan dihitung dari body mentah; tanpa sesi & tanpa cek Origin.
func (s *Service) Webhook(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		httpx.JSON(w, 413, map[string]string{"error": "Request terlalu besar"})
		return
	}
	if !s.verifySignature(r.Header.Get("kasera-signature-v1"), raw) {
		httpx.JSON(w, 401, map[string]string{"error": "invalid signature"})
		return
	}
	var event struct {
		Type     string `json:"type"`
		Livemode *bool  `json:"livemode"`
		Data     struct {
			PaymentRequestID string `json:"payment_request_id"`
			Amount           int    `json:"amount"`
			PaidAt           string `json:"paid_at"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &event) != nil {
		httpx.JSON(w, 400, map[string]string{"error": "invalid json"})
		return
	}
	if event.Livemode == nil || *event.Livemode != s.cfg.Billing.Livemode {
		httpx.JSON(w, 200, map[string]string{"ignored": "mode mismatch"})
		return
	}
	if event.Type == "payment.paid" {
		p, err := s.paymentWhere("provider_id = ?", event.Data.PaymentRequestID)
		if err == nil && p == nil {
			httpx.JSON(w, 200, map[string]string{"ignored": "unknown payment"})
			return
		}
		if err == nil {
			err = s.syncFromProvider(p, event.Data.PaymentRequestID, "succeeded", event.Data.Amount, event.Data.PaidAt)
		}
		if err != nil {
			httpx.Fail(w, err)
			return
		}
	}
	// test.ping dan event lain cukup dibalas 200.
	httpx.JSON(w, 200, map[string]bool{"received": true})
}

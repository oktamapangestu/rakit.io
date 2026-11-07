package api

// /api/sync: dipakai aplikasi desktop (lihat cloud.go di sisi desktop) untuk masuk dengan akun rakit.io, melihat
// project, mengunduh project, dan memublikasikan project dari komputer ke server.
//
// Login perangkat (seperti login GitHub CLI): aplikasi meminta kode (POST device), membuka browser ke
// /desktop/authorize?code=<kode pengguna>, pengguna yang sudah login menekan Izinkan (POST device/approve, dari
// halaman rakit.io sendiri), dan aplikasi menukar device code dengan token (POST device/token). Token disimpan
// sebagai sesi tanpa cookie dan dikirim lewat Authorization: Bearer; hanya rute /api/sync yang menerimanya.

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"rakit.io/server/internal/auth"
	"rakit.io/server/internal/bundle"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/i18n"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/store"
	"rakit.io/server/internal/userdb"
)

const (
	deviceTTL      = 10 * time.Minute
	devicePoll     = 2 // detik
	maxDevices     = 1000
	userCodeChars  = "BCDFGHJKLMNPQRSTVWXZ23456789" // tanpa vokal & huruf/angka yang mirip
	deviceNameMax  = 60
	bundleOverhead = 8 << 20
)

type deviceRequest struct {
	deviceCode string
	userCode   string
	name       string
	expires    time.Time
	userID     int64 // 0 = belum disetujui
}

// devices: permintaan login perangkat yang sedang menunggu (di memori; hilang saat server restart, cukup
// meminta kode baru).
type devices struct {
	mu   sync.Mutex
	byUC map[string]*deviceRequest
}

func (d *devices) sweep(now time.Time) {
	for k, v := range d.byUC {
		if now.After(v.expires) {
			delete(d.byUC, k)
		}
	}
}

func randomCode(n int, alphabet string) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b), nil
}

// normalizeUserCode: "abcd efgh", "ABCD-EFGH" -> "ABCDEFGH".
func normalizeUserCode(s string) string {
	var out strings.Builder
	for _, r := range strings.ToUpper(s) {
		if strings.ContainsRune(userCodeChars, r) {
			out.WriteRune(r)
		}
	}
	return out.String()
}

func displayUserCode(c string) string {
	if len(c) == 8 {
		return c[:4] + "-" + c[4:]
	}
	return c
}

// syncRequest: request /api/sync yang tidak memakai cookie (bearer token, atau belum login sama sekali), jadi
// aman dari CSRF dan tidak perlu cek Origin.
func syncRequest(parts []string, r *http.Request) bool {
	if len(parts) == 0 || !strings.EqualFold(parts[0], "sync") {
		return false
	}
	if auth.BearerToken(r) != "" {
		return true
	}
	return len(parts) >= 2 && strings.EqualFold(parts[1], "device") &&
		(len(parts) == 2 || (len(parts) == 3 && strings.EqualFold(parts[2], "token")))
}

func (h *Handler) sync(q *request) error {
	if h.cfg.Desktop {
		return errNotFound
	}
	switch {
	case q.is("POST", "device"):
		return h.deviceStart(q)
	case q.is("POST", "device", "token"):
		return h.deviceToken(q)
	case q.is("GET", "device", ":"):
		return h.deviceInfo(q)
	case q.is("POST", "device", "approve"):
		return h.deviceApprove(q)
	}
	// Selebihnya: hanya dengan token aplikasi desktop atau sesi login.
	if err := h.requireAuth(q); err != nil {
		return err
	}
	switch {
	case q.is("GET", "me"):
		all, err := h.db.ProjectsOf(q.user.ID)
		if err != nil {
			return err
		}
		return q.json(200, map[string]any{
			"user":     publicUser{q.user.Username, q.user.Email},
			"projects": h.publicAll(all),
			"limit":    h.cfg.MaxProjects, "customLimit": h.cfg.MaxCustom,
			"server": h.cfg.AppOrigin,
		})
	case q.is("POST", "logout"):
		h.auth.Revoke(q.user)
		return q.json(200, map[string]bool{"ok": true})
	case q.is("POST", "projects"):
		if err := q.load(); err != nil {
			return err
		}
		project, err := h.accounts().CreateProject(q.user, q.text("slug"), q.text("name"), q.lang())
		if err != nil {
			return err
		}
		return q.json(201, map[string]any{"project": h.public(project)})
	case q.is("GET", "projects", ":", "bundle"):
		project, err := h.syncProject(q)
		if err != nil {
			return err
		}
		return h.sendBundle(q, project)
	case q.is("PUT", "projects", ":", "bundle"):
		project, err := h.syncProject(q)
		if err != nil {
			return err
		}
		return h.receiveBundle(q, project)
	}
	return errNotFound
}

// ---------- Login perangkat ----------

func (h *Handler) deviceStart(q *request) error {
	if !h.authLimiter.Allow(q.w, "dev:"+httpx.ClientIP(q.r)) {
		return nil
	}
	if err := q.load(); err != nil {
		return err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	userCode, err := randomCode(8, userCodeChars)
	if err != nil {
		return err
	}
	name := jsconv.Slice(strings.TrimSpace(q.text("name")), deviceNameMax)
	if name == "" {
		name = "rakit desktop"
	}
	req := &deviceRequest{
		deviceCode: base64.RawURLEncoding.EncodeToString(raw), userCode: userCode, name: name,
		expires: time.Now().Add(deviceTTL),
	}
	d := h.devices
	d.mu.Lock()
	d.sweep(time.Now())
	if len(d.byUC) >= maxDevices {
		d.mu.Unlock()
		return httpx.Errorf(503, "Terlalu banyak permintaan dalam waktu singkat. Tunggu sebentar lalu coba lagi.")
	}
	d.byUC[userCode] = req
	d.mu.Unlock()
	return q.json(200, map[string]any{
		"deviceCode": req.deviceCode,
		"userCode":   displayUserCode(userCode),
		"verifyUrl":  h.cfg.AppOrigin + "/desktop/authorize?code=" + displayUserCode(userCode),
		"expiresIn":  int(deviceTTL.Seconds()),
		"interval":   devicePoll,
	})
}

// deviceToken: aplikasi menanyakan apakah permintaannya sudah disetujui. 202 = belum.
func (h *Handler) deviceToken(q *request) error {
	if err := q.load(); err != nil {
		return err
	}
	code := q.text("deviceCode")
	d := h.devices
	d.mu.Lock()
	var found *deviceRequest
	for _, v := range d.byUC {
		if subtle.ConstantTimeCompare([]byte(v.deviceCode), []byte(code)) == 1 {
			found = v
			break
		}
	}
	if found == nil || time.Now().After(found.expires) {
		d.mu.Unlock()
		return &httpx.Error{Status: 410, Code: "expired", Message: "Kode login sudah tidak berlaku. Coba masuk lagi."}
	}
	if found.userID == 0 {
		d.mu.Unlock()
		return q.json(202, map[string]bool{"pending": true})
	}
	delete(d.byUC, found.userCode) // token hanya diberikan sekali
	d.mu.Unlock()
	user, err := h.db.UserByID(found.userID)
	if err != nil {
		return err
	}
	if user == nil {
		return &httpx.Error{Status: 410, Code: "expired", Message: "Kode login sudah tidak berlaku. Coba masuk lagi."}
	}
	token, err := h.auth.IssueToken(user.ID)
	if err != nil {
		return err
	}
	return q.json(200, map[string]any{"token": token, "user": publicUser{user.Username, user.Email}})
}

func (h *Handler) pendingDevice(code string) *deviceRequest {
	d := h.devices
	d.mu.Lock()
	defer d.mu.Unlock()
	req := d.byUC[normalizeUserCode(code)]
	if req == nil || time.Now().After(req.expires) {
		return nil
	}
	return req
}

// deviceInfo: untuk halaman /desktop/authorize (pengguna sudah login).
func (h *Handler) deviceInfo(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	req := h.pendingDevice(q.rest[1])
	if req == nil {
		return httpx.Errorf(404, "Kode login sudah tidak berlaku. Coba masuk lagi.")
	}
	return q.json(200, map[string]any{
		"name": req.name, "code": displayUserCode(req.userCode), "approved": req.userID != 0,
		"user": publicUser{q.user.Username, q.user.Email},
	})
}

func (h *Handler) deviceApprove(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	if err := q.load(); err != nil {
		return err
	}
	req := h.pendingDevice(q.text("code"))
	if req == nil {
		return httpx.Errorf(404, "Kode login sudah tidak berlaku. Coba masuk lagi.")
	}
	h.devices.mu.Lock()
	defer h.devices.mu.Unlock()
	if q.body["approve"] == false {
		delete(h.devices.byUC, req.userCode)
		return q.json(200, map[string]bool{"ok": true})
	}
	if req.userID != 0 && req.userID != q.user.ID {
		return httpx.Errorf(409, "Kode ini sudah dipakai akun lain")
	}
	req.userID = q.user.ID
	return q.json(200, map[string]bool{"ok": true})
}

// ---------- Unduh & publikasi ----------

// syncProject: project milik user dari /api/sync/projects/<slug>/...
func (h *Handler) syncProject(q *request) (*store.Project, error) {
	p, err := h.db.ProjectBySlug(strings.ToLower(q.rest[1]))
	if err != nil {
		return nil, err
	}
	if p == nil || p.UserID != q.user.ID {
		return nil, httpx.Errorf(404, "Project tidak ditemukan")
	}
	return p, nil
}

func (h *Handler) syncTmp() string { return filepath.Join(h.cfg.DataDir, "tmp") }

// sendBundle: project (file + database lengkap) sebagai zip. Untuk publikasi manual: versi dev (yang diedit).
func (h *Handler) sendBundle(q *request, project *store.Project) error {
	ctx := q.r.Context()
	tables := []*userdb.TableInfo{}
	if h.userdb.HasDatabase(project.Slug) {
		var err error
		if tables, err = h.userdb.ListTables(ctx, project.Slug); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(h.syncTmp(), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(h.syncTmp(), "export-*.db")
	if err != nil {
		return err
	}
	tmp.Close()
	defer os.Remove(tmp.Name())
	dbFile := ""
	if ok, err := h.userdb.SnapshotTo(ctx, project.Slug, tmp.Name()); err != nil {
		return err
	} else if ok {
		dbFile = tmp.Name()
	}
	q.w.Header().Set("Content-Type", "application/zip")
	q.w.Header().Set("Content-Disposition", `attachment; filename="`+project.Slug+`.zip"`)
	q.w.Header().Set("Cache-Control", "no-store")
	meta := bundle.Meta{Name: project.Name, Slug: project.Slug, Tables: tables}
	// Header sudah terkirim begitu zip mulai ditulis; kesalahan di tengah jalan memutus zip (klien menolaknya).
	bundle.Write(q.w, meta, h.cfg.SiteRoot(project.Slug), true, dbFile)
	return nil
}

// receiveBundle: file & struktur tabel dari aplikasi desktop menggantikan isi project (versi dev bila publikasi
// manual). Data database dan folder upload di server dipertahankan. Versi sebelum & sesudahnya disimpan di riwayat.
func (h *Handler) receiveBundle(q *request, project *store.Project) error {
	if busy, err := h.db.ActiveJobIn(project.ID); err != nil {
		return err
	} else if busy {
		return httpx.Errorf(409, "AI sedang bekerja di project ini. Tunggu selesai atau tekan Stop.")
	}
	limits := h.plans.StorageFor(project.Slug)
	raw, err := readLimited(q.w, q.r, limits.TotalSize+bundleOverhead)
	if err != nil {
		return err
	}
	opened, err := bundle.Read(bytes.NewReader(raw), int64(len(raw)), h.syncTmp(), limits, false, false)
	if err != nil {
		return err
	}
	defer opened.Close()

	h.versions.Checkpoint(project, q.user.ID, i18n.T(q.lang(), "Sebelum dipublikasikan dari aplikasi desktop"))
	ctx := q.r.Context()
	schema, err := h.userdb.MergeSchema(ctx, project.Slug, opened.Meta.Tables)
	if err != nil {
		return err
	}
	if err := bundle.Install(opened.Files, h.cfg.SiteRoot(project.Slug), true); err != nil {
		return err
	}
	h.versions.Checkpoint(project, q.user.ID, i18n.T(q.lang(), "Dipublikasikan dari aplikasi desktop"))
	for i, s := range schema.Changes {
		schema.Changes[i] = i18n.T(q.lang(), s)
	}
	for i, s := range schema.Warnings {
		schema.Warnings[i] = i18n.T(q.lang(), s)
	}
	return q.json(200, map[string]any{"project": h.public(project), "schema": schema})
}

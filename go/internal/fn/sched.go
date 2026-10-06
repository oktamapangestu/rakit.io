package fn

// Log eksekusi dan jadwal (cron) fungsi.

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/plans"
	"rakit.io/server/internal/store"
	"rakit.io/server/internal/userdb"
)

const keepLogs = 100

// CronMinutes: jarak minimal jadwal (menit) per paket; paket gratis tanpa jadwal.
var CronMinutes = map[string]int{"pro": 15, "unlimited": 5}

const maxSchedules = 10

// ---------- Log ----------

func (s *Service) record(t Target, name, trigger string, out *Outcome) {
	var errText, logs any
	if out.Error != "" {
		errText = out.Error
	}
	if out.Logs != "" {
		logs = out.Logs
	}
	res, err := s.db.Exec(`
		INSERT INTO fn_logs (project_id, name, trigger, dev, status, ms, error, logs, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, t.Project.ID, name, trigger, t.Dev, out.Status, out.Duration, errText, logs, time.Now().UnixMilli())
	if err != nil {
		log.Printf("fn: catat log %s/%s: %v", t.Project.Slug, name, err)
		return
	}
	if id, _ := res.LastInsertId(); id%10 == 0 {
		// Sesekali buang yang lama (lebih dari keepLogs terakhir).
		s.db.Exec(`DELETE FROM fn_logs WHERE project_id = ? AND id <= (
			SELECT id FROM fn_logs WHERE project_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`, t.Project.ID, t.Project.ID, keepLogs)
	}
}

type LogEntry struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	Trigger   string  `json:"trigger"`
	Dev       bool    `json:"dev"`
	Status    int     `json:"status"`
	Ms        int64   `json:"ms"`
	Error     *string `json:"error"`
	Logs      *string `json:"logs"`
	CreatedAt int64   `json:"createdAt"`
}

// Logs: eksekusi terbaru project (opsional hanya satu fungsi).
func (s *Service) Logs(p *store.Project, name string, limit int) ([]LogEntry, error) {
	if limit <= 0 || limit > keepLogs {
		limit = 50
	}
	rows, err := s.db.Query(`
		SELECT id, name, trigger, dev, status, ms, error, logs, created_at FROM fn_logs
		WHERE project_id = ? AND (? = '' OR name = ?) ORDER BY id DESC LIMIT ?`, p.ID, name, name, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LogEntry{}
	for rows.Next() {
		var e LogEntry
		var errText, logs sql.NullString
		if err := rows.Scan(&e.ID, &e.Name, &e.Trigger, &e.Dev, &e.Status, &e.Ms, &errText, &logs, &e.CreatedAt); err != nil {
			return nil, err
		}
		if errText.Valid {
			e.Error = &errText.String
		}
		if logs.Valid {
			e.Logs = &logs.String
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ---------- Jadwal ----------

// cronLimit: jarak minimal jadwal untuk akun ini (0 = paket tanpa jadwal) dan nama paketnya.
func (s *Service) cronLimit(userID int64) (time.Duration, string) {
	if plan := s.plans.Active(userID); plan != nil {
		return time.Duration(CronMinutes[plan.ID]) * time.Minute, plan.Name
	}
	return 0, "Gratis"
}

type Schedule struct {
	Cron       string  `json:"cron"`
	NextRunAt  *string `json:"nextRunAt"`
	LastRunAt  *int64  `json:"lastRunAt"`
	LastStatus *int    `json:"lastStatus"`
	Active     bool    `json:"active"`
	Note       string  `json:"note,omitempty"` // alasan tidak aktif
}

func (s *Service) schedules(p *store.Project) (map[string]*Schedule, error) {
	rows, err := s.db.Query("SELECT name, cron, last_run_at, last_status FROM fn_schedules WHERE project_id = ?", p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	limit, plan := s.cronLimit(p.UserID)
	out := map[string]*Schedule{}
	for rows.Next() {
		var name string
		var last, status sql.NullInt64
		sc := &Schedule{}
		if err := rows.Scan(&name, &sc.Cron, &last, &status); err != nil {
			return nil, err
		}
		if last.Valid {
			sc.LastRunAt = &last.Int64
		}
		if status.Valid {
			n := int(status.Int64)
			sc.LastStatus = &n
		}
		cron, err := ParseCron(sc.Cron)
		switch {
		case err != nil:
			sc.Note = err.Error()
		case limit == 0:
			sc.Note = "Jadwal hanya berjalan pada paket Pro/Unlimited"
		case cron.MinGap(time.Now()) < limit:
			sc.Note = "Terlalu sering untuk paket " + plan
		default:
			sc.Active = true
			if next := cron.Next(time.Now()); !next.IsZero() {
				iso := plans.ISO(next.UnixMilli())
				sc.NextRunAt = &iso
			}
		}
		out[name] = sc
	}
	return out, rows.Err()
}

// SetSchedule memasang jadwal untuk fungsi (cron 5 kolom, WIB). cron kosong = hapus jadwal.
func (s *Service) SetSchedule(p *store.Project, name, expr string) error {
	if !NameRE.MatchString(name) {
		return httpx.Errorf(404, "Fungsi tidak ditemukan")
	}
	expr = strings.Join(strings.Fields(expr), " ")
	if expr == "" {
		_, err := s.db.Exec("DELETE FROM fn_schedules WHERE project_id = ? AND name = ?", p.ID, name)
		return err
	}
	if _, err := os.Stat(filepath.Join(s.cfg.SiteRoot(p.Slug), Dir, name+".js")); err != nil {
		return httpx.Errorf(404, "Fungsi tidak ditemukan")
	}
	limit, plan := s.cronLimit(p.UserID)
	if limit == 0 {
		return &httpx.Error{Status: 403, Code: "fn_cron_plan", Message: "Jadwal fungsi tersedia untuk paket Pro dan Unlimited."}
	}
	cron, err := ParseCron(expr)
	if err != nil {
		return httpx.Errorf(400, "Jadwal tidak valid: %s", err.Error())
	}
	if cron.MinGap(time.Now()) < limit {
		return httpx.Errorf(400, "Paket %s: jadwal paling sering setiap %d menit", plan, int(limit/time.Minute))
	}
	var n int
	s.db.QueryRow("SELECT COUNT(*) FROM fn_schedules WHERE project_id = ? AND name != ?", p.ID, name).Scan(&n)
	if n >= maxSchedules {
		return httpx.Errorf(409, "Maksimal %d jadwal per project", maxSchedules)
	}
	_, err = s.db.Exec(`
		INSERT INTO fn_schedules (project_id, name, cron, created_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (project_id, name) DO UPDATE SET cron = excluded.cron`, p.ID, name, expr, time.Now().UnixMilli())
	return err
}

// ---------- Penjadwal ----------

var cronCache sync.Map // ekspresi -> *Cron (nil = tidak valid)

func cached(expr string) *Cron {
	if c, ok := cronCache.Load(expr); ok {
		return c.(*Cron)
	}
	c, err := ParseCron(expr)
	if err != nil {
		c = nil
	}
	cronCache.Store(expr, c)
	return c
}

// StartScheduler menjalankan jadwal tiap menit tepat (WIB) sampai ctx selesai.
func (s *Service) StartScheduler(ctx context.Context) {
	go func() {
		for {
			now := time.Now()
			next := now.Truncate(time.Minute).Add(time.Minute)
			select {
			case <-ctx.Done():
				return
			case <-time.After(next.Sub(now) + 200*time.Millisecond):
			}
			s.tick(ctx, next)
		}
	}()
}

type due struct {
	project store.Project
	name    string
}

// tick menjalankan jadwal yang jatuh pada menit `minute`.
func (s *Service) tick(ctx context.Context, minute time.Time) {
	rows, err := s.db.Query(`
		SELECT s.project_id, s.name, s.cron, COALESCE(s.last_run_at, 0), p.user_id, p.slug, p.publish_mode
		FROM fn_schedules s JOIN projects p ON p.id = s.project_id`)
	if err != nil {
		log.Printf("fn: baca jadwal: %v", err)
		return
	}
	var list []due
	for rows.Next() {
		var d due
		var expr string
		var last int64
		if rows.Scan(&d.project.ID, &d.name, &expr, &last, &d.project.UserID, &d.project.Slug, &d.project.Mode) != nil {
			continue
		}
		cron := cached(expr)
		// Sudah dijalankan di menit ini (mis. server baru dimulai ulang): lewati.
		if cron == nil || !cron.Match(minute) || last >= minute.UnixMilli() {
			continue
		}
		if limit, _ := s.cronLimit(d.project.UserID); limit == 0 || cron.MinGap(minute) < limit {
			continue // paket berubah: jadwal tidak lagi diizinkan
		}
		list = append(list, d)
	}
	rows.Close()
	for _, d := range list {
		go s.runScheduled(ctx, d.project, d.name, minute)
	}
}

// runScheduled menjalankan versi publik fungsi (prod pada publikasi manual).
func (s *Service) runScheduled(ctx context.Context, p store.Project, name string, minute time.Time) {
	s.db.Exec("UPDATE fn_schedules SET last_run_at = ? WHERE project_id = ? AND name = ?", minute.UnixMilli(), p.ID, name)
	t := Target{Project: &p, Root: s.cfg.SiteRoot(p.Slug), DBKey: p.Slug}
	if p.Manual() {
		t.Root, t.DBKey = s.cfg.PublishedRoot(p.Slug), userdb.ProdKey(p.Slug)
	}
	req := Request{
		Method: "CRON", Path: "/api/fn/" + name, Query: map[string]string{}, Headers: map[string]string{"x-rakit-cron": "1"},
		Body: map[string]any{"scheduledAt": plans.ISO(minute.UnixMilli())},
	}
	status := 0
	out, err := s.execute(ctx, t, name, req, "cron")
	var he *httpx.Error
	switch {
	case err == nil:
		status = out.Status
	case errors.As(err, &he):
		status = he.Status // mis. kuota habis atau fungsi belum dipublikasikan
		s.record(t, name, "cron", &Outcome{Status: he.Status, Error: he.Message, Headers: map[string]string{}})
	default:
		log.Printf("fn: jadwal %s/%s: %v", p.Slug, name, err)
		status = 500
	}
	s.db.Exec("UPDATE fn_schedules SET last_status = ? WHERE project_id = ? AND name = ?", status, p.ID, name)
}

// ---------- Konteks AI Builder ----------

const (
	aiRecentFailures = 5    // eksekusi gagal terbaru yang ikut ke AI
	aiFailureChars   = 1500 // potongan error + console per eksekusi
)

// AIContext: jadwal fungsi dan eksekusi gagal terbaru project (yang kodenya belum diubah sejak gagal), untuk konteks AI Builder — supaya
// permintaan seperti "perbaiki fungsi yang error" bisa dikerjakan tanpa pengguna menyalin log.
// Nilai rahasia tidak pernah ada di sini (hanya error & console keluaran kode fungsi sendiri).
func (s *Service) AIContext(slug string) (schedules, failures []string) {
	p, err := s.store.ProjectBySlug(slug)
	if err != nil || p == nil {
		return nil, nil
	}
	if list, err := s.schedules(p); err == nil {
		for name, sc := range list {
			line := fmt.Sprintf("%s: %q (WIB)", name, sc.Cron)
			if !sc.Active && sc.Note != "" {
				line += " — tidak berjalan: " + sc.Note
			}
			schedules = append(schedules, line)
		}
		sort.Strings(schedules)
	}
	rows, err := s.db.Query(`
		SELECT name, trigger, status, error, logs, created_at FROM fn_logs
		WHERE project_id = ? AND (status >= 500 OR error IS NOT NULL) ORDER BY id DESC LIMIT 20`, p.ID)
	if err != nil {
		return schedules, nil
	}
	defer rows.Close()
	for rows.Next() {
		var name, trigger string
		var status int
		var errText, logs sql.NullString
		var at int64
		if rows.Scan(&name, &trigger, &status, &errText, &logs, &at) != nil {
			continue
		}
		// Kode yang diubah setelah gagal (atau sudah dihapus) kemungkinan sudah diperbaiki: jangan dikejar AI.
		info, err := os.Stat(filepath.Join(s.cfg.SiteRoot(slug), Dir, name+".js"))
		if err != nil || info.ModTime().UnixMilli() > at {
			continue
		}
		text := strings.TrimSpace(errText.String)
		if l := strings.TrimSpace(logs.String); l != "" {
			text += "\nconsole:\n" + l
		}
		if r := []rune(text); len(r) > aiFailureChars {
			text = string(r[:aiFailureChars]) + "…"
		}
		when := time.UnixMilli(at).In(wib).Format("2006-01-02 15:04")
		if len(failures) == aiRecentFailures {
			break
		}
		failures = append(failures, fmt.Sprintf("- %s (%s, %s, status %d):\n%s", name, trigger, when, status, text))
	}
	return schedules, failures
}

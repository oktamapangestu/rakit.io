package fn

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rakit.io/server/internal/config"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/plans"
	"rakit.io/server/internal/store"
	"rakit.io/server/internal/userdb"
)

func setup(t *testing.T) (*Service, *store.Store, *store.Project) {
	t.Helper()
	dir := t.TempDir()
	cfg := &config.Config{DataDir: dir, BaseDomain: "localhost", Protocol: "http"}
	db, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := db.Migrate(); err != nil {
		t.Fatal(err)
	}
	p := plans.New(cfg, db)
	s := New(cfg, db, userdb.New(cfg, p), p)
	uid, _ := db.InsertUser("budi", "budi@x.id", "")
	db.InsertProject(uid, "toko", "toko")
	project, _ := db.ProjectBySlug("toko")
	write := func(root, code string) {
		os.MkdirAll(filepath.Join(root, Dir), 0o755)
		os.WriteFile(filepath.Join(root, Dir, "lapor.js"), []byte(code), 0o644)
	}
	write(cfg.SiteRoot("toko"), `export default (req) => { console.log('jalan', req.method, 'dev'); return 1 }`)
	write(cfg.PublishedRoot("toko"), `export default (req) => { console.log('jalan', req.method, 'prod'); return 1 }`)
	return s, db, project
}

func subscribe(db *store.Store, userID int64, plan string, expires int64) {
	db.DB().Exec("INSERT OR REPLACE INTO subscriptions (user_id, plan, started_at, expires_at, updated_at) VALUES (?, ?, 0, ?, 0)", userID, plan, expires)
}

// waitLogs menunggu log jadwal yang dijalankan di goroutine.
func waitLogs(t *testing.T, s *Service, p *store.Project, n int) []LogEntry {
	t.Helper()
	for i := 0; i < 100; i++ {
		logs, _ := s.Logs(p, "lapor", 50)
		if len(logs) >= n {
			return logs
		}
		time.Sleep(50 * time.Millisecond)
	}
	logs, _ := s.Logs(p, "lapor", 50)
	t.Fatalf("log jadwal tidak muncul: %d, mau %d", len(logs), n)
	return nil
}

func TestJadwal(t *testing.T) {
	s, db, p := setup(t)
	ctx := context.Background()

	var he *httpx.Error
	if err := s.SetSchedule(p, "lapor", "*/15 * * * *"); !errors.As(err, &he) || he.Code != "fn_cron_plan" {
		t.Fatalf("paket gratis: %v", err)
	}
	subscribe(db, p.UserID, "pro", time.Now().Add(time.Hour).UnixMilli())
	if err := s.SetSchedule(p, "lapor", "*/5 * * * *"); err == nil || !strings.Contains(err.Error(), "paling sering setiap 15 menit") {
		t.Fatalf("terlalu sering: %v", err)
	}
	if err := s.SetSchedule(p, "tidak-ada", "0 7 * * *"); err == nil {
		t.Fatal("fungsi yang tidak ada harus ditolak")
	}
	if err := s.SetSchedule(p, "lapor", "*/15 * * * *"); err != nil {
		t.Fatal(err)
	}
	ov, _ := s.Overview(p)
	if sc := ov.Functions[0].Schedule; sc == nil || !sc.Active || sc.NextRunAt == nil || ov.Cron.MinMinutes != 15 {
		t.Fatalf("overview: %+v cron=%+v", sc, ov.Cron)
	}

	// Menit yang tidak cocok: tidak jalan. Menit yang cocok: jalan sekali saja.
	s.tick(ctx, at("2026-10-02 10:07"))
	s.tick(ctx, at("2026-10-02 10:15"))
	logs := waitLogs(t, s, p, 1)
	s.tick(ctx, at("2026-10-02 10:15"))
	time.Sleep(300 * time.Millisecond)
	if logs, _ = s.Logs(p, "lapor", 50); len(logs) != 1 {
		t.Fatalf("jalan %d kali di menit yang sama", len(logs))
	}
	if l := logs[0]; l.Trigger != "cron" || l.Status != 200 || l.Dev || l.Logs == nil || *l.Logs != "jalan CRON dev\n" {
		t.Fatalf("log: %+v %q", l, *l.Logs)
	}

	// Publikasi manual: jadwal menjalankan versi publik (prod).
	db.SetPublishMode(p.ID, store.ModeManual, 1)
	s.tick(ctx, at("2026-10-02 10:30"))
	if logs = waitLogs(t, s, p, 2); *logs[0].Logs != "jalan CRON prod\n" {
		t.Fatalf("manual: %q", *logs[0].Logs)
	}

	// Langganan berakhir: jadwal berhenti (tetap tersimpan, ditandai tidak aktif).
	subscribe(db, p.UserID, "pro", time.Now().Add(-time.Hour).UnixMilli())
	s.tick(ctx, at("2026-10-02 10:45"))
	time.Sleep(300 * time.Millisecond)
	if logs, _ = s.Logs(p, "lapor", 50); len(logs) != 2 {
		t.Fatalf("tetap jalan setelah langganan berakhir: %d", len(logs))
	}
	ov, _ = s.Overview(p)
	if sc := ov.Functions[0].Schedule; sc.Active || sc.Note != "Jadwal hanya berjalan pada paket Pro/Unlimited" {
		t.Fatalf("setelah berakhir: %+v", sc)
	}
	if err := s.SetSchedule(p, "lapor", ""); err != nil {
		t.Fatal(err)
	}
	if ov, _ = s.Overview(p); ov.Functions[0].Schedule != nil {
		t.Fatal("jadwal tidak terhapus")
	}
}

package fn

import (
	"strings"
	"testing"
	"time"
)

func at(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, wib)
	if err != nil {
		panic(err)
	}
	return t
}

func TestCron(t *testing.T) {
	cases := []struct {
		expr, from, next string
		gap              time.Duration
	}{
		{"0 7 * * *", "2026-10-02 07:00", "2026-10-03 07:00", 24 * time.Hour},
		{"*/15 * * * *", "2026-10-02 10:07", "2026-10-02 10:15", 15 * time.Minute},
		{"30 8 * * 1", "2026-10-02 09:00", "2026-10-05 08:30", 0}, // 2 Okt 2026 = Jumat; mingguan: jarak > jendela 8 hari
		{"0 9 * * 1-5", "2026-10-02 10:00", "2026-10-05 09:00", 24 * time.Hour},
		{"0 0 1 * *", "2026-10-02 00:00", "2026-11-01 00:00", 0},
		{"0 12 * * 7", "2026-10-02 00:00", "2026-10-04 12:00", 0}, // 7 = Minggu
		{"5/20 * * * *", "2026-10-02 10:06", "2026-10-02 10:25", 20 * time.Minute},
		{"0 8,17 * * *", "2026-10-02 09:00", "2026-10-02 17:00", 9 * time.Hour},
		// Tanggal & hari sama-sama dibatasi: salah satu cocok (tanggal 15 ATAU Senin).
		{"0 6 15 * 1", "2026-10-06 00:00", "2026-10-12 06:00", 0},
	}
	for _, c := range cases {
		cron, err := ParseCron(c.expr)
		if err != nil {
			t.Fatalf("%s: %v", c.expr, err)
		}
		if got := cron.Next(at(c.from)).Format("2006-01-02 15:04"); got != c.next {
			t.Errorf("%s dari %s: Next = %s, mau %s", c.expr, c.from, got, c.next)
		}
		if c.gap > 0 {
			if got := cron.MinGap(at(c.from)); got != c.gap {
				t.Errorf("%s: MinGap = %v, mau %v", c.expr, got, c.gap)
			}
		}
	}
	for expr, want := range map[string]string{
		"* * * *":     "5 kolom",
		"60 * * * *":  "kolom menit harus 0–59",
		"0 24 * * *":  "kolom jam harus 0–23",
		"*/0 * * * *": "langkah",
		"x * * * *":   "tidak valid",
		"0 0 30 2 *":  "tidak pernah terjadi",
		"0 0 * 13 *":  "kolom bulan harus 1–12",
		"5-1 * * * *": "kolom menit harus 0–59",
		"0 7 * * 8":   "kolom hari harus 0–7",
		"0 7 * * mon": "tidak valid",
	} {
		if _, err := ParseCron(expr); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%q: err = %v, mau memuat %q", expr, err, want)
		}
	}
}

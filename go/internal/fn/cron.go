package fn

// Jadwal fungsi: ekspresi cron 5 kolom (menit jam tanggal bulan hari-minggu) dalam WIB, mis.
// "0 7 * * *" = setiap hari 07.00, "*/15 * * * *" = tiap 15 menit, "30 8 * * 1" = Senin 08.30.

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

var wib = time.FixedZone("WIB", 7*60*60)

type cronField struct {
	allowed [61]bool
	star    bool
}

// Cron: jadwal yang sudah dibaca.
type Cron struct {
	minute, hour, dom, month, dow cronField
}

var fieldRange = [5][2]int{{0, 59}, {0, 23}, {1, 31}, {1, 12}, {0, 7}}
var fieldName = [5]string{"menit", "jam", "tanggal", "bulan", "hari"}

func parseField(text string, idx int) (cronField, error) {
	lo, hi := fieldRange[idx][0], fieldRange[idx][1]
	var f cronField
	f.star = text == "*"
	for _, part := range strings.Split(text, ",") {
		step := 1
		if base, s, ok := strings.Cut(part, "/"); ok {
			n, err := strconv.Atoi(s)
			if err != nil || n < 1 || n > hi {
				return f, fmt.Errorf("langkah %q pada kolom %s tidak valid", s, fieldName[idx])
			}
			part, step = base, n
		}
		from, to := lo, hi
		if part != "*" {
			a, b, isRange := strings.Cut(part, "-")
			x, err := strconv.Atoi(a)
			if err != nil {
				return f, fmt.Errorf("nilai %q pada kolom %s tidak valid", part, fieldName[idx])
			}
			from, to = x, x
			if isRange {
				if to, err = strconv.Atoi(b); err != nil {
					return f, fmt.Errorf("nilai %q pada kolom %s tidak valid", part, fieldName[idx])
				}
			} else if step > 1 {
				to = hi // "5/15" = mulai 5, tiap 15
			}
		}
		if from < lo || to > hi || from > to {
			return f, fmt.Errorf("kolom %s harus %d–%d", fieldName[idx], lo, hi)
		}
		for v := from; v <= to; v += step {
			f.allowed[v] = true
		}
	}
	if idx == 4 && f.allowed[7] { // 7 = Minggu, sama dengan 0
		f.allowed[0] = true
	}
	return f, nil
}

// ParseCron membaca ekspresi cron 5 kolom.
func ParseCron(expr string) (*Cron, error) {
	parts := strings.Fields(expr)
	if len(parts) != 5 {
		return nil, errors.New("jadwal harus 5 kolom: menit jam tanggal bulan hari (mis. 0 7 * * *)")
	}
	var fields [5]cronField
	for i, p := range parts {
		f, err := parseField(p, i)
		if err != nil {
			return nil, err
		}
		fields[i] = f
	}
	c := &Cron{fields[0], fields[1], fields[2], fields[3], fields[4]}
	if c.Next(time.Now()).IsZero() {
		return nil, errors.New("jadwal ini tidak pernah terjadi (periksa tanggal & bulan)")
	}
	return c, nil
}

// Match: apakah menit t (WIB) termasuk jadwal. Seperti cron biasa: bila tanggal dan hari sama-sama
// dibatasi, cukup salah satu yang cocok.
func (c *Cron) Match(t time.Time) bool {
	t = t.In(wib)
	if !c.minute.allowed[t.Minute()] || !c.hour.allowed[t.Hour()] || !c.month.allowed[int(t.Month())] {
		return false
	}
	dom, dow := c.dom.allowed[t.Day()], c.dow.allowed[int(t.Weekday())]
	if !c.dom.star && !c.dow.star {
		return dom || dow
	}
	return dom && dow
}

// Next: menit pertama setelah from yang cocok (dicari hingga 1 tahun ke depan); nol bila tidak ada.
func (c *Cron) Next(from time.Time) time.Time {
	t := from.In(wib).Truncate(time.Minute).Add(time.Minute)
	for end := t.AddDate(1, 0, 1); t.Before(end); t = t.Add(time.Minute) {
		if c.Match(t) {
			return t
		}
	}
	return time.Time{}
}

// MinGap: jarak terpendek antar-eksekusi berurutan dalam 8 hari ke depan (untuk batas paket).
func (c *Cron) MinGap(from time.Time) time.Duration {
	var prev time.Time
	gap := time.Duration(1<<63 - 1)
	t := from.In(wib).Truncate(time.Minute)
	for end := t.Add(8 * 24 * time.Hour); t.Before(end); t = t.Add(time.Minute) {
		if c.Match(t) {
			if !prev.IsZero() && t.Sub(prev) < gap {
				gap = t.Sub(prev)
			}
			prev = t
		}
	}
	return gap
}

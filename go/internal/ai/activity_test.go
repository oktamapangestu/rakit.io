package ai

import (
	"fmt"
	"strings"
	"testing"
)

func TestJSONStringStreamed(t *testing.T) {
	raw := `{"path": "index.html", "content": "<h1 class=\"judul\">Halo 👋é😀</h1>\n\\ok"}`
	// Dipotong di setiap posisi (termasuk di tengah escape & karakter UTF-8): hasil gabungannya tetap sama.
	for step := 1; step <= 7; step++ {
		var s jsonString
		var got strings.Builder
		for end := 0; end <= len(raw); end += step {
			got.WriteString(s.feed(raw[:end], "content"))
		}
		got.WriteString(s.feed(raw, "content"))
		if want := "<h1 class=\"judul\">Halo 👋é😀</h1>\n\\ok"; got.String() != want || !s.done {
			t.Fatalf("step %d: %q (done=%v), mau %q", step, got.String(), s.done, want)
		}
	}
}

func TestJSONFieldIgnoresKeyInsideString(t *testing.T) {
	if v, done := jsonField(`{"content": "x \"path\": \"salah\"", "path": "benar.html"}`, "path"); v != "benar.html" || !done {
		t.Fatalf("dapat %q %v", v, done)
	}
	if v, done := jsonField(`{"path": "ind`, "path"); v != "ind" || done {
		t.Fatalf("belum lengkap: dapat %q %v", v, done)
	}
}

func TestActivitySteps(t *testing.T) {
	var events []event
	a := newActivity(func(ev event) { events = append(events, ev) })
	a.start()
	a.reasoning("Pengguna minta ")
	a.reasoning("halaman menu.")
	a.toolDelta(0, "write_file", `{"path": "me`)
	a.toolDelta(0, "", `nu.html", "content": "<p>`)
	a.toolDelta(0, "", `Kopi</p>"}`)
	a.toolDelta(1, "create_table", `{"name": "produk", "columns": []}`)
	a.toolResult(0, toolCall{Name: "write_file"}, `Ditulis, TAPI ada masalah kualitas di "menu.html": 1 tautan <a href="#"> tidak menuju apa pun. Perbaiki lalu panggil write_file lagi.`)
	a.toolResult(1, toolCall{Name: "create_table"}, `OK: tabel "produk" akan dibuat/diperbarui.`)
	a.start() // putaran berikutnya
	a.toolDelta(0, "write_file", `{"path": "menu.html", "content": "<p>Ko`)
	a.start() // coba ulang di tengah jalan: langkah yang terputus dibatalkan
	a.flush()

	var got []string
	for _, ev := range events {
		line := ev["type"].(string)
		for _, k := range []string{"id", "tool", "target", "state", "text", "note"} {
			if v, ok := ev[k]; ok && v != "" {
				line += " " + k + "=" + strings.TrimSpace(strings.ReplaceAll(fmt.Sprint(v), "\n", " "))
			}
		}
		got = append(got, line)
	}
	want := []string{
		"reasoning text=Pengguna minta", // potongan pertama langsung dikirim, sisanya dikumpulkan
		"reasoning text=halaman menu.",
		"step id=1 tool=write_file target=menu.html state=run",
		"draft id=1 text=<p>Kopi</p>",
		"step id=2 tool=create_table target=produk state=run",
		`step id=1 state=warn note=1 tautan <a href="#"> tidak menuju apa pun`,
		"step id=2 state=ok",
		"round",
		"step id=3 tool=write_file target=menu.html state=run",
		"draft id=3 text=<p>Ko",
		"step id=3 state=cancel",
		"round",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("event:\n%s\n\nmau:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

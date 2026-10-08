package ai

import (
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

// activity: apa yang sedang dikerjakan AI, dikirim ke editor sebagai event selama job berjalan.
//
//	{type: "reasoning", text}   potongan proses berpikir model (reasoning_content)
//	{type: "say", text}         potongan teks jawaban model
//	{type: "round"}             model dipanggil lagi (putaran Builder berikutnya)
//	{type: "step", id, tool, target, state: "run"|"ok"|"warn"|"error", note}
//	{type: "draft", id, text}   potongan isi file yang sedang ditulis langkah id
//	{type: "note", text}        pemeriksaan server (mis. memperbaiki pemakaian API database)
//
// Potongan teks dikumpulkan dulu supaya tidak mengirim satu event per token.
type activity struct {
	send  func(event)
	seq   int                // nomor langkah; unik selama job (panggilan yang diulang = langkah baru)
	dirty bool               // sudah ada yang dikirim sejak model terakhir mulai dipanggil
	calls map[int]*toolDraft // tool call putaran ini, per index stream

	kind     string // potongan yang sedang dikumpulkan: "reasoning" | "say" | "draft"
	draftID  int
	pending  strings.Builder
	lastSent time.Time
}

type toolDraft struct {
	index, id int
	name      string
	args      string
	target    string // path file atau nama tabel
	started   bool
	content   jsonString // isi write_file yang sudah dibaca dari argumen
}

const (
	activityChunk = 400
	activityEvery = 150 * time.Millisecond
)

func newActivity(send func(event)) *activity {
	return &activity{send: send, calls: map[int]*toolDraft{}}
}

func (a *activity) add(kind string, id int, text string) {
	if text == "" {
		return
	}
	if a.pending.Len() > 0 && (a.kind != kind || a.draftID != id) {
		a.flush()
	}
	a.kind, a.draftID = kind, id
	a.pending.WriteString(text)
	if a.pending.Len() >= activityChunk || time.Since(a.lastSent) >= activityEvery {
		a.flush()
	}
}

func (a *activity) flush() {
	if a.pending.Len() == 0 {
		return
	}
	ev := event{"type": a.kind, "text": a.pending.String()}
	if a.kind == "draft" {
		ev["id"] = a.draftID
	}
	a.pending.Reset()
	a.lastSent = time.Now()
	a.dirty = true
	a.send(ev)
}

func (a *activity) emit(ev event) {
	a.flush()
	a.dirty = true
	a.send(ev)
}

func (a *activity) reasoning(text string) { a.add("reasoning", 0, text) }
func (a *activity) say(text string)       { a.add("say", 0, text) }

// start: model mulai dipanggil (putaran Builder berikutnya, coba ulang, atau model cadangan). Langkah yang
// belum selesai dari percobaan sebelumnya (terputus) ditandai batal.
func (a *activity) start() {
	for _, d := range a.calls {
		if d.started {
			a.emit(event{"type": "step", "id": d.id, "state": "cancel"})
		}
	}
	a.calls = map[int]*toolDraft{}
	if a.dirty {
		a.flush()
		a.send(event{"type": "round"})
		a.dirty = false
	}
}

func (a *activity) toolDelta(index int, name, args string) {
	d := a.calls[index]
	if d == nil {
		d = &toolDraft{index: index}
		a.calls[index] = d
	}
	if name != "" {
		d.name = name
	}
	d.args += args
	if !d.started {
		key := "path"
		if d.name == "create_table" {
			key = "name"
		}
		value, done := jsonField(d.args, key)
		if !done || d.name == "" {
			return
		}
		a.seq++
		d.id, d.target, d.started = a.seq, value, true
		a.emit(event{"type": "step", "id": d.id, "tool": d.name, "target": d.target, "state": "run"})
	}
	if d.name == "write_file" {
		if text := d.content.feed(d.args, "content"); text != "" {
			a.add("draft", d.id, text)
		}
	}
}

// toolResult: hasil stageToolCall untuk tool call ke-n (urut index stream, sama dengan reply.ToolCalls).
func (a *activity) toolResult(n int, call toolCall, result string) {
	indexes := make([]int, 0, len(a.calls))
	for i := range a.calls {
		indexes = append(indexes, i)
	}
	sort.Ints(indexes)
	var d *toolDraft
	if n < len(indexes) {
		d = a.calls[indexes[n]]
	}
	if d == nil || !d.started {
		// Nama/path tidak terbaca selama stream (argumen rusak): tetap tampilkan langkahnya.
		a.seq++
		d = &toolDraft{id: a.seq, name: call.Name, started: true}
		d.target, _ = jsonField(call.Arguments, map[bool]string{true: "name", false: "path"}[call.Name == "create_table"])
		a.emit(event{"type": "step", "id": d.id, "tool": d.name, "target": d.target, "state": "run"})
	}
	state, note := "ok", ""
	switch {
	case strings.HasPrefix(result, "Error:"):
		state, note = "error", strings.TrimSpace(strings.TrimPrefix(result, "Error:"))
	case strings.HasPrefix(result, "Ditulis, TAPI"):
		state, note = "warn", result
		if _, problem, found := strings.Cut(result, ": "); found {
			note = strings.TrimSuffix(strings.TrimSpace(strings.SplitN(problem, ". Perbaiki", 2)[0]), ".")
		}
	}
	d.started = false // sudah selesai: tidak dibatalkan oleh start()
	a.emit(event{"type": "step", "id": d.id, "state": state, "note": note})
}

func (a *activity) note(text string) { a.emit(event{"type": "note", "text": text}) }

// ---------- Membaca argumen JSON yang belum lengkap ----------

// jsonField: nilai string kunci `key` di objek JSON yang mungkin belum lengkap. done = string-nya sudah
// ditutup.
func jsonField(raw, key string) (string, bool) {
	var s jsonString
	text := s.feed(raw, key)
	return text, s.done
}

// jsonString membaca nilai string sebuah kunci sedikit demi sedikit, selagi argumennya masih mengalir.
type jsonString struct {
	start int // posisi sesudah tanda kutip pembuka nilai (0 = belum ketemu)
	pos   int // posisi berikutnya yang dibaca
	done  bool
}

// feed membaca raw (seluruh argumen sejauh ini) dan mengembalikan teks baru sejak pemanggilan sebelumnya.
func (s *jsonString) feed(raw, key string) string {
	if s.done {
		return ""
	}
	if s.start == 0 {
		s.start = valueStart(raw, key)
		if s.start == 0 {
			return ""
		}
		s.pos = s.start
	}
	var out strings.Builder
	for s.pos < len(raw) {
		c := raw[s.pos]
		if c == '"' {
			s.done = true
			s.pos++
			break
		}
		if c != '\\' {
			_, size := utf8.DecodeRuneInString(raw[s.pos:])
			if size == 1 && c >= 0x80 && !utf8.FullRuneInString(raw[s.pos:]) {
				break // karakter UTF-8 terpotong: tunggu sisanya
			}
			out.WriteString(raw[s.pos : s.pos+size])
			s.pos += size
			continue
		}
		if s.pos+1 >= len(raw) {
			break
		}
		switch esc := raw[s.pos+1]; esc {
		case 'n':
			out.WriteByte('\n')
		case 't':
			out.WriteByte('\t')
		case 'r':
			out.WriteByte('\r')
		case 'b':
			out.WriteByte('\b')
		case 'f':
			out.WriteByte('\f')
		case 'u':
			r, n := unicodeEscape(raw[s.pos:])
			if n == 0 {
				return out.String() // \uXXXX belum lengkap
			}
			out.WriteRune(r)
			s.pos += n
			continue
		default: // \" \\ \/
			out.WriteByte(esc)
		}
		s.pos += 2
	}
	return out.String()
}

// valueStart: posisi sesudah `"key"\s*:\s*"` (kunci yang bukan bagian dari string lain), atau 0.
func valueStart(raw, key string) int {
	needle := `"` + key + `"`
	for from := 0; ; {
		i := strings.Index(raw[from:], needle)
		if i < 0 {
			return 0
		}
		i += from
		from = i + len(needle)
		if i > 0 && raw[i-1] == '\\' {
			continue
		}
		j := from
		for j < len(raw) && strings.IndexByte(" \t\r\n", raw[j]) >= 0 {
			j++
		}
		if j >= len(raw) || raw[j] != ':' {
			continue
		}
		j++
		for j < len(raw) && strings.IndexByte(" \t\r\n", raw[j]) >= 0 {
			j++
		}
		if j < len(raw) && raw[j] == '"' {
			return j + 1
		}
		return 0
	}
}

// unicodeEscape membaca \uXXXX (dengan pasangan surrogate) di awal s: rune & panjangnya, atau 0 bila belum lengkap.
func unicodeEscape(s string) (rune, int) {
	if len(s) < 6 {
		return 0, 0
	}
	v, err := strconv.ParseUint(s[2:6], 16, 32)
	if err != nil {
		return utf8.RuneError, 6
	}
	r := rune(v)
	if !utf16.IsSurrogate(r) {
		return r, 6
	}
	if len(s) < 12 {
		return 0, 0
	}
	if s[6] != '\\' || s[7] != 'u' {
		return utf8.RuneError, 6
	}
	low, err := strconv.ParseUint(s[8:12], 16, 32)
	if err != nil {
		return utf8.RuneError, 6
	}
	return utf16.DecodeRune(r, rune(low)), 12
}

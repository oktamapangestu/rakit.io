// Package jscheck memeriksa sintaks JavaScript tanpa menjalankannya: kode dikompilasi QuickJS (yang sama dengan
// fungsi serverless, third_party/qjs) di runtime baru yang langsung ditutup. Dipakai AI Builder untuk menolak
// file JS yang tidak akan bisa dijalankan browser sebelum disimpan.
package jscheck

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/fastschema/qjs"
)

// Kind: cara kode dimuat. Script = <script> klasik di browser (tidak strict), Module = <script type="module">
// atau fungsi serverless (strict, boleh import/export dan await di tingkat atas).
type Kind int

const (
	Script Kind = iota
	Module
)

// Error: kesalahan sintaks beserta posisinya (baris 1 = baris pertama kode yang diperiksa).
type Error struct {
	Message string
	Line    int
	Column  int
}

func (e *Error) Error() string {
	if e.Line > 0 {
		return fmt.Sprintf("baris %d: %s", e.Line, e.Message)
	}
	return e.Message
}

const (
	checkTimeout = 5 * time.Second
	memoryPages  = 512 // 32 MiB: hanya parsing, tidak ada kode yang dijalankan
)

// sem membatasi pemeriksaan yang berjalan bersamaan (setiap pemeriksaan memakai runtime WebAssembly sendiri).
var sem = make(chan struct{}, 4)

// "    at app.js:12:5" di jejak QuickJS.
var posRE = regexp.MustCompile(`at [^\n]*?:(\d+):(\d+)`)

// Check mengompilasi code. nil = sintaksnya sah. Error lain (runtime tidak bisa dibuat, batas waktu) juga nil:
// pemeriksaan ini pembantu, bukan penentu, jadi kegagalannya sendiri tidak boleh menolak kode.
func Check(code string, kind Kind, file string) *Error {
	if strings.TrimSpace(code) == "" {
		return nil
	}
	sem <- struct{}{}
	defer func() { <-sem }()
	ctx, cancel := context.WithTimeout(context.Background(), checkTimeout)
	defer cancel()
	return compile(ctx, code, kind, file)
}

func compile(ctx context.Context, code string, kind Kind, file string) (out *Error) {
	defer func() {
		if r := recover(); r != nil {
			out = nil
		}
	}()
	rt, err := qjs.New(qjs.Option{Context: ctx, CloseOnContextDone: true, NoFS: true, MemoryLimitPages: memoryPages})
	if err != nil {
		return nil
	}
	defer func() {
		defer func() { recover() }()
		rt.Close()
	}()
	opts := []qjs.EvalOptionFunc{qjs.Code(code)}
	if kind == Module {
		opts = append(opts, qjs.TypeModule())
	} else {
		opts = append(opts, qjs.NoStrict())
	}
	if _, err := rt.Context().Compile(file, opts...); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return parse(err.Error())
	}
	return nil
}

// parse mengubah pesan QuickJS ("SyntaxError: unexpected token in expression: '}'\n    at app.js:3:1") menjadi
// Error.
func parse(msg string) *Error {
	first, _, _ := strings.Cut(msg, "\n")
	if !strings.Contains(first, "SyntaxError") {
		// Bukan kesalahan sintaks (mis. kehabisan memori saat parsing): jangan dilaporkan sebagai kode yang salah.
		return nil
	}
	e := &Error{Message: strings.TrimSpace(first[strings.Index(first, "SyntaxError"):])}
	if m := posRE.FindStringSubmatch(msg); m != nil {
		e.Line, _ = strconv.Atoi(m[1])
		e.Column, _ = strconv.Atoi(m[2])
	}
	return e
}

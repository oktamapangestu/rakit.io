package fn

// Mesin eksekusi fungsi: QuickJS di WebAssembly (third_party/qjs, dengan tambalan), satu runtime baru per
// eksekusi. Pengaman sandbox (diuji di engine_test.go):
//   - tanpa folder terpasang (NoFS): modul std/os tidak bisa membaca/menulis file server
//   - tanpa variabel lingkungan & tanpa proses (WASI tanpa env; exec/popen tidak ada)
//   - batas memori keras WebAssembly (memoryPages) + batas memori QuickJS
//   - batas waktu lewat context (CloseOnContextDone): loop tanpa akhir dihentikan
//   - panic dari library (mis. std.exit) dipulihkan; tidak pernah menjatuhkan server

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/fastschema/qjs"
)

//go:embed prelude.js
var prelude string

const (
	memoryPages = 1024     // 64 MiB memori WebAssembly per eksekusi
	jsMemory    = 48 << 20 // batas heap QuickJS
	jsStack     = 512 << 10
	maxLogBytes = 16 << 10
)

// Request: request HTTP yang diteruskan ke fungsi.
type Request struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Query   map[string]string `json:"query"`
	Headers map[string]string `json:"headers"`
	Body    any               `json:"body"` // JSON yang sudah dibaca, atau teks
	Text    string            `json:"text"`
}

// Result: jawaban fungsi.
type Result struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
	JSON    bool              `json:"json"`
}

// Host: layanan yang boleh dipanggil fungsi (db.*, fetch). Mengembalikan nilai (di-JSON-kan) atau error
// yang pesannya diteruskan ke kode fungsi.
type Host func(ctx context.Context, op string, args []json.RawMessage) (any, error)

// Kesalahan eksekusi yang dibedakan untuk pesan ke pengguna.
var (
	ErrTimeout = errors.New("fungsi melebihi batas waktu")
	ErrMemory  = errors.New("fungsi kehabisan memori")
)

// limitedLog: tangkapan console.log/print, dipotong di maxLogBytes.
type limitedLog struct {
	mu  sync.Mutex
	buf strings.Builder
}

func (l *limitedLog) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if room := maxLogBytes - l.buf.Len(); room > 0 {
		if len(p) > room {
			l.buf.Write(p[:room])
			l.buf.WriteString("\n… (log dipotong)")
		} else {
			l.buf.Write(p)
		}
	}
	return len(p), nil
}

func (l *limitedLog) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

var warmOnce sync.Once

// Warm mengompilasi modul QuickJS sekali (±0,5 detik) supaya eksekusi pertama tidak lambat.
func Warm() {
	warmOnce.Do(func() {
		_, _, _ = Run(context.Background(), "export default () => 1", Request{}, nil, nil, "warm.js")
	})
}

// Run menjalankan kode fungsi (modul dengan export default) untuk satu request. ctx menentukan batas
// waktu. logs berisi keluaran console.log/print.
func Run(ctx context.Context, code string, req Request, env map[string]string, host Host, file string) (res *Result, logs string, err error) {
	log := &limitedLog{}
	defer func() {
		if r := recover(); r != nil {
			res, err = nil, classify(ctx, fmt.Errorf("%v", r))
		}
		logs = log.String()
	}()

	rt, err := qjs.New(qjs.Option{
		Context: ctx, CloseOnContextDone: true,
		NoFS: true, MemoryLimitPages: memoryPages,
		MemoryLimit: jsMemory, MaxStackSize: jsStack,
		Stdout: log, Stderr: log,
	})
	if err != nil {
		return nil, "", classify(ctx, err)
	}
	defer func() {
		// Runtime yang dihentikan paksa (batas waktu/exit) bisa panic saat ditutup.
		defer func() { recover() }()
		rt.Close()
	}()
	js := rt.Context()

	js.SetFunc("__rakit", func(this *qjs.This) (*qjs.Value, error) {
		args := this.Args()
		reply := map[string]any{}
		if host == nil || len(args) < 2 {
			reply["error"] = "layanan tidak tersedia"
		} else {
			var list []json.RawMessage
			if err := json.Unmarshal([]byte(args[1].String()), &list); err != nil {
				reply["error"] = "argumen tidak valid"
			} else if value, err := host(ctx, args[0].String(), list); err != nil {
				reply["error"] = err.Error()
			} else {
				reply["value"] = value
			}
		}
		raw, err := json.Marshal(reply)
		if err != nil {
			raw = []byte(`{"error":"hasil tidak bisa dibaca"}`)
		}
		return this.Context().NewString(string(raw)), nil
	})
	envJSON, _ := json.Marshal(env)
	if env == nil {
		envJSON = []byte("{}")
	}
	js.Global().SetPropertyStr("__env", js.NewString(string(envJSON)))
	if v, err := js.Eval("prelude.js", qjs.Code(prelude)); err != nil {
		return nil, "", classify(ctx, err)
	} else {
		v.Free()
	}

	handler, err := js.Eval(file, qjs.Code(code), qjs.TypeModule())
	if err != nil {
		return nil, "", classify(ctx, err)
	}
	js.Global().SetPropertyStr("__handler", handler)
	reqJSON, _ := json.Marshal(req)
	js.Global().SetPropertyStr("__req", js.NewString(string(reqJSON)))

	// Eval menjalankan event loop sampai promise __run selesai (fungsi async, db, fetch).
	out, err := js.Eval("run.js", qjs.Code("__run(__handler, __req)"))
	if err != nil {
		return nil, "", classify(ctx, err)
	}
	if out.IsPromise() {
		awaited, err := out.Await()
		out.Free()
		if err != nil {
			return nil, "", classify(ctx, err)
		}
		out = awaited
	}
	defer out.Free()
	res = &Result{}
	if err := json.Unmarshal([]byte(out.String()), res); err != nil {
		return nil, "", fmt.Errorf("jawaban fungsi tidak bisa dibaca: %w", err)
	}
	return res, "", nil
}

// classify membedakan batas waktu & kehabisan memori dari kesalahan kode biasa.
func classify(ctx context.Context, err error) error {
	msg := err.Error()
	switch {
	case ctx.Err() != nil || strings.Contains(msg, "module closed with context"):
		return ErrTimeout
	case strings.Contains(msg, "out of memory"):
		return ErrMemory
	case strings.Contains(msg, "exit_code"):
		return errors.New("fungsi menghentikan dirinya sendiri (exit)")
	}
	// Pesan JS: "Error: …" beserta jejak stack dari QuickJS; cukup baris pertama.
	if i := strings.IndexByte(msg, '\n'); i > 0 {
		msg = msg[:i]
	}
	return errors.New(strings.TrimSpace(msg))
}

package fn

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func exec(t *testing.T, timeout time.Duration, code string, host Host) (*Result, string, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req := Request{Method: "POST", Path: "/api/fn/uji", Query: map[string]string{"q": "1"}, Headers: map[string]string{"x-a": "b"}, Body: map[string]any{"nama": "Ani"}, Text: `{"nama":"Ani"}`}
	return Run(ctx, code, req, map[string]string{"TOKEN": "rahasia"}, host, "functions/uji.js")
}

func TestJalankanFungsi(t *testing.T) {
	cases := []struct {
		name, code string
		want       Result
	}{
		{"objek -> JSON", `export default async (req, { env }) => ({ halo: req.body.nama, method: req.method, q: req.query.q, h: req.headers['x-a'], token: env.TOKEN })`,
			Result{200, map[string]string{}, `{"halo":"Ani","method":"POST","q":"1","h":"b","token":"rahasia"}`, true}},
		{"Response teks", `export default () => new Response('<b>hai</b>', { status: 201, headers: { 'content-type': 'text/html' } })`,
			Result{201, map[string]string{"content-type": "text/html"}, `<b>hai</b>`, false}},
		{"Response.json", `export default () => Response.json({ ok: 1 }, { status: 400 })`,
			Result{400, map[string]string{"content-type": "application/json; charset=utf-8"}, `{"ok":1}`, true}},
		{"tanpa nilai", `export default async () => {}`, Result{204, map[string]string{}, ``, false}},
		{"req.json()", `export default async (req) => (await req.json()).nama + (await req.text()).length`, Result{200, map[string]string{}, `"Ani14"`, true}},
		{"env beku", `export default (req, { env }) => { try { env.TOKEN = 'x' } catch (e) { return 'ditolak' } return env.TOKEN }`, Result{200, map[string]string{}, `"ditolak"`, true}},
	}
	for _, c := range cases {
		got, _, err := exec(t, 5*time.Second, c.code, nil)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		if raw, want := mustJSON(got), mustJSON(c.want); raw != want {
			t.Errorf("%s:\n dapat %s\n mau   %s", c.name, raw, want)
		}
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

func TestHost(t *testing.T) {
	var calls []string
	host := func(_ context.Context, op string, args []json.RawMessage) (any, error) {
		parts := []string{op}
		for _, a := range args {
			parts = append(parts, string(a))
		}
		calls = append(calls, strings.Join(parts, " "))
		switch op {
		case "db.insert":
			return map[string]any{"id": 7}, nil
		case "db.get":
			return nil, errors.New(`Tabel "x" tidak ditemukan`)
		case "fetch":
			return map[string]any{"status": 200, "headers": map[string]string{"content-type": "application/json"}, "body": `{"ok":true}`}, nil
		}
		return nil, errors.New("?")
	}
	code := `export default async (req, { db, fetch }) => {
		const row = await db.insert('pesan', { isi: 'hai', n: 1 });
		let err; try { await db.get('x', 1) } catch (e) { err = e.message }
		const r = await fetch('https://api.contoh.id/kirim', { method: 'POST', body: { a: 1 }, headers: { 'x-k': 'v' } });
		return { id: row.id, err, ok: r.ok, ct: r.headers.get('Content-Type'), data: await r.json() };
	}`
	got, _, err := exec(t, 5*time.Second, code, host)
	if err != nil {
		t.Fatal(err)
	}
	if got.Body != `{"id":7,"err":"Tabel \"x\" tidak ditemukan","ok":true,"ct":"application/json","data":{"ok":true}}` {
		t.Fatalf("body = %s", got.Body)
	}
	want := []string{`db.insert "pesan" {"isi":"hai","n":1}`, `db.get "x" 1`, `fetch "https://api.contoh.id/kirim" {"method":"POST","headers":{"x-k":"v"},"body":"{\"a\":1}"}`}
	if strings.Join(calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("calls =\n%s", strings.Join(calls, "\n"))
	}
}

func TestKesalahanDanLog(t *testing.T) {
	_, logs, err := exec(t, 5*time.Second, `export default () => { console.log('mulai', 1); throw new Error('stok habis') }`, nil)
	if err == nil || err.Error() != "Error: stok habis" || !strings.Contains(logs, "mulai 1") {
		t.Fatalf("err=%v logs=%q", err, logs)
	}
	if _, _, err := exec(t, 5*time.Second, `export default (() => {`, nil); err == nil || !strings.Contains(err.Error(), "SyntaxError") {
		t.Fatalf("sintaks: %v", err)
	}
	if _, _, err := exec(t, 5*time.Second, `export const x = 1`, nil); err == nil || !strings.Contains(err.Error(), "export default async function") {
		t.Fatalf("tanpa default: %v", err)
	}
}

func TestSandbox(t *testing.T) {
	// Tidak ada akses file, proses, atau variabel lingkungan server.
	got, _, err := exec(t, 5*time.Second, `export default async () => {
		const std = await import('qjs:std'); const os = await import('qjs:os');
		return [typeof globalThis.std, typeof globalThis.os, String(std.loadFile('/.env')), String(std.loadFile('../../.env')),
			String(std.open('/x.txt', 'w')), JSON.stringify(os.readdir('/')), String(std.getenv('HOME')), typeof os.exec, typeof std.popen];
	}`, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got.Body != `["undefined","undefined","null","null","null","[[],44]","undefined","undefined","undefined"]` {
		t.Fatalf("sandbox bocor: %s", got.Body)
	}

	for name, c := range map[string]struct {
		code string
		want error
	}{
		"loop tanpa akhir": {`export default () => { while (true) {} }`, ErrTimeout},
		"string besar":     {`export default () => { const a = []; for (let i = 0; i < 1e5; i++) a.push('x'.repeat(100000) + i); return a.length }`, ErrMemory},
		"arraybuffer":      {`export default () => new ArrayBuffer(512 * 1024 * 1024).byteLength`, ErrMemory},
	} {
		start := time.Now()
		_, _, err := exec(t, 2*time.Second, c.code, nil)
		// Yang penting dihentikan: alokasi string besar kadang lebih dulu terkena batas waktu.
		if name == "string besar" && errors.Is(err, ErrTimeout) {
			err = ErrMemory
		}
		if !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v, mau %v", name, err, c.want)
		}
		if d := time.Since(start); d > 6*time.Second {
			t.Errorf("%s: terlalu lama dihentikan (%v)", name, d)
		}
	}
	if _, _, err := exec(t, 2*time.Second, `export default async () => { (await import('qjs:std')).exit(1) }`, nil); err == nil || !strings.Contains(err.Error(), "exit") {
		t.Errorf("exit: %v", err)
	}
	// Setelah semua itu, mesin tetap bisa dipakai.
	if got, _, err := exec(t, 5*time.Second, `export default () => 'sehat'`, nil); err != nil || got.Body != `"sehat"` {
		t.Fatalf("setelahnya: %v %v", got, err)
	}
}

func TestConsoleLengkap(t *testing.T) {
	_, logs, err := exec(t, 5*time.Second, `export default () => {
  console.log('teks', 1, null, undefined, { a: 1, b: [1, 2] });
  const c = { x: 1 }; c.diri = c; console.log(c);
  console.info('i'); console.warn('w'); console.debug({ f() {}, u: undefined });
  console.error(new Error('boom'));
  console.assert(1 === 2, 'harus sama');
  return 1 }`, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"teks 1 null undefined {\"a\":1,\"b\":[1,2]}\n",
		"{\"x\":1,\"diri\":\"[Circular]\"}\n",
		"[info] i\n[warn] w\n",
		"[debug] {\"f\":\"[Function f]\",\"u\":\"[undefined]\"}\n",
		"[error] Error: boom\n    at default (functions/uji.js:5:",
		"[error] Assertion gagal: harus sama\n",
	} {
		if !strings.Contains(logs, want) {
			t.Errorf("log tidak berisi %q:\n%s", want, logs)
		}
	}
	if strings.Contains(logs, "prelude.js") || strings.Contains(logs, "run.js") {
		t.Errorf("stack internal ikut tampil:\n%s", logs)
	}
}

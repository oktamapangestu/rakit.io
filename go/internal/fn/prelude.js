// Lingkungan fungsi serverless rakit.io, dijalankan sebelum kode pengguna di setiap eksekusi.
// __rakit(op, argsJSON) -> resultJSON disediakan Go (lihat engine.go): semua akses keluar lewat sini.
'use strict';
(() => {
  // Modul bawaan QuickJS tidak dipakai fungsi (sandbox tetap tanpa file & tanpa proses).
  delete globalThis.std;
  delete globalThis.os;
  delete globalThis.bjson;

  const host = globalThis.__rakit;
  delete globalThis.__rakit;
  const call = (op, ...args) => {
    const out = JSON.parse(host(op, JSON.stringify(args)));
    if (out.error) throw new Error(out.error);
    return out.value;
  };

  class Response {
    constructor(body = null, init = {}) {
      this.body = body;
      this.status = Number(init.status) || 200;
      this.headers = { ...(init.headers || {}) };
    }

    static json(data, init = {}) {
      return new Response(data, { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) } });
    }

    static redirect(url, status = 302) {
      return new Response(null, { status, headers: { location: String(url) } });
    }
  }

  const db = Object.freeze({
    list: async (table, options = {}) => call('db.list', table, options),
    get: async (table, id) => call('db.get', table, id),
    insert: async (table, data) => call('db.insert', table, data),
    update: async (table, id, data) => call('db.update', table, id, data),
    delete: async (table, id) => call('db.delete', table, id),
  });

  async function fetch(url, init = {}) {
    let body = init.body;
    if (body != null && typeof body !== 'string') body = JSON.stringify(body);
    const r = call('fetch', String(url), { method: init.method || 'GET', headers: init.headers || {}, body: body ?? null });
    const headers = Object.freeze({ get: (name) => r.headers[String(name).toLowerCase()] ?? null, entries: () => Object.entries(r.headers) });
    return Object.freeze({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers,
      text: async () => r.body,
      json: async () => JSON.parse(r.body),
    });
  }

  const env = Object.freeze(JSON.parse(globalThis.__env));
  delete globalThis.__env;

  globalThis.Response = Response;
  globalThis.fetch = fetch;

  // Jalankan fungsi: kembalikan JSON {status, headers, body, json}.
  globalThis.__run = async (handler, raw) => {
    if (typeof handler !== 'function') {
      throw new Error('File fungsi harus berisi: export default async function (req, { db, env, fetch }) { ... }');
    }
    const r = JSON.parse(raw);
    const req = Object.freeze({
      method: r.method,
      path: r.path,
      query: Object.freeze(r.query),
      headers: Object.freeze(r.headers),
      body: r.body,
      text: async () => r.text,
      json: async () => JSON.parse(r.text || 'null'),
    });
    const out = await handler(req, Object.freeze({ db, env, fetch }));
    if (out instanceof Response) {
      const isText = typeof out.body === 'string' || out.body == null;
      return JSON.stringify({ status: out.status, headers: out.headers, body: isText ? out.body ?? '' : JSON.stringify(out.body), json: !isText });
    }
    if (out === undefined) return JSON.stringify({ status: 204, headers: {}, body: '', json: false });
    return JSON.stringify({ status: 200, headers: {}, body: JSON.stringify(out), json: true });
  };
})();

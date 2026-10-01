// Harness test HTTP: menyalakan server rakit.icu (proses terpisah) dengan folder data sementara,
// plus provider AI & Kasera Pay tiruan. Test hanya berbicara lewat HTTP dan database SQLite, jadi
// test yang sama dipakai untuk membuktikan backend lain (mis. versi Go) berperilaku sama:
//
//   RAKIT_SERVER_CMD=go/bin/rakit npm test      (atau: npm run test:go)
//
// Tanpa RAKIT_SERVER_CMD, yang diuji adalah server Node (src/server.js).

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const WEBHOOK_SECRET = 'whsec_test';
export const ADMIN_EMAIL = 'admin@test.local';
export const DAY_MS = 24 * 60 * 60 * 1000;

// PNG 1×1 yang valid, untuk prompt dengan gambar.
export const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
});

// ---------- Provider AI tiruan (format OpenAI chat completions, streaming) ----------
// ai.script: antrean perilaku untuk request berikutnya — { text, chunks, reasoning, toolCalls, finish, usage }
// | { status, retryAfter } | { hang: true } | { cut: true }.
// Kosong = menjawab "Halo dari AI tiruan".
async function startMockAI() {
  const ai = { script: [], requests: [], waiters: [], open: new Set() };
  const server = http.createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req) || '{}');
    ai.requests.push(body);
    ai.waiters.splice(0).forEach((resolve) => resolve(body));
    // ai.respond(body): perilaku bawaan bila antrean script kosong (mis. menurut body.model).
    const step = ai.script.shift() ?? ai.respond?.(body) ?? {};
    if (step.status) {
      res.writeHead(step.status, { 'Content-Type': 'application/json', ...(step.retryAfter ? { 'Retry-After': String(step.retryAfter) } : {}) });
      return res.end(JSON.stringify({ error: { message: `mock ${step.status}` } }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (step.hang) {
      ai.open.add(res);
      res.on('close', () => ai.open.delete(res));
      return res.write(': menunggu\n\n');
    }
    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (step.reasoning) send({ choices: [{ delta: { reasoning_content: step.reasoning } }] });
    // step.chunks: teks dikirim sepotong-sepotong · step.toolCalls: panggilan tool (mode Builder).
    for (const chunk of step.chunks ?? []) send({ choices: [{ delta: { content: chunk } }] });
    if (step.cut) return setTimeout(() => res.destroy(), 50); // koneksi putus di tengah jawaban
    const delta = step.toolCalls ? { tool_calls: step.toolCalls, ...(step.text ? { content: step.text } : {}) }
      : { content: step.chunks ? '' : step.text ?? 'Halo dari AI tiruan' };
    send({ choices: [{ delta, finish_reason: step.finish ?? (step.toolCalls ? 'tool_calls' : 'stop') }] });
    send({ choices: [], usage: step.usage ?? { prompt_tokens: 100, completion_tokens: 20 } });
    res.end('data: [DONE]\n\n');
  });
  const port = await listen(server);
  ai.url = `http://127.0.0.1:${port}`;
  /** Tunggu sampai server memanggil provider (dipakai sebelum Stop / prompt kedua). */
  ai.nextRequest = () => new Promise((resolve) => ai.waiters.push(resolve));
  ai.close = () => {
    for (const res of ai.open) res.destroy();
    server.closeAllConnections();
    server.close();
  };
  return ai;
}

// ---------- Kasera Pay tiruan ----------
// kasera.transactions: Map id -> transaksi (test boleh mengubah .status untuk meniru pembayaran).
// kasera.fail = true: POST /transactions dijawab 500.
async function startMockKasera() {
  const kasera = { transactions: new Map(), created: [], fail: false };
  const server = http.createServer(async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.method === 'POST' && req.url === '/transactions') {
      const body = JSON.parse(await readBody(req));
      if (kasera.fail) return json(500, { error: { code: 'internal', message: 'mock down' } });
      const trx = {
        id: `payreq_${crypto.randomUUID()}`,
        status: 'pending',
        amount: body.amount,
        external_id: body.external_id,
        payment: { type: 'qr', qr_string: `00020101021226MOCK${body.external_id}` },
        checkout_url: `https://pay.example/checkout/${body.external_id}`,
        instructions: { title: 'QRIS', steps: ['Scan'] },
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        paid_at: null,
      };
      kasera.transactions.set(trx.id, trx);
      kasera.created.push({ request: body, idempotencyKey: req.headers['idempotency-key'], trx });
      return json(201, trx);
    }
    const m = /^\/transactions\/(.+)$/.exec(req.url);
    if (req.method === 'GET' && m && kasera.transactions.has(m[1])) return json(200, kasera.transactions.get(m[1]));
    return json(404, { error: { code: 'not_found', message: 'not found' } });
  });
  const port = await listen(server);
  kasera.url = `http://127.0.0.1:${port}`;
  kasera.close = () => { server.closeAllConnections(); server.close(); };
  return kasera;
}

// ---------- Endpoint token Google tiruan ----------
// google.claims: isi id_token yang dikembalikan untuk penukaran kode berikutnya. google.fail = true: 400.
async function startMockGoogle() {
  const google = { claims: null, fail: false, requests: [] };
  const server = http.createServer(async (req, res) => {
    const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
    google.requests.push(form);
    res.setHeader('Content-Type', 'application/json');
    if (google.fail) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'invalid_grant' }));
    }
    const part = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    res.end(JSON.stringify({ id_token: `${part({ alg: 'none' })}.${part(google.claims)}.sig` }));
  });
  const port = await listen(server);
  google.url = `http://127.0.0.1:${port}/token`;
  google.close = () => { server.closeAllConnections(); server.close(); };
  return google;
}

// ---------- Klien HTTP dengan cookie (satu "browser" per pengguna) ----------
class Client {
  constructor(origin, { ip } = {}) {
    this.origin = origin;
    this.cookies = new Map();
    // Server mempercayai proxy di loopback, jadi X-Forwarded-For menentukan IP "pengunjung" (untuk batas laju).
    this.baseHeaders = ip ? { 'X-Forwarded-For': ip } : {};
  }

  async raw(method, url, { body, headers = {}, rawBody } = {}) {
    const res = await fetch(this.origin + url, {
      method,
      redirect: 'manual',
      headers: {
        Origin: this.origin,
        ...this.baseHeaders,
        ...(this.cookies.size ? { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const value = pair.slice(i + 1);
      if (value) this.cookies.set(pair.slice(0, i), value);
      else this.cookies.delete(pair.slice(0, i));
    }
    return res;
  }

  /** Request JSON; mengembalikan { status, body }. */
  async req(method, url, body, headers) {
    const res = await this.raw(method, url, { body, headers });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, body: data };
  }

  get(url) { return this.req('GET', url); }
  post(url, body = {}) { return this.req('POST', url, body); }
  put(url, body = {}) { return this.req('PUT', url, body); }
  patch(url, body = {}) { return this.req('PATCH', url, body); }
  del(url) { return this.req('DELETE', url); }

  async credits() {
    return (await this.get('/api/ai/credits')).body;
  }

  /** Kirim prompt (mode Plan secara default). Mengembalikan jawaban POST apa adanya. */
  startPrompt(prompt = 'Buatkan rencana', extra = {}) {
    return this.post('/api/ai/prompt', { prompt, mode: 'plan', ...extra });
  }

  /** Ikuti job sampai selesai; mengembalikan semua event-nya. */
  async jobEvents(id) {
    const res = await this.raw('GET', `/api/ai/jobs/${id}/events`);
    return (await res.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }

  /** Ikuti job sampai selesai; mengembalikan event terakhir ({ type: 'done' | 'error', ... }). */
  async finishJob(id) {
    return (await this.jobEvents(id)).at(-1);
  }

  /** Kirim prompt mode Builder dan tunggu hasil akhirnya. */
  build(prompt, extra) {
    return this.prompt(prompt, { mode: 'build', ...extra });
  }

  /** Kirim prompt dan tunggu hasil akhirnya. */
  async prompt(prompt, extra) {
    const started = await this.startPrompt(prompt, extra);
    if (started.status !== 201) return { started, final: null };
    return { started, final: await this.finishJob(started.body.assistantMessage.id) };
  }
}

// ---------- Stack lengkap ----------

/**
 * Nyalakan AI tiruan, Kasera tiruan, dan server. `env` menimpa pengaturan default.
 * Mengembalikan { origin, ai, kasera, db, client(), register(), webhook(), stop() }.
 */
export async function startStack(env = {}) {
  const [ai, kasera, google, port] = await Promise.all([startMockAI(), startMockKasera(), startMockGoogle(), freePort()]);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rakit-test-'));
  const origin = `http://localhost:${port}`;

  const serverEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PORT: String(port),
    BASE_DOMAIN: 'localhost',
    PROTOCOL: 'http',
    DATA_DIR: dataDir,
    AI_BASE_URL: ai.url,
    AI_API_KEY: 'test-key',
    AI_MODEL: 'mock-main',
    AI_VISION_MODEL: 'mock-vision',
    AI_BONUS_CREDITS: '2',
    AI_DAILY_CREDITS: '2',
    AI_CREDITS_PER_PROMPT: '1',
    AI_IMAGE_PROMPT_CREDITS: '2',
    KASERA_API_KEY: 'kp_test_mock',
    KASERA_WEBHOOK_SECRET: WEBHOOK_SECRET,
    KASERA_BASE_URL: kasera.url,
    GOOGLE_CLIENT_ID: 'google-client-test',
    GOOGLE_CLIENT_SECRET: 'google-secret-test',
    GOOGLE_TOKEN_URL: google.url,
    CREDIT_PACKAGES: '20:10000,50:20000',
    ASSISTANT_PACKAGES: '10000,25000',
    PLAN_PRO: '49000:3',
    PLAN_UNLIMITED: '98000:2',
    ADMIN_EMAILS: ADMIN_EMAIL,
    // Untuk menjalankan server Go dengan pendeteksi data race (go build -race).
    ...(process.env.GORACE ? { GORACE: process.env.GORACE } : {}),
    ...env,
  };
  let log = '';
  let child;
  let exited = true;
  const launch = () => {
    exited = false;
    child = spawn(process.env.RAKIT_SERVER_CMD || 'node src/server.js', { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: serverEnv });
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    const self = child;
    child.on('exit', () => { if (child === self) exited = true; });
  };
  const kill = async () => {
    if (exited) return;
    const dying = child;
    await new Promise((resolve) => { dying.once('exit', resolve); dying.kill('SIGTERM'); setTimeout(resolve, 3000); });
    exited = true;
  };
  const stop = async () => {
    await kill();
    ai.close();
    kasera.close();
    google.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  const ready = async () => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        if ((await fetch(`${origin}/api/config`)).ok) return;
      } catch { /* belum siap */ }
      if (exited || Date.now() > deadline) {
        await stop();
        throw new Error(`Server tidak menyala:\n${log}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  launch();
  await ready();

  // opts.json: body JSON (Content-Type diisi otomatis) · opts.body: body mentah (string/Buffer).
  const plainRequest = (host, urlPath, { method = 'GET', headers = {}, json, body } = {}) => new Promise((resolve, reject) => {
    const payload = json !== undefined ? JSON.stringify(json) : body;
    const allHeaders = { Host: host, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers };
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: allHeaders }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(payload);
  });

  let counter = 0;
  const stack = {
    origin,
    dataDir,
    ai,
    kasera,
    google,
    log: () => log,
    /** Matikan lalu nyalakan lagi server dengan data yang sama (meniru restart/deploy). */
    async restart() {
      await kill();
      // Beri waktu port dilepas sebelum dipakai lagi.
      await new Promise((r) => setTimeout(r, 300));
      launch();
      await ready();
    },

    /** Request ke website project (<slug>.localhost) lewat header Host. Mengembalikan { status, headers, body }. */
    site: (slug, urlPath = '/', opts) => plainRequest(`${slug}.localhost:${port}`, urlPath, opts),
    /** Request polos ke domain utama, tanpa header tambahan dari fetch (untuk menguji 304). */
    app: (urlPath = '/', opts) => plainRequest(`localhost:${port}`, urlPath, opts),
    /** Request dengan header Host bebas (mis. akses lewat IP). */
    host: (host, urlPath = '/', opts) => plainRequest(host.replace('{port}', port), urlPath, opts),
    stop,
    client: (opts) => new Client(origin, opts),
    /** Koneksi langsung ke database server (WAL: aman dibuka bersamaan), untuk menyiapkan/memeriksa keadaan. */
    db: () => new DatabaseSync(path.join(dataDir, 'rakit.db')),

    /** Daftarkan akun baru dan kembalikan kliennya (sudah login). */
    async register(name = `user${++counter}`, email = `${name}@test.local`) {
      const client = new Client(origin);
      const res = await client.post('/api/register', { username: name, email, password: 'rahasia-123' });
      if (res.status !== 201) throw new Error(`register ${name} gagal: ${res.status} ${JSON.stringify(res.body)}`);
      client.username = name;
      client.userId = stack.db().prepare('SELECT id FROM users WHERE username = ?').get(name).id;
      return client;
    },

    admin: () => stack.register('pemilik', ADMIN_EMAIL),

    /** Kirim webhook Kasera bertanda tangan. opts: { secret, timestamp, signature } untuk meniru kiriman tidak sah. */
    async webhook(event, opts = {}) {
      const raw = JSON.stringify(event);
      const t = opts.timestamp ?? Math.floor(Date.now() / 1000);
      const sig = opts.signature ?? crypto.createHmac('sha256', opts.secret ?? WEBHOOK_SECRET).update(`${t}.`).update(raw).digest('hex');
      const res = await fetch(`${origin}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'kasera-signature-v1': `t=${t},v1=${sig}` },
        body: raw,
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },

    /** Webhook "pembayaran lunas" untuk pembayaran lokal `paymentId`. */
    paid(paymentId, overrides = {}) {
      const row = stack.db().prepare('SELECT provider_id, amount FROM payments WHERE id = ?').get(paymentId);
      return stack.webhook({
        type: 'payment.paid',
        livemode: false,
        data: { payment_request_id: row.provider_id, amount: row.amount, paid_at: new Date().toISOString(), ...overrides },
      });
    },
  };
  return stack;
}

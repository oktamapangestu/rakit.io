// Halaman aplikasi (/, /editor, /admin, /panduan) dan aset statis di domain utama.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startStack } from './helpers/harness.mjs';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const versionOf = (rel) => crypto.createHash('sha1').update(fs.readFileSync(PUBLIC + rel)).digest('hex').slice(0, 10);

let stack;
let user;
let admin;
before(async () => {
  stack = await startStack();
  user = await stack.register();
  admin = await stack.admin();
});
after(() => stack?.stop());

async function page(client, url, opts) {
  const res = await client.raw(opts?.method ?? 'GET', url, { headers: opts?.headers });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

function assertSecurityHeaders(res) {
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
}

test('beranda: pengunjung melihat landing page dengan aset ber-versi; yang sudah login diarahkan ke editor', async () => {
  const res = await page(stack.client(), '/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assertSecurityHeaders(res);
  assert.ok(res.body.includes(`href="/css/landing.css?v=${versionOf('css/landing.css')}"`));
  assert.ok(res.body.includes(`src="/js/auth.js?v=${versionOf('js/auth.js')}"`));
  // Logo juga ber-versi: dulu tanpa versi, sehingga logo lama tertahan di cache browser (immutable 1 tahun).
  assert.ok(res.body.includes(`href="/logo.svg?v=${versionOf('logo.svg')}"`));
  assert.ok(res.body.includes(`src="/logo.svg?v=${versionOf('logo.svg')}"`));

  const loggedIn = await page(user, '/');
  assert.equal(loggedIn.status, 302);
  assert.equal(loggedIn.headers.get('location'), '/editor');
});

test('editor hanya untuk yang sudah login', async () => {
  const anon = await page(stack.client(), '/editor');
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.get('location'), '/');

  const res = await page(user, '/editor');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assertSecurityHeaders(res);
  assert.ok(res.body.includes(`src="/js/editor.js?v=${versionOf('js/editor.js')}"`));
  assert.ok(res.body.includes('https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js"'), 'aset luar tidak diubah');

  const head = await page(user, '/editor', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
});

test('dashboard owner hanya untuk email di ADMIN_EMAILS', async () => {
  const anon = await page(stack.client(), '/admin');
  assert.deepEqual([anon.status, anon.headers.get('location')], [302, '/']);
  const biasa = await page(user, '/admin');
  assert.deepEqual([biasa.status, biasa.headers.get('location')], [302, '/editor']);

  const res = await page(admin, '/admin');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok(res.body.includes(`src="/js/admin.js?v=${versionOf('js/admin.js')}"`));
});

test('sesi kedaluwarsa atau cookie palsu dianggap belum login', async () => {
  const temp = await stack.register();
  assert.equal((await page(temp, '/editor')).status, 200);
  stack.db().prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1000, temp.userId);
  assert.equal((await page(temp, '/editor')).status, 302);

  const palsu = stack.client();
  palsu.cookies.set('rakit_sid', 'bukan-token-asli');
  assert.equal((await page(palsu, '/editor')).status, 302);
  assert.equal((await page(palsu, '/')).status, 200);
});

test('panduan publik boleh di-cache 1 jam', async () => {
  const res = await page(stack.client(), '/panduan');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
  assert.match(res.body, /<title>/);
});

test('aset statis: cache panjang immutable, tipe benar, dan revalidasi 304', async () => {
  const js = await page(stack.client(), `/js/auth.js?v=${versionOf('js/auth.js')}`);
  assert.equal(js.status, 200);
  assert.equal(js.body, fs.readFileSync(`${PUBLIC}js/auth.js`, 'utf8'));
  assert.equal(js.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assertSecurityHeaders(js);
  assert.ok(js.headers.get('etag'));
  assert.ok(js.headers.get('last-modified'));

  assert.equal((await page(stack.client(), '/css/landing.css')).headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal((await page(stack.client(), '/logo.svg')).headers.get('content-type'), 'image/svg+xml');

  // Seperti browser: revalidasi dengan Accept-Encoding yang sama (ETag berbeda per encoding di server Go).
  const cached = await stack.app('/js/auth.js', { headers: { 'If-None-Match': js.headers.get('etag'), 'Accept-Encoding': 'gzip, deflate' } });
  assert.equal(cached.status, 304);
  assert.equal(cached.body, '');
  const since = await stack.app('/js/auth.js', { headers: { 'If-Modified-Since': js.headers.get('last-modified') } });
  assert.equal(since.status, 304);

  // File .html mentah tetap harus selalu direvalidasi.
  const html = await page(stack.client(), '/panduan.html');
  assert.equal(html.status, 200);
  assert.equal(html.headers.get('cache-control'), 'no-cache');
});

test('yang bukan aset dijawab 404 dan tidak membocorkan file di luar folder public', async () => {
  for (const url of ['/js/tidak-ada.js', '/tidak-ada', '/js/', '/.env', '/js/..%2f..%2fpackage.json', '/%2e%2e/package.json', '/js/%2e%2e/%2e%2e/src/server.js']) {
    const res = await page(stack.client(), url);
    assert.equal(res.status, 404, url);
    assert.ok(!res.body.includes('rakit-io') && !res.body.includes('express'), url);
  }
});

test('host lain dialihkan ke domain utama; path yang tidak dikenal dijawab 404', async () => {
  const ip = await stack.host('127.0.0.1:{port}', '/panduan?x=1');
  assert.deepEqual([ip.status, ip.headers.location], [302, `${stack.origin}/panduan?x=1`]);
  const other = await stack.host('contoh.com', '/');
  assert.deepEqual([other.status, other.headers.location], [302, `${stack.origin}/`]);

  for (const [method, url] of [['GET', '/api/tidak-ada'], ['POST', '/api/tidak-ada'], ['GET', '/api'], ['DELETE', '/api/me']]) {
    const res = await user.req(method, url, method === 'GET' ? undefined : {});
    assert.deepEqual([res.status, res.body], [404, { error: 'Endpoint tidak ditemukan' }], `${method} ${url}`);
  }
  // Request tulis ke /api tetap dicek Origin-nya lebih dulu.
  assert.equal((await stack.app('/api/tidak-ada', { method: 'POST', headers: { Origin: 'http://jahat.localhost' } })).status, 403);

  const post = await page(user, '/editor', { method: 'POST' });
  assert.equal(post.status, 404);
  assertSecurityHeaders(post);
});

test('database lama: akun tanpa project mendapat project bernama username saat server menyala', async () => {
  const db = stack.db();
  const { lastInsertRowid: id } = db.prepare("INSERT INTO users (username, email, password_hash, created_at) VALUES ('akun-lama', 'lama@test.local', 'x', ?)").run(Date.now());
  db.prepare("INSERT INTO ai_threads (user_id, title, created_at, updated_at) VALUES (?, 'lama', ?, ?)").run(id, Date.now(), Date.now());
  await stack.restart();
  assert.deepEqual(db.prepare('SELECT slug, name FROM projects WHERE user_id = ?').all(id).map((p) => ({ ...p })), [{ slug: 'akun-lama', name: 'akun-lama' }]);
  const thread = db.prepare('SELECT t.project_id = p.id AS ok FROM ai_threads t JOIN projects p ON p.user_id = t.user_id WHERE t.user_id = ?').get(id);
  assert.equal(thread.ok, 1);
  // Sesi yang sudah ada tetap berlaku setelah restart.
  assert.equal((await user.get('/api/me')).status, 200);
});

test('aset & halaman dikirim ter-gzip bila browser mendukungnya (server Go)', { skip: !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go' }, async () => {
  const { default: http } = await import('node:http');
  const { gunzipSync } = await import('node:zlib');
  const { port } = new URL(stack.origin);
  const get = (path, headers = {}) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers: { Host: `localhost:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  const original = fs.readFileSync(`${PUBLIC}js/editor.js`);
  const gz = await get('/js/editor.js', { 'Accept-Encoding': 'gzip, deflate, br' });
  assert.equal(gz.status, 200);
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.match(gz.headers.vary, /Accept-Encoding/);
  assert.ok(gz.body.length < original.length / 2, 'jauh lebih kecil');
  assert.deepEqual(gunzipSync(gz.body), original);
  assert.equal((await get('/js/editor.js', { 'Accept-Encoding': 'gzip', 'If-None-Match': gz.headers.etag })).status, 304);

  const plain = await get('/js/editor.js');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.deepEqual(plain.body, original);
  assert.notEqual(plain.headers.etag, gz.headers.etag, 'ETag berbeda per encoding');
  assert.equal((await get('/js/editor.js', { 'Accept-Encoding': 'gzip;q=0' })).headers['content-encoding'], undefined);

  const home = await get('/', { 'Accept-Encoding': 'gzip' });
  assert.equal(home.headers['content-encoding'], 'gzip');
  assert.match(gunzipSync(home.body).toString(), /<title>rakit\.io/);
});

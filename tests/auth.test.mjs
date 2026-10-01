// Akun: daftar, masuk, keluar, sesi, pengaman Origin, dan batas percobaan.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

let stack;
before(async () => { stack = await startStack(); });
after(() => stack?.stop());

const signup = (client, body) => client.post('/api/register', { password: 'rahasia-123', ...body });
const sessionCookie = (res) => res.headers.getSetCookie().find((c) => c.startsWith('rakit_sid='));

test('konfigurasi publik', async () => {
  const { status, body } = await stack.client().get('/api/config');
  assert.equal(status, 200);
  assert.deepEqual(body, { baseDomain: 'localhost', siteUrlPattern: `http://{username}.${stack.origin.slice(7)}`, googleEnabled: true });
});

test('daftar: akun + project pertama + sesi; website langsung tayang', async () => {
  const client = stack.client();
  const res = await client.raw('POST', '/api/register', { body: { username: '  Budi-Web ', email: ' Budi@Contoh.ID ', password: 'rahasia-123' } });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { user: { username: 'budi-web', email: 'budi@contoh.id' } });
  const cookie = sessionCookie(res);
  assert.match(cookie, /^rakit_sid=[A-Za-z0-9_-]{43};/);
  assert.match(cookie, /Max-Age=2592000/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.ok(!/Domain=/i.test(cookie), 'cookie tidak boleh berlaku untuk subdomain');
  assert.ok(!/Secure/i.test(cookie), 'http: tanpa Secure');

  const me = await client.get('/api/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.user, { username: 'budi-web', email: 'budi@contoh.id', isAdmin: false });
  assert.equal(me.body.maxProjects, 5);
  assert.equal(me.body.projects.length, 1);
  const project = me.body.project;
  assert.deepEqual({ ...project, createdAt: 0 }, {
    slug: 'budi-web', name: 'budi-web', siteUrl: `http://budi-web.${stack.origin.slice(7)}`, siteHost: 'budi-web.localhost', createdAt: 0,
  });
  assert.ok(Math.abs(project.createdAt - Date.now()) < 10_000);

  // File awal dari template, dengan nama & host terisi.
  const root = path.join(stack.dataDir, 'sites', 'budi-web');
  assert.deepEqual(fs.readdirSync(root).sort(), ['index.html', 'script.js', 'style.css']);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.includes('<title>budi-web</title>') && html.includes('budi-web.localhost') && !html.includes('{{'));
  assert.equal((await stack.site('budi-web', '/')).status, 200);

  // Password disimpan sebagai hash scrypt, sesi sebagai hash token.
  const row = stack.db().prepare('SELECT password_hash FROM users WHERE username = ?').get('budi-web');
  assert.match(row.password_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  const token = /rakit_sid=([^;]+)/.exec(cookie)[1];
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  assert.equal(stack.db().prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(hash).n, 1);
});

test('daftar: masukan tidak valid dan duplikat ditolak', async () => {
  await signup(stack.client({ ip: '198.51.100.1' }), { username: 'sudah-ada', email: 'ada@test.local' });
  const cases = [
    [{ username: 'ab', email: 'a@b.co' }, 400, 'Username harus 3–30 karakter'],
    [{ username: 'x'.repeat(31), email: 'a@b.co' }, 400, 'Username harus 3–30 karakter'],
    [{ username: 'nama_aneh', email: 'a@b.co' }, 400, 'Username hanya boleh huruf kecil, angka, dan tanda -, tidak diawali/diakhiri -'],
    [{ username: '-depan', email: 'a@b.co' }, 400, /tidak diawali/],
    [{ username: 'dua--strip', email: 'a@b.co' }, 400, 'Username tidak boleh mengandung "--"'],
    [{ username: 'admin', email: 'a@b.co' }, 400, 'Username ini tidak tersedia'],
    [{ username: 'www', email: 'a@b.co' }, 400, 'Username ini tidak tersedia'],
    [{ email: 'a@b.co' }, 400, 'Username harus 3–30 karakter'],
    [{ username: 'valid-nama', email: 'bukan-email' }, 400, 'Email tidak valid'],
    [{ username: 'valid-nama', email: `${'a'.repeat(250)}@b.co` }, 400, 'Email tidak valid'],
    [{ username: 'valid-nama', email: 'a@b.co', password: 'pendek' }, 400, 'Password minimal 8 karakter'],
    [{ username: 'valid-nama', email: 'a@b.co', password: 'x'.repeat(201) }, 400, 'Password minimal 8 karakter'],
    [{ username: 'sudah-ada', email: 'lain@test.local' }, 409, 'Username sudah dipakai'],
    [{ username: 'belum-ada', email: 'ADA@test.local' }, 409, 'Email sudah terdaftar'],
  ];
  for (const [body, status, message] of cases) {
    const res = await signup(stack.client({ ip: '198.51.100.1' }), body);
    assert.equal(res.status, status, JSON.stringify(body).slice(0, 80));
    if (typeof message === 'string') assert.equal(res.body.error, message);
    else assert.match(res.body.error, message);
  }
  assert.equal(stack.db().prepare("SELECT COUNT(*) AS n FROM users WHERE username IN ('valid-nama', 'belum-ada')").get().n, 0);

  // Subdomain project milik orang lain juga tidak boleh dipakai sebagai username.
  const owner = await stack.register('pemilik-proyek');
  assert.equal((await owner.post('/api/projects', { slug: 'toko-kedua', name: 'Toko' })).status, 201);
  const taken = await signup(stack.client({ ip: '198.51.100.1' }), { username: 'toko-kedua', email: 'baru@test.local' });
  assert.deepEqual([taken.status, taken.body.error], [409, 'Username sudah dipakai']);

  const bad = await stack.client({ ip: '198.51.100.1' }).raw('POST', '/api/register', { rawBody: '{"username":', headers: { 'Content-Type': 'application/json' } });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'JSON tidak valid' });
});

test('masuk dengan username atau email; salah password / akun tidak ada → 401 yang sama', async () => {
  await signup(stack.client({ ip: '198.51.100.2' }), { username: 'siti', email: 'siti@test.local' });
  for (const login of ['siti', 'SITI', 'siti@test.local', ' Siti@Test.Local ']) {
    const client = stack.client({ ip: '198.51.100.2' });
    const res = await client.post('/api/login', { login, password: 'rahasia-123' });
    assert.deepEqual([res.status, res.body], [200, { user: { username: 'siti', email: 'siti@test.local' } }], login);
    assert.equal((await client.get('/api/me')).status, 200);
  }
  const wrong = await stack.client({ ip: '198.51.100.2' }).post('/api/login', { login: 'siti', password: 'salah-sekali' });
  const missing = await stack.client({ ip: '198.51.100.2' }).post('/api/login', { login: 'tidak-ada', password: 'rahasia-123' });
  const empty = await stack.client({ ip: '198.51.100.2' }).post('/api/login', {});
  for (const res of [wrong, missing, empty]) {
    assert.deepEqual([res.status, res.body], [401, { error: 'Username/email atau password salah' }]);
  }
});

test('hash password buatan Node tetap bisa dipakai masuk', async () => {
  // Format yang sama dengan src/auth.js: scrypt bawaan Node (N=16384, r=8, p=1), kunci 64 byte.
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync('kata-sandi-lama', salt, 64);
  const client = await stack.register('akun-lama');
  stack.db().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(`scrypt$${salt.toString('hex')}$${key.toString('hex')}`, client.userId);
  assert.equal((await stack.client().post('/api/login', { login: 'akun-lama', password: 'kata-sandi-lama' })).status, 200);
  assert.equal((await stack.client().post('/api/login', { login: 'akun-lama', password: 'rahasia-123' })).status, 401);
});

test('keluar menghapus sesi di server dan cookie di browser', async () => {
  const client = await stack.register('mau-keluar');
  const token = client.cookies.get('rakit_sid');
  const res = await client.raw('POST', '/api/logout', { body: {} });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.match(sessionCookie(res), /^rakit_sid=;.*Expires=Thu, 01 Jan 1970/);
  assert.equal(stack.db().prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(client.userId).n, 0);

  // Token lama tidak berlaku lagi walau dikirim ulang.
  const stale = stack.client();
  stale.cookies.set('rakit_sid', token);
  assert.deepEqual(await stale.get('/api/me'), { status: 401, body: { error: 'Silakan masuk terlebih dahulu' } });
  assert.equal((await stack.client().post('/api/logout')).status, 200, 'keluar tanpa sesi tetap 200');
});

test('permintaan yang mengubah data wajib dari origin aplikasi', async () => {
  const client = await stack.register('cek-origin');
  const body = { login: 'cek-origin', password: 'rahasia-123' };
  for (const headers of [{ Origin: 'http://jahat.localhost' }, { Origin: `http://cek-origin.${stack.origin.slice(7)}` }, { Origin: 'null' }]) {
    const res = await client.req('POST', '/api/login', body, headers);
    assert.deepEqual([res.status, res.body], [403, { error: 'Origin tidak diizinkan' }], headers.Origin);
  }
  // Tanpa Origin: hanya diterima bila browser menandai same-origin.
  const post = (headers) => fetch(`${stack.origin}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({})).status, 403);
  assert.equal((await post({ 'Sec-Fetch-Site': 'same-site' })).status, 403);
  assert.equal((await post({ 'Sec-Fetch-Site': 'same-origin' })).status, 200);
  // GET tidak diperiksa.
  assert.equal((await client.req('GET', '/api/me', undefined, { Origin: 'http://jahat.localhost' })).status, 200);
});

test('batas percobaan daftar/masuk: 30 per 15 menit per IP', async () => {
  const client = stack.client({ ip: '203.0.113.7' });
  const tries = await Promise.all(Array.from({ length: 30 }, () => client.post('/api/login', { login: 'tidak-ada', password: 'x' })));
  assert.ok(tries.every((r) => r.status === 401));
  const limited = await client.raw('POST', '/api/login', { body: { login: 'tidak-ada', password: 'x' } });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.deepEqual(await limited.json(), { error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  assert.equal((await signup(client, { username: 'kena-batas', email: 'kena@test.local' })).status, 429, 'daftar memakai jatah yang sama');
  // IP lain tidak terpengaruh.
  assert.equal((await stack.client({ ip: '203.0.113.8' }).post('/api/login', { login: 'tidak-ada', password: 'x' })).status, 401);
});

test('endpoint API yang tidak ada → 404 JSON', async () => {
  const res = await stack.client().get('/api/tidak-ada');
  assert.deepEqual([res.status, res.body], [404, { error: 'Endpoint tidak ditemukan' }]);
});

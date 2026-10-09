// Lupa password: pengaturan email di dashboard owner, pengiriman lewat API email (tiruan), link sekali pakai,
// dan password baru. Fitur ini hanya ada di server Go.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const skip = !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go';

// API email tiruan: mencatat setiap request; mail.script = antrean status jawaban (kosong = 200).
async function startMockMail() {
  const mail = { requests: [], script: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      mail.requests.push({ headers: req.headers, body, raw: Buffer.from(body.raw, 'base64').toString('utf8') });
      const status = mail.script.shift() ?? 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { id: `msg_${mail.requests.length}` } : { error: { message: `mock ${status}` } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  mail.url = `http://127.0.0.1:${server.address().port}/v1/messages`;
  mail.close = () => { server.closeAllConnections(); server.close(); };
  return mail;
}

let stack;
let mail;
before(async () => {
  if (skip) return;
  mail = await startMockMail();
  stack = await startStack({ MAIL_API_URL: mail.url });
});
after(() => { stack?.stop(); mail?.close(); });

// Email dikirim di latar: tunggu sampai API tiruan menerima n request.
async function waitForMail(n) {
  const deadline = Date.now() + 10_000;
  while (mail.requests.length < n) {
    if (Date.now() > deadline) throw new Error(`email ke-${n} tidak terkirim`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return mail.requests[n - 1];
}

// Isi pesan quoted-printable → teks.
const decodeQP = (s) => Buffer.from(s.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
const resetToken = (raw) => /#reset=([A-Za-z0-9_-]+)/.exec(decodeQP(raw))?.[1];

test('pengaturan email: hanya owner, divalidasi, API key tidak pernah dikirim balik', { skip }, async () => {
  const user = await stack.register('bukan-owner');
  assert.equal((await user.get('/api/admin/mail')).status, 403);

  const admin = await stack.admin();
  const empty = await admin.get('/api/admin/mail');
  assert.deepEqual(empty.body, { sender: '', senderName: '', hasKey: false, keyHint: '', enabled: false, apiUrl: mail.url });
  assert.equal((await stack.client().get('/api/config')).body.passwordReset, false);
  const off = await stack.client({ ip: '198.51.100.20' }).post('/api/forgot-password', { login: 'bukan-owner' });
  assert.equal(off.status, 503);
  assert.equal(off.body.error, 'Fitur lupa password belum aktif. Hubungi admin.');

  for (const [body, message] of [
    [{ sender: 'bukan email' }, 'Alamat pengirim tidak valid'],
    [{ sender: 'Nama <a@b.co>' }, 'Alamat pengirim tidak valid'],
    [{ sender: 'a@b.co', apiKey: 'ada spasi' }, 'API key tidak valid'],
  ]) {
    const res = await admin.put('/api/admin/mail', body);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, message);
  }

  const saved = await admin.put('/api/admin/mail', { sender: ' Hello@Rakit.Test ', senderName: 'rakit.io', apiKey: 'mk_live_rahasia1234' });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, { sender: 'hello@rakit.test', senderName: 'rakit.io', hasKey: true, keyHint: '…1234', enabled: true, apiUrl: mail.url });
  assert.ok(!JSON.stringify((await admin.get('/api/admin/mail')).body).includes('rahasia'));
  // apiKey kosong = key lama tetap dipakai.
  assert.equal((await admin.put('/api/admin/mail', { sender: 'hello@rakit.test', senderName: 'Rakit' })).body.keyHint, '…1234');
  assert.equal((await stack.client().get('/api/config')).body.passwordReset, true);

  // Email tes: ke email owner bila tujuan kosong, lewat API dengan Bearer & Idempotency-Key.
  const sent = await admin.post('/api/admin/mail/test', {});
  assert.deepEqual(sent.body, { ok: true, to: 'admin@test.local' });
  const req = mail.requests.at(-1);
  assert.equal(req.headers.authorization, 'Bearer mk_live_rahasia1234');
  assert.match(req.headers['idempotency-key'], /^[0-9a-f]{32}$/);
  assert.deepEqual({ ...req.body, raw: undefined }, { sender: 'hello@rakit.test', recipients: ['admin@test.local'], raw: undefined });
  assert.match(req.raw, /^From: "Rakit" <hello@rakit\.test>\r\n/);
  assert.match(req.raw, /\r\nTo: <admin@test\.local>\r\n/);
  assert.match(req.raw, /\r\nSubject: Email tes dari localhost\r\n/);

  // API gagal: pesannya ditampilkan ke owner.
  mail.script.push(401);
  const failed = await admin.post('/api/admin/mail/test', { to: 'lain@test.local' });
  assert.deepEqual(failed.body, { ok: false, error: 'API email menjawab 401: mock 401' });
});

test('lupa password: link sekali pakai, sesi lama keluar, password baru berlaku', { skip }, async () => {
  const budi = await stack.register('budi-lupa', 'budi.lupa@test.local');
  const visitor = stack.client({ ip: '198.51.100.21' });
  const before = mail.requests.length;

  // Akun tidak ada: jawaban sama, tidak ada email.
  const unknown = await visitor.post('/api/forgot-password', { login: 'tidak-ada@test.local' });
  assert.deepEqual(unknown, { status: 200, body: { ok: true } });
  assert.equal((await visitor.post('/api/forgot-password', { login: '  ' })).status, 400);

  // Bisa dengan email (huruf besar/kecil diabaikan) atau username.
  assert.deepEqual(await visitor.post('/api/forgot-password', { login: ' Budi.Lupa@Test.Local ' }), { status: 200, body: { ok: true } });
  const sent = await waitForMail(before + 1);
  assert.deepEqual(sent.body.recipients, ['budi.lupa@test.local']);
  assert.match(sent.raw, /\r\nSubject: Ganti password localhost\r\n/);
  assert.match(sent.raw, /multipart\/alternative/);
  const text = decodeQP(sent.raw);
  assert.ok(text.includes('Halo budi-lupa,'));
  assert.ok(text.includes(`${stack.origin}/#reset=`), 'link ke halaman masuk');
  const token = resetToken(sent.raw);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);

  const short = await visitor.post('/api/reset-password', { token, password: 'pendek' });
  assert.equal(short.status, 400);
  assert.equal(short.body.error, 'Password minimal 8 karakter');
  const wrong = await visitor.post('/api/reset-password', { token: 'salah', password: 'password-baru' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, 'Link ganti password tidak valid atau sudah kedaluwarsa. Minta link baru.');

  const done = await visitor.post('/api/reset-password', { token, password: 'password-baru' });
  assert.deepEqual(done, { status: 200, body: { user: { username: 'budi-lupa', email: 'budi.lupa@test.local' } } });
  assert.equal((await visitor.get('/api/me')).body.user.username, 'budi-lupa', 'langsung masuk');
  assert.equal((await budi.get('/api/me')).status, 401, 'sesi lama keluar');

  // Link hanya sekali pakai.
  assert.equal((await stack.client({ ip: '198.51.100.22' }).post('/api/reset-password', { token, password: 'password-lain' })).status, 400);
  const login = (password) => stack.client({ ip: '198.51.100.23' }).post('/api/login', { login: 'budi-lupa', password });
  assert.equal((await login('rahasia-123')).status, 401);
  assert.equal((await login('password-baru')).status, 200);
});

test('lupa password: link kedaluwarsa ditolak, maks. 3 email per akun per jam, email berbahasa Inggris', { skip }, async () => {
  await stack.register('sari-lupa', 'sari@test.local');
  const visitor = stack.client({ ip: '198.51.100.24' });
  visitor.cookies.set('lang', 'en');
  const before = mail.requests.length;

  assert.equal((await visitor.post('/api/forgot-password', { login: 'sari-lupa' })).status, 200);
  const sent = await waitForMail(before + 1);
  const text = decodeQP(sent.raw);
  assert.match(sent.raw, /\r\nSubject: Reset your localhost password\r\n/);
  assert.ok(text.includes('Hi sari-lupa,'));
  assert.ok(text.includes(`${stack.origin}/en#reset=`));

  const token = resetToken(sent.raw);
  stack.db().prepare('UPDATE password_resets SET expires_at = ?').run(Date.now() - 1);
  const expired = await visitor.post('/api/reset-password', { token, password: 'password-baru' });
  assert.equal(expired.status, 400);
  assert.equal(expired.body.error, 'This password reset link is invalid or has expired. Request a new one.');

  for (let i = 0; i < 3; i++) assert.equal((await visitor.post('/api/forgot-password', { login: 'sari@test.local' })).status, 200);
  await waitForMail(before + 3);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(mail.requests.length, before + 3, 'permintaan ke-4 dalam sejam tidak dikirim');
});

test('API email gangguan sementara: dicoba ulang dengan Idempotency-Key yang sama', { skip }, async () => {
  const admin = stack.client();
  await admin.post('/api/login', { login: 'pemilik', password: 'rahasia-123' });
  const before = mail.requests.length;
  mail.script.push(503);
  const sent = await admin.post('/api/admin/mail/test', {});
  assert.equal(sent.body.ok, true);
  assert.equal(mail.requests.length, before + 2);
  const [first, second] = mail.requests.slice(-2);
  assert.equal(first.headers['idempotency-key'], second.headers['idempotency-key']);
  assert.equal(first.body.raw, second.body.raw);
});

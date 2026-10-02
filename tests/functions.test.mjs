// Fungsi serverless: functions/<nama>.js dipanggil lewat <slug>/api/fn/<nama>, dengan db (sebagai pemilik),
// env (rahasia project), dan fetch. Sandbox & batas waktu/memori diuji di go/internal/fn. Fitur khusus Go.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const skip = !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go';

let stack;
let api; // server luar tiruan untuk fetch
before(async () => {
  if (skip) return;
  // Server tiruan berjalan di 127.0.0.1: izinkan fetch ke alamat lokal khusus untuk test ini.
  stack = await startStack({ FN_ALLOW_PRIVATE_FETCH: '1' });
  api = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ method: req.method, auth: req.headers.authorization ?? null, body }));
    });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
});
after(() => { api?.close(); return stack?.stop(); });

const call = (slug, name, opts) => stack.site(slug, `/api/fn/${name}`, opts);
const json = (res) => JSON.parse(res.body);
async function fn(user, name, code, headers) {
  await user.req('POST', '/api/files', { path: `functions/${name}.js` }, headers);
  const res = await user.req('PUT', '/api/files/content', { path: `functions/${name}.js`, content: code }, headers);
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

test('fungsi dijalankan lewat /api/fn; kodenya tidak bisa dibaca sebagai file', { skip }, async () => {
  const user = await stack.register('fn-dasar');
  await fn(user, 'halo', `export default async function (req) {
    return { pesan: 'Halo ' + (req.body?.nama ?? req.query.nama ?? 'dunia'), method: req.method };
  }`);
  let res = await call('fn-dasar', 'halo?nama=Budi');
  assert.deepEqual([res.status, res.headers['content-type'], json(res)], [200, 'application/json; charset=utf-8', { pesan: 'Halo Budi', method: 'GET' }]);
  res = await call('fn-dasar', 'halo', { method: 'POST', json: { nama: 'Ani' } });
  assert.deepEqual(json(res), { pesan: 'Halo Ani', method: 'POST' });
  assert.equal(res.headers['cache-control'], 'no-store');

  for (const p of ['/functions/halo.js', '/Functions/halo.js', '/functions/', '/functions']) {
    const file = await stack.site('fn-dasar', p);
    assert.equal(file.status, 404, p);
    assert.ok(!file.body.includes('Halo '), p);
  }
  assert.deepEqual([(await call('fn-dasar', 'tidak-ada')).status, json(await call('fn-dasar', 'tidak-ada'))], [404, { error: 'Fungsi tidak ditemukan' }]);
  assert.equal((await call('fn-dasar', '..%2fsecret')).status, 404);
  assert.equal((await call('belum-ada-situs', 'halo')).status, 404);
});

test('db sebagai pemilik, rahasia lewat env, dan fetch ke luar', { skip }, async () => {
  const user = await stack.register('fn-toko');
  // Tabel khusus pemilik: pengunjung tidak bisa menulis langsung lewat /api/db, tapi fungsi bisa.
  await user.post('/api/database/tables', { name: 'pesanan', columns: [{ name: 'nama', type: 'text' }, { name: 'total', type: 'number' }] });
  assert.equal((await stack.site('fn-toko', '/api/db/pesanan', { method: 'POST', json: { nama: 'x' } })).status, 403);

  const bad = await user.put('/api/functions/secrets', { name: 'token-api', value: 'x' });
  assert.deepEqual([bad.status, bad.body.error], [400, 'Nama rahasia: huruf besar, angka, dan _, diawali huruf (mis. TELEGRAM_TOKEN)']);
  const saved = await user.put('/api/functions/secrets', { name: 'API_TOKEN', value: 'rahasia-123' });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.secrets.map((s) => s.name), ['API_TOKEN']);
  assert.ok(!JSON.stringify(saved.body).includes('rahasia-123'), 'nilai rahasia tidak pernah dikirim balik');

  await fn(user, 'pesan', `export default async function (req, { db, env, fetch }) {
    const row = await db.insert('pesanan', { nama: req.body.nama, total: req.body.total });
    const daftar = await db.list('pesanan', { sort: '-id', limit: 5 });
    let salah; try { await db.get('tidak_ada', 1) } catch (e) { salah = e.message }
    const r = await fetch('${'http://127.0.0.1:'}' + req.query.port + '/kirim', { method: 'POST', headers: { Authorization: 'Bearer ' + env.API_TOKEN }, body: { id: row.id } });
    return { id: row.id, total: daftar.total, salah, kirim: await r.json(), status: r.status, adaToken: env.API_TOKEN === 'rahasia-123' };
  }`);
  const res = await call('fn-toko', `pesan?port=${api.address().port}`, { method: 'POST', json: { nama: 'Ani', total: 15000 } });
  assert.equal(res.status, 200, res.body);
  assert.deepEqual(json(res), {
    id: 1, total: 1, salah: 'Tabel "tidak_ada" tidak ditemukan', status: 200, adaToken: true,
    kirim: { method: 'POST', auth: 'Bearer rahasia-123', body: '{"id":1}' },
  });
  assert.deepEqual((await user.get('/api/database/tables/pesanan/rows')).body.rows.map((r) => [r.nama, r.total]), [['Ani', 15000]]);

  // Memanggil website rakit.io sendiri diblokir (mencegah rantai pemanggilan).
  await fn(user, 'putar', `export default async (req, { fetch }) => { try { await fetch('http://fn-toko.localhost/api/fn/putar') } catch (e) { return e.message } }`);
  assert.equal(json(await call('fn-toko', 'putar')), 'fetch: fungsi tidak bisa memanggil website rakit.io (pakai db langsung)');

  assert.equal((await user.del('/api/functions/secrets/API_TOKEN')).body.secrets.length, 0);
  assert.equal((await user.del('/api/functions/secrets/API_TOKEN')).status, 404);
});

test('jawaban: Response, header yang diizinkan, dan pesan kesalahan', { skip }, async () => {
  const user = await stack.register('fn-jawab');
  await fn(user, 'html', `export default () => new Response('<h1>Hai</h1>', { status: 201, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'rakit_sid=palsu; Domain=localhost', 'X-Versi': '2', 'Access-Control-Allow-Origin': '*' } })`);
  const res = await call('fn-jawab', 'html');
  assert.deepEqual([res.status, res.body, res.headers['content-type'], res.headers['x-versi'], res.headers['access-control-allow-origin']], [201, '<h1>Hai</h1>', 'text/html; charset=utf-8', '2', '*']);
  assert.equal(res.headers['set-cookie'], undefined, 'Set-Cookie dari fungsi selalu dibuang');

  await fn(user, 'rusak', `export default () => { console.log('cek stok'); throw new Error('stok habis') }`);
  const pub = await call('fn-jawab', 'rusak');
  assert.deepEqual([pub.status, json(pub)], [500, { error: 'Fungsi gagal dijalankan' }], 'detail kesalahan tidak bocor ke pengunjung');

  // Uji coba dari editor: detail kesalahan & log ditampilkan.
  const tried = await user.post('/api/functions/rusak/run', { method: 'GET' });
  assert.deepEqual([tried.status, tried.body.status, tried.body.error, tried.body.logs], [200, 500, 'Fungsi gagal: Error: stok habis', 'cek stok\n']);
  const ok = await user.post('/api/functions/html/run', { method: 'POST', query: 'a=1', body: '{"x":1}' });
  assert.deepEqual([ok.body.status, ok.body.body, ok.body.headers['content-type']], [201, '<h1>Hai</h1>', 'text/html; charset=utf-8']);
  assert.equal(typeof ok.body.ms, 'number');
  assert.equal((await user.post('/api/functions/tidak-ada/run', {})).status, 404);

  const list = (await user.get('/api/functions')).body;
  assert.deepEqual(list.functions.map((f) => [f.name, f.path, f.url]), [
    ['html', 'functions/html.js', `http://fn-jawab.${stack.origin.slice(7)}/api/fn/html`],
    ['rusak', 'functions/rusak.js', `http://fn-jawab.${stack.origin.slice(7)}/api/fn/rusak`],
  ]);
  assert.deepEqual([list.usage.plan, list.usage.limit, list.limits], ['Gratis', 1000, { timeoutSeconds: 10, memoryMb: 64 }]);
  assert.ok(list.usage.today >= 4);
});

test('kuota harian per akun', { skip }, async () => {
  const user = await stack.register('fn-kuota');
  await fn(user, 'x', 'export default () => 1');
  assert.equal((await call('fn-kuota', 'x')).status, 200);
  const db = stack.db();
  const day = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  db.prepare('UPDATE fn_usage SET count = 1000 WHERE user_id = ? AND day = ?').run(user.userId, day);
  const res = await call('fn-kuota', 'x');
  assert.deepEqual([res.status, json(res).code], [429, 'fn_quota']);
  assert.match(json(res).error, /1000 eksekusi\/hari untuk paket Gratis/);
});

test('publikasi manual: fungsi dev di <slug>--dev, tayang setelah dipublikasikan', { skip }, async () => {
  const user = await stack.register('fn-dev');
  await user.post('/api/database/tables', { name: 'catatan', columns: [{ name: 'isi', type: 'text' }] });
  await user.put('/api/publish/mode', { mode: 'manual' });
  await fn(user, 'tulis', `export default async (req, { db }) => (await db.insert('catatan', { isi: req.query.isi })).isi`);
  assert.equal((await call('fn-dev', 'tulis?isi=a')).status, 404, 'belum dipublikasikan');
  const dev = await call('fn-dev--dev', 'tulis?isi=uji');
  assert.deepEqual([dev.status, json(dev)], [200, 'uji']);
  assert.equal((await user.get('/api/functions')).body.functions[0].url, `http://fn-dev--dev.${stack.origin.slice(7)}/api/fn/tulis`);

  await user.post('/api/publish', {});
  assert.deepEqual(json(await call('fn-dev', 'tulis?isi=asli')), 'asli');
  // Masing-masing menulis ke database versinya sendiri: dev (editor) dan prod (file @prod).
  assert.equal((await user.get('/api/database/tables/catatan/rows')).body.rows.map((r) => r.isi).join(), 'uji');
  const prod = new DatabaseSync(path.join(stack.dataDir, 'db', 'fn-dev@prod.db'));
  assert.deepEqual(prod.prepare('SELECT isi FROM catatan').all().map((r) => r.isi), ['asli']);
  prod.close();
});

test('log eksekusi: pengunjung & uji coba tercatat, bisa disaring per fungsi', { skip }, async () => {
  const user = await stack.register('fn-log');
  await fn(user, 'a', `export default () => { console.log('dari a'); return 1 }`);
  await fn(user, 'b', `export default () => { throw new Error('rusak') }`);
  await call('fn-log', 'a');
  await call('fn-log', 'b');
  await user.post('/api/functions/a/run', {});
  const all = (await user.get('/api/functions/logs')).body.logs;
  assert.deepEqual(all.map((l) => [l.name, l.trigger, l.status, l.dev]), [['a', 'test', 200, true], ['b', 'http', 500, false], ['a', 'http', 200, false]]);
  assert.deepEqual([all[1].error, all[2].logs], ['Fungsi gagal: Error: rusak', 'dari a\n']);
  assert.equal(typeof all[0].ms, 'number');
  assert.deepEqual((await user.get('/api/functions/logs?name=b')).body.logs.map((l) => l.name), ['b']);
  // Log project lain tidak terlihat.
  const other = await stack.register('fn-log-lain');
  assert.deepEqual((await other.get('/api/functions/logs')).body.logs, []);
});

test('jadwal: hanya paket berbayar, dengan jarak minimal per paket', { skip }, async () => {
  const user = await stack.register('fn-jadwal');
  await fn(user, 'rekap', 'export default (req) => req.method');
  let res = await user.put('/api/functions/rekap/schedule', { cron: '0 7 * * *' });
  assert.deepEqual([res.status, res.body.code], [403, 'fn_cron_plan']);
  assert.equal((await user.get('/api/functions')).body.cron.minMinutes, 0);

  stack.db().prepare('INSERT INTO subscriptions (user_id, plan, started_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(user.userId, 'pro', Date.now(), Date.now() + 30 * 86_400_000, Date.now());
  res = await user.put('/api/functions/rekap/schedule', { cron: '*/5 * * * *' });
  assert.deepEqual([res.status, res.body.error], [400, 'Paket Pro: jadwal paling sering setiap 15 menit']);
  res = await user.put('/api/functions/rekap/schedule', { cron: '0 0 30 2 *' });
  assert.match(res.body.error, /tidak pernah terjadi/);
  assert.equal((await user.put('/api/functions/tidak-ada/schedule', { cron: '0 7 * * *' })).status, 404);

  res = await user.put('/api/functions/rekap/schedule', { cron: '  0   7 * * 1-5 ' });
  assert.equal(res.status, 200);
  const sched = res.body.functions[0].schedule;
  assert.deepEqual([sched.cron, sched.active, res.body.cron.minMinutes], ['0 7 * * 1-5', true, 15]);
  assert.match(sched.nextRunAt, /T00:00:00\.000Z$/, '07.00 WIB = 00.00 UTC');
  res = await user.put('/api/functions/rekap/schedule', { cron: '' });
  assert.equal(res.body.functions[0].schedule, null);
});

test('AI tahu cara menulis fungsi dan nama rahasia (tanpa isinya)', { skip }, async () => {
  const user = await stack.register('fn-ai');
  await user.put('/api/functions/secrets', { name: 'TELEGRAM_TOKEN', value: 'isi-rahasia-tg' });
  stack.ai.script.push({ text: 'Rencana: buat functions/kirim.js.' });
  const { final } = await user.prompt('kirim notifikasi telegram saat ada pesanan', { mode: 'plan' });
  assert.equal(final.type, 'done');
  const sent = stack.ai.requests.at(-1).messages;
  assert.match(sent[0].content, /Serverless functions \(server-side code\):/);
  assert.match(sent[0].content, /NEVER write a key or token into any file/);
  const ctx = sent.at(-1).content;
  assert.ok(ctx.includes('Function secrets (names only, read with env.NAME): TELEGRAM_TOKEN'));
  assert.ok(!JSON.stringify(stack.ai.requests).includes('isi-rahasia-tg'), 'isi rahasia tidak pernah dikirim ke AI');
});

// Riwayat versi project: versi otomatis sebelum mengedit, simpan manual, bandingkan, dan kembalikan.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DAY_MS, startStack } from './helpers/harness.mjs';

let stack;
before(async () => { stack = await startStack(); });
after(() => stack?.stop());

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('gambar')]);
const rootOf = (user) => path.join(stack.dataDir, 'sites', user.username);
const save = (user, file, content) => user.put('/api/files/content', { path: file, content });
const list = async (user) => (await user.get('/api/versions')).body.versions;
const snapshot = async (user, label) => (await user.post('/api/versions', { label })).body.id;

test('versi otomatis dibuat sebelum edit pertama, paling sering sekali per 10 menit', async () => {
  const user = await stack.register();
  const initial = (await user.get('/api/versions')).body;
  assert.deepEqual(initial, { versions: [], history: { days: 7, max: 20 } });

  const original = fs.readFileSync(path.join(rootOf(user), 'index.html'), 'utf8');
  await save(user, 'index.html', 'edit 1');
  let versions = await list(user);
  assert.equal(versions.length, 1);
  assert.deepEqual({ ...versions[0], id: 0, createdAt: 0 }, { id: 0, kind: 'edit', label: '', fileCount: 3, createdAt: 0 });
  assert.ok(Math.abs(versions[0].createdAt - Date.now()) < 10_000);
  // Versi itu berisi kondisi SEBELUM diedit.
  assert.equal((await user.get(`/api/versions/${versions[0].id}/file?path=index.html`)).body.content, original);

  await save(user, 'index.html', 'edit 2');
  await user.post('/api/files', { path: 'baru.html' });
  assert.equal((await list(user)).length, 1, 'masih dalam 10 menit');

  // Setelah 10 menit: versi otomatis berikutnya (berisi "edit 2" + baru.html).
  stack.db().prepare('UPDATE versions SET created_at = created_at - ?').run(11 * 60 * 1000);
  await save(user, 'index.html', 'edit 3');
  versions = await list(user);
  assert.deepEqual(versions.map((v) => [v.kind, v.fileCount]), [['edit', 4], ['edit', 3]]);
  assert.equal((await user.get(`/api/versions/${versions[0].id}/file?path=index.html`)).body.content, 'edit 2');

  // Membaca tidak membuat versi.
  stack.db().prepare('UPDATE versions SET created_at = created_at - ?').run(11 * 60 * 1000);
  await user.get('/api/files');
  await user.get('/api/files/content?path=index.html');
  assert.equal((await list(user)).length, 2);
  // Tidak ada yang berubah sejak versi terakhir → tidak ada versi baru walau sudah lewat 10 menit.
  const before = (await list(user)).length;
  await save(user, 'index.html', 'edit 3');
  await save(user, 'index.html', 'edit 3');
  assert.equal((await list(user)).length, before + 1);
});

test('simpan versi manual: selalu dibuat, label dirapikan', async () => {
  const user = await stack.register();
  const res = await user.post('/api/versions', { label: `  Rilis \n  pertama ${'x'.repeat(100)}` });
  assert.equal(res.status, 201);
  assert.equal(typeof res.body.id, 'number');
  const second = await snapshot(user, '');
  assert.notEqual(second, res.body.id, 'manual tetap dibuat walau tidak ada perubahan');
  const versions = await list(user);
  assert.deepEqual(versions.map((v) => v.kind), ['manual', 'manual']);
  assert.equal(versions[1].label, `Rilis pertama ${'x'.repeat(100)}`.slice(0, 80));
  assert.equal(versions[0].label, '');
  // Isi file disimpan sekali per hash.
  const blobs = fs.readdirSync(path.join(stack.dataDir, 'versions', user.username), { recursive: true }).filter((p) => p.length > 60);
  assert.equal(blobs.length, 3);
});

test('detail versi: status tiap file dibanding kondisi sekarang', async () => {
  const user = await stack.register();
  await user.raw('POST', '/api/files/upload?path=logo.png', { rawBody: PNG, headers: { 'Content-Type': 'image/png' } });
  const id = await snapshot(user, 'titik awal');
  await save(user, 'index.html', 'berubah');
  await user.del('/api/files?path=script.js');
  await user.post('/api/files', { path: 'baru/halaman.html' });

  const { status, body } = await user.get(`/api/versions/${id}`);
  assert.equal(status, 200);
  assert.deepEqual({ ...body.version, createdAt: 0 }, { id, kind: 'manual', label: 'titik awal', createdAt: 0, fileCount: 4 });
  assert.deepEqual(body.files.map((f) => [f.path, f.status, f.image]), [
    ['baru/halaman.html', 'new', false],
    ['index.html', 'changed', false],
    ['logo.png', 'same', true],
    ['script.js', 'missing', false],
    ['style.css', 'same', false],
  ]);
  assert.equal(body.files.find((f) => f.path === 'logo.png').size, PNG.length);

  const img = await user.raw('GET', `/api/versions/${id}/file?path=logo.png`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(img.headers.get('cache-control'), 'private, max-age=86400');
  assert.equal(img.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  assert.ok(Buffer.from(await img.arrayBuffer()).equals(PNG));

  assert.equal((await user.get(`/api/versions/${id}/file?path=baru/halaman.html`)).body.error, 'File ini tidak ada di versi tersebut');
  assert.equal((await user.get(`/api/versions/${id}/file`)).body.error, 'Path wajib diisi');
  for (const bad of ['999999', 'abc']) {
    const res = await user.get(`/api/versions/${bad}`);
    assert.deepEqual([res.status, res.body.error], [404, 'Versi tidak ditemukan. Mungkin sudah terhapus karena melewati batas riwayat.']);
  }
  const other = await stack.register();
  assert.equal((await other.get(`/api/versions/${id}`)).status, 404, 'versi project orang lain');
  assert.equal((await other.post(`/api/versions/${id}/restore`)).status, 404);
});

test('kembalikan seluruh project ke sebuah versi (dan bisa dibatalkan)', async () => {
  const user = await stack.register();
  const root = rootOf(user);
  await user.post('/api/files', { path: 'lama/a.html' });
  await save(user, 'lama/a.html', 'isi lama');
  const original = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const id = await snapshot(user, 'bagus');

  await save(user, 'index.html', 'rusak');
  await user.del('/api/files?path=lama');
  await user.post('/api/files', { path: 'baru/x.html' });
  await user.post('/api/files', { path: 'kosong', type: 'dir' });

  const res = await user.post(`/api/versions/${id}/restore`);
  assert.equal(res.status, 200);
  assert.deepEqual([...res.body.touched].sort(), ['baru/x.html', 'index.html', 'lama/a.html']);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), original);
  assert.equal(fs.readFileSync(path.join(root, 'lama/a.html'), 'utf8'), 'isi lama');
  assert.ok(!fs.existsSync(path.join(root, 'baru')), 'file & folder yang dibuat setelah versi itu dihapus');
  assert.ok(!fs.existsSync(path.join(root, 'kosong')));

  // Kondisi sebelum restore tersimpan sebagai versi 'restore', jadi restore bisa dibatalkan.
  const versions = await list(user);
  assert.equal(versions[0].kind, 'restore');
  assert.match(versions[0].label, /^Sebelum dikembalikan ke versi \d{1,2} \p{L}{3}, \d{2}\.\d{2}$/u);
  assert.equal((await user.post(`/api/versions/${versions[0].id}/restore`)).status, 200);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), 'rusak');
  assert.ok(fs.existsSync(path.join(root, 'baru/x.html')) && !fs.existsSync(path.join(root, 'lama')));
  // Mengembalikan ke kondisi yang sama dengan sekarang: tidak ada yang disentuh.
  assert.deepEqual((await user.post(`/api/versions/${versions[0].id}/restore`)).body, { touched: [] });
});

test('kembalikan satu file saja', async () => {
  const user = await stack.register();
  const root = rootOf(user);
  const id = await snapshot(user, 'awal');
  const original = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  await save(user, 'style.css', 'body{}');
  await save(user, 'index.html', 'tetap diubah');
  await user.post('/api/files', { path: 'baru.html' });

  assert.deepEqual((await user.post(`/api/versions/${id}/restore`, { path: 'style.css' })).body, { touched: ['style.css'] });
  assert.equal(fs.readFileSync(path.join(root, 'style.css'), 'utf8'), original);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), 'tetap diubah');
  assert.deepEqual((await user.post(`/api/versions/${id}/restore`, { path: 'style.css' })).body, { touched: [] });
  // File yang belum ada di versi itu: mengembalikannya berarti menghapusnya.
  assert.deepEqual((await user.post(`/api/versions/${id}/restore`, { path: 'baru.html' })).body, { touched: ['baru.html'] });
  assert.ok(!fs.existsSync(path.join(root, 'baru.html')));
  const missing = await user.post(`/api/versions/${id}/restore`, { path: 'tidak-pernah-ada.html' });
  assert.deepEqual([missing.status, missing.body.error], [404, 'File tidak ditemukan di versi ini']);
  assert.equal((await user.post(`/api/versions/${id}/restore`, { path: '../x' })).status, 400);
});

test('batas riwayat mengikuti paket: versi lama & berlebih dipangkas, isi yang tak terpakai dibersihkan', async () => {
  const user = await stack.register();
  for (let i = 0; i < 22; i++) {
    fs.writeFileSync(path.join(rootOf(user), 'index.html'), `isi ke-${i}`);
    await snapshot(user, `v${i}`);
  }
  let versions = await list(user);
  assert.equal(versions.length, 20, 'paket gratis: maksimal 20 versi');
  assert.deepEqual([versions[0].label, versions.at(-1).label], ['v21', 'v2']);
  const blobDir = path.join(stack.dataDir, 'versions', user.username);
  const blobCount = () => fs.readdirSync(blobDir, { recursive: true }).filter((p) => p.length > 60).length;
  assert.equal(blobCount(), 22, '20 isi index.html + style.css + script.js');

  // Lebih tua dari 7 hari: ikut terhapus saat versi berikutnya dibuat.
  const old = versions.slice(-5).map((v) => v.id);
  stack.db().prepare(`UPDATE versions SET created_at = ? WHERE id IN (${old.join(',')})`).run(Date.now() - 8 * DAY_MS);
  await snapshot(user, 'terbaru');
  versions = await list(user);
  assert.equal(versions.length, 16);
  assert.equal(blobCount(), 17);

  // Pelanggan Pro: 30 hari, 200 versi.
  stack.db().prepare('INSERT INTO subscriptions (user_id, plan, started_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(user.userId, 'pro', Date.now(), Date.now() + DAY_MS, Date.now());
  assert.deepEqual((await user.get('/api/versions')).body.history, { days: 30, max: 200 });
  for (let i = 0; i < 6; i++) await snapshot(user, `pro${i}`);
  assert.equal((await list(user)).length, 22);
});

test('versi yang isinya sudah tidak tersedia → 410', async () => {
  const user = await stack.register();
  const id = await snapshot(user, 'awal');
  fs.rmSync(path.join(stack.dataDir, 'versions', user.username), { recursive: true });
  const res = await user.get(`/api/versions/${id}/file?path=index.html`);
  assert.deepEqual([res.status, res.body.error], [410, 'Isi file di versi ini sudah tidak tersedia']);
});

test('versi buatan AI Builder (server yang menjalankan AI) terbaca dan bisa dikembalikan', async () => {
  const user = await stack.register();
  const original = fs.readFileSync(path.join(rootOf(user), 'index.html'), 'utf8');
  await save(user, 'style.css', 'body { color: red }'); // versi 'edit' lebih dulu
  const call = (name, args) => ({ index: 0, id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } });
  stack.ai.script.push({ toolCalls: [call('write_file', { path: 'index.html', content: '<h1>Dari AI</h1>' })] }, { text: 'Selesai.' });
  const { final } = await user.prompt('ubah judul', { mode: 'build' });
  assert.equal(final.type, 'done');
  assert.equal(fs.readFileSync(path.join(rootOf(user), 'index.html'), 'utf8'), '<h1>Dari AI</h1>');

  const versions = await list(user);
  assert.deepEqual(versions.map((v) => v.kind), ['ai', 'edit']);
  assert.equal(versions[0].label, 'Sebelum AI: ubah judul');
  const detail = (await user.get(`/api/versions/${versions[0].id}`)).body;
  assert.deepEqual(detail.files.map((f) => [f.path, f.status]), [['index.html', 'changed'], ['script.js', 'same'], ['style.css', 'same']]);
  assert.deepEqual((await user.post(`/api/versions/${versions[0].id}/restore`)).body, { touched: ['index.html'] });
  assert.equal(fs.readFileSync(path.join(rootOf(user), 'index.html'), 'utf8'), original);
  // Setelah AI/restore, edit berikutnya langsung membuat versi baru walau belum 10 menit.
  await save(user, 'index.html', 'edit setelah restore');
  assert.deepEqual((await list(user)).map((v) => v.kind), ['edit', 'restore', 'ai', 'edit']);
});

// Publikasi manual (dev/prod): editor mengubah versi dev (<slug>--dev), website publik (<slug>) baru
// berubah setelah dipublikasikan. Database dev terpisah; struktur tabel ikut dipublikasikan, datanya tidak.
// Fitur ini hanya ada di server Go.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const skip = !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go';

let stack;
before(async () => { if (!skip) stack = await startStack(); });
after(() => stack?.stop());

const T = '/api/database/tables';
const PUBLIC = { list: 'public', view: 'public', create: 'public', update: 'owner', delete: 'owner' };
const page = (slug, p = '/') => stack.site(slug, p);
const dev = (slug, p = '/') => stack.site(`${slug}--dev`, p);
const rows = async (host, table) => JSON.parse((await stack.site(host, `/api/db/${table}`)).body).rows.map((r) => r.isi);
const write = (user, content, p = 'index.html') => user.put('/api/files/content', { path: p, content });

test('bawaan langsung tayang; versi dev hanya ada pada publikasi manual', { skip }, async () => {
  const user = await stack.register('toko-live');
  const status = (await user.get('/api/publish')).body;
  assert.deepEqual(status.publish, { mode: 'live', siteUrl: `http://toko-live.${stack.origin.slice(7)}`, publishedAt: null, files: [], schema: [], pending: false, destructive: false });
  assert.deepEqual([status.project.mode, status.project.previewUrl], [undefined, undefined]);
  const devPage = await dev('toko-live');
  assert.equal(devPage.status, 404);
  assert.match(devPage.body, /Versi dev tidak aktif/);
  assert.equal((await user.post('/api/publish', {})).status, 409);
  assert.deepEqual([(await user.put('/api/publish/mode', { mode: 'x' })).status], [400]);
});

test('publikasi manual: edit di dev, tayang setelah dipublikasikan', { skip }, async () => {
  const user = await stack.register('toko-pub');
  const original = (await page('toko-pub')).body;
  // Data asli sebelum beralih: ikut ke prod dan disalin ke dev.
  await user.post(T, { name: 'pesan', columns: [{ name: 'isi', type: 'text' }], rules: PUBLIC });
  await user.post(`${T}/pesan/rows`, { isi: 'asli' });

  const on = await user.put('/api/publish/mode', { mode: 'manual' });
  assert.equal(on.status, 200);
  assert.deepEqual([on.body.project.mode, on.body.project.previewUrl], ['manual', `http://toko-pub--dev.${stack.origin.slice(7)}`]);
  assert.equal(on.body.publish.pending, false);
  assert.match(on.body.publish.publishedAt, /^\d{4}-/);
  assert.equal((await user.get('/api/me')).body.project.mode, 'manual');

  // Dev & prod sama di awal; pengunjung dev tidak diindeks mesin pencari.
  const devPage = await dev('toko-pub');
  assert.deepEqual([devPage.status, devPage.body, devPage.headers['x-robots-tag']], [200, original, 'noindex']);
  assert.equal((await page('toko-pub')).body, original);

  // Edit (editor/AI) hanya mengubah dev.
  await write(user, '<h1>Draft baru</h1>');
  await user.post('/api/files', { path: 'baru.css' });
  await write(user, 'p{}', 'baru.css');
  assert.equal((await dev('toko-pub')).body, '<h1>Draft baru</h1>');
  assert.equal((await page('toko-pub')).body, original);
  let st = (await user.get('/api/publish')).body.publish;
  assert.deepEqual(st.files, [{ path: 'baru.css', change: 'added' }, { path: 'index.html', change: 'changed' }]);
  assert.equal(st.pending, true);

  // Database terpisah: data dev dan prod tidak saling memengaruhi.
  await stack.site('toko-pub', '/api/db/pesan', { method: 'POST', json: { isi: 'dari pengunjung' } });
  await stack.site('toko-pub--dev', '/api/db/pesan', { method: 'POST', json: { isi: 'uji coba' } });
  assert.deepEqual((await rows('toko-pub', 'pesan')).sort(), ['asli', 'dari pengunjung']);
  assert.deepEqual((await rows('toko-pub--dev', 'pesan')).sort(), ['asli', 'uji coba']);
  assert.deepEqual((await user.get(`${T}/pesan/rows`)).body.rows.map((r) => r.isi).sort(), ['asli', 'uji coba'], 'editor database = dev');

  // Struktur tabel dev: kolom baru, ganti nama kolom, tabel baru.
  await user.patch(`${T}/pesan`, { addColumns: [{ name: 'nama', type: 'text' }], renameColumns: [{ from: 'isi', to: 'isi' }] });
  await user.patch(`${T}/pesan`, { renameColumns: [{ from: 'nama', to: 'pengirim' }] });
  await user.post(T, { name: 'produk', columns: [{ name: 'harga', type: 'number' }], rules: PUBLIC });
  st = (await user.get('/api/publish')).body.publish;
  assert.deepEqual(st.schema, [
    { text: 'Kolom baru pesan.nama', destructive: false },
    { text: 'Ganti nama kolom pesan.nama → pengirim', destructive: false },
    { text: 'Tabel baru produk (kolom harga)', destructive: false },
  ]);
  assert.equal(st.destructive, false);

  // Gambar kiriman pengunjung di prod tidak boleh hilang saat publikasi.
  const prodUploads = path.join(stack.dataDir, 'published', 'toko-pub', 'uploads', 'pesan');
  fs.mkdirSync(prodUploads, { recursive: true });
  fs.writeFileSync(path.join(prodUploads, 'foto.png'), 'gambar pengunjung');

  const pub = await user.post('/api/publish', {});
  assert.equal(pub.status, 200);
  assert.equal(pub.body.publish.pending, false);
  assert.equal((await page('toko-pub')).body, '<h1>Draft baru</h1>');
  assert.equal((await page('toko-pub', '/baru.css')).body, 'p{}');
  assert.equal((await page('toko-pub', '/uploads/pesan/foto.png')).body, 'gambar pengunjung');
  // Struktur ikut, data prod tetap (tidak diganti data dev).
  assert.deepEqual((await rows('toko-pub', 'pesan')).sort(), ['asli', 'dari pengunjung']);
  const prodRow = JSON.parse((await page('toko-pub', '/api/db/pesan')).body).rows[0];
  assert.ok('pengirim' in prodRow && !('nama' in prodRow));
  assert.equal(JSON.parse((await page('toko-pub', '/api/db/produk')).body).rows.length, 0);
  assert.deepEqual((await user.get('/api/publish')).body.publish.schema, []);
});

test('perubahan yang menghapus data di website publik perlu konfirmasi', { skip }, async () => {
  const user = await stack.register('toko-hapus');
  await user.post(T, { name: 'catatan', columns: [{ name: 'isi', type: 'text' }, { name: 'lama', type: 'text' }], rules: PUBLIC });
  await user.put('/api/publish/mode', { mode: 'manual' });
  // Kolom/tabel yang dibuat lalu dihapus di dev tidak dianggap menghapus data publik.
  await user.post(T, { name: 'coba', columns: [] });
  await user.del(`${T}/coba`);
  await user.patch(`${T}/catatan`, { dropColumns: ['lama'] });
  const st = (await user.get('/api/publish')).body.publish;
  assert.deepEqual(st.schema, [
    { text: 'Tabel baru coba', destructive: false },
    { text: 'Hapus tabel coba', destructive: false },
    { text: 'Hapus kolom catatan.lama beserta datanya', destructive: true },
  ]);
  assert.equal(st.destructive, true);

  // Data di website publik masih memakai kolom lama sampai dipublikasikan.
  await stack.site('toko-hapus', '/api/db/catatan', { method: 'POST', json: { isi: 'x', lama: 'y' } });
  const refused = await user.post('/api/publish', {});
  assert.deepEqual([refused.status, refused.body.code], [409, 'confirm']);
  assert.equal(JSON.parse((await page('toko-hapus', '/api/db/catatan')).body).rows[0].lama, 'y');
  const ok = await user.post('/api/publish', { confirm: true });
  assert.equal(ok.status, 200);
  const row = JSON.parse((await page('toko-hapus', '/api/db/catatan')).body).rows[0];
  assert.deepEqual([row.isi, 'lama' in row], ['x', false]);
});

test('kembali ke langsung tayang: data asli dipakai lagi, dev ikut tayang', { skip }, async () => {
  const user = await stack.register('toko-balik');
  await user.post(T, { name: 'pesan', columns: [{ name: 'isi', type: 'text' }], rules: PUBLIC });
  await user.put('/api/publish/mode', { mode: 'manual' });
  await stack.site('toko-balik', '/api/db/pesan', { method: 'POST', json: { isi: 'asli' } });
  await stack.site('toko-balik--dev', '/api/db/pesan', { method: 'POST', json: { isi: 'uji' } });
  await write(user, '<p>belum dipublikasikan</p>');

  const refused = await user.put('/api/publish/mode', { mode: 'live' });
  assert.deepEqual([refused.status, refused.body.code], [409, 'confirm']);
  const back = await user.put('/api/publish/mode', { mode: 'live', confirm: true });
  assert.equal(back.status, 200);
  assert.deepEqual([back.body.project.mode, back.body.publish.mode], [undefined, 'live']);
  assert.equal((await page('toko-balik')).body, '<p>belum dipublikasikan</p>');
  assert.deepEqual(await rows('toko-balik', 'pesan'), ['asli']);
  assert.deepEqual((await user.get(`${T}/pesan/rows`)).body.rows.map((r) => r.isi), ['asli']);
  assert.equal((await dev('toko-balik')).status, 404);
  assert.ok(!fs.existsSync(path.join(stack.dataDir, 'published', 'toko-balik')));
  assert.ok(!fs.existsSync(path.join(stack.dataDir, 'db', 'toko-balik@prod.db')));

  // Bisa beralih lagi: perubahan struktur lama tidak ikut tercatat.
  await user.put('/api/publish/mode', { mode: 'manual' });
  assert.deepEqual((await user.get('/api/publish')).body.publish.schema, []);
});

test('hapus project ikut membuang versi publik', { skip }, async () => {
  const user = await stack.register('toko-induk');
  await user.post('/api/projects', { slug: 'toko-anak' });
  const anak = { 'X-Project': 'toko-anak' };
  await user.req('PUT', '/api/publish/mode', { mode: 'manual' }, anak);
  await user.req('POST', T, { name: 'x', columns: [] }, anak);
  await user.req('PUT', '/api/publish/mode', { mode: 'manual' }, anak);
  assert.ok(fs.existsSync(path.join(stack.dataDir, 'published', 'toko-anak')));
  assert.equal((await user.del('/api/projects/toko-anak')).status, 200);
  assert.ok(!fs.existsSync(path.join(stack.dataDir, 'published', 'toko-anak')));
  assert.equal((await page('toko-anak')).status, 404);
});

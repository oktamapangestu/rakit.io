// Editor database pemilik (/api/database): tabel, kolom, aturan akses, relasi, baris, dan upload.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

let stack;
before(async () => { stack = await startStack(); });
after(() => stack?.stop());

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('gambar')]);
const T = '/api/database/tables';
const OWNER = { list: 'owner', view: 'owner', create: 'owner', update: 'owner', delete: 'owner' };
const expectError = (res, status, message) => {
  assert.equal(res.status, status, JSON.stringify(res.body));
  if (typeof message === 'string') assert.equal(res.body.error, message);
  else assert.match(res.body.error, message);
};

test('daftar kosong lalu buat tabel: nama dirapikan, aturan bawaan khusus pemilik', async () => {
  const user = await stack.register();
  const empty = await user.get(T);
  assert.deepEqual(empty.body.tables, []);
  assert.deepEqual({ ...empty.body.usage, bytes: 0 }, { bytes: 0, tables: 0, limits: { bytes: 50 * 1024 * 1024, tables: 20 } });
  assert.ok(empty.body.usage.bytes > 0);
  assert.equal((await stack.client().get(T)).status, 401);

  const res = await user.post(T, {
    name: ' Buku Tamu ',
    columns: [{ name: 'Nama Lengkap', type: 'text', required: 1 }, { name: 'email', type: 'text', private: true }, { name: 'jumlah', type: 'number' }],
    rules: { list: 'public', create: 'public', view: 'siapa saja' },
  });
  assert.equal(res.status, 201);
  const { table } = res.body;
  assert.match(table.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual({ ...table, createdAt: '' }, {
    name: 'buku_tamu',
    columns: [
      { name: 'nama_lengkap', type: 'text', required: true, private: false },
      { name: 'email', type: 'text', required: false, private: true },
      { name: 'jumlah', type: 'number', required: false, private: false },
    ],
    rules: { ...OWNER, list: 'public', create: 'public' },
    createdAt: '',
    rowCount: 0,
  });
  const list = (await user.get(T)).body;
  assert.deepEqual(list.tables.map((t) => [t.name, t.rowCount]), [['buku_tamu', 0]]);
  assert.equal(list.usage.tables, 1);
  assert.equal((await user.post(T, { name: 'kosong' })).body.table.columns.length, 0, 'tabel tanpa kolom boleh');
});

test('buat tabel: masukan tidak valid', async () => {
  const user = await stack.register();
  await user.post(T, { name: 'produk', columns: [] });
  const cases = [
    [{}, 400, /^Nama tabel "undefined" tidak valid\. Pakai huruf kecil, angka, dan _, diawali huruf \(maks\. 40 karakter\)\.$/],
    [{ name: '1tabel' }, 400, /Nama tabel "1tabel" tidak valid/],
    [{ name: 'sqlite_x' }, 400, /tidak valid/],
    [{ name: '_rakit_tables' }, 400, /tidak valid/],
    [{ name: 'x'.repeat(41) }, 400, /tidak valid/],
    [{ name: 'produk' }, 409, 'Tabel "produk" sudah ada'],
    [{ name: 't', columns: [{ name: 'id', type: 'number' }] }, 400, 'Kolom "id" sudah dibuat otomatis'],
    [{ name: 't', columns: [{ name: 'created_at', type: 'date' }] }, 400, 'Kolom "created_at" sudah dibuat otomatis'],
    [{ name: 't', columns: [{ name: 'a', type: 'json' }] }, 400, 'Tipe kolom "json" tidak dikenal. Pilih: text, number, boolean, date, reference, image'],
    [{ name: 't', columns: [{ name: 'a' }] }, 400, /^Tipe kolom "undefined" tidak dikenal/],
    [{ name: 't', columns: [{ type: 'text' }] }, 400, /^Nama kolom "undefined" tidak valid/],
    [{ name: 't', columns: [{ name: 'a', type: 'text' }, { name: 'A', type: 'number' }] }, 400, 'Kolom "a" ditulis lebih dari sekali'],
    [{ name: 't', columns: Array.from({ length: 31 }, (_, i) => ({ name: `k${i}`, type: 'text' })) }, 400, 'Maksimal 30 kolom per tabel'],
    [{ name: 't', columns: [{ name: 'p', type: 'reference' }] }, 400, 'Kolom relasi "p" harus menunjuk ke tabel lain (refTable)'],
    [{ name: 't', columns: [{ name: 'p', type: 'reference', refTable: 'tidak_ada' }] }, 400, 'Kolom "p" menunjuk ke tabel "tidak_ada" yang tidak ada'],
    [{ name: 't', columns: [{ name: 'p', type: 'reference', refTable: 't' }] }, 400, 'Kolom "p" tidak bisa menunjuk ke tabelnya sendiri'],
  ];
  for (const [body, status, message] of cases) expectError(await user.post(T, body), status, message);
  assert.deepEqual((await user.get(T)).body.tables.map((t) => t.name), ['produk']);

  for (let i = 0; i < 19; i++) assert.equal((await user.post(T, { name: `tabel_${i}` })).status, 201);
  expectError(await user.post(T, { name: 'kelebihan' }), 413, 'Maksimal 20 tabel per proyek');
});

test('ubah tabel: tambah/hapus/ganti nama kolom, flag, aturan, dan ganti nama tabel', async () => {
  const user = await stack.register();
  await user.post(T, { name: 'kategori', columns: [{ name: 'nama', type: 'text' }] });
  await user.post(T, { name: 'produk', columns: [{ name: 'nama', type: 'text' }, { name: 'harga', type: 'number' }, { name: 'kategori_id', type: 'reference', refTable: 'kategori' }] });
  await user.post(`${T}/produk/rows`, { nama: 'Kopi', harga: 15000 });
  const patch = (name, body) => user.patch(`${T}/${name}`, body);

  const res = await patch('produk', {
    addColumns: [{ name: 'Stok', type: 'number' }, { name: 'aktif', type: 'boolean', required: true }],
    dropColumns: ['harga'],
    renameColumns: [{ from: 'nama', to: 'Judul Produk' }, { from: 'stok', to: 'stok' }],
    columnFlags: { judul_produk: { required: true }, stok: { private: 1, required: 0 } },
    rules: { list: 'public', view: 'salah' },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.table.columns, [
    { name: 'judul_produk', type: 'text', required: true, private: false },
    { name: 'kategori_id', type: 'reference', required: false, private: false, refTable: 'kategori' },
    { name: 'stok', type: 'number', required: false, private: true },
    { name: 'aktif', type: 'boolean', required: true, private: false },
  ]);
  assert.deepEqual(res.body.table.rules, { ...OWNER, list: 'public' });
  assert.equal(res.body.table.rowCount, 1);
  const row = (await user.get(`${T}/produk/rows`)).body.rows[0];
  assert.deepEqual({ ...row, created_at: '' }, { id: 1, created_at: '', judul_produk: 'Kopi', kategori_id: null, stok: null, aktif: null });

  // Ganti nama tabel: kolom relasi di tabel lain ikut menunjuk ke nama baru; tanggal dibuat tetap.
  const before = (await user.get(T)).body.tables.find((t) => t.name === 'kategori').createdAt;
  const renamed = await patch('kategori', { rename: 'Jenis Barang' });
  assert.deepEqual([renamed.body.table.name, renamed.body.table.createdAt], ['jenis_barang', before]);
  const tables = (await user.get(T)).body.tables;
  assert.deepEqual(tables.map((t) => t.name), ['jenis_barang', 'produk']);
  assert.equal(tables[1].columns.find((c) => c.name === 'kategori_id').refTable, 'jenis_barang');
  assert.equal((await patch('produk', { rename: 'produk' })).status, 200, 'nama sama = tidak berubah');

  expectError(await patch('tidak_ada', {}), 404, 'Tabel "tidak_ada" tidak ditemukan');
  expectError(await patch('produk', { addColumns: [{ name: 'stok', type: 'text' }] }), 409, 'Kolom "stok" sudah ada');
  expectError(await patch('produk', { dropColumns: ['tidak_ada'] }), 404, 'Kolom "tidak_ada" tidak ditemukan');
  expectError(await patch('produk', { renameColumns: [{ from: 'x', to: 'y' }] }), 404, 'Kolom "x" tidak ditemukan');
  expectError(await patch('produk', { renameColumns: [{ from: 'stok', to: 'aktif' }] }), 409, 'Kolom "aktif" sudah ada');
  expectError(await patch('produk', { renameColumns: [{ from: 'stok', to: 'id' }] }), 409, 'Kolom "id" sudah ada');
  expectError(await patch('produk', { columnFlags: { x: { required: true } } }), 404, 'Kolom "x" tidak ditemukan');
  expectError(await patch('produk', { rename: 'jenis_barang' }), 409, 'Tabel "jenis_barang" sudah ada');
  expectError(await patch('produk', { rename: '9x' }), 400, /Nama tabel "9x" tidak valid/);
  // Perubahan yang gagal di tengah tidak tersimpan sebagian.
  expectError(await patch('produk', { addColumns: [{ name: 'baru', type: 'text' }], dropColumns: ['tidak_ada'] }), 404, /tidak ditemukan/);
  assert.ok(!(await user.get(T)).body.tables[1].columns.some((c) => c.name === 'baru'));
  assert.equal((await patch('produk', {})).status, 200);
});

test('hapus tabel: ditolak bila masih dirujuk; file upload-nya ikut terhapus', async () => {
  const user = await stack.register();
  await user.post(T, { name: 'kategori', columns: [{ name: 'gambar', type: 'image' }] });
  await user.post(T, { name: 'produk', columns: [{ name: 'kategori_id', type: 'reference', refTable: 'kategori' }, { name: 'k2', type: 'reference', refTable: 'kategori' }] });
  const up = await user.raw('POST', `${T}/kategori/upload?column=gambar`, { rawBody: PNG, headers: { 'Content-Type': 'image/png' } });
  assert.equal(up.status, 201);
  const dir = path.join(stack.dataDir, 'sites', user.username, 'uploads', 'kategori');
  assert.equal(fs.readdirSync(dir).length, 1);

  expectError(await user.del(`${T}/kategori`), 409, 'Tabel "kategori" masih dirujuk oleh produk.kategori_id, produk.k2. Hapus dulu kolom relasinya.');
  await user.patch(`${T}/produk`, { dropColumns: ['kategori_id', 'k2'] });
  assert.deepEqual(await user.del(`${T}/kategori`), { status: 200, body: { ok: true } });
  assert.ok(!fs.existsSync(dir));
  expectError(await user.del(`${T}/kategori`), 404, 'Tabel "kategori" tidak ditemukan');
  expectError(await user.del(`${T}/Produk`), 404, 'Tabel "Produk" tidak ditemukan');
  assert.deepEqual((await user.get(T)).body.tables.map((t) => t.name), ['produk']);
});

test('baris: pemilik melihat semua kolom dan boleh semua operasi tanpa aturan publik', async () => {
  const user = await stack.register();
  await user.post(T, { name: 'tamu', columns: [{ name: 'nama', type: 'text', required: true }, { name: 'email', type: 'text', private: true }, { name: 'hadir', type: 'boolean' }] });
  const R = `${T}/tamu/rows`;

  const created = await user.post(R, { nama: 'Budi', email: 'b@x.id', hadir: 'ya' });
  assert.equal(created.status, 201);
  assert.deepEqual({ ...created.body.row, created_at: '' }, { id: 1, created_at: '', nama: 'Budi', email: 'b@x.id', hadir: true });
  await user.post(R, { nama: 'Ani', email: 'a@x.id', hadir: false });

  const list = (await user.get(`${R}?sort=-nama&email=b@x.id`)).body;
  assert.deepEqual([list.total, list.limit, list.offset, list.rows.map((r) => r.email)], [1, 50, 0, ['b@x.id']], 'kolom privat boleh difilter pemilik');
  assert.deepEqual((await user.get(`${R}?sort=email&limit=1`)).body.rows.map((r) => r.nama), ['Ani']);

  const updated = await user.patch(`${R}/1`, { hadir: false });
  assert.deepEqual([updated.status, updated.body.row.hadir, updated.body.row.email], [200, false, 'b@x.id']);
  assert.deepEqual(await user.del(`${R}/2`), { status: 200, body: { ok: true } });
  assert.equal((await user.get(R)).body.total, 1);

  expectError(await user.post(R, { email: 'x' }), 400, 'Kolom "nama" wajib diisi');
  expectError(await user.post(R, [1]), 400, /Body harus berupa objek JSON/);
  expectError(await user.patch(`${R}/99`, { nama: 'X' }), 404, 'Baris tidak ditemukan');
  expectError(await user.del(`${R}/abc`), 400, 'id tidak valid');
  expectError(await user.get(`${T}/tidak_ada/rows`), 404, 'Tabel "tidak_ada" tidak ditemukan');
  expectError(await user.post(`${T}/tidak_ada/rows`, {}), 404, 'Tabel "tidak_ada" tidak ditemukan');
  // Pengunjung tetap tidak bisa apa-apa: semua operasi masih khusus pemilik.
  assert.equal((await stack.site(user.username, '/api/db/tamu')).status, 403);
});

test('upload pemilik: SVG boleh, bukan gambar ditolak', async () => {
  const user = await stack.register();
  await user.post(T, { name: 'galeri', columns: [{ name: 'foto', type: 'image' }, { name: 'judul', type: 'text' }] });
  const upload = async (query, body, type = 'image/png') => {
    const res = await user.raw('POST', `${T}/galeri/upload?${query}`, { rawBody: body, headers: { 'Content-Type': type } });
    return { status: res.status, body: await res.json() };
  };
  const svg = await upload('column=foto', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml');
  assert.equal(svg.status, 201);
  assert.match(svg.body.url, /^\/uploads\/galeri\/[a-z0-9]+-[0-9a-f]{10}\.svg$/);
  assert.ok(fs.existsSync(path.join(stack.dataDir, 'sites', user.username, svg.body.url)));
  expectError(await upload('column=judul', PNG), 400, /bukan kolom gambar/);
  expectError(await upload('column=foto', Buffer.from('teks biasa')), 400, 'File harus berupa gambar JPG, PNG, WEBP, GIF, atau AVIF');
  expectError(await upload('', PNG), 400, /Sertakan \?column=/);
  const other = await stack.register();
  const res = await other.raw('POST', `${T}/galeri/upload?column=foto`, { rawBody: PNG, headers: { 'Content-Type': 'image/png' } });
  assert.equal(res.status, 404, 'tabel di project orang lain');
});

test('tabel buatan AI Builder langsung muncul di editor database, dan sebaliknya dipakai AI', async () => {
  const user = await stack.register();
  await user.post(T, { name: 'lama', columns: [{ name: 'isi', type: 'text' }], rules: { list: 'public' } });
  const call = (name, args) => ({ index: 0, id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } });
  stack.ai.script.push(
    { toolCalls: [call('create_table', { name: 'ucapan', columns: [{ name: 'nama', type: 'text', required: true }, { name: 'pesan', type: 'text' }], public: ['list', 'create'] })] },
    { text: 'Tabel dibuat.' },
  );
  const { final } = await user.prompt('buat buku tamu', { mode: 'build' });
  assert.equal(final.type, 'done');
  // AI menerima ringkasan tabel yang sudah ada.
  const sent = JSON.stringify(stack.ai.requests.at(-2).messages);
  assert.ok(sent.includes('- lama (0 rows; public: list)'));

  const tables = (await user.get(T)).body.tables;
  assert.deepEqual(tables.map((t) => t.name), ['lama', 'ucapan']);
  assert.deepEqual(tables[1].rules, { ...OWNER, list: 'public', create: 'public' });
  assert.equal((await user.post(`${T}/ucapan/rows`, { nama: 'Budi', pesan: 'Selamat' })).status, 201);
  assert.equal((await stack.site(user.username, '/api/db/ucapan')).status, 200);
});

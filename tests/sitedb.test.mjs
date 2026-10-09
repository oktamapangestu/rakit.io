// API database publik di domain website: <slug>.<domain>/api/db/<tabel>. Tabel dibuat pemilik lewat
// editor database (/api/database), lalu dipakai pengunjung sesuai aturan akses tiap operasi.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DAY_MS, startStack } from './helpers/harness.mjs';

let stack;
before(async () => { stack = await startStack(); });
after(() => stack?.stop());

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('isi-gambar-tiruan')]);
const ALL_PUBLIC = { list: 'public', view: 'public', create: 'public', update: 'public', delete: 'public' };

/** Akun baru + tabel-tabelnya. Tiap test memakai website sendiri supaya batas request tidak saling memengaruhi. */
async function siteWith(...tables) {
  const owner = await stack.register();
  for (const table of tables) {
    const res = await owner.post('/api/database/tables', table);
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  const call = async (method, url, opts = {}) => {
    const res = await stack.site(owner.username, `/api/db${url}`, { method, ...opts });
    let body = res.body;
    try { body = JSON.parse(res.body); } catch { /* bukan JSON */ }
    return { status: res.status, headers: res.headers, body };
  };
  return {
    owner,
    slug: owner.username,
    root: path.join(stack.dataDir, 'sites', owner.username),
    get: (url) => call('GET', url),
    post: (url, json) => call('POST', url, { json }),
    patch: (url, json) => call('PATCH', url, { json }),
    del: (url) => call('DELETE', url),
    call,
  };
}

const tamu = (rules = ALL_PUBLIC) => ({
  name: 'tamu',
  columns: [
    { name: 'nama', type: 'text', required: true },
    { name: 'email', type: 'text', private: true },
    { name: 'jumlah', type: 'number' },
    { name: 'hadir', type: 'boolean' },
    { name: 'tanggal', type: 'date' },
  ],
  rules,
});

test('tabel tidak ada / website tanpa database → 404; operasi khusus pemilik → 403', async () => {
  const kosong = await stack.register();
  const none = await stack.site(kosong.username, '/api/db/apa');
  assert.equal(none.status, 404);
  assert.deepEqual(JSON.parse(none.body), { error: 'Tabel "apa" tidak ditemukan' });
  assert.equal(none.headers['cache-control'], 'no-store');
  assert.equal(fs.existsSync(path.join(stack.dataDir, 'db', `${kosong.username}.db`)), false, 'request publik tidak membuat file database');
  assert.equal((await stack.site('belum-terdaftar', '/api/db/apa')).status, 404);

  const site = await siteWith(tamu({ create: 'public' }));
  assert.equal((await site.get('/lain')).status, 404);
  assert.equal((await site.get('/Tamu')).status, 404, 'nama tabel peka huruf besar/kecil');
  const list = await site.get('/tamu');
  assert.equal(list.status, 403);
  assert.match(list.body.error, /Pengunjung tidak diizinkan melihat daftar data tabel "tamu"/);
  assert.equal((await site.post('/tamu', { nama: 'Budi' })).status, 201);
  assert.equal((await site.get('/tamu/1')).status, 403);
  assert.equal((await site.patch('/tamu/1', { nama: 'X' })).status, 403);
  assert.equal((await site.del('/tamu/1')).status, 403);
});

test('tambah baris: nilai dikonversi sesuai tipe, kolom privat tidak dikembalikan', async () => {
  const site = await siteWith(tamu());
  const res = await site.post('/tamu', { nama: 'Budi', email: 'budi@contoh.id', jumlah: '2', hadir: 'ya', tanggal: '2026-12-31T19:00' });
  assert.equal(res.status, 201);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(res.body), ['id', 'created_at', 'nama', 'jumlah', 'hadir', 'tanggal']);
  assert.equal(res.body.id, 1);
  assert.match(res.body.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual({ ...res.body, created_at: null }, { id: 1, created_at: null, nama: 'Budi', jumlah: 2, hadir: true, tanggal: '2026-12-31T19:00' });

  // Kolom yang tidak diisi = null; angka pecahan & nilai kosong.
  const two = await site.post('/tamu', { nama: 'Ani', jumlah: 1.5, hadir: false, tanggal: '' });
  assert.deepEqual({ ...two.body, created_at: null }, { id: 2, created_at: null, nama: 'Ani', jumlah: 1.5, hadir: false, tanggal: null });
  const three = await site.post('/tamu', { nama: 42 });
  assert.deepEqual([three.body.nama, three.body.jumlah, three.body.hadir], ['42', null, null]);

  // Pemilik (editor database, proses yang sama/berbeda) melihat data yang sama termasuk kolom privat.
  const rows = (await site.owner.get('/api/database/tables/tamu/rows')).body;
  assert.equal(rows.total, 3);
  assert.equal(rows.rows[0].email, 'budi@contoh.id');
});

test('tambah baris: masukan tidak valid ditolak 400 dengan pesan yang jelas', async () => {
  const site = await siteWith(tamu());
  const cases = [
    [{ jumlah: 1 }, /Kolom "nama" wajib diisi/],
    [{ nama: '' }, /Kolom "nama" wajib diisi/],
    [{ nama: 'A', umur: 3 }, /Kolom tidak dikenal: umur/],
    [{ nama: 'A', jumlah: 'banyak' }, /Nilai kolom "jumlah" harus berupa angka/],
    [{ nama: 'A', jumlah: true }, /harus berupa angka/],
    [{ nama: 'A', hadir: 'mungkin' }, /harus true atau false/],
    [{ nama: 'A', tanggal: 'besok' }, /harus tanggal/],
    [{ nama: 'A', tanggal: '2026-13-01' }, /harus tanggal/],
    [{ nama: { a: 1 } }, /harus berupa teks/],
    [{ nama: 'x'.repeat(10_001) }, /maksimal 10000 karakter/],
    [[1, 2], /Body harus berupa objek JSON/],
  ];
  for (const [body, message] of cases) {
    const res = await site.post('/tamu', body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.match(res.body.error, message);
  }
  assert.equal((await site.post('/tamu', { nama: 'x'.repeat(10_000) })).status, 201);
  // id dan created_at dari pengunjung diabaikan, bukan ditolak.
  const sys = await site.post('/tamu', { nama: 'B', id: 99, created_at: '2000-01-01' });
  assert.equal(sys.status, 201);
  assert.equal(sys.body.id, 2);

  const bad = await site.call('POST', '/tamu', { body: '{"nama": ', headers: { 'Content-Type': 'application/json' } });
  assert.deepEqual([bad.status, bad.body], [400, { error: 'JSON tidak valid' }]);
  const plain = await site.call('POST', '/tamu', { body: 'nama=Budi', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(plain.status, 400);
  assert.match(plain.body.error, /Body harus berupa objek JSON/);
  const big = await site.post('/tamu', { nama: 'A', email: 'x'.repeat(70_000) });
  assert.deepEqual([big.status, big.body], [413, { error: 'Request terlalu besar' }]);
  // Teks base64 gambar di kolom teks: diarahkan ke upload.
  const b64 = await site.post('/tamu', { nama: `data:image/png;base64,${'A'.repeat(11_000)}` });
  assert.equal(b64.status, 413);
  assert.match(b64.body.error, /Upload filenya dulu/);
});

test('daftar: urut, batas, offset, dan filter', async () => {
  const site = await siteWith(tamu());
  const data = [['Cici', 3, true], ['Ani', 1, false], ['Budi', 2, true], ['Dedi', null, null]];
  for (const [nama, jumlah, hadir] of data) await site.post('/tamu', { nama, jumlah, hadir, email: `${nama}@x.id` });
  const names = async (query) => {
    const res = await site.get(`/tamu${query}`);
    assert.equal(res.status, 200, `${query} ${JSON.stringify(res.body)}`);
    return res.body.rows.map((r) => r.nama);
  };

  const all = await site.get('/tamu');
  assert.deepEqual([all.body.total, all.body.limit, all.body.offset], [4, 50, 0]);
  assert.deepEqual(all.body.rows.map((r) => r.id), [1, 2, 3, 4]);
  assert.ok(!('email' in all.body.rows[0]));

  assert.deepEqual(await names('?sort=nama'), ['Ani', 'Budi', 'Cici', 'Dedi']);
  assert.deepEqual(await names('?sort=-nama'), ['Dedi', 'Cici', 'Budi', 'Ani']);
  assert.deepEqual(await names('?sort=-created_at&limit=2'), ['Dedi', 'Budi']);
  assert.deepEqual(await names('?sort=id&limit=2&offset=1'), ['Ani', 'Budi']);
  assert.deepEqual(await names('?limit=abc&offset=-5'), ['Cici', 'Ani', 'Budi', 'Dedi']);
  assert.equal((await site.get('/tamu?limit=1000')).body.limit, 100);
  assert.equal((await site.get('/tamu?limit=0')).body.limit, 50);
  assert.equal((await site.get('/tamu?limit=2abc')).body.limit, 2);

  assert.deepEqual(await names('?hadir=true'), ['Cici', 'Budi']);
  assert.deepEqual(await names('?hadir=0'), ['Ani']);
  assert.deepEqual(await names('?jumlah=2'), ['Budi']);
  assert.deepEqual(await names('?nama=Ani'), ['Ani']);
  assert.deepEqual(await names('?id=3'), ['Budi']);
  assert.deepEqual(await names('?jumlah='), ['Dedi'], 'nilai kosong = yang belum diisi');
  assert.deepEqual(await names('?hadir=true&jumlah=3'), ['Cici']);
  assert.deepEqual(await names('?nama=Ani&nama=Budi'), ['Ani'], 'kunci berulang: nilai pertama');
  const filtered = await site.get('/tamu?hadir=true&limit=1');
  assert.deepEqual([filtered.body.total, filtered.body.rows.length], [2, 1]);

  for (const [query, message] of [
    ['?sort=email', /Tidak bisa mengurutkan berdasarkan "email"/],
    ['?sort=tidak_ada', /Tidak bisa mengurutkan/],
    ['?email=Ani@x.id', /Tidak bisa memfilter kolom "email"/],
    ['?apa=1', /Tidak bisa memfilter kolom "apa"/],
    ['?jumlah=dua', /harus berupa angka/],
  ]) {
    const res = await site.get(`/tamu${query}`);
    assert.equal(res.status, 400, query);
    assert.match(res.body.error, message);
  }
});

test('lihat, ubah, hapus satu baris', async () => {
  const site = await siteWith(tamu());
  await site.post('/tamu', { nama: 'Budi', email: 'b@x.id', jumlah: 2 });

  assert.deepEqual((await site.get('/tamu/1')).body.nama, 'Budi');
  assert.ok(!('email' in (await site.get('/tamu/1')).body));
  assert.deepEqual([(await site.get('/tamu/9')).status, (await site.get('/tamu/9')).body], [404, { error: 'Baris tidak ditemukan' }]);
  for (const id of ['abc', '0', '-1', '1.5']) assert.deepEqual((await site.get(`/tamu/${id}`)).body, { error: 'id tidak valid' }, id);

  const upd = await site.patch('/tamu/1', { jumlah: 5, hadir: true });
  assert.equal(upd.status, 200);
  assert.deepEqual([upd.body.nama, upd.body.jumlah, upd.body.hadir], ['Budi', 5, true]);
  assert.equal((await site.patch('/tamu/1', { jumlah: null })).body.jumlah, null);
  assert.match((await site.patch('/tamu/1', { nama: '' })).body.error, /Kolom "nama" wajib diisi/);
  assert.deepEqual((await site.patch('/tamu/1', {})).body, { error: 'Tidak ada kolom yang diubah' });
  assert.deepEqual((await site.patch('/tamu/1', { id: 7 })).body, { error: 'Tidak ada kolom yang diubah' });
  assert.equal((await site.patch('/tamu/9', { jumlah: 1 })).status, 404);
  assert.equal((await site.patch('/tamu/x', { jumlah: 1 })).status, 400);

  assert.deepEqual([(await site.del('/tamu/1')).status, (await site.get('/tamu')).body.total], [200, 0]);
  assert.equal((await site.del('/tamu/1')).status, 404);
  assert.equal((await site.del('/tamu/x')).status, 400);
  // id tidak dipakai ulang setelah baris dihapus.
  assert.equal((await site.post('/tamu', { nama: 'Ani' })).body.id, 2);
});

test('relasi antar tabel: validasi id, expand, dan hapus melepas rujukan', async () => {
  const site = await siteWith(
    { name: 'produk', columns: [{ name: 'nama', type: 'text' }, { name: 'modal', type: 'number', private: true }], rules: ALL_PUBLIC },
    { name: 'pesanan', columns: [{ name: 'produk_id', type: 'reference', refTable: 'produk' }, { name: 'catatan', type: 'text' }], rules: ALL_PUBLIC },
  );
  await site.post('/produk', { nama: 'Kopi', modal: 5000 });
  await site.post('/produk', { nama: 'Teh', modal: 3000 });

  const bad = await site.post('/pesanan', { produk_id: 99 });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /menunjuk ke produk id 99 yang tidak ada/);
  assert.match((await site.post('/pesanan', { produk_id: 'kopi' })).body.error, /id baris produk/);
  assert.equal((await site.post('/pesanan', { produk_id: '1', catatan: 'panas' })).status, 201);
  await site.post('/pesanan', { produk_id: 2 });
  await site.post('/pesanan', { catatan: 'tanpa produk' });

  const plain = await site.get('/pesanan');
  assert.deepEqual(plain.body.rows.map((r) => r.produk_id), [1, 2, null]);
  assert.ok(!('produk_id__ref' in plain.body.rows[0]));

  const expanded = await site.get('/pesanan?expand=produk_id');
  assert.deepEqual(expanded.body.rows.map((r) => r.produk_id__ref?.nama ?? null), ['Kopi', 'Teh', null]);
  assert.deepEqual(Object.keys(expanded.body.rows[0].produk_id__ref), ['id', 'created_at', 'nama'], 'kolom privat tabel tujuan disembunyikan');
  assert.equal((await site.get('/pesanan/1?expand=produk_id')).body.produk_id__ref.nama, 'Kopi');
  assert.match((await site.get('/pesanan?expand=catatan')).body.error, /Kolom "catatan" bukan relasi/);
  assert.deepEqual((await site.get('/pesanan?produk_id=2')).body.rows.map((r) => r.id), [2]);

  assert.equal((await site.del('/produk/1')).status, 200);
  assert.deepEqual((await site.get('/pesanan')).body.rows.map((r) => r.produk_id), [null, 2, null]);
});

test('kolom gambar: alamat divalidasi; upload menyimpan file di website dan dibersihkan saat tidak dipakai', async () => {
  const site = await siteWith({
    name: 'produk',
    columns: [{ name: 'nama', type: 'text' }, { name: 'gambar', type: 'image' }],
    rules: ALL_PUBLIC,
  });
  assert.equal((await site.post('/produk', { nama: 'A', gambar: '/images/logo.png' })).status, 201);
  assert.equal((await site.post('/produk', { nama: 'B', gambar: 'https://contoh.id/a.jpg' })).status, 201);
  for (const gambar of ['data:image/png;base64,AAAA', 'bukan alamat', '/../rahasia.png', '/uploads/a.txt', 7]) {
    assert.equal((await site.post('/produk', { nama: 'C', gambar })).status, 400, String(gambar));
  }

  const upload = (query, body = PNG, headers = { 'Content-Type': 'image/png' }) => site.call('POST', `/produk/upload${query}`, { body, headers });
  const up = await upload('?column=gambar');
  assert.equal(up.status, 201);
  assert.match(up.body.url, /^\/uploads\/produk\/[a-z0-9]+-[0-9a-f]{10}\.png$/);
  assert.ok(fs.readFileSync(path.join(site.root, up.body.url)).equals(PNG));
  const served = await stack.site(site.slug, up.body.url);
  assert.deepEqual([served.status, served.headers['content-type']], [200, 'image/png']);

  assert.match((await upload('')).body.error, /Sertakan \?column=<nama kolom gambar>.*: gambar$/);
  assert.match((await upload('?column=nama')).body.error, /bukan kolom gambar/);
  assert.match((await upload('?column=gambar', Buffer.from('bukan gambar'))).body.error, /File harus berupa gambar/);
  assert.match((await upload('?column=gambar', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).body.error, /File harus berupa gambar/, 'SVG dari pengunjung ditolak');
  assert.equal((await upload('?column=gambar', Buffer.alloc(0))).status, 400);
  assert.equal((await site.call('POST', '/lain/upload?column=gambar', { body: PNG })).status, 404);

  // Baris memakai gambar itu, lalu diganti: file lama dihapus. Baris dihapus: file ikut dihapus.
  const row = (await site.post('/produk', { nama: 'D', gambar: up.body.url })).body;
  const up2 = await upload('?column=gambar');
  assert.equal((await site.patch(`/produk/${row.id}`, { gambar: up2.body.url })).status, 200);
  assert.equal(fs.existsSync(path.join(site.root, up.body.url)), false);
  assert.equal(fs.existsSync(path.join(site.root, up2.body.url)), true);
  await site.del(`/produk/${row.id}`);
  assert.equal(fs.existsSync(path.join(site.root, up2.body.url)), false);
});

test('upload: hanya bila Tambah/Ubah dibuka untuk publik; ukuran mengikuti paket pemilik', async () => {
  const site = await siteWith({ name: 'galeri', columns: [{ name: 'foto', type: 'image' }], rules: { list: 'public' } });
  const upload = (body) => site.call('POST', '/galeri/upload?column=foto', { body, headers: { 'Content-Type': 'image/png' } });
  const refused = await upload(PNG);
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /tidak diizinkan mengupload gambar/);

  await site.owner.req('PATCH', '/api/database/tables/galeri', { rules: { update: 'public' } });
  assert.equal((await upload(PNG)).status, 201);

  // Paket gratis: maks. 1 MB per gambar. Pro: 5 MB.
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
  const tooBig = await upload(big);
  assert.equal(tooBig.status, 413);
  assert.match(tooBig.body.error, /Ukuran gambar maksimal 1 MB/);
  stack.db().prepare('INSERT INTO subscriptions (user_id, plan, started_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(site.owner.userId, 'pro', Date.now(), Date.now() + 30 * DAY_MS, Date.now());
  assert.equal((await upload(big)).status, 201);
  // Di atas batas server (lebih dari batas paket mana pun): ditolak sebelum dibaca seluruhnya.
  const huge = await upload(Buffer.concat([PNG, Buffer.alloc(12 * 1024 * 1024)]));
  assert.equal(huge.status, 413);
  assert.match(huge.body.error, /^File terlalu besar \(maks\. \d+ MB\)$/);
});

test('perubahan dari editor database langsung terlihat di API publik', async () => {
  const site = await siteWith(tamu({ list: 'public' }));
  await site.owner.post('/api/database/tables/tamu/rows', { nama: 'Dari pemilik', email: 'p@x.id' });
  assert.deepEqual((await site.get('/tamu')).body.rows.map((r) => r.nama), ['Dari pemilik']);

  await site.owner.req('PATCH', '/api/database/tables/tamu', { addColumns: [{ name: 'kota', type: 'text' }], rules: { create: 'public', list: 'owner' } });
  assert.equal((await site.get('/tamu')).status, 403);
  assert.equal((await site.post('/tamu', { nama: 'Tamu', kota: 'Solo' })).body.kota, 'Solo');

  await site.owner.req('PATCH', '/api/database/tables/tamu', { rename: 'undangan', rules: { list: 'public' } });
  assert.equal((await site.get('/tamu')).status, 404);
  assert.equal((await site.get('/undangan')).body.total, 2);

  assert.equal((await site.owner.req('DELETE', '/api/database/tables/undangan')).status, 200);
  assert.equal((await site.get('/undangan')).status, 404);
});

test('project dihapus lalu dibuat lagi dengan subdomain yang sama: data lama tidak muncul', async () => {
  const owner = await stack.register();
  const slug = `${owner.username}-b`;
  const headers = { 'X-Project': slug };
  const make = async () => {
    assert.equal((await owner.post('/api/projects', { slug, name: 'Kedua' })).status, 201);
    assert.equal((await owner.req('POST', '/api/database/tables', { name: 'catatan', columns: [{ name: 'isi', type: 'text' }], rules: ALL_PUBLIC }, headers)).status, 201);
  };
  const list = async () => JSON.parse((await stack.site(slug, '/api/db/catatan')).body);

  await make();
  assert.equal((await stack.site(slug, '/api/db/catatan', { method: 'POST', json: { isi: 'lama' } })).status, 201);
  assert.equal((await list()).total, 1);

  assert.equal((await owner.req('DELETE', `/api/projects/${slug}`)).status, 200);
  assert.equal((await stack.site(slug, '/api/db/catatan')).status, 404);
  await make();
  assert.equal((await list()).total, 0);
  assert.equal((await stack.site(slug, '/api/db/catatan', { method: 'POST', json: { isi: 'baru' } })).status, 201);
  assert.deepEqual((await owner.req('GET', '/api/database/tables/catatan/rows', undefined, headers)).body.rows.map((r) => r.isi), ['baru']);
});

test('pengunjung dan pemilik menulis bersamaan ke database yang sama: tidak ada yang gagal atau hilang', async () => {
  const site = await siteWith(tamu());
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => [
    site.post('/tamu', { nama: `Tamu ${i}` }),
    site.owner.post('/api/database/tables/tamu/rows', { nama: `Pemilik ${i}` }),
  ]).flat());
  assert.deepEqual([...new Set(results.map((r) => r.status))], [201]);
  const all = (await site.owner.get('/api/database/tables/tamu/rows?limit=100')).body;
  assert.equal(all.total, 80);
  assert.equal(new Set(all.rows.map((r) => r.id)).size, 80);
});

test('rute lain di bawah /api/db dijawab 404', async () => {
  const site = await siteWith(tamu());
  for (const [method, url] of [['GET', ''], ['PUT', '/tamu'], ['PATCH', '/tamu'], ['DELETE', '/tamu'], ['POST', '/tamu/1'], ['GET', '/tamu/1/2']]) {
    const res = await site.call(method, url);
    assert.deepEqual([res.status, res.body], [404, { error: 'Endpoint tidak ditemukan' }], `${method} ${url}`);
  }
  const head = await site.call('HEAD', '/tamu');
  assert.deepEqual([head.status, head.body], [200, '']);
});

test('batas request per website + IP: 60 penulisan per menit, lalu 429', async () => {
  const site = await siteWith(tamu());
  const results = await Promise.all(Array.from({ length: 60 }, (_, i) => site.post('/tamu', { nama: `Tamu ${i}` })));
  assert.ok(results.every((r) => r.status === 201));
  const limited = await site.post('/tamu', { nama: 'kelebihan' });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers['retry-after']) > 0 && Number(limited.headers['retry-after']) <= 60);
  assert.ok(limited.body.error);
  // Membaca punya jatah sendiri; website lain tidak terpengaruh.
  assert.equal((await site.get('/tamu')).body.total, 60);
  const other = await siteWith(tamu());
  assert.equal((await other.post('/tamu', { nama: 'A' })).status, 201);
});

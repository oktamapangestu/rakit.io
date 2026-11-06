// File project di editor: daftar, baca, tulis, buat, unggah gambar, ganti nama, hapus, dan kuota.
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
const upload = async (user, query, body = PNG, headers = { 'Content-Type': 'image/png' }) => {
  const res = await user.raw('POST', `/api/files/upload?${query}`, { rawBody: body, headers });
  return { status: res.status, body: await res.json() };
};
const expectError = (res, status, message) => {
  assert.equal(res.status, status, JSON.stringify(res.body));
  if (typeof message === 'string') assert.equal(res.body.error, message);
  else assert.match(res.body.error, message);
};

test('daftar file awal beserta pemakaian dan batas paket', async () => {
  const user = await stack.register();
  const { status, body } = await user.get('/api/files');
  assert.equal(status, 200);
  const files = [...body.files].sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(files.map((f) => [f.path, f.name, f.type]), [['index.html', 'index.html', 'file'], ['script.js', 'script.js', 'file'], ['style.css', 'style.css', 'file']]);
  for (const f of files) assert.equal(f.size, fs.statSync(path.join(rootOf(user), f.path)).size);
  assert.deepEqual(body.usage, {
    size: files.reduce((sum, f) => sum + f.size, 0),
    entries: 3,
    limits: { fileSize: 512 * 1024, totalSize: 100 * 1024 * 1024, entries: 2000, imageSize: 5 * 1024 * 1024, depth: 8 },
  });
  assert.equal((await stack.client().get('/api/files')).status, 401);
});

test('baca dan simpan isi file', async () => {
  const user = await stack.register();
  const read = await user.get('/api/files/content?path=index.html');
  assert.equal(read.status, 200);
  assert.equal(read.body.content, fs.readFileSync(path.join(rootOf(user), 'index.html'), 'utf8'));

  const saved = await user.put('/api/files/content', { path: '/index.html', content: '<h1>Halo 🌏</h1>' });
  assert.deepEqual([saved.status, saved.body], [200, { path: 'index.html' }]);
  assert.equal(fs.readFileSync(path.join(rootOf(user), 'index.html'), 'utf8'), '<h1>Halo 🌏</h1>');
  assert.equal((await user.get('/api/files/content?path=index.html')).body.content, '<h1>Halo 🌏</h1>');
  assert.equal((await stack.site(user.username, '/')).body, '<h1>Halo 🌏</h1>');
  assert.equal((await user.put('/api/files/content', { path: 'index.html', content: '' })).status, 200, 'file boleh dikosongkan');

  expectError(await user.get('/api/files/content?path=tidak-ada.html'), 404, 'File tidak ditemukan');
  expectError(await user.get('/api/files/content'), 400, 'Path wajib diisi');
  expectError(await user.get('/api/files/content?path=catatan.txt'), 400, 'Hanya file .html, .css, dan .js yang diizinkan');
  expectError(await user.get('/api/files/content?path=../rahasia.html'), 400, 'Nama ".." tidak valid. Gunakan huruf, angka, titik, - atau _');
  expectError(await user.get('/api/files/content?path=.env.js'), 400, /Nama "\.env\.js" tidak valid/);
  expectError(await user.get(`/api/files/content?path=${'a/'.repeat(8)}x.js`), 400, 'Kedalaman folder maksimal 8 level');
  expectError(await user.put('/api/files/content', { path: 'baru.html', content: 'x' }), 404, 'File tidak ditemukan');
  expectError(await user.put('/api/files/content', { path: 'index.html', content: 5 }), 400, 'Konten harus berupa teks');
  expectError(await user.put('/api/files/content', { path: 'index.html' }), 400, 'Konten harus berupa teks');
  expectError(await user.put('/api/files/content', { path: 'index.html', content: 'x'.repeat(512 * 1024 + 1) }), 413, 'Ukuran file maksimal 512 KB');
  assert.equal((await user.put('/api/files/content', { path: 'index.html', content: 'x'.repeat(512 * 1024) })).status, 200);
});

test('buat file dan folder', async () => {
  const user = await stack.register();
  assert.deepEqual((await user.post('/api/files', { path: 'halaman/tentang.html' })), { status: 201, body: { path: 'halaman/tentang.html' } });
  assert.equal(fs.readFileSync(path.join(rootOf(user), 'halaman/tentang.html'), 'utf8'), '');
  assert.deepEqual((await user.post('/api/files', { path: 'aset\\gambar', type: 'dir' })).body, { path: 'aset/gambar' });
  assert.ok(fs.statSync(path.join(rootOf(user), 'aset/gambar')).isDirectory());

  const list = (await user.get('/api/files')).body;
  assert.deepEqual(list.files.filter((f) => f.type === 'dir').map((f) => f.path).sort(), ['aset', 'aset/gambar', 'halaman']);
  assert.ok(!('size' in list.files.find((f) => f.type === 'dir')));
  assert.equal(list.usage.entries, 7);

  expectError(await user.post('/api/files', { path: 'index.html' }), 409, 'File sudah ada');
  expectError(await user.post('/api/files', { path: 'halaman' , type: 'dir' }), 409, 'Sudah ada file/folder dengan nama itu');
  expectError(await user.post('/api/files', { path: 'index.html/x.html' }), 409, '"index.html" adalah file');
  expectError(await user.post('/api/files', { path: 'catatan.txt' }), 400, 'Hanya file .html, .css, dan .js yang diizinkan');
  expectError(await user.post('/api/files', { path: 'aset' }), 400, 'Hanya file .html, .css, dan .js yang diizinkan');
  expectError(await user.post('/api/files', {}), 400, 'Path wajib diisi');
  expectError(await user.post('/api/files', { path: 'nama spasi.html' }), 400, /tidak valid/);
});

test('unggah gambar: isi diperiksa, ukuran mengikuti paket, timpa hanya bila diminta', async () => {
  const user = await stack.register();
  assert.deepEqual(await upload(user, 'path=images/logo.png'), { status: 201, body: { path: 'images/logo.png' } });
  assert.ok(fs.readFileSync(path.join(rootOf(user), 'images/logo.png')).equals(PNG));
  assert.equal((await stack.site(user.username, '/images/logo.png')).headers['content-type'], 'image/png');

  expectError(await upload(user, 'path=images/logo.png'), 409, 'File sudah ada');
  assert.equal((await upload(user, 'path=images/logo.png&overwrite=1')).status, 201);
  expectError(await upload(user, 'path=images&overwrite=1'), 400, /^Format gambar tidak didukung\. Pakai \.png, \.jpg, \.jpeg, \.gif, \.webp, \.svg, \.ico, \.avif$/);
  expectError(await upload(user, 'path=foto.jpg'), 400, 'Isi file bukan gambar JPG yang valid');
  expectError(await upload(user, 'path=kosong.png', Buffer.alloc(0)), 400, 'File gambar kosong');
  expectError(await upload(user, ''), 400, 'Path wajib diisi');
  expectError(await upload(user, 'path=catatan.html'), 400, /Format gambar tidak didukung/);
  const svg = Buffer.from('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.equal((await upload(user, 'path=logo.svg', svg, { 'Content-Type': 'image/svg+xml' })).status, 201);
  expectError(await upload(user, 'path=palsu.svg', Buffer.from('<html><svg></svg></html>')), 400, 'Isi file bukan gambar SVG yang valid');

  const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
  expectError(await upload(user, 'path=besar.png', big), 413, 'Ukuran gambar maksimal 5 MB per file');
  expectError(await upload(user, 'path=raksasa.png', Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 2048)])), 413, 'Request terlalu besar');
});

test('ganti nama / pindah file dan folder', async () => {
  const user = await stack.register();
  await user.post('/api/files', { path: 'lama/a.html' });
  await upload(user, 'path=lama/foto.png');
  const rename = (from, to) => user.post('/api/files/rename', { from, to });

  assert.deepEqual(await rename('lama/a.html', 'lama/b.html'), { status: 200, body: { path: 'lama/b.html' } });
  assert.deepEqual((await rename('lama', 'baru/dalam')).body, { path: 'baru/dalam' });
  assert.ok(fs.existsSync(path.join(rootOf(user), 'baru/dalam/b.html')) && !fs.existsSync(path.join(rootOf(user), 'lama')));
  assert.deepEqual((await rename('index.html', 'index.html')).body, { path: 'index.html' });

  expectError(await rename('tidak-ada.html', 'x.html'), 404, 'File/folder tidak ditemukan');
  expectError(await rename('index.html', 'style.css'), 409, 'Sudah ada file/folder dengan nama itu');
  expectError(await rename('index.html', 'index.txt'), 400, 'Hanya file .html, .css, dan .js yang diizinkan');
  expectError(await rename('baru/dalam/foto.png', 'baru/dalam/foto.html'), 400, /^Gambar harus berakhiran/);
  expectError(await rename('baru', 'baru/dalam/lagi'), 400, 'Tidak bisa memindahkan folder ke dalam dirinya sendiri');
  expectError(await rename('script.js', 'style.css/x.js'), 409, '"style.css" adalah file');
  expectError(await rename('', 'x.html'), 400, 'Path wajib diisi');
});

test('hapus file dan folder beserta isinya', async () => {
  const user = await stack.register();
  await user.post('/api/files', { path: 'buang/a/b.html' });
  assert.deepEqual(await user.del('/api/files?path=buang'), { status: 200, body: { ok: true } });
  assert.ok(!fs.existsSync(path.join(rootOf(user), 'buang')));
  assert.equal((await user.del('/api/files?path=script.js')).status, 200);
  expectError(await user.del('/api/files?path=script.js'), 404, 'File/folder tidak ditemukan');
  expectError(await user.del('/api/files'), 400, 'Path wajib diisi');
  expectError(await user.del('/api/files?path=..'), 400, /tidak valid/);
  assert.ok(fs.existsSync(rootOf(user)));
});

test('kuota: jumlah file & folder dan total ukuran', async () => {
  const user = await stack.register();
  const root = rootOf(user);
  // Isi langsung di disk sampai tepat di batas 2.000 entri (3 file awal + folder + 1.996 file).
  fs.mkdirSync(path.join(root, 'banyak'));
  for (let i = 0; i < 1996; i++) fs.writeFileSync(path.join(root, 'banyak', `f${i}.js`), '');
  expectError(await user.post('/api/files', { path: 'satu-lagi.html' }), 413, 'Maksimal 2000 file & folder');
  expectError(await user.post('/api/files', { path: 'folder-baru', type: 'dir' }), 413, 'Maksimal 2000 file & folder');
  assert.equal((await user.put('/api/files/content', { path: 'index.html', content: 'tetap boleh diubah' })).status, 200);
  fs.rmSync(path.join(root, 'banyak'), { recursive: true });

  // Total 100 MB: file gambar besar (sparse) ditaruh langsung di disk.
  fs.writeFileSync(path.join(root, 'besar.png'), '');
  fs.truncateSync(path.join(root, 'besar.png'), 100 * 1024 * 1024 - 100);
  await user.put('/api/files/content', { path: 'index.html', content: '' });
  await user.put('/api/files/content', { path: 'style.css', content: '' });
  await user.put('/api/files/content', { path: 'script.js', content: '' });
  assert.equal((await user.put('/api/files/content', { path: 'index.html', content: 'x'.repeat(100) })).status, 200);
  expectError(await user.put('/api/files/content', { path: 'style.css', content: 'x' }), 413, 'Kuota penyimpanan 100 MB penuh');
  assert.equal((await user.put('/api/files/content', { path: 'index.html', content: 'x'.repeat(50) })).status, 200, 'mengecilkan file tetap boleh');
});

test('file project lain tidak bisa disentuh', async () => {
  const user = await stack.register();
  const other = await stack.register();
  const res = await user.req('GET', '/api/files', undefined, { 'X-Project': other.username });
  assert.equal(res.status, 404);
  const write = await user.req('PUT', '/api/files/content', { path: 'index.html', content: 'dibajak' }, { 'X-Project': other.username });
  assert.equal(write.status, 404);
  assert.notEqual(fs.readFileSync(path.join(rootOf(other), 'index.html'), 'utf8'), 'dibajak');
});

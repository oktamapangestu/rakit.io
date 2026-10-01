// Bahan diagram otomatis project (/api/diagrams): peta halaman, aset, form, tabel, relasi, dan alur data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

let stack;
before(async () => { stack = await startStack(); });
after(() => stack?.stop());

const byKey = (list, ...keys) => [...list].sort((a, b) => keys.map((k) => String(a[k]).localeCompare(String(b[k]))).find((n) => n) ?? 0);

test('project baru: halaman awal beserta asetnya', async () => {
  const user = await stack.register('awal');
  const { status, body } = await user.get('/api/diagrams');
  assert.equal(status, 200);
  assert.deepEqual(body.project, { slug: 'awal', name: 'awal' });
  assert.deepEqual(body.pages, [{ path: 'index.html', title: 'awal', orphan: false }]);
  assert.deepEqual(byKey(body.assets, 'kind'), [
    { from: 'index.html', to: 'style.css', kind: 'css', missing: false },
    { from: 'index.html', to: 'script.js', kind: 'js', missing: false },
  ]);
  assert.deepEqual(body.headings, [{ page: 'index.html', text: 'Halo, dunia! 👋' }]);
  assert.deepEqual(body.buttons, [{ page: 'index.html', text: 'Klik aku' }]);
  assert.deepEqual([body.links, body.forms, body.tables, body.relations, body.calls, body.external], [[], [], [], [], [], 0]);
  assert.equal((await stack.client().get('/api/diagrams')).status, 401);
  assert.equal(fs.existsSync(path.join(stack.dataDir, 'db', 'awal.db')), false, 'tidak membuat file database');
});

test('peta halaman, tautan rusak, form, tabel, relasi, dan pemakaian API database', async () => {
  const user = await stack.register('toko');
  const root = path.join(stack.dataDir, 'sites', 'toko');
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  write('index.html', `<!doctype html><html><head>
    <TITLE>  Toko   <b>Kopi</b>  </TITLE>
    <link rel="stylesheet" href="css/app.css"><link rel="icon" href="/logo.png"><link rel="Stylesheet" href='/tidak-ada.css'>
    <script src="js/app.js"></script><script src="https://cdn.example/x.js"></script><script>inline()</script>
    </head><body>
    <h1>Selamat <em>datang</em></h1><h1>   </h1>
    <a href="produk">Produk</a> <a href="/produk.html#atas">Lagi</a> <a href="blog/">Blog</a> <a href="./kontak.html?x=1">Kontak</a>
    <a href="hilang.html">Rusak</a> <a href="../luar.html">Luar</a> <a href="#atas">Atas</a> <a href="">Kosong</a> <a>Tanpa</a>
    <a href="https://contoh.id">Luar 1</a> <a href="//cdn.contoh.id/x">Luar 2</a> <a href="mailto:a@b.co">Surel</a> <a href="index.html">Diri</a>
    <form action="/kirim" method="POST"></form><form></form>
    <button type="button"> Beli   <span>sekarang</span> </button><button></button>
    </body></html>`);
  write('produk.html', '<h1>Daftar Produk</h1><a href="index.html">Beranda</a><script src="/js/produk.js"></script>');
  write('kontak.html', '<title></title><h1>Hubungi kami</h1>');
  write('blog/index.html', '<a href="../">Beranda</a><a href="artikel-1">Artikel</a>');
  write('blog/artikel-1.html', '<title>Artikel</title>');
  write('yatim.html', '<title>Tidak ditautkan</title>');
  write('404.html', '<title>Tidak ada</title>');
  write('css/app.css', 'body{}');
  write('js/app.js', `
    fetch('/api/db/produk?sort=-created_at');
    fetch('/api/db/produk/' + id); fetch('/api/db/produk/7');
    fetch("/api/db/pesanan", { method: 'POST', body: JSON.stringify(data) });
    fetch(\`/api/db/pesanan/\${id}\`, { method: "patch" });
    fetch('/api/db/produk/5', { method: 'DELETE' }); fetch('/api/db/ulasan');
    fetch('/api/db/pesanan', { method: 'POST' });`);
  write('js/produk.js', "fetch('/api/db/kategori/')");
  write('logo.png', 'PNG');

  const T = '/api/database/tables';
  await user.post(T, { name: 'kategori', columns: [{ name: 'nama', type: 'text' }], rules: { list: 'public' } });
  await user.post(T, { name: 'produk', columns: [{ name: 'nama', type: 'text' }, { name: 'kategori_id', type: 'reference', refTable: 'kategori' }, { name: 'modal', type: 'number', private: true }], rules: { list: 'public', view: 'public' } });
  await user.post(T, { name: 'pesanan', columns: [{ name: 'produk_id', type: 'number' }, { name: 'kategori', type: 'text' }, { name: 'produk', type: 'boolean' }, { name: 'pesanan_id', type: 'number' }], rules: { create: 'public' } });
  await user.post(`${T}/kategori/rows`, { nama: 'Minuman' });
  await user.patch('/api/projects/toko', { name: 'Toko Kopi' });

  const { body } = await user.get('/api/diagrams');
  assert.deepEqual(body.project, { slug: 'toko', name: 'Toko Kopi' });
  assert.deepEqual(byKey(body.pages, 'path'), [
    { path: '404.html', title: 'Tidak ada', orphan: false },
    { path: 'blog/artikel-1.html', title: 'Artikel', orphan: false },
    { path: 'blog/index.html', title: '', orphan: false },
    { path: 'index.html', title: 'Toko Kopi', orphan: false },
    { path: 'kontak.html', title: '', orphan: false },
    { path: 'produk.html', title: 'Daftar Produk', orphan: false },
    { path: 'yatim.html', title: 'Tidak ditautkan', orphan: true },
  ]);
  assert.deepEqual(byKey(body.links, 'from', 'to'), [
    { from: 'blog/index.html', to: 'blog/artikel-1.html', broken: false },
    { from: 'blog/index.html', to: 'index.html', broken: false },
    { from: 'index.html', to: '../luar.html', broken: true },
    { from: 'index.html', to: 'blog/index.html', broken: false },
    { from: 'index.html', to: 'hilang.html', broken: true },
    { from: 'index.html', to: 'kontak.html', broken: false },
    { from: 'index.html', to: 'produk.html', broken: false },
    { from: 'produk.html', to: 'index.html', broken: false },
  ]);
  assert.equal(body.external, 2);
  assert.deepEqual(byKey(body.assets, 'from', 'to'), [
    { from: 'index.html', to: 'css/app.css', kind: 'css', missing: false },
    { from: 'index.html', to: 'js/app.js', kind: 'js', missing: false },
    { from: 'index.html', to: 'tidak-ada.css', kind: 'css', missing: true },
    { from: 'produk.html', to: 'js/produk.js', kind: 'js', missing: false },
  ]);
  assert.deepEqual(body.forms, [{ page: 'index.html', action: '/kirim', method: 'post' }, { page: 'index.html', action: null, method: 'get' }]);
  assert.deepEqual(byKey(body.headings, 'page'), [
    { page: 'index.html', text: 'Selamat datang' }, { page: 'kontak.html', text: 'Hubungi kami' }, { page: 'produk.html', text: 'Daftar Produk' },
  ]);
  assert.deepEqual(body.buttons, [{ page: 'index.html', text: 'Beli sekarang' }]);

  assert.deepEqual(body.tables.map((t) => [t.name, t.rowCount, t.columns.length, t.rules.list]), [['kategori', 1, 1, 'public'], ['pesanan', 0, 4, 'owner'], ['produk', 0, 3, 'public']]);
  assert.deepEqual(Object.keys(body.tables[0]).sort(), ['columns', 'name', 'rowCount', 'rules']);
  assert.deepEqual(byKey(body.relations, 'from', 'column'), [
    { from: 'pesanan', column: 'kategori', to: 'kategori' },
    { from: 'pesanan', column: 'produk_id', to: 'produk' },
    { from: 'produk', column: 'kategori_id', to: 'kategori' },
  ]);
  assert.deepEqual(byKey(body.calls, 'file', 'table', 'op'), [
    { file: 'js/app.js', table: 'pesanan', op: 'create', status: 'ok' },
    { file: 'js/app.js', table: 'pesanan', op: 'update', status: 'owner_only' },
    { file: 'js/app.js', table: 'produk', op: 'delete', status: 'owner_only' },
    { file: 'js/app.js', table: 'produk', op: 'list', status: 'ok' },
    { file: 'js/app.js', table: 'produk', op: 'view', status: 'ok' },
    { file: 'js/app.js', table: 'ulasan', op: 'list', status: 'missing' },
    { file: 'js/produk.js', table: 'kategori', op: 'list', status: 'ok' },
  ]);
});

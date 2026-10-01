// Website project di <slug>.<domain>: penyajian file statis, URL bersih, 404, dan pengaman path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

let stack;
let root;
before(async () => {
  stack = await startStack();
  await stack.register('toko');
  root = path.join(stack.dataDir, 'sites', 'toko');
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  write('index.html', '<h1>Toko</h1>');
  write('about.html', '<h1>Tentang</h1>');
  write('css/app.css', 'body{color:red}');
  write('js/app.js', 'console.log(1)');
  write('blog/index.html', '<h1>Blog</h1>');
  write('images/logo.png', 'PNGDATA');
  write('uploads/produk/a-1.jpg', 'JPGDATA');
  write('rahasia.txt', 'jangan disajikan');
  write('.env', 'RAHASIA=1');
  fs.writeFileSync(path.join(stack.dataDir, 'luar.html'), 'di luar folder situs');
  fs.symlinkSync(path.join(stack.dataDir, 'luar.html'), path.join(root, 'link.html'));
});
after(() => stack?.stop());

test('halaman utama dan file statis dengan Content-Type yang benar', async () => {
  const home = await stack.site('toko', '/');
  assert.equal(home.status, 200);
  assert.equal(home.body, '<h1>Toko</h1>');
  assert.equal(home.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(home.headers['cache-control'], 'no-cache');
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  assert.equal(home.headers['content-length'], '13');
  assert.ok(home.headers.etag);

  const types = {
    '/index.html': 'text/html; charset=utf-8',
    '/css/app.css': 'text/css; charset=utf-8',
    '/js/app.js': 'text/javascript; charset=utf-8',
    '/images/logo.png': 'image/png',
    '/uploads/produk/a-1.jpg': 'image/jpeg',
  };
  for (const [url, type] of Object.entries(types)) {
    const res = await stack.site('toko', url);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers['content-type'], type, url);
  }
  assert.equal((await stack.site('toko', '/?utm=1')).status, 200, 'query string diabaikan');
});

test('URL bersih, index folder, dan redirect folder tanpa garis miring', async () => {
  assert.equal((await stack.site('toko', '/about')).body, '<h1>Tentang</h1>');
  assert.equal((await stack.site('toko', '/blog/')).body, '<h1>Blog</h1>');
  const redirect = await stack.site('toko', '/blog');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, '/blog/');
});

test('ETag: If-None-Match yang cocok dijawab 304; HEAD tanpa isi', async () => {
  const first = await stack.site('toko', '/css/app.css');
  const cached = await stack.site('toko', '/css/app.css', { headers: { 'If-None-Match': first.headers.etag } });
  assert.equal(cached.status, 304);
  assert.equal(cached.body, '');
  assert.equal((await stack.site('toko', '/css/app.css', { headers: { 'If-None-Match': 'W/"lain"' } })).status, 200);

  const head = await stack.site('toko', '/css/app.css', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-length'], '15');
  assert.equal(head.body, '');
});

test('yang tidak boleh disajikan dijawab 404: tipe lain, dotfile, symlink, keluar folder', async () => {
  for (const url of ['/rahasia.txt', '/.env', '/link.html', '/tidak-ada.html', '/tidak-ada', '/..%2f..%2fluar.html', '/%2e%2e/luar.html', '/css/../../luar.html', '/images/']) {
    const res = await stack.site('toko', url);
    assert.equal(res.status, 404, url);
    assert.ok(!res.body.includes('di luar folder situs') && !res.body.includes('RAHASIA'), url);
  }
  const page = await stack.site('toko', '/tidak-ada.html');
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(page.body, /Halaman tidak ditemukan/);
  assert.match(page.body, /<code>\/tidak-ada\.html<\/code>/);
  assert.ok(page.body.includes(`href="${stack.origin}"`));
  // Nama file di halaman 404 tidak boleh membawa HTML dari URL.
  assert.ok(!(await stack.site('toko', '/%3Cscript%3Ealert(1)%3C/script%3E')).body.includes('<script>'));
  // Segmen ".." yang masih di dalam situs diselesaikan seperti di browser.
  assert.equal((await stack.site('toko', '/css/../about.html')).status, 200);
});

test('404.html buatan pemilik dipakai dengan status 404', async () => {
  fs.writeFileSync(path.join(root, '404.html'), '<h1>Ups</h1>');
  try {
    const res = await stack.site('toko', '/tidak-ada');
    assert.equal(res.status, 404);
    assert.equal(res.body, '<h1>Ups</h1>');
  } finally {
    fs.rmSync(path.join(root, '404.html'));
  }
});

test('subdomain yang belum dipakai, metode selain GET/HEAD, dan www', async () => {
  const unknown = await stack.site('belum-ada', '/');
  assert.equal(unknown.status, 404);
  assert.match(unknown.body, /Situs tidak ditemukan/);
  assert.match(unknown.body, /belum-ada\.localhost belum dipakai siapa pun/);

  const post = await stack.site('toko', '/', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');

  const www = await stack.site('www', '/panduan?x=1');
  assert.equal(www.status, 301);
  assert.equal(www.headers.location, `${stack.origin}/panduan?x=1`);

  assert.equal((await stack.site('-jelek-', '/')).status, 404);
});

test('/api di domain website tetap dilayani API situs, bukan file', async () => {
  const res = await stack.site('toko', '/api/tidak-ada');
  assert.equal(res.status, 404);
  assert.deepEqual(JSON.parse(res.body), { error: 'Endpoint tidak ditemukan' });
});

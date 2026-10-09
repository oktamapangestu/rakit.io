// Versi bahasa Inggris: halaman /en/..., cookie lang, pesan error server, file awal project, dan bahasa AI.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const skip = !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go';

let stack;
before(async () => { if (!skip) stack = await startStack(); });
after(() => stack?.stop());

async function page(client, url) {
  const res = await client.raw('GET', url);
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

test('halaman /en: versi Inggris, pilihan bahasa diingat di cookie, ?lang= mengganti bahasa', { skip }, async () => {
  const visitor = stack.client();
  const id = await page(visitor, '/');
  assert.equal(id.status, 200);
  assert.match(id.body, /<html lang="id">/);
  assert.match(id.body, /href="\/en"[^>]*>EN</);
  assert.match(id.body, new RegExp(`hreflang="en" href="${stack.origin}/en"`));

  const en = await page(visitor, '/en');
  assert.equal(en.status, 200);
  assert.match(en.body, /<html lang="en">/);
  assert.match(en.body, /src="\/js\/en\/auth\.js\?v=/);
  assert.equal(visitor.cookies.get('lang'), 'en');

  // Bahasa Inggris dipilih: alamat Indonesia dialihkan ke versi Inggrisnya (query ikut).
  assert.deepEqual([(await page(visitor, '/')).location, (await page(visitor, '/panduan?x=1')).location], ['/en', '/en/panduan?x=1']);
  const guide = await page(visitor, '/en/panduan');
  assert.equal(guide.status, 200);
  assert.match(guide.body, /The <em>Complete<\/em> Guide/);

  // Tombol ganti bahasa: ?lang=id menyimpan pilihan lalu membuka halaman tanpa parameter itu.
  assert.equal((await page(visitor, '/en/panduan?lang=id&x=1')).location, '/panduan?x=1');
  assert.equal(visitor.cookies.get('lang'), 'id');
  assert.match((await page(visitor, '/panduan')).body, /<html lang="id">/);
  assert.equal((await page(visitor, '/?lang=en')).location, '/en');
  assert.equal(visitor.cookies.get('lang'), 'en');

  assert.equal((await page(visitor, '/en/editor')).location, '/en', 'belum login');
  assert.equal((await visitor.raw('GET', '/js/en/editor.js')).status, 200);
});

test('editor versi Inggris: yang sudah login diarahkan ke /en/editor', { skip }, async () => {
  const user = await stack.register('english');
  user.cookies.set('lang', 'en');
  assert.equal((await page(user, '/en')).location, '/en/editor');
  assert.equal((await page(user, '/editor?project=english')).location, '/en/editor?project=english');
  const editor = await page(user, '/en/editor');
  assert.equal(editor.status, 200);
  assert.match(editor.body, /<html lang="en">/);
  assert.match(editor.body, /src="\/js\/en\/editor\.js\?v=/);
  assert.match(editor.body, /href="\/en\/panduan"/);
  assert.match(editor.body, />\s*AI Assistant\s*</);
});

test('pesan error server mengikuti bahasa pengguna', { skip }, async () => {
  const en = stack.client();
  en.cookies.set('lang', 'en');
  const id = stack.client();
  const bad = { login: 'tidak-ada', password: 'salah-sekali' };
  assert.deepEqual((await en.post('/api/login', bad)).body, { error: 'Wrong username/email or password' });
  assert.deepEqual((await id.post('/api/login', bad)).body, { error: 'Username/email atau password salah' });
  assert.equal((await en.post('/api/register', { username: 'pendek', email: 'a@b.co', password: '123' })).body.error, 'Password must be at least 8 characters');

  const user = await stack.register('dobel');
  const taken = await en.post('/api/register', { username: 'dobel', email: 'lain@test.local', password: 'rahasia-123' });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error, 'Username is already taken');
  user.cookies.set('lang', 'en');
  const missing = await user.get('/api/files/content?path=tidak-ada.html');
  assert.equal(missing.body.error, 'File not found');
});

test('akun dari versi Inggris mendapat file awal berbahasa Inggris', { skip }, async () => {
  const client = stack.client();
  client.cookies.set('lang', 'en');
  const res = await client.post('/api/register', { username: 'hello', email: 'hello@test.local', password: 'rahasia-123' });
  assert.equal(res.status, 201);
  const index = (await client.get('/api/files/content?path=index.html')).body;
  assert.match(index.content, /<html lang="en">/);
  assert.match(index.content, /Hello, world!/);

  const indo = await stack.register('halo');
  assert.match((await indo.get('/api/files/content?path=index.html')).body.content, /Halo, dunia!/);
});

test('Baca Alur Kode versi Inggris: AI diminta berbahasa Inggris, simpanan per bahasa', { skip }, async () => {
  const user = await stack.register('walk');
  const code = "const b = document.getElementById('go');\nb.addEventListener('click', () => alert('hi'));\n";
  const reply = (summary, explain) => ({ text: '```json\n' + JSON.stringify({
    summary, steps: [{ id: 1, title: 'Start', kind: 'start', lines: [[1, 2]], explain }], related: [], complexity: '', notes: [],
  }) + '\n```' });

  stack.ai.script.push(reply('Skrip ini menyiapkan tombol untuk halaman.', 'Mencari tombol dengan id go lalu menunggu klik dari pengunjung.'));
  assert.equal((await user.post('/api/ai/explain', { path: 'script.js', content: code })).status, 200);
  assert.doesNotMatch(stack.ai.requests.at(-1).messages[0].content, /LANGUAGE: the user reads ENGLISH/);

  user.cookies.set('lang', 'en');
  assert.equal((await user.get('/api/ai/explain?path=script.js')).body.saved, null, 'penjelasan berbahasa Indonesia tidak dipakai');
  stack.ai.script.push(reply('This script sets up the button on the page.', 'It finds the button with the id go and then waits for the visitor to click it.'));
  const en = await user.post('/api/ai/explain', { path: 'script.js', content: code });
  assert.equal(en.status, 200, JSON.stringify(en.body));
  assert.equal(en.body.cached, false);
  assert.equal(en.body.saved.explanation.lang, 'en');
  const system = stack.ai.requests.at(-1).messages[0].content;
  assert.match(system, /Write everything in English/);
  assert.match(system, /LANGUAGE: the user reads ENGLISH/);
  assert.equal((await user.post('/api/ai/explain', { path: 'script.js', content: code })).body.cached, true);
});

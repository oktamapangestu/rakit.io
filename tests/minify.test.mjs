// Minify otomatis website publik (SITE_MINIFY): pengunjung menerima .html/.css/.js versi minify, sedangkan versi dev,
// preview di editor (iframe + cookie rakit_preview), dan file di editor tetap asli. Khusus server Go.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const skip = !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go';
const HTML = '<!doctype html>\n<html>\n<head>\n  <!-- catatan -->\n  <script defer src="/app.js"></script>\n</head>\n<body>\n  <button type="button" @click="open = !open">Menu</button>\n</body>\n</html>\n';
const JS = '// komentar\nfunction halo() {\n  return 1;\n}\n';

let stack;
let user;
before(async () => {
  if (skip) return;
  stack = await startStack({ SITE_MINIFY: '1' });
  user = await stack.register('mini');
  await user.put('/api/files/content', { path: 'index.html', content: HTML });
  await user.post('/api/files', { path: 'app.js' });
  await user.put('/api/files/content', { path: 'app.js', content: JS });
});
after(() => stack?.stop());

test('pengunjung menerima versi minify; editor tetap menyimpan file asli', { skip }, async () => {
  const page = await stack.site('mini', '/');
  assert.equal(page.body, '<!doctype html><html><head><script defer src="/app.js"></script></head><body><button type="button" @click="open = !open">Menu</button></body></html>');
  assert.equal(page.headers['content-length'], String(Buffer.byteLength(page.body)));
  assert.match(page.headers.etag, /-m"$/);
  assert.equal((await stack.site('mini', '/', { headers: { 'If-None-Match': page.headers.etag } })).status, 304);
  assert.equal((await stack.site('mini', '/app.js')).body, 'function halo(){return 1}');
  assert.equal((await user.get('/api/files/content?path=app.js')).body.content, JS);
});

test('preview di editor: halaman & file yang dimuatnya asli (nomor baris error tetap cocok)', { skip }, async () => {
  const frame = await stack.site('mini', '/', { headers: { 'Sec-Fetch-Dest': 'iframe' } });
  assert.match(frame.body, /<!-- catatan -->/);
  const cookie = [frame.headers['set-cookie']].flat().find((c) => c?.startsWith('rakit_preview='));
  assert.ok(cookie, 'cookie preview dipasang');
  const js = await stack.site('mini', '/app.js', { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal(js.body, JS);
  assert.doesNotMatch(js.headers.etag, /-m"$/);
});

test('versi dev (publikasi manual) tidak diminify', { skip }, async () => {
  assert.equal((await user.put('/api/publish/mode', { mode: 'manual' })).status, 200);
  assert.equal((await stack.site('mini--dev', '/app.js')).body, JS);
  assert.equal((await stack.site('mini', '/app.js')).body, 'function halo(){return 1}');
});

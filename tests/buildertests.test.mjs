// Tool uji Builder (go/internal/ai/lab.go): test_api & check_page menguji website salinan kerja (file asli +
// perubahan job ini), tabel yang dicatat dibuat lebih awal — masuk snapshot (Batalkan menghapusnya) dan dihapus
// lagi bila job gagal. search_files mencari di file terbaru. Hanya server Go.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const GO = /go\/bin\/rakit/.test(process.env.RAKIT_SERVER_CMD ?? '');

let stack;
before(async () => {
  if (!GO) return;
  stack = await startStack({ AI_BONUS_CREDITS: '20', AI_DAILY_CREDITS: '0' });
});
after(() => stack?.stop());

let callId = 0;
const call = (name, args) => ({ index: 0, id: `call_${++callId}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const calls = (...list) => ({ toolCalls: list.map((c, index) => ({ ...c, index })) });
const toolResults = (request) => request.messages.filter((m) => m.role === 'tool').map((m) => m.content);
const read = (user, rel) => fs.readFileSync(path.join(stack.dataDir, 'sites', user.username, rel), 'utf8');

const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><ul id="daftar"></ul><script>
fetch('/api/db/produk').then((r) => r.json()).then((d) => { document.getElementById('daftar').textContent = d.rows.length; });
fetch('/api/produk-salah');
belumAda();
</script></body></html>`;

test('Builder: test_api & check_page menguji perubahan job ini; tabel uji masuk snapshot', { skip: !GO }, async () => {
  const user = await stack.register();
  stack.ai.script.push(
    calls(
      call('create_table', { name: 'produk', columns: [{ name: 'nama', type: 'text' }, { name: 'harga', type: 'number' }], public: ['list', 'create', 'delete'] }),
      call('write_file', { path: 'index.html', content: page }),
      call('write_file', { path: 'functions/halo.js', content: "export default async (req) => ({ halo: req.body?.nama ?? 'tamu' });\n" }),
    ),
    calls(
      call('test_api', { method: 'POST', path: '/api/db/produk', body: { nama: 'Bolu', harga: 25000 } }),
      call('test_api', { method: 'GET', path: '/api/db/produk' }),
      call('test_api', { method: 'POST', path: '/api/fn/halo', body: { nama: 'Ani' } }),
      call('test_api', { method: 'GET', path: '/api/fn/tidak-ada' }),
      call('search_files', { pattern: 'belumada' }),
      call('check_page', { path: '/' }),
    ),
    { text: 'Toko sudah dibuat dan diuji.' },
  );
  const { final } = await user.build('Buat katalog produk');
  assert.equal(final.type, 'done', JSON.stringify(final));
  const results = toolResults(stack.ai.requests.at(-1)).slice(3);
  assert.match(results[0], /^HTTP 20\d/, 'tabel yang dicatat sudah ada saat diuji');
  assert.match(results[1], /^HTTP 200 OK\n\{"rows":\[.*"nama":"Bolu"/);
  assert.match(results[2], /^HTTP 200 OK\n\{"halo":"Ani"\}/, 'fungsi baru dijalankan dari salinan kerja');
  assert.match(results[3], /^HTTP 404/);
  assert.equal(results[4], 'index.html:5: belumAda();');
  if (results[5].startsWith('Error: pemeriksaan halaman tidak tersedia')) {
    // Tanpa Chromium, check_page tidak ditawarkan ke model.
    assert.ok(!stack.ai.requests.at(-1).tools.some((t) => t.function.name === 'check_page'));
  } else {
    assert.match(results[5], /^Ditemukan \d+ masalah/);
    assert.match(results[5], /belumAda is not defined/);
    assert.match(results[5], /HTTP 404: GET \/api\/produk-salah/);
    assert.doesNotMatch(results[5], /api\/db\/produk[^-]/, 'tabel produk sudah ada');
  }
  // Prompt sistem menyuruh menguji.
  assert.match(stack.ai.requests.at(-1).messages[0].content, /Testing your work/);

  // Diterapkan: tabel uji ikut snapshot, Batalkan menghapusnya.
  const m = final.message;
  assert.equal(m.applyState, 'pending');
  assert.match(read(user, 'index.html'), /belumAda/);
  let tables = (await user.get('/api/database/tables')).body.tables;
  assert.deepEqual(tables.map((t) => t.name), ['produk']);
  assert.equal((await user.post(`/api/ai/messages/${m.id}/revert`)).status, 200);
  tables = (await user.get('/api/database/tables')).body.tables;
  assert.deepEqual(tables, [], 'tabel yang dibuat saat pengujian ikut dihapus');

  // Statistik: masalah dari check_page tercatat.
  const row = stack.db().prepare('SELECT checks FROM ai_requests WHERE user_id = ? ORDER BY id DESC').get(user.userId);
  if (!results[5].startsWith('Error:')) assert.ok(JSON.parse(row.checks).found.page >= 2, row.checks);
});

test('Builder: job gagal setelah pengujian → tabel uji dihapus lagi, kredit kembali', { skip: !GO }, async () => {
  const user = await stack.register();
  stack.ai.script.push(
    calls(
      call('create_table', { name: 'tamu', columns: [{ name: 'nama', type: 'text' }], public: ['create'] }),
      call('test_api', { method: 'POST', path: '/api/db/tamu', body: { nama: 'A' } }),
    ),
    { status: 400 },
  );
  const { final } = await user.build('Buat buku tamu');
  assert.equal(final.type, 'error');
  assert.equal(final.credits.remaining, 20);
  assert.deepEqual((await user.get('/api/database/tables')).body.tables, []);
});

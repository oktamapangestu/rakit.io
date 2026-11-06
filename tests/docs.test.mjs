// Tab Dokumentasi (GET /api/docs): API database per tabel + pemakaiannya di halaman, API fungsi yang dibaca dari
// kodenya, rahasia, dan masalah yang ketahuan; Catatan Project (simpan, ikut ke AI, draf buatan AI). Fitur khusus Go.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const skip = !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go';

let stack;
before(async () => { if (!skip) stack = await startStack({ AI_DAILY_PROMPTS: '10' }); });
after(() => stack?.stop());

async function write(user, path, content) {
  await user.req('POST', '/api/files', { path });
  const res = await user.req('PUT', '/api/files/content', { path, content });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

test('dokumentasi project: tabel, fungsi, rahasia, dan hal yang perlu dicek', { skip }, async () => {
  const user = await stack.register('docs-user');
  const empty = await user.get('/api/docs');
  assert.equal(empty.status, 200);
  assert.deepEqual([empty.body.tables, empty.body.functions, empty.body.secrets, empty.body.issues], [[], [], [], []]);
  assert.equal(empty.body.project.slug, 'docs-user');

  assert.equal((await user.req('POST', '/api/database/tables', {
    name: 'pesanan',
    columns: [{ name: 'nama', type: 'text', required: true }, { name: 'hp', type: 'text', private: true }],
    rules: { list: 'owner', view: 'owner', create: 'public', update: 'owner', delete: 'owner' },
  })).status, 201);
  await user.put('/api/functions/secrets', { name: 'TG_TOKEN', value: 'rahasia' });
  await user.put('/api/functions/secrets', { name: 'LAMA', value: 'x' });
  await write(user, 'functions/kirim.js', `// Kirim pesanan ke Telegram.
export default async function (req, { db, env, fetch }) {
  if (req.method !== 'POST') return Response.json({ error: 'POST saja' }, { status: 405 });
  const { nama, hp } = req.body;
  await db.insert('pesanan', { nama, hp });
  await db.list('produk');
  await fetch('https://api.telegram.org/bot' + env.TG_TOKEN + '/send', { body: { chat: env.CHAT_ID } });
  return { ok: true };
}`);
  await write(user, 'index.html', `<script>
  fetch('/api/fn/kirim', { method: 'POST' });
  fetch('/api/fn/hilang');
  fetch('/api/db/pesanan');
  fetch('/api/db/pesanan', { method: 'POST' });
</script>`);

  const { status, body } = await user.get('/api/docs');
  assert.equal(status, 200);

  const t = body.tables.find((x) => x.name === 'pesanan');
  assert.deepEqual(t.columns.map((c) => [c.name, c.required, c.private]), [['nama', true, false], ['hp', false, true]]);
  assert.equal(t.rules.create, 'public');
  assert.deepEqual(t.usedBy.map((u) => [u.file, u.op, u.status]), [['index.html', 'list', 'owner_only'], ['index.html', 'create', 'ok']]);

  const [f] = body.functions;
  assert.equal(f.name, 'kirim');
  assert.equal(f.summary, 'Kirim pesanan ke Telegram.');
  assert.match(f.url, /\/api\/fn\/kirim$/);
  assert.deepEqual([f.methods, f.body, f.query, f.secrets], [['POST'], ['nama', 'hp'], [], ['TG_TOKEN', 'CHAT_ID']]);
  assert.deepEqual(f.tables, [{ table: 'pesanan', ops: ['create'] }, { table: 'produk', ops: ['list'] }]);
  assert.deepEqual([f.fetches, f.usedBy, f.schedule], [['api.telegram.org'], ['index.html'], null]);

  assert.deepEqual(body.secrets.map((s) => [s.name, s.usedBy]), [['LAMA', []], ['TG_TOKEN', ['kirim']]]);
  assert.ok(!JSON.stringify(body).includes('rahasia'), 'nilai rahasia tidak boleh ikut');

  const issues = body.issues.map((i) => [i.kind, i.name, i.file ?? i.fn, i.op ?? '']).sort();
  assert.deepEqual(issues, [
    ['missing_function', 'hilang', 'index.html', ''],
    ['missing_secret', 'CHAT_ID', 'kirim', ''],
    ['missing_table', 'produk', 'kirim', ''],
    ['owner_only', 'pesanan', 'index.html', 'list'],
  ]);

  assert.equal((await stack.register('docs-asing').then((u) => u.raw('GET', '/api/docs', { headers: { 'X-Project': 'docs-user' } }))).status, 404);
});

test('Catatan Project: disimpan, ikut dikirim ke AI Builder & Plan, dan bisa dibuatkan drafnya', { skip }, async () => {
  const user = await stack.register('docs-catatan');
  const first = await user.get('/api/docs');
  assert.deepEqual([first.body.notes, first.body.notesMax], ['', 8000]);

  // Tanpa catatan: tidak ada bagian catatan di prompt.
  stack.ai.script.push({ text: 'Rencana' });
  await user.prompt('rencana');
  assert.ok(!JSON.stringify(stack.ai.requests.at(-1).messages).includes('project-notes'));

  const saved = await user.put('/api/docs/notes', { notes: '  ## Gaya\r\n- Warna utama hijau #16a34a\n\n' });
  assert.deepEqual([saved.status, saved.body.notes], [200, '## Gaya\n- Warna utama hijau #16a34a']);
  assert.equal((await user.get('/api/docs')).body.notes, '## Gaya\n- Warna utama hijau #16a34a');
  assert.equal((await user.put('/api/docs/notes', { notes: 'x'.repeat(8001) })).status, 400);
  assert.equal((await user.put('/api/docs/notes', { notes: 5 })).status, 400);

  const block = '<project-notes>\n## Gaya\n- Warna utama hijau #16a34a\n</project-notes>';
  stack.ai.script.push({ text: 'Rencana' });
  await user.prompt('rencana lagi');
  const planAsk = stack.ai.requests.at(-1).messages.at(-1).content;
  assert.ok(planAsk.includes(block) && planAsk.indexOf(block) < planAsk.indexOf('Request:\nrencana lagi'), planAsk.slice(0, 400));
  stack.ai.script.push({ text: 'Tidak ada yang perlu diubah.' });
  await user.build('cek');
  assert.ok(stack.ai.requests.at(-1).messages.at(-1).content.includes(block));

  // Draf: 1 kredit, pagar kode & judul dibuang, tidak langsung disimpan; catatan lama ikut dikirim.
  const before = (await user.credits()).freeRemaining;
  stack.ai.script.push({ text: '```markdown\n# Catatan Project\n\n## Tentang website\n- Toko kue (perkiraan — sesuaikan)\n```' });
  const draft = await user.post('/api/docs/notes/draft');
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.equal(draft.body.draft, '## Tentang website\n- Toko kue (perkiraan — sesuaikan)');
  assert.equal(draft.body.credits.freeRemaining, before - 1);
  const sent = stack.ai.requests.at(-1).messages;
  assert.match(sent[0].content, /Project notes/);
  assert.ok(sent[1].content.includes(block) && sent[1].content.includes('Automatic analysis'));
  assert.equal((await user.get('/api/docs')).body.notes, '## Gaya\n- Warna utama hijau #16a34a');

  // Isi kotak teks yang belum disimpan dipakai sebagai dasar draf.
  stack.ai.script.push({ text: '## Aturan untuk AI\n- Bahasa santai' });
  assert.equal((await user.post('/api/docs/notes/draft', { notes: 'Pakai bahasa santai' })).status, 200);
  assert.ok(stack.ai.requests.at(-1).messages[1].content.includes('<project-notes>\nPakai bahasa santai\n</project-notes>'));
  const afterDrafts = before - 2;

  // Draf kosong: gagal dan kredit dikembalikan.
  stack.ai.script.push({ text: '   ' });
  const bad = await user.post('/api/docs/notes/draft');
  assert.equal(bad.status, 422);
  assert.equal((await user.credits()).freeRemaining, afterDrafts);

  const stranger = await stack.register('docs-orang-lain');
  assert.equal((await stranger.req('PUT', '/api/docs/notes', { notes: 'x' }, { 'X-Project': 'docs-catatan' })).status, 404);
});

test('Peta Halaman: tautan keluar/masuk, CSS/JS, form, deskripsi, dan masalahnya', { skip }, async () => {
  const user = await stack.register('docs-peta');
  await write(user, 'index.html', `<!doctype html><html><head><title>Beranda</title>
<meta name="description" content="Toko kue rumahan">
<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="hilang.css"><script src="app.js"></script></head>
<body><a href="tentang.html">Tentang</a> <a href="rusak.html">Rusak</a> <a href="https://contoh.com">Luar</a>
<form action="/api/fn/kirim" method="post"></form></body></html>`);
  await write(user, 'tentang.html', '<title>Tentang kami</title><a href="index.html">Kembali</a>');
  await write(user, 'sendiri.html', '<h1>Halaman sendiri</h1>');
  await write(user, 'style.css', 'body{}');
  await write(user, 'app.js', '');

  const { body } = await user.get('/api/docs');
  const page = (p) => body.pages.find((x) => x.path === p);
  const index = page('index.html');
  assert.deepEqual([index.title, index.description, index.orphan], ['Beranda', 'Toko kue rumahan', false]);
  assert.deepEqual(index.links.map((l) => [l.to, l.broken]), [['tentang.html', false], ['rusak.html', true]]);
  assert.deepEqual(index.linkedFrom, ['tentang.html']);
  assert.deepEqual(index.assets.map((a) => [a.to, a.kind, a.missing]), [['style.css', 'css', false], ['hilang.css', 'css', true], ['app.js', 'js', false]]);
  assert.deepEqual(index.forms, [{ page: 'index.html', action: '/api/fn/kirim', method: 'post' }]);
  assert.deepEqual([page('tentang.html').title, page('tentang.html').linkedFrom], ['Tentang kami', ['index.html']]);
  assert.deepEqual([page('sendiri.html').title, page('sendiri.html').orphan], ['Halaman sendiri', true]);

  const issues = body.issues.filter((i) => ['broken_link', 'missing_asset', 'orphan_page'].includes(i.kind)).map((i) => [i.kind, i.name, i.file]);
  assert.deepEqual(issues, [['broken_link', 'rusak.html', 'index.html'], ['missing_asset', 'hilang.css', 'index.html'], ['orphan_page', 'sendiri.html', 'sendiri.html']]);
});

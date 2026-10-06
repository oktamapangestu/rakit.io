// Baca Alur Kode (/api/ai/explain): AI menjelaskan alur satu file langkah demi langkah, beserta rujukan ke file
// lain. Gratis (tanpa kredit), dibatasi per akun per hari, hasil disimpan per file + hash isi. Fitur khusus Go.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const skip = !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go';

let stack;
before(async () => { if (!skip) stack = await startStack({ AI_EXPLAIN_DAILY_LIMIT: '3' }); });
after(() => stack?.stop());

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const code = "const tombol = document.getElementById('sapa');\ntombol.addEventListener('click', () => {\n  alert('Halo');\n});";
const answer = (steps) => ({ text: '```json\n' + JSON.stringify({
  summary: 'Menyapa pengunjung saat tombol diklik.',
  steps,
  related: [{ path: 'index.html', line: 20, note: 'memuat script.js' }],
  complexity: 'Sangat cepat.',
  notes: [{ level: 'tip', line: 3, text: 'Pakai pesan di halaman, bukan alert.' }],
}) + '\n```' });

test('baca alur kode: konteks ke AI, hasil disimpan per isi file, kuota harian', { skip }, async () => {
  const user = await stack.register('alur');
  assert.equal((await stack.client().post('/api/ai/explain', { path: 'script.js', content: code })).status, 401);
  const credits = (await user.credits()).remaining;

  const empty = await user.get('/api/ai/explain?path=script.js');
  assert.deepEqual(empty.body, { saved: null, remaining: 3, limit: 3 });

  stack.ai.script.push(answer([
    { id: 1, title: 'Ambil tombol', kind: 'start', lines: [[1, 1]], explain: 'Mencari tombol.', refs: [{ path: 'index.html', line: 12, note: 'tombol' }] },
    { id: 2, title: 'Tunggu klik', kind: 'event', lines: [[2, 4]], explain: 'Menunggu klik.', next: [] },
  ]));
  const first = await user.post('/api/ai/explain', { path: 'script.js', content: code });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.cached, false);
  assert.equal(first.body.remaining, 2);
  assert.equal(first.body.saved.hash, sha(code));
  const ex = first.body.saved.explanation;
  assert.deepEqual(ex.steps.map((s) => [s.id, s.title, s.lines]), [[1, 'Ambil tombol', [[1, 1]]], [2, 'Tunggu klik', [[2, 4]]]]);
  assert.deepEqual(ex.steps[0].refs, [{ path: 'index.html', line: 12, note: 'tombol' }]);
  assert.deepEqual(ex.related, [{ path: 'index.html', line: 20, note: 'memuat script.js' }]);

  // Yang dikirim: isi editor bernomor baris, dan index.html (memuat script.js) sebagai file terkait.
  const sent = stack.ai.requests.at(-1).messages[1].content;
  assert.match(sent, /FILE TO EXPLAIN: script\.js \(4 lines\)/);
  assert.match(sent, /1\| const tombol = document\.getElementById\('sapa'\);/);
  assert.match(sent, /<related path="index\.html">\n 1\| <!doctype html>/i);

  // Isi sama: diambil dari simpanan, tanpa AI dan tanpa kuota.
  const requests = stack.ai.requests.length;
  const again = await user.post('/api/ai/explain', { path: 'script.js', content: code });
  assert.deepEqual([again.body.cached, again.body.remaining, stack.ai.requests.length], [true, 2, requests]);
  assert.equal((await user.get('/api/ai/explain?path=script.js')).body.saved.hash, sha(code));

  // Jawaban rusak: diminta ulang sekali dalam percakapan yang sama (tetap 1 kuota), lalu menyerah.
  stack.ai.script.push({ text: 'Maaf, ini penjelasannya tanpa JSON.' }, { text: '{rusak' });
  const broken = await user.post('/api/ai/explain', { path: 'script.js', content: code, force: true });
  assert.equal(broken.status, 422);
  assert.match(stack.ai.requests.at(-1).messages.at(-1).content, /not valid JSON/);
  assert.equal((await user.get('/api/ai/explain?path=script.js')).body.saved.explanation.steps.length, 2, 'simpanan lama tetap');

  // Tanya lanjutan: tahu langkah yang sedang dibuka.
  stack.ai.script.push({ text: 'Karena `getElementById` mencari elemen dengan id **sapa** (baris 1).' });
  const ask = await user.post('/api/ai/explain/ask', { path: 'script.js', content: code, step: 2, question: 'Kenapa pakai id?', history: [{ q: 'Halo', a: 'Hai' }] });
  assert.equal(ask.status, 200);
  assert.match(ask.body.answer, /getElementById/);
  const asked = stack.ai.requests.at(-1).messages;
  assert.match(asked[1].content, /step 2 "Tunggu klik"/);
  assert.deepEqual(asked.slice(-3).map((m) => m.content), ['Halo', 'Hai', 'Kenapa pakai id?']);

  const limited = await user.post('/api/ai/explain', { path: 'script.js', content: `${code}\n// ubah`, force: true });
  assert.deepEqual([limited.status, limited.body.code], [429, 'explain_limit']);
  assert.equal((await user.credits()).remaining, credits, 'tidak memakai kredit');
});

test('baca alur kode: validasi file', { skip }, async () => {
  const user = await stack.register('alur2');
  const cases = [
    [{ path: 'logo.png', content: 'x' }, 400],
    [{ path: '../x.js', content: 'x' }, 400],
    [{ path: 'script.js' }, 400],
    [{ path: 'script.js', content: '   \n' }, 400],
    [{ path: 'script.js', content: 'x'.repeat(130_000) }, 413],
    [{ path: 'script.js', content: 'x', question: '' }, 400, '/api/ai/explain/ask'],
  ];
  for (const [body, status, url = '/api/ai/explain'] of cases) {
    assert.equal((await user.post(url, body)).status, status, JSON.stringify(body).slice(0, 80));
  }
});

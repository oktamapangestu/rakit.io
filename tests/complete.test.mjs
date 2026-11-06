// Prediksi kode di editor (/api/ai/complete): gratis (tanpa kredit), dibatasi per akun per hari, jawaban
// model dirapikan (hanya isi <insert>, tanpa mengulang kode di sekitar kursor). Fitur khusus Go.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const skip = !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go';

let stack;
before(async () => { if (!skip) stack = await startStack({ AI_COMPLETE_DAILY_LIMIT: '3' }); });
after(() => stack?.stop());

const complete = (user, body) => user.post('/api/ai/complete', body);

test('prediksi kode: konteks ke model, jawaban dirapikan, kuota harian', { skip }, async () => {
  const user = await stack.register('ketik');
  assert.equal((await stack.client().post('/api/ai/complete', { prefix: 'x' })).status, 401);
  const credits = (await user.credits()).freeRemaining;

  stack.ai.script.push({ text: 'Tentu! <insert>console.log(nama);\n</insert> Penjelasan diabaikan.' });
  const first = await complete(user, { path: 'script.js', prefix: 'function sapa(nama) {\n  ', suffix: '\n}\n' });
  assert.equal(first.status, 200);
  assert.equal(first.body.completion, 'console.log(nama);');
  assert.equal(first.body.remaining, 2);
  const sent = stack.ai.requests.at(-1);
  assert.equal(sent.model, 'mock-vision', 'tanpa AI_COMPLETE_MODEL: model cepat (model gambar)');
  assert.equal(sent.max_tokens, 256);
  assert.equal(sent.messages[1].content, 'File: script.js\n\nfunction sapa(nama) {\n  <CURSOR>\n}\n\n\nReply with <insert>...</insert> only.');

  // Baris yang sedang diketik dan sisa baris sesudah kursor yang ikut ditulis model dibuang.
  stack.ai.script.push({ text: '<insert>  <h1>Halo</h1></insert>' });
  assert.equal((await complete(user, { path: 'index.html', prefix: '<body>\n  <h1>', suffix: '</h1>\n' })).body.completion, 'Halo');

  // Tanpa kode sebelum kursor: tidak bertanya ke model dan tidak dihitung.
  const before = stack.ai.requests.length;
  assert.deepEqual((await complete(user, { path: 'a.js', prefix: '  \n', suffix: '' })).body, { completion: '' });
  assert.equal(stack.ai.requests.length, before);

  stack.ai.script.push({ text: 'Kodenya sudah lengkap.' }); // tanpa <insert>: tidak ada saran
  assert.equal((await complete(user, { path: 'a.js', prefix: 'let a', suffix: '' })).body.completion, '');
  const limited = await complete(user, { path: 'a.js', prefix: 'let b', suffix: '' });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'complete_limit');
  assert.equal((await user.credits()).freeRemaining, credits, 'tidak memakai kredit');
});

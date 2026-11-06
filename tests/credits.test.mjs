// Kuota AI: jatah prompt harian (1 prompt = 1, termasuk bergambar), lalu kredit yang dibeli; pemotongan di awal dan
// pengembalian saat gagal/dihentikan.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startStack, TINY_PNG } from './helpers/harness.mjs';

let stack;
before(async () => { stack = await startStack(); }); // 4 prompt gratis/hari, 1 kredit/prompt, 2 kredit/prompt bergambar
after(() => stack?.stop());

const buy = (user, n) => stack.db().prepare(`
  INSERT INTO credit_balance (user_id, balance) VALUES (?, ?)
  ON CONFLICT (user_id) DO UPDATE SET balance = balance + excluded.balance`).run(user.userId, n);

test('akun baru mendapat jatah prompt harian, tanpa langganan & bonus', async () => {
  const user = await stack.register();
  const c = await user.credits();
  assert.equal(c.enabled, true);
  assert.deepEqual([c.limit, c.used, c.freeRemaining, c.purchased, c.remaining], [4, 0, 4, 0, 0]);
  assert.equal(c.costPerPrompt, 1);
  assert.deepEqual(c.images, { cost: 2, max: 3 });
  for (const gone of ['plan', 'bonusLimit', 'bonusRemaining']) assert.equal(c[gone], undefined, gone);
});

test('tanpa login ditolak 401, Origin asing ditolak 403', async () => {
  const anon = stack.client();
  assert.equal((await anon.get('/api/ai/credits')).status, 401);
  assert.equal((await anon.startPrompt()).status, 401);

  const user = await stack.register();
  const res = await user.req('POST', '/api/ai/prompt', { prompt: 'x', mode: 'plan' }, { Origin: 'http://jahat.localhost' });
  assert.equal(res.status, 403);
  assert.equal((await user.credits()).freeRemaining, 4);
});

test('prompt berhasil memakai 1 jatah dan mencatat request', async () => {
  const user = await stack.register();
  stack.ai.script.push({ text: 'Ini rencananya.' });
  const { started, final } = await user.prompt('Buat halaman toko');
  assert.equal(started.status, 201);
  assert.equal(started.body.credits.freeRemaining, 3, 'jatah dipotong saat prompt diterima');
  assert.equal(final.type, 'done');
  assert.equal(final.message.content, 'Ini rencananya.');
  assert.equal(final.credits.freeRemaining, 3);

  const log = stack.db().prepare('SELECT model, status, input_tokens, output_tokens FROM ai_requests WHERE user_id = ?').all(user.userId);
  assert.deepEqual(log.map((r) => ({ ...r })), [{ model: 'mock-main', status: 'ok', input_tokens: 100, output_tokens: 20 }]);
});

test('jatah habis: kredit yang dibeli dipakai, lalu ditolak 402', async () => {
  const user = await stack.register();
  for (let i = 0; i < 4; i++) assert.equal((await user.prompt(`prompt ${i}`)).final.type, 'done');
  const refused = await user.startPrompt('satu lagi');
  assert.deepEqual([refused.status, refused.body.code], [402, 'no_credits']);
  assert.match(refused.body.error, /Jatah 4 prompt hari ini sudah habis/);
  assert.equal((await user.get('/api/ai/threads')).body.activeJob, null, 'tidak ada job yang menggantung');

  buy(user, 1);
  const paid = await user.prompt('pakai kredit');
  assert.equal(paid.started.status, 201);
  assert.deepEqual([paid.final.credits.freeRemaining, paid.final.credits.purchased], [0, 0]);
  assert.equal((await user.startPrompt('habis')).status, 402);
});

test('AI gagal / menjawab kosong / Stop: jatah dikembalikan', async () => {
  const user = await stack.register();
  stack.ai.script.push({ status: 500 });
  const failed = await user.prompt('akan gagal');
  assert.equal(failed.started.body.credits.freeRemaining, 3);
  assert.equal(failed.final.type, 'error');
  assert.match(failed.final.error, /Kredit dikembalikan/);
  assert.equal(failed.final.credits.freeRemaining, 4);
  assert.equal(stack.db().prepare('SELECT status FROM ai_requests WHERE user_id = ?').get(user.userId).status, 'error');

  stack.ai.script.push({ text: '   ' });
  assert.equal((await user.prompt('jawaban kosong')).final.credits.freeRemaining, 4);

  stack.ai.script.push({ hang: true });
  const called = stack.ai.nextRequest();
  const started = await user.startPrompt('lama sekali');
  await called;
  assert.equal((await user.credits()).freeRemaining, 3);
  const id = started.body.assistantMessage.id;
  assert.equal((await user.post(`/api/ai/jobs/${id}/cancel`)).status, 200);
  const final = await user.finishJob(id);
  assert.deepEqual([final.message.status, final.credits.freeRemaining], ['aborted', 4]);
});

test('kredit dibeli dikembalikan ke saldo bila AI gagal', async () => {
  const user = await stack.register();
  for (let i = 0; i < 4; i++) await user.prompt(`prompt ${i}`);
  buy(user, 3);
  stack.ai.script.push({ status: 500 });
  const failed = await user.prompt('gagal');
  assert.equal(failed.started.body.credits.purchased, 2);
  assert.equal(failed.final.credits.purchased, 3);
});

test('satu prompt berjalan per akun: prompt kedua ditolak 429 tanpa memotong jatah', async () => {
  const user = await stack.register();
  stack.ai.script.push({ hang: true });
  const called = stack.ai.nextRequest();
  const first = await user.startPrompt('pertama');
  await called;
  assert.equal((await user.startPrompt('kedua')).status, 429);
  assert.equal((await user.credits()).freeRemaining, 3);

  const other = await stack.register();
  assert.equal((await other.post(`/api/ai/jobs/${first.body.assistantMessage.id}/cancel`)).status, 404);
  await user.post(`/api/ai/jobs/${first.body.assistantMessage.id}/cancel`);
  await user.finishJob(first.body.assistantMessage.id);
  assert.equal((await user.credits()).freeRemaining, 4);
});

test('prompt bergambar: 1 dari jatah harian, atau 2 kredit setelah jatah habis', async () => {
  const user = await stack.register();
  stack.ai.script.push({ text: 'Image 1: mockup halaman.' }, { text: 'Rencana dari gambar.' });
  const { started, final } = await user.prompt('ikuti desain ini', { images: [TINY_PNG], thumbs: [TINY_PNG] });
  assert.equal(started.status, 201);
  assert.equal(final.credits.freeRemaining, 3);
  assert.equal(stack.ai.requests.at(-2).model, 'mock-vision');
  assert.equal(stack.ai.requests.at(-1).model, 'mock-main');

  for (let i = 0; i < 3; i++) await user.prompt(`biasa ${i}`);
  buy(user, 1);
  const refused = await user.startPrompt('gambar lagi', { images: [TINY_PNG], thumbs: [TINY_PNG] });
  assert.deepEqual([refused.status, refused.body.code], [402, 'no_credits']);
  assert.match(refused.body.error, /butuh 2 kredit/);
  buy(user, 1);
  stack.ai.script.push({ text: 'Image 1: mockup.' }, { text: 'Rencana.' });
  const ok = await user.prompt('gambar dari kredit', { images: [TINY_PNG], thumbs: [TINY_PNG] });
  assert.equal(ok.final.type, 'done');
  assert.equal(ok.final.credits.purchased, 0);
});

test('prompt tidak valid ditolak tanpa memotong jatah', async () => {
  const user = await stack.register();
  assert.equal((await user.startPrompt('   ')).status, 400);
  assert.equal((await user.startPrompt('x'.repeat(20_001))).status, 400);
  assert.equal((await user.startPrompt('gambar rusak', { images: ['data:image/png;base64,AAAA'] })).status, 400);
  assert.equal((await user.credits()).freeRemaining, 4);
});

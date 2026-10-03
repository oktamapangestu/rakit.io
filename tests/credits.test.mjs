// Kredit AI: pemotongan di awal, urutan sumber (bonus → gratis harian), dan pengembalian saat gagal/dihentikan.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startStack, TINY_PNG } from './helpers/harness.mjs';

let stack;
before(async () => { stack = await startStack(); }); // bonus 2, gratis harian 2, 1 kredit/prompt, 2 kredit/prompt bergambar
after(() => stack?.stop());

test('akun baru mendapat bonus + jatah gratis harian', async () => {
  const user = await stack.register();
  const c = await user.credits();
  assert.equal(c.enabled, true);
  assert.equal(c.bonusLimit, 2);
  assert.equal(c.bonusRemaining, 2);
  assert.equal(c.limit, 2);
  assert.equal(c.freeRemaining, 2);
  assert.equal(c.purchased, 0);
  assert.equal(c.remaining, 4);
  assert.equal(c.costPerPrompt, 1);
  assert.deepEqual(c.images, { cost: 2, max: 3 });
  assert.equal(c.plan, null);
});

test('tanpa login ditolak 401, Origin asing ditolak 403', async () => {
  const anon = stack.client();
  assert.equal((await anon.get('/api/ai/credits')).status, 401);
  assert.equal((await anon.startPrompt()).status, 401);

  const user = await stack.register();
  const res = await user.req('POST', '/api/ai/prompt', { prompt: 'x', mode: 'plan' }, { Origin: 'http://jahat.localhost' });
  assert.equal(res.status, 403);
  assert.equal((await user.credits()).remaining, 4);
});

test('prompt berhasil memotong 1 kredit dan mencatat request', async () => {
  const user = await stack.register();
  stack.ai.script.push({ text: 'Ini rencananya.' });
  const { started, final } = await user.prompt('Buat halaman toko');
  assert.equal(started.status, 201);
  assert.equal(started.body.credits.remaining, 3, 'kredit dipotong saat prompt diterima');
  assert.equal(final.type, 'done');
  assert.equal(final.message.status, 'done');
  assert.equal(final.message.content, 'Ini rencananya.');
  assert.equal(final.credits.remaining, 3);

  const log = stack.db().prepare('SELECT model, status, input_tokens, output_tokens FROM ai_requests WHERE user_id = ?').all(user.userId);
  assert.deepEqual(log.map((r) => ({ ...r })), [{ model: 'mock-main', status: 'ok', input_tokens: 100, output_tokens: 20 }]);
});

test('urutan pemakaian: bonus dulu, lalu gratis harian, lalu ditolak 402', async () => {
  const user = await stack.register();
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const { final } = await user.prompt(`prompt ${i}`);
    assert.equal(final.type, 'done');
    seen.push([final.credits.bonusRemaining, final.credits.freeRemaining]);
  }
  assert.deepEqual(seen, [[1, 2], [0, 2], [0, 1], [0, 0]]);

  const refused = await user.startPrompt('satu lagi');
  assert.equal(refused.status, 402);
  assert.equal(refused.body.code, 'no_credits');
  assert.equal((await user.credits()).remaining, 0);
  // Prompt yang ditolak tidak meninggalkan job yang menggantung.
  const threads = (await user.get('/api/ai/threads')).body;
  assert.equal(threads.activeJob, null);
});

test('AI gagal: kredit dikembalikan', async () => {
  const user = await stack.register();
  stack.ai.script.push({ status: 500 });
  const { started, final } = await user.prompt('akan gagal');
  assert.equal(started.body.credits.remaining, 3);
  assert.equal(final.type, 'error');
  assert.equal(final.message.status, 'error');
  assert.match(final.error, /Kredit dikembalikan/);
  assert.equal(final.credits.remaining, 4);
  assert.equal(final.credits.bonusRemaining, 2);
  assert.equal(stack.db().prepare('SELECT status FROM ai_requests WHERE user_id = ?').get(user.userId).status, 'error');
});

test('AI menjawab kosong: dianggap gagal dan kredit dikembalikan', async () => {
  const user = await stack.register();
  stack.ai.script.push({ text: '   ' });
  const { final } = await user.prompt('jawaban kosong');
  assert.equal(final.type, 'error');
  assert.equal(final.credits.remaining, 4);
});

test('Stop: job dibatalkan dan kredit dikembalikan', async () => {
  const user = await stack.register();
  stack.ai.script.push({ hang: true });
  const called = stack.ai.nextRequest();
  const started = await user.startPrompt('lama sekali');
  assert.equal(started.status, 201);
  await called;
  const id = started.body.assistantMessage.id;

  assert.equal((await user.credits()).remaining, 3);
  assert.equal((await user.post(`/api/ai/jobs/${id}/cancel`)).status, 200);
  const final = await user.finishJob(id);
  assert.equal(final.type, 'error');
  assert.equal(final.message.status, 'aborted');
  assert.equal(final.credits.remaining, 4);
});

test('satu prompt berjalan per akun: prompt kedua ditolak 429 tanpa memotong kredit', async () => {
  const user = await stack.register();
  stack.ai.script.push({ hang: true });
  const called = stack.ai.nextRequest();
  const first = await user.startPrompt('pertama');
  await called;

  const second = await user.startPrompt('kedua');
  assert.equal(second.status, 429);
  assert.equal((await user.credits()).remaining, 3, 'hanya prompt pertama yang memotong kredit');

  // Job orang lain tidak boleh disentuh.
  const other = await stack.register();
  assert.equal((await other.post(`/api/ai/jobs/${first.body.assistantMessage.id}/cancel`)).status, 404);

  await user.post(`/api/ai/jobs/${first.body.assistantMessage.id}/cancel`);
  await user.finishJob(first.body.assistantMessage.id);
  assert.equal((await user.credits()).remaining, 4);
});

test('prompt dengan gambar memakai 2 kredit; ditolak bila sisa kredit kurang', async () => {
  const user = await stack.register();
  stack.ai.script.push({ text: 'Image 1: mockup halaman.' }, { text: 'Rencana dari gambar.' });
  const { started, final } = await user.prompt('ikuti desain ini', { images: [TINY_PNG], thumbs: [TINY_PNG] });
  assert.equal(started.status, 201);
  assert.equal(final.type, 'done');
  assert.equal(final.credits.remaining, 2);
  assert.equal(stack.ai.requests.at(-2).model, 'mock-vision');
  assert.equal(stack.ai.requests.at(-1).model, 'mock-main');

  await user.prompt('biasa'); // sisa 1
  const refused = await user.startPrompt('gambar lagi', { images: [TINY_PNG], thumbs: [TINY_PNG] });
  assert.equal(refused.status, 402);
  assert.equal(refused.body.code, 'no_credits');
  assert.equal((await user.credits()).remaining, 1);
});

test('prompt tidak valid ditolak tanpa memotong kredit', async () => {
  const user = await stack.register();
  assert.equal((await user.startPrompt('   ')).status, 400);
  assert.equal((await user.startPrompt('x'.repeat(20_001))).status, 400);
  assert.equal((await user.startPrompt('gambar rusak', { images: ['data:image/png;base64,AAAA'] })).status, 400);
  assert.equal((await user.credits()).remaining, 4);
});

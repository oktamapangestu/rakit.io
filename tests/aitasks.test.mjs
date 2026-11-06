// Model per tugas (dashboard owner → Model AI editor → Model per tugas): Builder, Plan, diagram, Baca Alur
// Kode, dan prediksi kode bisa memakai model khusus beserta cadangannya sendiri; tanpa itu mengikuti model
// utama. Fitur ini hanya ada di server Go.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const skip = !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go';
const MODELS = '/api/admin/ai-models';
const BASE = { model: 'mock-main', fallbacks: [], vision: 'mock-vision', visionFallbacks: [] };

let stack;
let admin;
before(async () => {
  if (skip) return;
  stack = await startStack({ AI_DAILY_PROMPTS: '22' });
  admin = await stack.admin();
});
after(() => stack?.stop());

test('model per tugas: default kosong, divalidasi, gagal = tidak ada yang tersimpan', { skip }, async () => {
  const view = (await admin.get(MODELS)).body;
  assert.deepEqual(view.tasks, {});
  assert.deepEqual(view.taskList.map((t) => [t.key, t.default]), [
    ['builder', 'Model utama'], ['plan', 'Model utama'], ['diagram', 'Model utama'], ['explain', 'Model utama'], ['complete', 'Model gambar, lalu model utama'],
  ]);

  for (const [tasks, message] of [
    [{ plan: { model: '', fallbacks: ['x'] } }, 'Plan: isi modelnya dulu sebelum model cadangan'],
    [{ builder: { model: 'ada spasi' } }, 'Builder: ID model tidak valid'],
    [{ diagram: { model: 'a', fallbacks: ['b', 'a'] } }, 'Diagram: model "a" tercantum dua kali'],
    [{ explain: { model: 'a', fallbacks: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'] } }, 'Baca Alur Kode: model cadangan maksimal 5'],
    [{ complete: { model: 'cepat@tidak-ada' } }, 'Prediksi kode: provider "tidak-ada" belum ada — tambahkan dulu di Provider AI'],
    ['bukan objek', 'Model per tugas tidak valid'],
  ]) {
    const res = await admin.put(MODELS, { ...BASE, model: 'tidak-tersimpan', tasks });
    assert.deepEqual([res.status, res.body.error], [400, message], JSON.stringify(tasks));
  }
  assert.equal((await admin.get(MODELS)).body.models.model, 'mock-main', 'model utama tidak ikut tersimpan saat tugas tidak valid');

  // Tanpa "tasks" di body (klien lama): model per tugas tidak diubah.
  await admin.put(MODELS, { ...BASE, tasks: { plan: { model: 'mock-plan' } } });
  await admin.put(MODELS, BASE);
  assert.deepEqual((await admin.get(MODELS)).body.tasks, { plan: { model: 'mock-plan', fallbacks: [] } });
  await admin.put(MODELS, { ...BASE, tasks: {} });
});

test('tiap tugas memakai modelnya sendiri; cadangan tugas dipakai saat modelnya gangguan', { skip }, async () => {
  const user = await stack.register();
  const saved = await admin.put(MODELS, {
    ...BASE,
    fallbacks: ['mock-cadangan-utama'],
    tasks: { plan: { model: 'mock-plan', fallbacks: ['mock-plan-2'] }, complete: { model: 'mock-cepat' }, builder: { model: '' } },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.tasks, { plan: { model: 'mock-plan', fallbacks: ['mock-plan-2'] }, complete: { model: 'mock-cepat', fallbacks: [] } });
  assert.deepEqual(saved.body.health.map((h) => h.model), ['mock-main', 'mock-cadangan-utama', 'mock-vision', 'mock-plan', 'mock-plan-2', 'mock-cepat']);

  await user.prompt('rencanakan');
  assert.equal(stack.ai.requests.at(-1).model, 'mock-plan');
  await user.prompt('bangun', { mode: 'build' });
  assert.equal(stack.ai.requests.at(-1).model, 'mock-main', 'Builder tanpa model khusus: model utama');
  stack.ai.script.push({ text: '<insert>1;</insert>' });
  await user.post('/api/ai/complete', { path: 'a.js', prefix: 'let a = ', suffix: '' });
  assert.equal(stack.ai.requests.at(-1).model, 'mock-cepat');

  // Model Plan gangguan → cadangan Plan (bukan cadangan model utama).
  stack.ai.respond = (body) => (body.model === 'mock-plan' ? { status: 500 } : { text: `dari ${body.model}` });
  const res = await user.prompt('rencanakan lagi');
  assert.equal(res.final.message.content, 'dari mock-plan-2');
  assert.deepEqual(stack.db().prepare('SELECT model FROM ai_requests WHERE user_id = ? ORDER BY id').all(user.userId).map((r) => r.model),
    ['mock-plan', 'mock-main', 'mock-plan-2']);
  stack.ai.respond = undefined;

  // Dikosongkan lagi: Plan kembali mengikuti model utama.
  await admin.put(MODELS, { ...BASE, tasks: {} });
  await user.prompt('rencana ketiga');
  assert.equal(stack.ai.requests.at(-1).model, 'mock-main');
});

test('model tugas bisa di provider lain; provider itu tercatat dipakai', { skip }, async () => {
  const res = await admin.put('/api/admin/ai-providers', { providers: [{ id: 'lain', name: 'Lain', baseUrl: stack.ai.url, apiKey: 'test-key' }] });
  assert.equal(res.status, 200);
  await admin.put(MODELS, { ...BASE, tasks: { diagram: { model: 'mock-diagram@lain', fallbacks: ['mock-diagram-2'] } } });
  const lain = (await admin.get('/api/admin/ai-providers')).body.providers.find((p) => p.id === 'lain');
  assert.deepEqual(lain.usedBy, ['Diagram: mock-diagram@lain']);
  const blocked = await admin.put('/api/admin/ai-providers', { providers: [] });
  assert.match(blocked.body.error, /^Provider "lain" masih dipakai \(Diagram: mock-diagram@lain\)/);
  await admin.put(MODELS, { ...BASE, tasks: {} });
  assert.equal((await admin.put('/api/admin/ai-providers', { providers: [] })).status, 200);
});

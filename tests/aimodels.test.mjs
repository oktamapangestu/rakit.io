// Model AI editor: pengaturan owner, model cadangan saat model utama gangguan, dan antrean.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const MODELS = '/api/admin/ai-models';

test('pengaturan model: hanya owner, divalidasi, default dari .env', async () => {
  const stack = await startStack({ AI_FALLBACK_MODEL: 'env-cadangan' });
  try {
    const admin = await stack.admin();
    const user = await stack.register();
    assert.equal((await user.get(MODELS)).status, 403);
    assert.equal((await user.put(MODELS, { model: 'x' })).status, 403);
    assert.equal((await stack.client().get(MODELS)).status, 401);

    const view = (await admin.get(MODELS)).body;
    assert.deepEqual(view.models, { model: 'mock-main', fallback: 'env-cadangan', vision: 'mock-vision', visionFallback: '' });
    assert.deepEqual([view.cooldownMinutes, view.fallbackUsed], [5, 0]);
    assert.deepEqual(view.health.map((h) => [h.model, h.down, h.failures, h.lastError, h.lastFailureAt, h.retryInSeconds]), [
      ['mock-main', false, 0, '', null, 0], ['env-cadangan', false, 0, '', null, 0], ['mock-vision', false, 0, '', null, 0],
    ]);

    for (const [body, message] of [
      [{ model: '' }, 'Model utama wajib diisi'],
      [{}, 'Model utama wajib diisi'],
      [{ model: 'ada spasi' }, 'Model utama: ID model tidak valid'],
      [{ model: 'a', fallback: '-x' }, 'Model cadangan: ID model tidak valid'],
      [{ model: 'a', fallback: 'a' }, 'Model cadangan harus berbeda dari model utama'],
      [{ model: 'a', visionFallback: 'b' }, 'Isi model gambar dulu sebelum model gambar cadangan'],
      [{ model: 'a', vision: 'v', visionFallback: 'v' }, 'Model gambar cadangan harus berbeda dari model gambar'],
    ]) {
      const res = await admin.put(MODELS, body);
      assert.deepEqual([res.status, res.body.error], [400, message], JSON.stringify(body));
    }
    assert.equal((await admin.get(MODELS)).body.models.model, 'mock-main');

    // Mengosongkan model gambar mematikan lampiran gambar di prompt.
    assert.deepEqual((await user.credits()).images, { cost: 2, max: 3 });
    const saved = await admin.put(MODELS, { model: ' org/model-baru:1 ', fallback: '', vision: '', visionFallback: '' });
    assert.deepEqual([saved.status, saved.body.models], [200, { model: 'org/model-baru:1', fallback: '', vision: '', visionFallback: '' }]);
    assert.equal((await user.credits()).images, null);
    await user.prompt('pakai model baru');
    assert.equal(stack.ai.requests.at(-1).model, 'org/model-baru:1');
    assert.equal(stack.db().prepare('SELECT model FROM ai_requests WHERE user_id = ?').get(user.userId).model, 'org/model-baru:1');
  } finally {
    await stack.stop();
  }
});

test('model utama gangguan → pindah ke model cadangan, lalu model utama dilewati sementara', async () => {
  const stack = await startStack({ AI_BONUS_CREDITS: '20' });
  try {
    const admin = await stack.admin();
    const user = await stack.register();
    await admin.put(MODELS, { model: 'mock-main', fallback: 'mock-cadangan', vision: 'mock-vision', visionFallback: 'mock-vision-2' });
    const seen = () => stack.ai.requests.map((r) => r.model);

    stack.ai.respond = (body) => (body.model === 'mock-main' ? { status: 500 } : { text: `dari ${body.model}` });
    const first = await user.prompt('satu');
    assert.equal(first.final.message.content, 'dari mock-cadangan');
    assert.deepEqual(seen(), ['mock-main', 'mock-cadangan']);
    assert.equal(first.final.credits.remaining, 21, 'tetap 1 kredit');

    // Selama masa jeda, permintaan berikutnya langsung ke cadangan.
    await user.prompt('dua');
    assert.deepEqual(seen().slice(2), ['mock-cadangan']);
    const view = (await admin.get(MODELS)).body;
    assert.equal(view.fallbackUsed, 1, 'dihitung saat benar-benar berpindah');
    const main = view.health.find((h) => h.model === 'mock-main');
    assert.deepEqual([main.down, main.failures], [true, 1]);
    assert.match(main.lastError, /^AI provider 500/);
    assert.ok(main.retryInSeconds > 0 && main.retryInSeconds <= 300);
    assert.equal(view.health.find((h) => h.model === 'mock-cadangan').down, false);
    assert.deepEqual(stack.db().prepare('SELECT model, status FROM ai_requests WHERE user_id = ? ORDER BY id').all(user.userId).map((r) => [r.model, r.status]),
      [['mock-cadangan', 'ok'], ['mock-cadangan', 'ok']]);

    // Cadangan ikut gangguan: keduanya dicoba, lalu gagal dengan kredit kembali.
    stack.ai.respond = () => ({ status: 500 });
    const both = await user.prompt('tiga');
    assert.deepEqual(seen().slice(3), ['mock-cadangan', 'mock-main']);
    assert.deepEqual([both.final.type, both.final.credits.remaining], ['error', 20]);

    // Keduanya pulih: kembali ke urutan utama → cadangan.
    stack.ai.respond = (body) => ({ text: `dari ${body.model}` });
    assert.equal((await user.prompt('empat')).final.message.content, 'dari mock-main');
    assert.equal((await admin.get(MODELS)).body.health.find((h) => h.model === 'mock-main').down, false);
  } finally {
    await stack.stop();
  }
});

test('yang bukan gangguan model tidak memicu pindah: API key ditolak; jawaban terputus memicu pindah', async () => {
  const stack = await startStack({ AI_FALLBACK_MODEL: 'mock-cadangan', AI_VISION_FALLBACK_MODEL: 'mock-vision-2', AI_BONUS_CREDITS: '20' });
  try {
    const user = await stack.register();
    const seen = () => stack.ai.requests.map((r) => r.model);
    stack.ai.script.push({ status: 401 });
    const denied = await user.prompt('kunci salah');
    assert.equal(denied.final.type, 'error');
    assert.deepEqual(seen(), ['mock-main']);

    stack.ai.script.push({ chunks: ['seteng'], cut: true }, { text: 'utuh dari cadangan' });
    assert.equal((await user.prompt('putus')).final.message.content, 'utuh dari cadangan');
    assert.deepEqual(seen().slice(1), ['mock-main', 'mock-cadangan']);

    // Sibuk (503): 1 kali coba ulang di model utama, lalu pindah.
    const other = await stack.register();
    stack.ai.respond = (body) => (body.model === 'mock-cadangan' ? { text: 'cadangan' } : { status: 503, retryAfter: 1 });
    stack.ai.requests.length = 0;
    // Model utama masih dalam masa jeda dari gangguan tadi, jadi cadangan dipakai langsung.
    assert.equal((await other.prompt('sibuk')).final.message.content, 'cadangan');
    assert.deepEqual(seen(), ['mock-cadangan']);
  } finally {
    await stack.stop();
  }
});

test('antrean: lebih dari batas menunggu giliran; antrean penuh ditolak dengan kredit kembali', async () => {
  const stack = await startStack({ AI_MAX_CONCURRENT: '1', AI_QUEUE_MAX: '1' });
  try {
    const [a, b, c] = [await stack.register(), await stack.register(), await stack.register()];
    stack.ai.script.push({ hang: true });
    const called = stack.ai.nextRequest();
    const first = await a.startPrompt('pertama');
    await called;

    const second = await b.startPrompt('kedua');
    const third = await c.startPrompt('ketiga');
    const full = await c.finishJob(third.body.assistantMessage.id);
    assert.deepEqual([full.type, full.error], ['error', 'AI sedang penuh. Coba lagi beberapa saat lagi. Kredit dikembalikan.']);
    assert.equal(full.credits.remaining, 4);
    assert.equal(stack.db().prepare('SELECT status FROM ai_requests WHERE user_id = ?').get(c.userId).status, 'queue_full');
    assert.equal((await b.get(`/api/ai/threads/${second.body.threadId}`)).body.messages[1].status, 'queued');

    // Yang pertama dihentikan: yang mengantre langsung jalan.
    await a.post(`/api/ai/jobs/${first.body.assistantMessage.id}/cancel`);
    const events = await b.jobEvents(second.body.assistantMessage.id);
    assert.deepEqual(events.map((e) => e.type), ['queued', 'running', 'done']);
    assert.deepEqual(events[0], { type: 'queued', position: 1, total: 1 });
  } finally {
    await stack.stop();
  }
});

test('AI belum dikonfigurasi: prompt ditolak 503 tanpa memotong kredit', async () => {
  const stack = await startStack({ AI_API_KEY: '' });
  try {
    const user = await stack.register();
    assert.equal((await user.credits()).enabled, false);
    const res = await user.startPrompt('halo');
    assert.deepEqual([res.status, res.body.error], [503, 'Fitur AI belum dikonfigurasi di server']);
    assert.equal((await user.credits()).remaining, 4);
  } finally {
    await stack.stop();
  }
});

// AI pribadi (tab Provider AI): endpoint kompatibel OpenAI milik pengguna dipakai AI editor tanpa memotong jatah/kredit.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

let stack;
before(async () => { stack = await startStack({ AI_AGENT_ENGINES: 'claude' }); });
after(() => stack?.stop());

const setup = (user, extra = {}) => user.put('/api/ai/provider', { baseUrl: stack.ai.url, apiKey: 'sk-pribadi-12345678', model: 'mock-pribadi', ...extra });

test('simpan, lihat (tanpa key), uji koneksi, dan validasi', async () => {
  const user = await stack.register();
  assert.deepEqual((await user.get('/api/ai/provider')).body, { configured: false, active: false, baseUrl: '', model: '', agentBaseUrl: '', keyHint: '', updatedAt: 0 });
  for (const [body, message] of [
    [{ baseUrl: 'ftp://x', model: 'm' }, /^Base URL harus alamat http\(s\) lengkap/],
    [{ model: 'm' }, /^Base URL wajib diisi/],
    [{ baseUrl: stack.ai.url }, /^Nama model wajib diisi/],
  ]) {
    const res = await user.put('/api/ai/provider', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, message);
  }

  const saved = await setup(user);
  assert.equal(saved.status, 200);
  assert.deepEqual({ ...saved.body, updatedAt: 0 }, { configured: true, active: true, baseUrl: stack.ai.url, model: 'mock-pribadi', agentBaseUrl: '', keyHint: 'sk-…5678', updatedAt: 0 });
  assert.ok(!JSON.stringify(saved.body).includes('sk-pribadi'), 'key tidak dikirim balik');

  const tested = await user.post('/api/ai/provider/test', {});
  assert.deepEqual(tested.body, { ok: true, models: ['mock-main', 'mock-pribadi'] });
  assert.equal(stack.ai.lastAuth, 'Bearer sk-pribadi-12345678');

  // Ubah model saja: key lama tetap.
  assert.equal((await user.put('/api/ai/provider', { model: 'mock-lain' })).body.keyHint, 'sk-…5678');
  assert.equal((await stack.client().get('/api/ai/provider')).status, 401);
});

test('aktif: prompt memakai endpoint & key pengguna, tidak memotong jatah; nonaktif: kembali ke AI platform', async () => {
  const user = await stack.register();
  await setup(user);
  const credits = await user.credits();
  assert.deepEqual([credits.personal, credits.freeRemaining, credits.agents], ['mock-pribadi', 4, undefined]);

  stack.ai.script.push({ text: 'Dari AI pribadi.' });
  const { started, final } = await user.prompt('halo');
  assert.equal(started.status, 201);
  assert.equal(final.message.content, 'Dari AI pribadi.');
  assert.equal(stack.ai.requests.at(-1).model, 'mock-pribadi');
  assert.equal(stack.ai.lastAuth, 'Bearer sk-pribadi-12345678');
  assert.equal(final.credits.freeRemaining, 4, 'jatah tidak terpakai');

  // Permintaan mode Agen dikerjakan Builder dengan AI pribadi.
  stack.ai.script.push({ text: 'Builder pribadi.' });
  const agent = await user.prompt('buat halaman', { mode: 'agent', engine: 'claude' });
  assert.equal(agent.final.message.content, 'Builder pribadi.');
  assert.equal(stack.ai.requests.at(-1).model, 'mock-pribadi');

  // Jatah habis pun tetap bisa memakai AI pribadi.
  stack.db().prepare("INSERT INTO ai_usage (user_id, period, used) VALUES (?, ?, 99) ON CONFLICT (user_id, period) DO UPDATE SET used = 99")
    .run(user.userId, `free:${new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)}`);
  assert.equal((await user.prompt('masih bisa')).final.type, 'done');

  await user.put('/api/ai/provider', { active: false });
  assert.equal((await user.credits()).personal, undefined);
  assert.equal((await user.startPrompt('jatah habis')).status, 402);

  assert.deepEqual((await user.del('/api/ai/provider')).body, { ok: true });
  assert.equal((await user.get('/api/ai/provider')).body.configured, false);
});

test('AI pribadi satu akun tidak berlaku untuk akun lain', async () => {
  const a = await stack.register();
  const b = await stack.register();
  await setup(a);
  stack.ai.script.push({ text: 'platform' });
  await b.prompt('halo');
  assert.equal(stack.ai.requests.at(-1).model, 'mock-main');
  assert.equal(stack.ai.lastAuth, 'Bearer test-key');
  assert.equal((await b.credits()).freeRemaining, 3);
});

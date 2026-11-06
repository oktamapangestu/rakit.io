// Provider AI tambahan dari dashboard owner: tambah/ubah/hapus, API key tidak pernah dikirim balik,
// model merujuk provider dengan "model@id", dan permintaan AI (editor & asisten website) dikirim ke
// provider milik modelnya. Fitur ini hanya ada di server Go.
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const skip = !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go';
const PROVIDERS = '/api/admin/ai-providers';
const MODELS = '/api/admin/ai-models';

// Provider kedua tiruan (kompatibel OpenAI): mencatat model & header Authorization tiap permintaan.
async function startProvider(key) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${key}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end('{"error":{"message":"kunci salah"}}');
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'model-b' }, { id: 'asisten-x' }] }));
      }
      const body = JSON.parse(raw || '{}');
      seen.push({ model: body.model, auth });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `dari provider kedua (${body.model})` }, finish_reason: 'stop' }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, seen, close: () => { server.closeAllConnections(); server.close(); } };
}

test('provider: hanya owner, divalidasi, API key tidak pernah dikirim balik', { skip }, async () => {
  const stack = await startStack();
  const second = await startProvider('sk-rahasia-1234');
  try {
    const admin = await stack.admin();
    const user = await stack.register();
    assert.equal((await user.get(PROVIDERS)).status, 403);
    assert.equal((await stack.client().get(PROVIDERS)).status, 401);

    const first = (await admin.get(PROVIDERS)).body;
    assert.equal(first.maxProviders, 20);
    assert.deepEqual(first.providers.map((p) => [p.id, p.builtin, p.hasKey, p.keyHint]), [['', true, true, '…-key']]);
    assert.deepEqual(first.providers[0].usedBy, ['Model utama: mock-main', 'Model gambar: mock-vision', 'Asisten DeepSeek V4.1 Flash: deepseek-v4.1-flash', 'Asisten DeepSeek V4 Pro: deepseek-v4-pro']);

    const good = { id: 'cadangan', name: 'Cadangan', baseUrl: `${second.url}/`, apiKey: 'sk-rahasia-1234' };
    for (const [providers, message] of [
      [[{ ...good, id: 'Ada Spasi' }], 'ID provider "ada spasi" tidak valid (huruf kecil, angka, -; maks. 30)'],
      [[good, { ...good, name: 'Lain' }], 'ID provider "cadangan" dipakai dua kali'],
      [[{ ...good, name: ' ' }], 'Nama provider "cadangan" wajib diisi'],
      [[{ ...good, baseUrl: 'ftp://x' }], 'Base URL Cadangan harus alamat http(s) lengkap, mis. https://api.openai.com/v1'],
      [[{ ...good, apiKey: 'ada spasi' }], 'API key Cadangan tidak valid'],
      [Array.from({ length: 21 }, (_, i) => ({ ...good, id: `p${i}` })), 'Provider maksimal 20'],
    ]) {
      const res = await admin.put(PROVIDERS, { providers });
      assert.deepEqual([res.status, res.body.error], [400, message]);
    }

    const saved = await admin.put(PROVIDERS, { providers: [good] });
    assert.equal(saved.status, 200);
    assert.ok(!JSON.stringify(saved.body).includes('sk-rahasia'), 'API key tidak dikirim balik');
    assert.deepEqual(saved.body.providers.map((p) => [p.id, p.name, p.baseUrl, p.keyHint]), [['', 'Bawaan (.env)', stack.ai.url, '…-key'], ['cadangan', 'Cadangan', second.url, '…1234']]);

    // Ubah nama tanpa mengisi API key: key lama tetap dipakai (tes koneksi berhasil).
    await admin.put(PROVIDERS, { providers: [{ ...good, name: 'Cadangan 2', apiKey: '' }] });
    const tested = await admin.post(`${PROVIDERS}/test`, { id: 'cadangan', baseUrl: second.url });
    assert.deepEqual(tested.body, { ok: true, models: ['asisten-x', 'model-b'] });
    const wrong = await admin.post(`${PROVIDERS}/test`, { baseUrl: second.url, apiKey: 'salah' });
    assert.equal(wrong.body.ok, false);
    assert.match(wrong.body.error, /^Provider menjawab 401 — API key salah/);

    // Model harus merujuk provider yang ada; provider yang dipakai tidak bisa dihapus.
    const unknown = await admin.put(MODELS, { model: 'x@tidak-ada' });
    assert.deepEqual([unknown.status, unknown.body.error], [400, 'Model utama: provider "tidak-ada" belum ada — tambahkan dulu di Provider AI']);
    assert.equal((await admin.put(MODELS, { model: 'mock-main', fallbacks: ['model-b@cadangan'] })).status, 200);
    const used = await admin.put(PROVIDERS, { providers: [] });
    assert.deepEqual([used.status, used.body.error], [400, 'Provider "cadangan" masih dipakai (Cadangan 1: model-b@cadangan). Ganti model itu dulu sebelum menghapusnya.']);
    assert.deepEqual((await admin.get(PROVIDERS)).body.providers[1].usedBy, ['Cadangan 1: model-b@cadangan']);

    await admin.put(MODELS, { model: 'mock-main', fallbacks: [] });
    assert.deepEqual((await admin.put(PROVIDERS, { providers: [] })).body.providers.map((p) => p.id), ['']);
  } finally {
    second.close();
    await stack.stop();
  }
});

test('model cadangan di provider lain: provider utama gangguan → dijawab provider kedua', { skip }, async () => {
  const stack = await startStack({ AI_DAILY_PROMPTS: '22' });
  const second = await startProvider('sk-kedua');
  try {
    const admin = await stack.admin();
    const user = await stack.register();
    await admin.put(PROVIDERS, { providers: [{ id: 'kedua', name: 'Kedua', baseUrl: second.url, apiKey: 'sk-kedua' }] });
    await admin.put(MODELS, { model: 'mock-main', fallbacks: ['model-b@kedua'], vision: 'mock-vision' });

    stack.ai.respond = () => ({ status: 503 });
    const res = await user.prompt('halo');
    assert.equal(res.final.message.content, 'dari provider kedua (model-b)');
    assert.deepEqual(second.seen, [{ model: 'model-b', auth: 'Bearer sk-kedua' }], 'ID model dikirim tanpa @provider, dengan key provider itu');
    assert.equal(stack.db().prepare('SELECT model FROM ai_requests WHERE user_id = ?').get(user.userId).model, 'model-b@kedua');
    const health = (await admin.get(MODELS)).body.health;
    assert.deepEqual(health.map((h) => [h.model, h.down]), [['mock-main', true], ['model-b@kedua', false], ['mock-vision', false]]);
  } finally {
    second.close();
    await stack.stop();
  }
});

test('asisten website memakai provider modelnya; AI aktif walau .env tanpa provider', { skip }, async () => {
  const stack = await startStack({ AI_API_KEY: '' });
  const second = await startProvider('sk-asisten');
  try {
    const admin = await stack.admin();
    const user = await stack.register();
    assert.equal((await user.credits()).enabled, false);

    await admin.put(PROVIDERS, { providers: [{ id: 'kedua', name: 'Kedua', baseUrl: second.url, apiKey: 'sk-asisten' }] });
    await admin.put(MODELS, { model: 'model-b@kedua' });
    assert.equal((await user.credits()).enabled, true);
    const res = await user.prompt('halo');
    assert.equal(res.final.message.content, 'dari provider kedua (model-b)');

    const models = [{ key: 'cepat', name: 'Cepat', tier: '', model: 'asisten-x@kedua', cost: 150, markup: 3, enabled: true }];
    const bad = await admin.put('/api/admin/assistant', { models: [{ ...models[0], model: 'asisten-x@hilang' }] });
    assert.deepEqual([bad.status, bad.body.error], [400, 'Model untuk "Cepat": provider "hilang" belum ada — tambahkan dulu di Provider AI']);
    assert.equal((await admin.put('/api/admin/assistant', { models })).status, 200);

    assert.equal((await user.put('/api/assistant', { enabled: true, modelKey: 'cepat' })).status, 200);
    const siteOrigin = `http://${user.username}.${stack.origin.slice(7)}`;
    const chat = await stack.site(user.username, '/api/ai/chat', { method: 'POST', json: { messages: [{ role: 'user', content: 'Halo' }] }, headers: { Origin: siteOrigin, 'X-Forwarded-For': '198.51.100.9' } });
    assert.equal(chat.status, 200, chat.body);
    assert.deepEqual(JSON.parse(chat.body), { reply: 'dari provider kedua (asisten-x)' });
    assert.deepEqual(second.seen.at(-1), { model: 'asisten-x', auth: 'Bearer sk-asisten' });
  } finally {
    second.close();
    await stack.stop();
  }
});

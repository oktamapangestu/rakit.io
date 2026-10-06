// Library AI di fungsi (ai.chat / ai.json / ai.embed): provider dipasang pemilik project dengan API key
// sendiri di tab Fungsi; key tidak pernah dikirim balik. Adaptor tiap provider diuji di go/internal/fnai.
// Fitur khusus Go.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const skip = !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('gambar')]);

let stack;
let mock; // provider AI tiruan: /v1/* (format OpenAI) dan /anthropic/* (format Anthropic)
const seen = [];
const replies = []; // teks jawaban chat berikutnya (antrean); kosong = "Halo dari mock"
before(async () => {
  if (skip) return;
  stack = await startStack({ FN_ALLOW_PRIVATE_FETCH: '1' });
  mock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      seen.push({ path: req.url, headers: req.headers, body });
      res.setHeader('Content-Type', 'application/json');
      const text = replies.shift() ?? 'Halo dari mock';
      if (req.url === '/v1/chat/completions') {
        res.end(JSON.stringify({ model: body.model, choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 4 } }));
      } else if (req.url === '/v1/embeddings') {
        res.end(JSON.stringify({ model: body.model, data: body.input.map((t, index) => ({ index, embedding: [t.length, 1] })), usage: { prompt_tokens: 3 } }));
      } else if (req.url === '/anthropic/messages') {
        res.end(JSON.stringify({ model: body.model, content: [{ type: 'text', text: `Claude: ${text}` }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2 } }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { message: 'tidak ada' } }));
      }
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
});
after(() => { mock?.close(); return stack?.stop(); });

const base = () => `http://127.0.0.1:${mock.address().port}`;
// Uji coba dari editor: pesan kesalahan fungsi ditampilkan lengkap (endpoint publik menyembunyikannya).
const run = async (user, name) => {
  const { body } = await user.post(`/api/functions/${name}/run`, { method: 'GET' });
  return { status: body.status, error: body.error, body: body.body };
};
const json = (res) => JSON.parse(res.body);
async function fn(user, name, code) {
  await user.post('/api/files', { path: `functions/${name}.js` });
  const res = await user.put('/api/files/content', { path: `functions/${name}.js`, content: code });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}
const overview = async (user) => (await user.get('/api/functions')).body;

test('provider AI: simpan, default, ganti, hapus; API key tidak pernah dikirim balik', { skip }, async () => {
  const user = await stack.register('ai-prov');
  const put = (body) => user.put('/api/functions/ai-providers', body);
  const cases = [
    [{ name: 'Bukan Nama!', kind: 'openai', apiKey: 'k', model: 'm' }, /Nama provider/],
    [{ name: 'x', kind: 'aneh', apiKey: 'k', model: 'm' }, /Jenis provider/],
    [{ name: 'x', kind: 'openai', apiKey: 'k' }, /Model wajib/],
    [{ name: 'x', kind: 'openai', model: 'm' }, /API key wajib/],
    [{ name: 'x', kind: 'compatible', apiKey: 'k', model: 'm' }, /Base URL wajib/],
    [{ name: 'x', kind: 'compatible', apiKey: 'k', model: 'm', baseUrl: 'ftp://a' }, /Base URL harus/],
    [{ name: 'x', kind: 'compatible', apiKey: 'k', model: 'm', baseUrl: 'http://toko.localhost/v1' }, /rakit\.io/],
  ];
  for (const [body, message] of cases) {
    const res = await put(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, message);
  }

  assert.equal((await put({ name: 'Lokal', kind: 'compatible', baseUrl: `${base()}/v1/`, apiKey: 'sk-rahasia-1234', model: 'mock-1' })).status, 200);
  assert.equal((await put({ name: 'claude', kind: 'anthropic', baseUrl: `${base()}/anthropic`, apiKey: 'ak-rahasia-9876', model: 'claude-mock' })).status, 200);
  let list = (await overview(user)).aiProviders;
  assert.deepEqual(list.map((p) => [p.name, p.default, p.keyHint, p.baseUrl]),
    [['lokal', true, '…1234', `${base()}/v1`], ['claude', false, '…9876', `${base()}/anthropic`]]);
  const raw = JSON.stringify(await overview(user));
  assert.ok(!raw.includes('rahasia'), 'API key tidak ada di jawaban');
  assert.deepEqual(Object.keys((await overview(user)).aiKinds).sort(), ['anthropic', 'compatible', 'gemini', 'openai']);

  // Ubah tanpa API key: key lama tetap dipakai; jadikan default.
  assert.equal((await put({ name: 'claude', kind: 'anthropic', baseUrl: `${base()}/anthropic`, model: 'claude-2', default: true })).status, 200);
  list = (await overview(user)).aiProviders;
  assert.deepEqual(list.map((p) => [p.name, p.default, p.model]), [['claude', true, 'claude-2'], ['lokal', false, 'mock-1']]);
  const tested = await user.post('/api/functions/ai-providers/claude/test');
  assert.deepEqual([tested.body.ok, tested.body.text], [true, 'Claude: Halo dari mock']);
  assert.equal(seen.at(-1).headers['x-api-key'], 'ak-rahasia-9876');

  // Hapus default: provider lain menjadi default. Project orang lain tidak melihat apa pun.
  assert.equal((await user.del('/api/functions/ai-providers/claude')).status, 200);
  assert.equal((await user.del('/api/functions/ai-providers/claude')).status, 404);
  assert.deepEqual((await overview(user)).aiProviders.map((p) => [p.name, p.default]), [['lokal', true]]);
  const other = await stack.register('ai-prov-lain');
  assert.deepEqual((await overview(other)).aiProviders, []);
});

test('ai.chat, ai.json, ai.embed di fungsi; gambar project; batas & pemakaian', { skip }, async () => {
  const user = await stack.register('ai-fn');
  await fn(user, 'tanpa', `export default async (req, { ai }) => ai.chat('halo')`);
  let res = await run(user, 'tanpa');
  assert.equal(res.status, 500);
  assert.match(res.error, /Belum ada provider AI/);

  await user.put('/api/functions/ai-providers', { name: 'lokal', kind: 'compatible', baseUrl: `${base()}/v1`, apiKey: 'sk-proj-1', model: 'mock-1', embedModel: 'emb-1' });
  await user.put('/api/functions/ai-providers', { name: 'claude', kind: 'anthropic', baseUrl: `${base()}/anthropic`, apiKey: 'ak-2', model: 'claude-mock' });
  await user.raw('POST', '/api/files/upload?path=images/bukti.png', { rawBody: PNG, headers: { 'Content-Type': 'image/png' } });

  await fn(user, 'chat', `export default async function (req, { ai }) {
    const a = await ai.chat('Halo AI');
    const b = await ai.chat({ provider: 'claude', system: 'Kamu CS.', messages: [{ role: 'user', content: 'Ada kue?' }], temperature: 0.3, maxTokens: 50 });
    const c = await ai.chat('Ini gambar apa?', { images: ['/images/bukti.png'], model: 'vision-1' });
    return { a, b: b.text, c: c.text, providers: await ai.providers() };
  }`);
  res = await run(user, 'chat');
  assert.equal(res.status, 200, res.error);
  const out = json(res);
  assert.deepEqual(out.a, { text: 'Halo dari mock', model: 'mock-1', provider: 'lokal', finish: 'stop', usage: { input: 10, output: 4 } });
  assert.equal(out.b, 'Claude: Halo dari mock');
  assert.deepEqual(out.providers.map((p) => p.name), ['lokal', 'claude']);

  const [first, second, third] = seen.slice(-3);
  assert.equal(first.headers.authorization, 'Bearer sk-proj-1');
  assert.deepEqual(first.body.messages, [{ role: 'user', content: 'Halo AI' }]);
  assert.deepEqual([second.path, second.body.system, second.body.temperature, second.body.max_tokens], ['/anthropic/messages', 'Kamu CS.', 0.3, 50]);
  const parts = third.body.messages[0].content;
  assert.equal(third.body.model, 'vision-1');
  assert.deepEqual(parts[0], { type: 'text', text: 'Ini gambar apa?' });
  assert.match(parts[1].image_url.url, /^data:image\/png;base64,/);

  // ai.json: bentuk diminta di instruksi sistem; jawaban bukan JSON diminta ulang sekali.
  replies.push('Maaf, ini datanya: nama Budi', '```json\n{"nama":"Budi","hp":"0812"}\n```');
  await fn(user, 'ekstrak', `export default async (req, { ai }) => ai.json('Ambil data dari: Budi 0812', { nama: 'string', hp: 'string' })`);
  res = await run(user, 'ekstrak');
  assert.deepEqual(json(res), { nama: 'Budi', hp: '0812' });
  assert.match(seen.at(-2).body.messages[0].content, /"nama":"string"/);
  assert.match(seen.at(-1).body.messages.at(-1).content, /not valid JSON/);

  // ai.embed: satu teks -> vektor, array -> array vektor; similarity dihitung di fungsi.
  await fn(user, 'cari', `export default async (req, { ai }) => {
    const one = await ai.embed('abc');
    const many = await ai.embed(['a', 'abcd']);
    return { one, many, sama: ai.similarity([1, 0], [2, 0]), beda: ai.similarity([1, 0], [0, 1]) };
  }`);
  res = await run(user, 'cari');
  assert.deepEqual(json(res), { one: [3, 1], many: [[1, 1], [4, 1]], sama: 1, beda: 0 });
  assert.equal(seen.at(-1).body.model, 'emb-1');

  // Kesalahan yang jelas bagi pemilik fungsi.
  const errors = {
    'tak-ada': `ai.chat('x', { provider: 'gemini' })`,
    'role': `ai.chat({ messages: [{ role: 'robot', content: 'x' }] })`,
    'gambar': `ai.chat('x', { images: ['/images/tidak-ada.png'] })`,
    'embed-claude': `ai.embed('x', { provider: 'claude' })`,
    'banyak': `Promise.all([1,2,3,4,5,6].map(() => ai.chat('x')))`,
  };
  const expected = {
    'tak-ada': /Provider AI "gemini" tidak ada. Yang tersedia: lokal, claude/,
    'role': /role harus "user" atau "assistant"/,
    'gambar': /gambar \/images\/tidak-ada.png tidak ada di project/,
    'embed-claude': /Anthropic tidak menyediakan embedding/,
    'banyak': /maksimal 5 panggilan per eksekusi/,
  };
  for (const [name, expr] of Object.entries(errors)) {
    await fn(user, name, `export default async (req, { ai }) => ${expr}`);
    const r = await run(user, name);
    assert.equal(r.status, 500, name);
    assert.match(r.error, expected[name], name);
  }

  const lokal = (await overview(user)).aiProviders.find((p) => p.name === 'lokal');
  assert.ok(lokal.today.calls >= 6, JSON.stringify(lokal.today));
  assert.ok(lokal.today.inputTokens >= 40);
});

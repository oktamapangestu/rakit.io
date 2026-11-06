// Mode Agen tanpa Docker (aplikasi desktop, AI_AGENT_LOCAL): driver dijalankan Node langsung di folder kerja, layanan
// host di 127.0.0.1. Driver diganti agen tiruan (helpers/fake-agent.mjs). Juga: AI pribadi dengan base URL format
// Anthropic menjalankan mode Agen dengan key pengguna, tanpa jatah/kredit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const GO = /go\/bin\/rakit/.test(process.env.RAKIT_SERVER_CMD ?? '');
let stack;
let runtime;
before(async () => {
  if (!GO) return;
  // Runtime lokal tiruan: claude_driver.mjs memuat agen tiruan.
  runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'rakit-runtime-'));
  const fake = fileURLToPath(new URL('./helpers/fake-agent.mjs', import.meta.url));
  fs.writeFileSync(path.join(runtime, 'claude_driver.mjs'), `
if (process.cwd() !== process.env.RAKIT_WORKSPACE) throw new Error('cwd bukan folder kerja');
if (!process.env.ANTHROPIC_BASE_URL.startsWith('http://127.0.0.1:')) throw new Error('ANTHROPIC_BASE_URL');
if (!process.env.HOME.startsWith(process.env.RAKIT_RUN)) throw new Error('HOME harus terpisah');
await import(${JSON.stringify(fake)});
`);
  stack = await startStack({ AI_DAILY_PROMPTS: '20', AI_AGENT_ENGINES: 'claude', AI_AGENT_LOCAL: runtime, AI_AGENT_NODE: process.execPath });
});
after(() => {
  stack?.stop();
  if (runtime) fs.rmSync(runtime, { recursive: true, force: true });
});

const rootOf = (user) => path.join(stack.dataDir, 'sites', user.username);

test('runtime lokal: mesin aktif dan mengerjakan prompt tanpa Docker', { skip: !GO }, async () => {
  const user = await stack.register();
  assert.deepEqual((await user.credits()).agents.map((a) => a.id), ['claude']);
  const { started, final } = await user.prompt('Buat buku tamu', { mode: 'agent', engine: 'claude' });
  assert.equal(started.status, 201);
  assert.equal(final.type, 'done', JSON.stringify(final));
  assert.match(final.message.content, /Buku tamu sudah dibuat\./);
  assert.match(fs.readFileSync(path.join(rootOf(user), 'index.html'), 'utf8'), /x-data="tamu"/);
  assert.equal(stack.ai.requests.at(-1).model, 'mock-main', 'tanpa AI pribadi: AI platform');
  assert.equal(final.credits.freeRemaining, 19);
});

test('AI pribadi + base URL Anthropic: mode Agen memakai key & model pengguna, tanpa jatah', { skip: !GO }, async () => {
  const user = await stack.register();
  const saved = await user.put('/api/ai/provider', { baseUrl: stack.ai.url, agentBaseUrl: `${stack.ai.url}/v1`, apiKey: 'sk-agen-12345678', model: 'mock-pribadi' });
  assert.equal(saved.body.agentBaseUrl, `${stack.ai.url}/v1`);
  const credits = await user.credits();
  assert.deepEqual([credits.personal, credits.agents.map((a) => a.id)], ['mock-pribadi', ['claude']]);

  const { final } = await user.prompt('Buat buku tamu', { mode: 'agent', engine: 'claude' });
  assert.equal(final.type, 'done', JSON.stringify(final));
  assert.equal(final.message.mode, 'agent');
  assert.equal(stack.ai.requests.at(-1).model, 'mock-pribadi');
  assert.equal(stack.ai.lastAuth, 'Bearer sk-agen-12345678');
  assert.equal(final.credits.freeRemaining, 20, 'jatah tidak terpakai');

  // Tanpa base URL Anthropic: mode Agen disembunyikan, permintaan Agen dikerjakan Builder.
  await user.put('/api/ai/provider', { agentBaseUrl: '' });
  assert.equal((await user.credits()).agents, undefined);
  stack.ai.script.push({ text: 'Builder pribadi.' });
  const builder = await user.prompt('halo', { mode: 'agent', engine: 'claude' });
  assert.equal(builder.final.message.mode, 'build');
  assert.equal((await user.put('/api/ai/provider', { agentBaseUrl: 'bukan-url' })).status, 400);
});

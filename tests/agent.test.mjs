// Mode Agen (go/internal/ai/agent.go): mesin agen mengerjakan prompt di sandbox, hasilnya lewat jalur Builder
// (Simpan/Batalkan, kredit, statistik). Container Docker diganti mesin tiruan (helpers/fake-agent.mjs) lewat
// AI_AGENT_CMD, dengan layanan host yang sama (unix socket): website salinan kerja, proxy AI, create_table.
// Hanya server Go yang punya mode Agen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const GO = /go\/bin\/rakit/.test(process.env.RAKIT_SERVER_CMD ?? '');
const FAKE = `node ${fileURLToPath(new URL('./helpers/fake-agent.mjs', import.meta.url))}`;

let stack;
before(async () => {
  if (!GO) return;
  stack = await startStack({ AI_BONUS_CREDITS: '20', AI_DAILY_CREDITS: '0', AI_AGENT_ENGINES: 'claude,pi', AI_AGENT_CMD: FAKE });
});
after(() => stack?.stop());

const rootOf = (user) => path.join(stack.dataDir, 'sites', user.username);
const read = (user, rel) => fs.readFileSync(path.join(rootOf(user), rel), 'utf8');
const exists = (user, rel) => fs.existsSync(path.join(rootOf(user), rel));
const agent = (user, prompt, engine = 'claude') => user.prompt(prompt, { mode: 'agent', engine });

test('mode Agen: mesin aktif ditampilkan di info kredit; mesin tidak aktif ditolak', { skip: !GO }, async () => {
  const user = await stack.register();
  const credits = await user.credits();
  assert.deepEqual(credits.agents.map((a) => a.id), ['claude', 'pi']);
  const res = await user.startPrompt('halo', { mode: 'agent', engine: 'openhands' });
  assert.equal(res.status, 400);
  assert.equal((await user.credits()).remaining, credits.remaining, 'kredit tidak dipotong');
});

test('mode Agen: perubahan & tabel diterapkan dengan snapshot, Batalkan mengembalikan semuanya', { skip: !GO }, async () => {
  const user = await stack.register();
  const original = read(user, 'index.html');
  const { started, final } = await agent(user, 'Buat buku tamu');
  assert.equal(started.status, 201);
  assert.equal(started.body.assistantMessage.mode, 'agent');
  assert.equal(started.body.userMessage.engine, 'claude');
  assert.equal(final.type, 'done', JSON.stringify(final));
  const m = final.message;
  assert.equal(m.engine, 'claude');
  assert.equal(m.applyState, 'pending');
  assert.match(m.content, /Buku tamu sudah dibuat\./);
  assert.match(m.content, /catatan\.md/, 'file non-website disebut, tidak disimpan');
  assert.deepEqual(m.changes.map((c) => c.action === 'table' ? `tabel ${c.name}` : `${c.action} ${c.path}`), ['tabel tamu', 'write app.js', 'write index.html']);
  assert.equal(final.credits.remaining, 19, '1 kredit, sama dengan Builder');

  // Diterapkan ke project; AGENTS.md & file lain milik agen tidak ikut.
  assert.match(read(user, 'index.html'), /x-data="tamu"/);
  assert.match(read(user, 'app.js'), /\/api\/db\/tamu/);
  assert.ok(!exists(user, 'AGENTS.md') && !exists(user, 'catatan.md'));
  const tables = (await user.get('/api/database/tables')).body.tables;
  assert.deepEqual(tables.map((t) => [t.name, t.columns.map((c) => `${c.name}:${c.type}`).join(','), t.rules.create]), [['tamu', 'nama:text,pesan:text,foto:image', 'public']]);

  // Proxy AI: model dipaksa ke model owner, kunci dari server.
  const req = stack.ai.requests.at(-1);
  assert.equal(req.model, 'mock-main');
  assert.deepEqual(req.stream_options, { include_usage: true });

  // Statistik owner.
  const row = stack.db().prepare("SELECT action, detail, input_tokens, checks FROM ai_requests WHERE user_id = ? ORDER BY id DESC").get(user.userId);
  assert.equal(row.action, 'agent');
  assert.match(row.detail, /^\[claude\] Buat buku tamu/);
  assert.equal(row.input_tokens, 100, 'token dari proxy');

  const res = await user.post(`/api/ai/messages/${m.id}/revert`);
  assert.equal(res.status, 200);
  assert.equal(read(user, 'index.html'), original);
  assert.ok(!exists(user, 'app.js'));
  assert.deepEqual((await user.get('/api/database/tables')).body.tables, [], 'tabel yang dibuat agen ikut dihapus');
});

test('mode Agen: form yang tidak menyimpan dikembalikan pemeriksaan server, agen memperbaikinya', { skip: !GO }, async () => {
  const user = await stack.register();
  const { final } = await agent(user, 'Buat buku tamu [form-rusak]');
  assert.equal(final.type, 'done', JSON.stringify(final));
  assert.match(final.message.content, /Form sekarang menyimpan ke database\./);
  assert.match(read(user, 'app.js'), /\/api\/db\/tamu/);
  const checks = JSON.parse(stack.db().prepare("SELECT checks FROM ai_requests WHERE user_id = ? ORDER BY id DESC").get(user.userId).checks);
  assert.deepEqual(checks.found, { form: 1 });
  assert.equal(checks.left, undefined);
});

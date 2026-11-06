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
  stack = await startStack({ AI_DAILY_PROMPTS: '20', AI_AGENT_ENGINES: 'claude,pi', AI_AGENT_CMD: FAKE });
});
after(() => stack?.stop());

const rootOf = (user) => path.join(stack.dataDir, 'sites', user.username);
const read = (user, rel) => fs.readFileSync(path.join(rootOf(user), rel), 'utf8');
const exists = (user, rel) => fs.existsSync(path.join(rootOf(user), rel));
const agent = (user, prompt, engine = 'claude') => user.prompt(prompt, { mode: 'agent', engine });

test('mode Agen: mesin aktif ditampilkan di info kredit; mesin tidak dikenal diabaikan & ditolak', { skip: !GO }, async () => {
  const user = await stack.register();
  const credits = await user.credits();
  assert.deepEqual(credits.agents.map((a) => a.id), ['claude'], 'pi (sudah dihapus) tidak dikenal, jadi tidak aktif');
  const res = await user.startPrompt('halo', { mode: 'agent', engine: 'pi' });
  assert.equal(res.status, 400);
  assert.equal((await user.credits()).freeRemaining, credits.freeRemaining, 'kredit tidak dipotong');
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
  assert.equal(final.credits.freeRemaining, 19, '1 kredit, sama dengan Builder');

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

// Baca event job satu per satu (stream tetap terbuka selama job berjalan).
async function* jobStream(user, jobId) {
  const res = await user.raw('GET', `/api/ai/jobs/${jobId}/events`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
  }
}

async function untilQuestion(events) {
  for (;;) {
    const { value, done } = await events.next();
    assert.ok(!done, 'job selesai tanpa bertanya');
    assert.notEqual(value.type, 'error', JSON.stringify(value));
    if (value.type === 'question') return value;
  }
}

test('mode Agen: agen bertanya lewat ask_user, jawaban pengguna diteruskan ke agen', { skip: !GO }, async () => {
  const user = await stack.register();
  const started = await user.startPrompt('Ganti judul halaman [tanya]', { mode: 'agent', engine: 'claude' });
  assert.equal(started.status, 201);
  const jobId = started.body.assistantMessage.id;
  const events = jobStream(user, jobId);
  const q = await untilQuestion(events);
  assert.equal(q.question, 'Judulnya mau apa?');
  assert.deepEqual(q.options, [{ label: 'Halo Dunia', description: 'Sapaan singkat' }, { label: 'Selamat Datang' }]);

  // Hanya pemilik job, untuk pertanyaan yang sedang menunggu, dengan jawaban berisi.
  const other = await stack.register();
  assert.equal((await other.post(`/api/ai/jobs/${jobId}/answer`, { question: q.id, answer: 'Halo Dunia' })).status, 409);
  assert.equal((await user.post(`/api/ai/jobs/${jobId}/answer`, { question: q.id + 1, answer: 'Halo Dunia' })).status, 409);
  assert.equal((await user.post(`/api/ai/jobs/${jobId}/answer`, { question: q.id, answer: '  ' })).status, 400);
  assert.equal((await user.post(`/api/ai/jobs/${jobId}/answer`, { question: q.id, answer: 'Halo Dunia' })).status, 200);
  assert.equal((await user.post(`/api/ai/jobs/${jobId}/answer`, { question: q.id, answer: 'Halo Dunia' })).status, 409, 'sudah dijawab');

  const rest = [];
  for await (const ev of events) rest.push(ev);
  assert.deepEqual(rest.find((e) => e.type === 'answered'), { type: 'answered', id: q.id, answer: 'Halo Dunia', timeout: false });
  const final = rest.at(-1);
  assert.equal(final.type, 'done', JSON.stringify(final));
  assert.match(final.message.content, /Judul diganti jadi "Halo Dunia"/);
  assert.match(final.message.content, /400: options harus berisi 2 sampai 4 pilihan/, 'argumen salah ditolak ke agen');
  assert.match(read(user, 'index.html'), /<h1>Halo Dunia<\/h1>/);
  assert.equal(final.credits.freeRemaining, 19, 'tetap 1 kredit');

  // Saat menyambung ulang, pertanyaan & jawabannya ikut terkirim ulang (editor tidak membuka dialog lagi).
  const replay = await user.jobEvents(jobId);
  assert.ok(replay.some((e) => e.type === 'question') && replay.some((e) => e.type === 'answered'));
});

test('mode Agen: Stop saat agen menunggu jawaban menghentikan job', { skip: !GO }, async () => {
  const user = await stack.register();
  const started = await user.startPrompt('Ganti judul halaman [tanya]', { mode: 'agent', engine: 'claude' });
  const jobId = started.body.assistantMessage.id;
  const events = jobStream(user, jobId);
  const q = await untilQuestion(events);
  assert.equal((await user.post(`/api/ai/jobs/${jobId}/cancel`)).status, 200);
  const rest = [];
  for await (const ev of events) rest.push(ev);
  assert.equal(rest.at(-1).type, 'error', JSON.stringify(rest.at(-1)));
  assert.equal((await user.post(`/api/ai/jobs/${jobId}/answer`, { question: q.id, answer: 'Halo Dunia' })).status, 409);
  assert.equal((await user.credits()).freeRemaining, 20, 'kredit dikembalikan');
});

test('mode Agen: Catatan Project ikut di AGENTS.md', { skip: !GO }, async () => {
  const user = await stack.register();
  assert.equal((await agent(user, '[catatan] cek')).final.message.content, 'tanpa catatan');
  assert.equal((await user.put('/api/docs/notes', { notes: '- Warna utama hijau' })).status, 200);
  assert.equal((await agent(user, '[catatan] cek lagi')).final.message.content, 'Catatan: - Warna utama hijau');
});

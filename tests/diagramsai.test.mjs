// Diagram buatan AI (/api/diagrams/saved, /api/diagrams/generate): disimpan per jenis, memakai kredit seperti
// prompt (dikembalikan bila gagal), dan perbaikan kode yang gagal digambar gratis maks. 2 kali. Fitur khusus Go.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const skip = !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go';

let stack;
before(async () => { if (!skip) stack = await startStack({ AI_BONUS_CREDITS: '10', AI_DAILY_CREDITS: '0' }); });
after(() => stack?.stop());

const ERD = '```mermaid\nerDiagram\n  tamu {\n    number id PK\n    text nama\n  }\n```\n- [warn] Siapa pun bisa menghapus data tamu.\n- [info] 1 tabel.\nTeks lain diabaikan.';
const generate = (user, body) => user.post('/api/diagrams/generate', body);

test('membuat, menyimpan, dan memperbarui diagram', { skip }, async () => {
  const user = await stack.register('diagramku');
  assert.equal((await stack.client().get('/api/diagrams/saved')).status, 401);
  assert.deepEqual((await user.get('/api/diagrams/saved')).body, { diagrams: {} });

  stack.ai.script.push({ text: ERD });
  const before = Date.now();
  const res = await generate(user, { kind: 'erd' });
  assert.equal(res.status, 200);
  assert.equal(res.body.diagram.code, 'erDiagram\n  tamu {\n    number id PK\n    text nama\n  }');
  assert.deepEqual(res.body.diagram.notes, [{ level: 'warn', text: 'Siapa pun bisa menghapus data tamu.' }, { level: 'info', text: '1 tabel.' }]);
  assert.equal(res.body.diagram.canFix, true);
  assert.ok(res.body.diagram.updatedAt >= before);
  assert.equal(res.body.credits.remaining, 9);

  // AI menerima isi project, analisis otomatis, dan jenis diagram yang diminta.
  const sent = stack.ai.requests.at(-1);
  assert.equal(sent.messages[0].role, 'system');
  assert.match(sent.messages[1].content, /<file path="index.html">/);
  assert.match(sent.messages[1].content, /Automatic analysis[\s\S]*"pages"/);
  assert.match(sent.messages[1].content, /Draw an ERD/);

  const saved = (await user.get('/api/diagrams/saved')).body.diagrams;
  assert.deepEqual(Object.keys(saved), ['erd']);
  assert.deepEqual(saved.erd, res.body.diagram);

  // Update: diganti seluruhnya, waktunya ikut berubah.
  stack.ai.script.push({ text: '```mermaid\nerDiagram\n  buku {\n    number id PK\n  }\n```' });
  const again = await generate(user, { kind: 'erd' });
  assert.equal(again.status, 200);
  assert.match(again.body.diagram.code, /buku/);
  assert.deepEqual(again.body.diagram.notes, []);
  assert.ok(again.body.diagram.updatedAt >= res.body.diagram.updatedAt);
  assert.equal(again.body.credits.remaining, 8);
});

test('jawaban yang tidak bisa dipakai: kredit dikembalikan, diagram lama tetap', { skip }, async () => {
  const user = await stack.register('gagal');
  assert.equal((await generate(user, { kind: 'pie' })).status, 400);

  stack.ai.script.push({ text: 'NONE: Belum ada tabel. Buat tabel dulu.' });
  const none = await generate(user, { kind: 'erd' });
  assert.equal(none.status, 422);
  assert.match(none.body.error, /Belum ada yang bisa digambar: Belum ada tabel/);

  stack.ai.script.push({ text: '```mermaid\nflowchart LR\n  A --> B\n```' }); // bukan erDiagram
  assert.equal((await generate(user, { kind: 'erd' })).status, 422);
  stack.ai.script.push({ text: 'Maaf, saya tidak bisa.' });
  assert.equal((await generate(user, { kind: 'site' })).status, 422);

  assert.equal((await user.credits()).remaining, 10);
  assert.deepEqual((await user.get('/api/diagrams/saved')).body, { diagrams: {} });
});

test('perbaikan kode yang gagal digambar: gratis, maks. 2 kali sampai di-Update', { skip }, async () => {
  const user = await stack.register('perbaiki');
  assert.equal((await generate(user, { kind: 'site', renderError: 'Parse error' })).status, 404);

  stack.ai.script.push({ text: '```mermaid\nflowchart LR\n  A[rusak\n```' });
  assert.equal((await generate(user, { kind: 'site' })).status, 200);

  for (const n of [1, 2]) {
    stack.ai.script.push({ text: `\`\`\`mermaid\nflowchart LR\n  A["Beranda ${n}"]\n\`\`\`` });
    const fixed = await generate(user, { kind: 'site', renderError: 'Parse error on line 2' });
    assert.equal(fixed.status, 200);
    assert.equal(fixed.body.diagram.code, `flowchart LR\n  A["Beranda ${n}"]`);
    assert.equal(fixed.body.diagram.canFix, n < 2);
    assert.equal(fixed.body.credits.remaining, 9, 'perbaikan tidak memakai kredit');
    const sent = stack.ai.requests.at(-1).messages;
    assert.equal(sent.at(-2).role, 'assistant');
    assert.match(sent.at(-1).content, /Parse error on line 2/);
  }
  assert.equal((await generate(user, { kind: 'site', renderError: 'Parse error' })).status, 429);

  stack.ai.script.push({ text: '```mermaid\nflowchart LR\n  A["Baru"]\n```' });
  const updated = await generate(user, { kind: 'site' });
  assert.equal(updated.body.diagram.canFix, true, 'Update memberi jatah perbaikan lagi');
});

test('format salah dicoba ulang sekali tanpa kredit tambahan; catatan bernomor tetap terbaca', { skip }, async () => {
  const user = await stack.register('ulang');
  const before = (await user.credits()).remaining;
  stack.ai.script.push(
    { text: '┌──────┐\n│ produk │\n└──────┘' },
    { text: '```mermaid\nflowchart LR\n  A["Beranda"] --> B["Pesan"]\n```\n\n**Catatan:**\n1. **Beranda** menautkan ke halaman Pesan.\n2. [warn] Halaman Tentang tidak ditautkan.' },
  );
  const res = await generate(user, { kind: 'site' });
  assert.equal(res.status, 200);
  assert.equal(res.body.diagram.code, 'flowchart LR\n  A["Beranda"] --> B["Pesan"]');
  assert.deepEqual(res.body.diagram.notes, [
    { level: 'info', text: 'Beranda menautkan ke halaman Pesan.' },
    { level: 'warn', text: 'Halaman Tentang tidak ditautkan.' },
  ]);
  assert.equal(res.body.credits.remaining, before - 1, 'satu kredit untuk dua panggilan');
  const retry = stack.ai.requests.at(-1).messages;
  assert.equal(retry.at(-2).role, 'assistant');
  assert.match(retry.at(-1).content, /first line is flowchart/);
});

test('stream: proses AI (berpikir & kode Mermaid) dikirim selama diagram dibuat', { skip }, async () => {
  const user = await stack.register('diagramlive');
  const stream = async (body) => {
    const res = await user.raw('POST', '/api/diagrams/generate', { body: { ...body, stream: true } });
    const text = await res.text();
    return { status: res.status, type: res.headers.get('content-type'), events: res.headers.get('content-type')?.includes('ndjson') ? text.split('\n').filter(Boolean).map((l) => JSON.parse(l)) : JSON.parse(text) };
  };

  stack.ai.script.push({ reasoning: 'Ada satu tabel tamu.', chunks: ERD.match(/[\s\S]{1,40}/g) });
  const ok = await stream({ kind: 'erd' });
  assert.equal(ok.status, 200);
  assert.match(ok.type, /ndjson/);
  const { events } = ok;
  assert.equal(events.find((e) => e.type === 'reasoning').text, 'Ada satu tabel tamu.');
  assert.deepEqual(events.filter((e) => e.type === 'step'), [
    { type: 'step', id: 1, tool: 'diagram', target: 'erd', state: 'run' },
    { type: 'step', id: 1, state: 'ok' },
  ]);
  assert.equal(events.filter((e) => e.type === 'draft').map((e) => e.text).join(''), ERD);
  const done = events.at(-1);
  assert.equal(done.type, 'done');
  assert.match(done.diagram.code, /^erDiagram/);
  assert.equal(typeof done.credits.remaining, 'number');

  // Gagal setelah AI menjawab: event error dengan status & pesan; ditolak sebelum mulai: error HTTP biasa.
  stack.ai.script.push({ text: 'NONE: Belum ada tabel.' });
  const none = await stream({ kind: 'erd' });
  assert.equal(none.status, 200);
  assert.deepEqual([none.events.at(-1).type, none.events.at(-1).status], ['error', 422]);
  assert.match(none.events.at(-1).error, /Belum ada yang bisa digambar/);
  const bad = await stream({ kind: 'pie' });
  assert.equal(bad.status, 400);
});

test('edit diagram: kode disimpan tanpa kredit; ubah dengan AI memakai kode di editor sebagai dasar', { skip }, async () => {
  const user = await stack.register('diagramedit');
  const save = (kind, code) => user.put(`/api/diagrams/saved/${kind}`, { code });

  // Simpan manual: catatan AI tetap, kredit tidak terpakai; jenis & baris pertama diperiksa.
  stack.ai.script.push({ text: ERD });
  assert.equal((await generate(user, { kind: 'erd' })).status, 200);
  const credits = (await user.credits()).remaining;
  const edited = 'erDiagram\n  tamu {\n    number id PK\n    text nama_lengkap\n  }';
  const res = await save('erd', `  ${edited}\n`);
  assert.equal(res.status, 200);
  assert.equal(res.body.diagram.code, edited);
  assert.equal(res.body.diagram.notes.length, 2);
  assert.equal((await user.get('/api/diagrams/saved')).body.diagrams.erd.code, edited);
  assert.equal((await user.credits()).remaining, credits);
  assert.equal((await save('erd', 'flowchart LR\n  A --> B')).status, 400, 'jenis lain ditolak');
  assert.equal((await save('pie', edited)).status, 400);
  assert.equal((await save('erd', 'erDiagram\n' + 'x'.repeat(70_000))).status, 400);
  // Jenis yang belum pernah dibuat AI juga bisa ditulis sendiri.
  assert.equal((await save('state', 'stateDiagram-v2\n  [*] --> Baru')).status, 200);

  // Ubah dengan AI: kode dari editor (belum disimpan) + permintaan dikirim ke AI; hasilnya disimpan.
  const draft = edited.replace('nama_lengkap', 'nama');
  stack.ai.script.push({ text: '```mermaid\nerDiagram\n  tamu {\n    number id PK\n    text nama\n  }\n  bayar {\n    number id PK\n  }\n  tamu ||--o{ bayar : "membayar"\n```\n- [info] Ditambah tabel bayar.' });
  const changed = await generate(user, { kind: 'erd', instruction: 'tambahkan tabel bayar', code: draft });
  assert.equal(changed.status, 200);
  assert.match(changed.body.diagram.code, /bayar/);
  assert.deepEqual(changed.body.diagram.notes, [{ level: 'info', text: 'Ditambah tabel bayar.' }]);
  assert.equal(changed.body.credits.remaining, credits - 1);
  const sent = stack.ai.requests.at(-1).messages;
  assert.equal(sent.at(-2).content, '```mermaid\n' + draft + '\n```');
  assert.match(sent.at(-1).content, /tambahkan tabel bayar/);

  // Tanpa kode dari editor: memakai yang tersimpan. Kode dasar berjenis salah dan dua mode sekaligus ditolak.
  stack.ai.script.push({ text: ERD });
  assert.equal((await generate(user, { kind: 'erd', instruction: 'rapikan' })).status, 200);
  assert.match(stack.ai.requests.at(-1).messages.at(-2).content, /bayar/);
  assert.equal((await generate(user, { kind: 'erd', instruction: 'x', code: 'graph TD\n A' })).status, 400);
  assert.equal((await generate(user, { kind: 'erd', instruction: 'x', renderError: 'Parse error' })).status, 400);
  assert.equal((await generate(user, { kind: 'usecase', instruction: 'x' })).status, 404, 'belum ada diagram untuk diubah');
});

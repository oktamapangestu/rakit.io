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

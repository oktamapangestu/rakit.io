// AI editor: mode Builder (tool calling, terapkan/simpan/batalkan), mode Plan, riwayat percakapan,
// job yang tetap berjalan di server, lampiran gambar, dan penanganan jawaban bermasalah.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startStack, TINY_PNG } from './helpers/harness.mjs';

let stack;
before(async () => { stack = await startStack({ AI_BONUS_CREDITS: '50', AI_DAILY_CREDITS: '0' }); });
after(() => stack?.stop());

let callId = 0;
const call = (name, args) => ({ index: 0, id: `call_${++callId}`, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const calls = (...list) => ({ toolCalls: list.map((c, index) => ({ ...c, index })) });
const rootOf = (user) => path.join(stack.dataDir, 'sites', user.username);
const read = (user, rel) => fs.readFileSync(path.join(rootOf(user), rel), 'utf8');
const exists = (user, rel) => fs.existsSync(path.join(rootOf(user), rel));
/** Pesan yang dikirim server ke provider pada request ke-n dari belakang. */
const sent = (n = 1) => stack.ai.requests.at(-n);
const toolResults = (request) => request.messages.filter((m) => m.role === 'tool').map((m) => m.content);

test('Builder: menulis, menghapus file dan membuat tabel; hasilnya menunggu konfirmasi', async () => {
  const user = await stack.register();
  const original = read(user, 'index.html');
  stack.ai.script.push(
    calls(
      call('write_file', { path: 'index.html', content: '<h1>Baru</h1>' }),
      call('write_file', { path: 'halaman/tentang.html', content: '<p>Tentang</p>' }),
      call('delete_file', { path: 'script.js' }),
      call('create_table', { name: 'Ucapan', columns: [{ name: 'nama', type: 'text', required: true }, { name: 'email', type: 'text', private: true }], public: ['list', 'create', 'list'] }),
    ),
    { text: 'Halaman sudah diperbarui.' },
  );
  const { started, final } = await user.build('rombak halaman');
  assert.equal(started.status, 201);
  assert.deepEqual([started.body.userMessage.role, started.body.userMessage.content, started.body.userMessage.status], ['user', 'rombak halaman', 'sent']);
  assert.deepEqual([started.body.assistantMessage.role, started.body.assistantMessage.status, started.body.assistantMessage.mode], ['assistant', 'queued', 'build']);
  assert.equal(typeof started.body.threadId, 'number');

  assert.equal(final.type, 'done');
  const m = final.message;
  assert.deepEqual([m.status, m.content, m.applyState, m.error], ['done', 'Halaman sudah diperbarui.', 'pending', null]);
  assert.deepEqual(m.changes, [
    { path: 'index.html', action: 'write', content: '<h1>Baru</h1>' },
    { path: 'halaman/tentang.html', action: 'write', content: '<p>Tentang</p>' },
    { path: 'script.js', action: 'delete' },
    { action: 'table', name: 'ucapan', columns: [{ name: 'nama', type: 'text', required: true, private: false }, { name: 'email', type: 'text', required: false, private: true }], public: ['list', 'create'] },
  ]);
  assert.deepEqual(Object.keys(m.before).sort(), ['halaman/tentang.html', 'index.html', 'script.js']);
  assert.equal(m.before['index.html'], original);
  assert.equal(m.before['halaman/tentang.html'], null, 'file baru');
  assert.ok(m.before['script.js'].length > 0);
  assert.deepEqual(final.touched, ['index.html', 'halaman/tentang.html', 'script.js']);
  assert.equal(final.credits.remaining, 49);

  // Perubahan langsung diterapkan di server.
  assert.equal(read(user, 'index.html'), '<h1>Baru</h1>');
  assert.equal(read(user, 'halaman/tentang.html'), '<p>Tentang</p>');
  assert.ok(!exists(user, 'script.js'));
  const table = (await user.get('/api/database/tables')).body.tables[0];
  assert.deepEqual([table.name, table.rules.list, table.rules.create, table.rules.view], ['ucapan', 'public', 'public', 'owner']);

  // Request pertama membawa tool, konteks file, dan prompt sistem Builder.
  const first = sent(2);
  assert.deepEqual(first.tools.map((t) => t.function.name), ['write_file', 'delete_file', 'create_table']);
  assert.equal(first.model, 'mock-main');
  assert.equal(first.stream, true);
  assert.equal(first.messages[0].role, 'system');
  assert.match(first.messages[0].content, /You are in BUILDER mode/);
  assert.match(first.messages[0].content, /https:\/\/<project>\.localhost/);
  const prompt = first.messages.at(-1).content;
  assert.match(prompt, /^Project files:\n- /);
  assert.ok(prompt.includes(`<file path="index.html">\n${original}\n</file>`));
  assert.ok(prompt.includes('Database tables:\n(no tables yet)'));
  assert.ok(prompt.endsWith('---\n\nRequest:\nrombak halaman'));
  // Request kedua membawa hasil tiap tool.
  assert.deepEqual(toolResults(sent(1)), [
    'OK: "index.html" ditulis (13 karakter).',
    'OK: "halaman/tentang.html" ditulis (14 karakter).',
    'OK: "script.js" akan dihapus.',
    `OK: tabel "ucapan" akan dibuat/diperbarui. Pakai dari JavaScript situs dengan fetch('/api/db/ucapan').`,
  ]);

  // Simpan: hanya sekali.
  const kept = await user.post(`/api/ai/messages/${m.id}/keep`);
  assert.deepEqual([kept.status, kept.body.message.applyState], [200, 'kept']);
  const again = await user.post(`/api/ai/messages/${m.id}/keep`);
  assert.deepEqual([again.status, again.body.error], [409, 'Perubahan ini sudah dikonfirmasi sebelumnya']);
  assert.equal((await user.post(`/api/ai/messages/${m.id}/revert`)).status, 409);
});

test('Builder: Batalkan mengembalikan file, folder, dan tabel seperti semula', async () => {
  const user = await stack.register();
  await user.post('/api/database/tables', { name: 'lama', columns: [{ name: 'isi', type: 'text' }], rules: { list: 'public' } });
  const original = { index: read(user, 'index.html'), script: read(user, 'script.js') };
  stack.ai.script.push(
    calls(
      call('write_file', { path: 'index.html', content: 'diubah AI' }),
      call('write_file', { path: 'baru/dalam/x.css', content: 'a{}' }),
      call('delete_file', { path: 'script.js' }),
      call('create_table', { name: 'produk', columns: [{ name: 'nama', type: 'text' }], public: [] }),
      call('create_table', { name: 'pesanan', columns: [{ name: 'produk_id', type: 'reference', refTable: 'produk' }], public: ['create'] }),
      call('create_table', { name: 'lama', columns: [{ name: 'isi', type: 'text' }, { name: 'tambahan', type: 'number' }], public: ['list', 'create'] }),
    ),
    { text: 'Selesai.' },
  );
  const { final } = await user.build('ubah banyak hal');
  assert.equal(final.message.applyState, 'pending');
  let tables = (await user.get('/api/database/tables')).body.tables;
  assert.deepEqual(tables.map((t) => [t.name, t.columns.map((c) => c.name).join(',')]), [['lama', 'isi,tambahan'], ['pesanan', 'produk_id'], ['produk', 'nama']]);
  assert.equal(tables[0].rules.create, 'public');

  const other = await stack.register();
  assert.equal((await other.post(`/api/ai/messages/${final.message.id}/revert`)).status, 404);
  const res = await user.post(`/api/ai/messages/${final.message.id}/revert`);
  assert.equal(res.status, 200);
  assert.equal(res.body.message.applyState, 'reverted');
  assert.deepEqual(res.body.touched, ['index.html', 'baru/dalam/x.css', 'script.js']);
  assert.equal(read(user, 'index.html'), original.index);
  assert.equal(read(user, 'script.js'), original.script);
  assert.ok(!exists(user, 'baru'), 'folder baru yang kini kosong ikut dihapus');
  tables = (await user.get('/api/database/tables')).body.tables;
  assert.deepEqual(tables.map((t) => [t.name, t.columns.map((c) => c.name).join(','), t.rules.create]), [['lama', 'isi', 'owner']]);
  assert.equal((await user.post(`/api/ai/messages/${final.message.id}/revert`)).status, 409);
});

test('Builder: panggilan tool yang salah dijawab dengan pesan kesalahan, bukan diterapkan', async () => {
  const user = await stack.register();
  stack.ai.script.push(
    calls(
      call('write_file', { path: 'catatan.txt', content: 'x' }),
      call('write_file', { path: '../luar.html', content: 'x' }),
      call('write_file', { path: 'a.html' }),
      call('write_file', { path: 'besar.js', content: 'x'.repeat(512 * 1024 + 1) }),
      call('write_file', '{"path": "rusak.html", "content": '),
      call('hapus_semua', {}),
      call('create_table', { name: '9salah', columns: [], public: [] }),
      call('create_table', { name: 't', columns: 'bukan array', public: [] }),
      call('create_table', { name: 't', columns: [{ name: 'id', type: 'number' }], public: [] }),
      call('create_table', { name: 't', columns: [{ name: 'a', type: 'json' }], public: [] }),
      call('create_table', { name: 't', columns: [{ name: 'p', type: 'reference' }], public: [] }),
      call('create_table', { name: 't', columns: [], public: ['baca'] }),
      call('write_file', { path: 'ok.html', content: 'v1' }),
      call('write_file', { path: 'ok.html', content: 'v2' }),
    ),
    { text: 'Hanya ok.html yang berhasil.' },
  );
  const { final } = await user.build('uji kesalahan');
  assert.equal(final.type, 'done');
  assert.deepEqual(final.message.changes, [{ path: 'ok.html', action: 'write', content: 'v2' }], 'file yang ditulis dua kali: versi terakhir');
  assert.deepEqual(toolResults(sent(1)), [
    'Error: "catatan.txt": hanya file .html, .css, dan .js yang diizinkan.',
    'Error: Nama ".." tidak valid. Gunakan huruf, angka, titik, - atau _',
    'Error: content harus berupa teks.',
    'Error: "besar.js" melebihi 512 KB.',
    'Error: argumen bukan JSON yang valid. Panggil tool ini lagi dengan JSON yang benar.',
    'Error: tool "hapus_semua" tidak dikenal.',
    'Error: Nama tabel "9salah" tidak valid: pakai huruf kecil, angka, dan _, diawali huruf (awalan sqlite_ dan _rakit dicadangkan).',
    'Error: columns harus berupa array.',
    'Error: Kolom "id" sudah otomatis, jangan ditulis.',
    'Error: Tipe kolom "json" tidak dikenal. Pilih: text, number, boolean, date, reference, image.',
    'Error: Kolom relasi "p" harus menyertakan refTable (nama tabel yang ditunjuk).',
    'Error: Operasi tidak dikenal: baca. Pilih dari: list, view, create, update, delete.',
    'OK: "ok.html" ditulis (2 karakter).',
    'OK: "ok.html" ditulis (2 karakter).',
  ]);
  // Argumen yang rusak dikirim balik ke provider sebagai "{}" supaya riwayatnya tetap sah.
  const echoed = sent(1).messages.find((msg) => msg.role === 'assistant' && msg.tool_calls).tool_calls;
  assert.equal(echoed[4].function.arguments, '{}');
  assert.equal(read(user, 'ok.html'), 'v2');
});

test('Builder: alamat API database yang salah diminta diperbaiki sebelum selesai', async () => {
  const user = await stack.register();
  stack.ai.script.push(
    calls(
      call('create_table', { name: 'ucapan', columns: [{ name: 'pesan', type: 'text' }], public: ['list'] }),
      call('write_file', { path: 'app.js', content: "fetch('/api/ucapan'); fetch('/api/db/komentar')" }),
    ),
    { text: 'Sudah.' },
    calls(call('write_file', { path: 'app.js', content: "fetch('/api/db/ucapan')" })),
    { text: 'Sudah diperbaiki.' },
  );
  const { final } = await user.build('buat buku tamu');
  assert.equal(final.message.content, 'Sudah diperbaiki.');
  assert.equal(read(user, 'app.js'), "fetch('/api/db/ucapan')");
  assert.equal(toolResults(sent(3))[1], 'Ditulis, TAPI ada masalah di "app.js": alamat "/api/ucapan" salah, seharusnya "/api/db/ucapan"; tabel "komentar" belum ada, panggil create_table untuk membuatnya. Perbaiki lalu panggil write_file lagi.');
  const nudge = sent(2).messages.at(-1);
  assert.equal(nudge.role, 'user');
  assert.equal(nudge.content, 'Sebelum selesai, perbaiki masalah ini dengan tool, lalu tulis ringkasan lagi:\n- app.js: alamat "/api/ucapan" salah, seharusnya "/api/db/ucapan"\n- app.js: tabel "komentar" belum ada, panggil create_table untuk membuatnya');
});

test('Builder: perubahan yang gagal diterapkan dikembalikan utuh dan dilaporkan', async () => {
  const user = await stack.register();
  const original = read(user, 'index.html');
  stack.ai.script.push(
    calls(
      call('write_file', { path: 'index.html', content: 'tidak boleh tersisa' }),
      call('create_table', { name: 'baru', columns: [{ name: 'x', type: 'reference', refTable: 'tidak_ada' }], public: [] }),
    ),
    { text: 'Selesai.' },
  );
  const { final } = await user.build('akan gagal diterapkan');
  assert.equal(final.type, 'done');
  assert.deepEqual([final.message.status, final.message.applyState], ['done', 'failed']);
  assert.equal(final.message.error, 'Gagal menerapkan perubahan: Kolom "x" menunjuk ke tabel "tidak_ada" yang tidak ada. File dikembalikan seperti semula.');
  assert.deepEqual(final.touched, []);
  assert.equal(read(user, 'index.html'), original);
  assert.deepEqual((await user.get('/api/database/tables')).body.tables, []);
  assert.equal((await user.post(`/api/ai/messages/${final.message.id}/keep`)).status, 409);
});

test('Builder tanpa perubahan: jawaban biasa; jawaban kosong dianggap gagal', async () => {
  const user = await stack.register();
  stack.ai.script.push({ text: 'Itu sudah benar, tidak perlu diubah.' });
  const { final } = await user.build('apakah ini sudah benar?');
  assert.deepEqual([final.message.content, final.message.changes, final.message.applyState], ['Itu sudah benar, tidak perlu diubah.', [], null]);

  // Perubahan tanpa ringkasan tetap berhasil dengan pesan bawaan.
  stack.ai.script.push(calls(call('write_file', { path: 'x.html', content: 'x' })), { text: '' });
  assert.equal((await user.build('tanpa ringkasan')).final.message.content, 'Perubahan sudah dibuat.');

  stack.ai.script.push({ text: '  ' });
  const empty = await user.build('kosong');
  assert.deepEqual([empty.final.type, empty.final.error], ['error', 'AI tidak memberi jawaban. Coba lagi.']);
  assert.equal(empty.final.credits.remaining, 48);
});

test('Plan: hanya teks, tanpa tool, blok kode dibuang', async () => {
  const user = await stack.register();
  stack.ai.script.push({ text: 'abaikan <message>## Rencana\n\n- Buat halaman\n\n\n\n<file path="a.html">kode</file>\n<db-table name="x"></db-table>Selesai</message> ekor' });
  const { final } = await user.prompt('rencanakan toko');
  assert.equal(final.message.content, '## Rencana\n\n- Buat halaman\n\nSelesai');
  assert.deepEqual([final.message.mode, final.message.changes, final.message.applyState], ['plan', [], null]);
  assert.equal(sent().tools, undefined);
  assert.match(sent().messages[0].content, /You are in PLAN mode/);
  assert.equal(sent().max_tokens, 64000);
  assert.deepEqual(sent().stream_options, { include_usage: true });

  stack.ai.script.push({ text: 'Rencana yang panjang', finish: 'length' });
  assert.equal((await user.prompt('panjang')).final.message.content, 'Rencana yang panjang\n\n_(Jawaban terpotong karena terlalu panjang.)_');
});

test('jawaban terpotong terus-menerus dan jawaban yang ditolak provider → gagal dengan kredit kembali', async () => {
  const user = await stack.register();
  for (let i = 0; i < 3; i++) stack.ai.script.push({ ...calls(call('write_file', '{"path": "a.html", "content": "terpo')), finish: 'length' });
  const cut = await user.build('file raksasa');
  assert.deepEqual([cut.final.type, cut.final.error], ['error', 'Jawaban AI terus terpotong karena terlalu panjang. Coba pecah permintaan jadi lebih kecil.']);
  assert.match(toolResults(sent(1))[0], /^Error: panggilan ini terpotong karena jawabanmu melebihi batas panjang/);

  stack.ai.script.push({ text: '', finish: 'content_filter' });
  const refused = await user.prompt('ditolak');
  assert.deepEqual([refused.final.type, refused.final.error], ['error', 'Permintaan ini tidak bisa diproses oleh AI.']);

  stack.ai.script.push({ chunks: ['seten'], cut: true });
  const broken = await user.prompt('putus di tengah');
  assert.deepEqual([broken.final.type, broken.final.error], ['error', 'Terjadi kesalahan saat menghubungi AI. Kredit dikembalikan.']);

  assert.equal((await user.credits()).remaining, 50);
  const log = stack.db().prepare('SELECT status FROM ai_requests WHERE user_id = ? ORDER BY id').all(user.userId).map((r) => r.status);
  assert.deepEqual(log, ['max_tokens', 'refusal', 'error']);
});

test('percakapan: prompt lanjutan membawa riwayat; daftar & isi percakapan; hapus riwayat', async () => {
  const user = await stack.register();
  stack.ai.script.push(calls(call('write_file', { path: 'index.html', content: 'v1' })), { text: 'Judul diganti.' });
  const first = await user.build('  ganti   judul\n halaman  ');
  const threadId = first.started.body.threadId;

  stack.ai.script.push({ text: 'Rencana lanjutan.' });
  const second = await user.prompt('lanjutkan', { threadId });
  assert.equal(second.started.body.threadId, threadId);
  assert.equal(second.final.message.threadId, threadId);
  // Prompt baru = perubahan sebelumnya yang belum dikonfirmasi dianggap disimpan.
  assert.equal(stack.db().prepare('SELECT apply_state FROM ai_messages WHERE id = ?').get(first.final.message.id).apply_state, 'kept');
  const history = sent().messages;
  assert.deepEqual(history.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(history[1].content, 'ganti   judul\n halaman');
  assert.equal(history[2].content, 'Judul diganti.\n\n(Perubahan: tulis index.html)');
  assert.ok(history[3].content.endsWith('Request:\nlanjutkan'));

  // Percakapan lain di project yang sama.
  stack.ai.script.push({ text: 'Halo.' });
  const other = await user.prompt('percakapan baru');
  assert.notEqual(other.started.body.threadId, threadId);
  assert.deepEqual(sent().messages.map((m) => m.role), ['system', 'user'], 'tanpa riwayat percakapan lain');
  // threadId milik orang lain / tidak ada: percakapan baru.
  const stranger = await stack.register();
  stack.ai.script.push({ text: 'Hai.' });
  assert.notEqual((await stranger.prompt('numpang', { threadId })).started.body.threadId, threadId);

  const list = (await user.get('/api/ai/threads')).body;
  assert.equal(list.activeJob, null);
  assert.deepEqual(list.threads.map((t) => t.title), ['percakapan baru', 'ganti judul halaman']);
  assert.deepEqual(Object.keys(list.threads[0]).sort(), ['createdAt', 'id', 'title', 'updatedAt']);

  const detail = await user.get(`/api/ai/threads/${threadId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.thread.id, threadId);
  assert.deepEqual(detail.body.messages.map((m) => [m.role, m.mode, m.status]), [['user', 'build', 'sent'], ['assistant', 'build', 'done'], ['user', 'plan', 'sent'], ['assistant', 'plan', 'done']]);
  assert.deepEqual(Object.keys(detail.body.messages[1]).sort(), ['applyState', 'before', 'changes', 'content', 'createdAt', 'error', 'id', 'images', 'mode', 'role', 'status', 'threadId']);
  assert.equal(detail.body.messages[1].applyState, 'kept');
  assert.equal((await stranger.get(`/api/ai/threads/${threadId}`)).status, 404);
  assert.equal((await user.get('/api/ai/threads/abc')).status, 404);

  const del = await user.del('/api/ai/threads');
  assert.deepEqual([del.status, del.body], [200, { deleted: 2 }]);
  assert.deepEqual((await user.get('/api/ai/threads')).body.threads, []);
  assert.equal((await stranger.get('/api/ai/threads')).body.threads.length, 1);
});

test('job: progres bisa diikuti ulang kapan saja, juga setelah selesai', async () => {
  const user = await stack.register();
  stack.ai.script.push({ reasoning: 'berpikir...', chunks: ['a'.repeat(500), 'b'.repeat(500)] });
  const started = await user.startPrompt('jawaban panjang');
  const id = started.body.assistantMessage.id;
  const events = await user.jobEvents(id);
  const types = events.map((e) => e.type);
  assert.deepEqual(types.filter((t) => t !== 'progress'), ['running', 'thinking', 'done']);
  assert.ok(types.includes('progress'));
  assert.equal(events.filter((e) => e.type === 'progress').at(-1).chars, 1000);
  assert.equal(events.at(-1).message.content.length, 1000);

  // Sambung ulang setelah selesai: event diputar ulang dan langsung ditutup.
  // Event progres hanya disimpan yang terbaru.
  const replay = await user.jobEvents(id);
  assert.deepEqual(replay.map((e) => e.type), ['running', 'thinking', 'progress', 'done']);
  assert.equal(replay[2].chars, 1000);

  const other = await stack.register();
  assert.equal((await other.raw('GET', `/api/ai/jobs/${id}/events`)).status, 404);
  assert.equal((await user.raw('GET', '/api/ai/jobs/999999/events')).status, 404);
  assert.equal((await user.raw('GET', `/api/ai/jobs/${started.body.userMessage.id}/events`)).status, 404, 'pesan user bukan job');
  assert.equal((await user.post('/api/ai/jobs/999999/cancel')).status, 404);
  assert.equal((await user.post(`/api/ai/jobs/${id}/cancel`)).status, 200, 'membatalkan job yang sudah selesai tidak berpengaruh');
  assert.equal((await user.get(`/api/ai/threads/${started.body.threadId}`)).body.messages[1].status, 'done');
});

test('riwayat panjang: tiap pesan lama dipotong 8000 karakter, total 40000, yang terbaru didahulukan', async () => {
  const user = await stack.register();
  let threadId;
  for (const letter of 'abcdef') {
    stack.ai.script.push({ text: `jawab ${letter}` });
    const res = await user.prompt(letter.repeat(20_000), threadId ? { threadId } : {});
    assert.equal(res.final.type, 'done');
    threadId = res.started.body.threadId;
  }
  stack.ai.script.push({ text: 'selesai' });
  await user.prompt('terakhir', { threadId });
  const history = sent().messages.slice(1, -1); // tanpa system & prompt baru
  assert.ok(history.every((m) => m.content.length <= 8000));
  assert.ok(history.reduce((n, m) => n + m.content.length, 0) <= 40_000);
  assert.deepEqual(history.at(-1), { role: 'assistant', content: 'jawab f' });
  assert.equal(history.at(-2).content, 'f'.repeat(8000));
  assert.equal(history[0].role, 'user');
  assert.ok(!history.some((m) => m.content.startsWith('a')), 'pesan paling lama dibuang');
});

test('job berjalan terlihat sebagai activeJob dan mengunci hapus riwayat', async () => {
  const user = await stack.register();
  stack.ai.script.push({ hang: true });
  const called = stack.ai.nextRequest();
  const started = await user.startPrompt('lama');
  await called;
  const id = started.body.assistantMessage.id;
  const active = (await user.get('/api/ai/threads')).body.activeJob;
  assert.deepEqual(active, { id, threadId: started.body.threadId, projectSlug: user.username });
  assert.equal((await user.get(`/api/ai/threads/${started.body.threadId}`)).body.messages[1].status, 'running');
  const del = await user.del('/api/ai/threads');
  assert.deepEqual([del.status, del.body.error], [409, 'Tunggu AI selesai (atau tekan Stop) sebelum menghapus riwayat.']);
  await user.post(`/api/ai/jobs/${id}/cancel`);
  const final = await user.finishJob(id);
  assert.deepEqual([final.error, final.message.status, final.message.error], ['Dihentikan. Kredit dikembalikan.', 'aborted', 'Dihentikan. Kredit dikembalikan.']);
  assert.equal(stack.db().prepare('SELECT status FROM ai_requests WHERE user_id = ?').get(user.userId).status, 'aborted');
});

test('lampiran gambar: dideskripsikan model vision, disimpan di riwayat, ikut di prompt lanjutan', async () => {
  const user = await stack.register();
  stack.ai.script.push({ text: '  Image 1: sketsa halaman toko.  ' }, { text: 'Rencana dari sketsa.' });
  const { started, final } = await user.prompt('ikuti sketsa ini', { images: [TINY_PNG], thumbs: [TINY_PNG] });
  assert.deepEqual(started.body.userMessage.images, [TINY_PNG]);
  assert.equal(final.type, 'done');

  const vision = sent(2);
  assert.equal(vision.model, 'mock-vision');
  assert.equal(vision.tools, undefined);
  assert.match(vision.messages[0].content, /^You look at images a user attached/);
  assert.deepEqual(vision.messages[1].content, [{ type: 'text', text: "The user's request: ikuti sketsa ini" }, { type: 'image_url', image_url: { url: TINY_PNG } }]);
  const note = '[Gambar yang dilampirkan pengguna — deskripsi dari AI penglihatan]\nImage 1: sketsa halaman toko.';
  assert.ok(sent(1).messages.at(-1).content.endsWith(`Request:\nikuti sketsa ini\n\n${note}`));
  const events = await user.jobEvents(started.body.assistantMessage.id);
  assert.equal(events[0].type, 'vision');

  const threadId = started.body.threadId;
  assert.deepEqual((await user.get(`/api/ai/threads/${threadId}`)).body.messages[0].images, [TINY_PNG]);
  stack.ai.script.push({ text: 'Lanjut.' });
  await user.prompt('lanjut', { threadId });
  assert.equal(sent().messages[1].content, `ikuti sketsa ini\n\n${note}`);

  stack.ai.script.push({ text: ' ' });
  const blind = await user.prompt('gambar tak terbaca', { images: [TINY_PNG], thumbs: [TINY_PNG] });
  assert.equal(blind.final.error, 'AI gagal membaca gambar. Coba lagi. Kredit dikembalikan.');
  assert.equal(blind.final.credits.remaining, 47);

  const tooMany = await user.startPrompt('kebanyakan', { images: [TINY_PNG, TINY_PNG, TINY_PNG, TINY_PNG] });
  assert.deepEqual([tooMany.status, tooMany.body.error], [400, 'Maksimal 3 gambar per prompt']);
  assert.equal((await user.startPrompt('format', { images: 'bukan-array' })).body.error, 'Format gambar tidak valid');
  assert.equal((await user.startPrompt('format', { images: ['data:image/gif;base64,AAAA'] })).body.error, 'Gambar harus berformat JPG, PNG, atau WEBP');
  assert.equal((await user.startPrompt('palsu', { images: ['data:image/png;base64,AAAAAAAAAAAAAAAA'] })).body.error, 'File yang dilampirkan bukan gambar yang valid');
});

test('provider sibuk (503): dicoba ulang lalu berhasil', async () => {
  const user = await stack.register();
  stack.ai.script.push({ status: 503, retryAfter: 1 }, { text: 'Akhirnya.' });
  const started = await user.startPrompt('sibuk dulu');
  const events = await user.jobEvents(started.body.assistantMessage.id);
  assert.deepEqual(events.map((e) => e.type), ['running', 'retry', 'running', 'done']);
  assert.deepEqual(events[1], { type: 'retry', attempt: 1, max: 3, seconds: 1 });
  assert.equal(events.at(-1).message.content, 'Akhirnya.');
});

test('server dimulai ulang saat AI bekerja: job ditandai gagal dan kredit dikembalikan', async () => {
  const user = await stack.register();
  stack.ai.script.push({ hang: true });
  const called = stack.ai.nextRequest();
  const started = await user.startPrompt('terputus');
  await called;
  assert.equal((await user.credits()).remaining, 49);
  await stack.restart();

  const final = await user.finishJob(started.body.assistantMessage.id);
  assert.equal(final.type, 'error');
  assert.equal(final.error, 'Server dimulai ulang saat AI sedang bekerja. Kredit dikembalikan, silakan kirim ulang.');
  assert.equal(final.message.status, 'error');
  assert.equal(final.credits.remaining, 50);
  assert.equal((await user.get('/api/ai/threads')).body.activeJob, null);
  // Setelah itu bisa langsung mengirim prompt lagi.
  stack.ai.script.push({ text: 'Jalan lagi.' });
  assert.equal((await user.prompt('ulang')).final.message.content, 'Jalan lagi.');
});

// AI editor: mode Builder (tool calling, terapkan/simpan/batalkan), mode Plan, riwayat percakapan,
// job yang tetap berjalan di server, lampiran gambar, dan penanganan jawaban bermasalah.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startStack, TINY_PNG } from './helpers/harness.mjs';

const GO = /go\/bin\/rakit/.test(process.env.RAKIT_SERVER_CMD ?? '');
let stack;
before(async () => { stack = await startStack({ AI_DAILY_PROMPTS: '50' }); });
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
  assert.equal(final.credits.freeRemaining, 49);

  // Perubahan langsung diterapkan di server.
  assert.equal(read(user, 'index.html'), '<h1>Baru</h1>');
  assert.equal(read(user, 'halaman/tentang.html'), '<p>Tentang</p>');
  assert.ok(!exists(user, 'script.js'));
  const table = (await user.get('/api/database/tables')).body.tables[0];
  assert.deepEqual([table.name, table.rules.list, table.rules.create, table.rules.view], ['ucapan', 'public', 'public', 'owner']);

  // Request pertama membawa tool, konteks file, dan prompt sistem Builder.
  const first = sent(2);
  const names = first.tools.map((t) => t.function.name);
  assert.deepEqual(names.slice(0, 5), ['write_file', 'edit_file', 'read_file', 'delete_file', 'create_table']);
  // Server Go: tool uji (go/internal/ai/lab.go); check_page hanya bila ada Chromium.
  assert.deepEqual(names.slice(5).filter((n) => n !== 'check_page'), GO ? ['test_api', 'search_files'] : []);
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

test('Builder: langkah AI & isi file yang sedang ditulis dikirim sebagai event', async () => {
  const user = await stack.register();
  stack.ai.script.push(
    { reasoning: 'Perlu halaman menu.', ...calls(
      call('write_file', { path: 'menu.html', content: '<a href="#">Menu</a>\n<p>Kopi "susu"</p>' }),
      call('create_table', { name: 'produk', columns: [{ name: 'nama', type: 'text' }] }),
    ) },
    calls(call('write_file', { path: 'menu.html', content: '<p>Menu</p>' })),
    { text: 'Selesai.' },
  );
  const started = await user.startPrompt('buat menu', { mode: 'build' });
  const events = await user.jobEvents(started.body.assistantMessage.id);
  const steps = events.filter((e) => e.type === 'step');
  assert.deepEqual(steps, [
    { type: 'step', id: 1, tool: 'write_file', target: 'menu.html', state: 'run' },
    { type: 'step', id: 2, tool: 'create_table', target: 'produk', state: 'run' },
    { type: 'step', id: 1, state: 'warn', note: '1 tautan <a href="#"> tidak menuju apa pun — hapus atau arahkan ke seksi nyata' },
    { type: 'step', id: 2, state: 'ok', note: '' },
    { type: 'step', id: 3, tool: 'write_file', target: 'menu.html', state: 'run' },
    { type: 'step', id: 3, state: 'ok', note: '' },
  ]);
  const draft = (id) => events.filter((e) => e.type === 'draft' && e.id === id).map((e) => e.text).join('');
  assert.equal(draft(1), '<a href="#">Menu</a>\n<p>Kopi "susu"</p>');
  assert.equal(draft(3), '<p>Menu</p>');
  assert.deepEqual(events.filter((e) => e.type === 'round').length, 2);
  assert.equal(events.find((e) => e.type === 'reasoning').text, 'Perlu halaman menu.');
  assert.equal(events.at(-1).type, 'done');
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

const goOnly = !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go';

test('Builder: edit_file, read_file, cek sintaks & rujukan file, catatan gambar, statistik pemeriksaan', { skip: goOnly }, async () => {
  const user = await stack.register();
  stack.ai.script.push(
    calls(
      call('edit_file', { path: 'index.html', edits: [
        { old_text: '<link rel="stylesheet" href="style.css">', new_text: '<link rel="stylesheet" href="style.css">\n  <script defer src="/js/tambahan.js"></script>' },
        { old_text: '<h1>Halo, dunia! 👋</h1>', new_text: '<h1>Toko Kue</h1>\n    <img src="/images/kue.jpg" alt="Kue">' },
      ] }),
      call('write_file', { path: 'app.js', content: 'const harga = ;' }),
    ),
    calls(call('read_file', { path: 'index.html' }), call('write_file', { path: 'app.js', content: 'const harga = 1;' })),
    { text: 'Selesai.' },
    calls(call('write_file', { path: 'js/tambahan.js', content: 'console.log(1);' })),
    { text: 'Selesai, sudah lengkap.' },
  );
  const { final } = await user.build('ganti judul jadi Toko Kue');
  assert.equal(final.type, 'done');

  const [edit, syntax] = toolResults(sent(4));
  assert.match(edit, /^OK: "index\.html" diubah/);
  assert.match(syntax, /^Ditulis, TAPI ada masalah di "app\.js": baris 1: SyntaxError/);
  // read_file mengembalikan isi yang sudah diubah edit_file di job yang sama.
  const [readBack] = toolResults(sent(3)).slice(2);
  assert.match(readBack, /^Isi terbaru "index\.html":\n[\s\S]*<h1>Toko Kue<\/h1>/);
  // Putaran lanjut tidak membawa isi file lagi; model diarahkan ke read_file.
  assert.match(sent(3).messages[1].content, /Call read_file/);
  assert.equal(sent(2).messages.at(-1).content, 'Sebelum selesai, perbaiki masalah ini dengan tool, lalu tulis ringkasan lagi:\n'
    + '- index.html: <script src="/js/tambahan.js"> menunjuk file "js/tambahan.js" yang tidak ada di project');

  assert.equal(final.message.content, 'Selesai, sudah lengkap.\n\n_Gambar yang dipakai tapi belum ada di project — unggah dengan nama ini: `/images/kue.jpg`._');
  const page = read(user, 'index.html');
  assert.ok(page.includes('<h1>Toko Kue</h1>') && page.includes('x-data="penghitung"'), 'bagian lain index.html tetap utuh');
  assert.equal(read(user, 'js/tambahan.js'), 'console.log(1);');

  const row = stack.db().prepare("SELECT checks FROM ai_requests WHERE user_id = ? AND action = 'build'").get(user.userId);
  assert.deepEqual(JSON.parse(row.checks), { found: { js: 1, ref: 1 }, rounds: 5, tools: { edit_file: 1, read_file: 1, write_file: 3 } });
});

test('Builder: masalah yang sama tidak dikembalikan berulang-ulang', { skip: goOnly }, async () => {
  const user = await stack.register();
  const before = stack.ai.requests.length;
  stack.ai.script.push(
    calls(call('write_file', { path: 'a.html', content: '<script src="/tidak-ada.js"></script>' })),
    { text: 'Selesai.' },
    { text: 'Sengaja, file itu akan dibuat nanti.' },
  );
  const { final } = await user.build('buat a.html');
  assert.equal(final.message.content, 'Sengaja, file itu akan dibuat nanti.');
  assert.equal(stack.ai.requests.length - before, 3);
  const row = stack.db().prepare("SELECT checks FROM ai_requests WHERE user_id = ? AND action = 'build'").get(user.userId);
  assert.deepEqual(JSON.parse(row.checks), { found: { ref: 1 }, left: { ref: 1 }, rounds: 3, tools: { write_file: 1 } });
});

test('Builder: ringkasan yang menyebut perubahan tanpa memanggil tool diminta dikerjakan', { skip: goOnly }, async () => {
  const user = await stack.register();
  stack.ai.script.push(
    { text: 'Tombol pesan sudah diperbaiki.\n\n(Perubahan: tulis js/core.js, tulis functions/pesanan-buat.js)' },
    calls(call('write_file', { path: 'js/core.js', content: 'console.log(1);' })),
    { text: 'Tombol pesan sudah diperbaiki.\n\n(Perubahan: tulis js/core.js)' },
  );
  const { final } = await user.build('perbaiki tombol pesan');
  assert.match(sent(2).messages.at(-1).content, /^Kamu menulis bahwa js\/core\.js, functions\/pesanan-buat\.js diubah, tapi belum ada tool/);
  // Diminta sekali saja; baris tiruan catatan riwayat dibuang dari ringkasan.
  assert.equal(final.message.content, 'Tombol pesan sudah diperbaiki.');
  assert.equal(read(user, 'js/core.js'), 'console.log(1);');
  const row = stack.db().prepare("SELECT checks FROM ai_requests WHERE user_id = ? AND action = 'build'").get(user.userId);
  assert.deepEqual(JSON.parse(row.checks), { found: { claim: 1 }, rounds: 3, tools: { write_file: 1 } });
});

test('Builder: kode yang hilang saat file ditimpa dikembalikan ke model', { skip: goOnly }, async () => {
  const user = await stack.register();
  const original = read(user, 'script.js');
  stack.ai.script.push(
    // Placeholder langsung dilaporkan saat ditulis; komponen yang hilang dilaporkan di pemeriksaan akhir.
    calls(call('write_file', { path: 'script.js', content: '// ... kode lainnya tetap sama\n' })),
    calls(call('read_file', { path: 'script.js', original: true })),
    { text: 'Selesai.' },
    calls(call('write_file', { path: 'script.js', content: original })),
    { text: 'Selesai, komponen dikembalikan.' },
  );
  const { final } = await user.build('rapikan script.js');
  const [written] = toolResults(sent(4));
  assert.match(written, /^Ditulis, TAPI ada masalah di "script\.js": ada komentar placeholder "\.\.\. kode lainnya tetap sama"/);
  const [before] = toolResults(sent(3)).slice(1);
  assert.equal(before, `Isi "script.js" sebelum jawaban ini:\n${original}`);
  assert.match(sent(2).messages.at(-1).content, /x-data="penghitung" masih dipakai di index\.html/);
  assert.equal(final.message.content, 'Selesai, komponen dikembalikan.');
  assert.equal(read(user, 'script.js'), original);
  const row = stack.db().prepare("SELECT checks FROM ai_requests WHERE user_id = ? AND action = 'build'").get(user.userId);
  assert.deepEqual(JSON.parse(row.checks).left, undefined);
});

test('Builder: cek ekspresi Alpine, struktur CSS, dan nama kolom database', { skip: goOnly }, async () => {
  const user = await stack.register();
  const page = '<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.9/dist/cdn.min.js"></script>'
    + '<div x-data="{ n: 0 }"><button @click="n++)">+</button></div>'
    + '<script>fetch("/api/db/tamu", { method: "POST", body: JSON.stringify({ nama: "a", pesan: "b" }) })</script>';
  stack.ai.script.push(
    calls(
      call('create_table', { name: 'tamu', columns: [{ name: 'nama', type: 'text' }, { name: 'ucapan', type: 'text' }], public: ['create'] }),
      call('write_file', { path: 'buku.html', content: page }),
      call('write_file', { path: 'buku.css', content: '.a { color: red;\n.b { color: blue }\n' }),
    ),
    { text: 'Selesai.' },
    calls(
      call('write_file', { path: 'buku.html', content: page.replace('n++)', 'n++').replace('pesan:', 'ucapan:') }),
      call('write_file', { path: 'buku.css', content: '.a { color: red; }\n.b { color: blue }\n' }),
    ),
    { text: 'Buku tamu siap.' },
  );
  const { final } = await user.build('buat buku tamu');
  assert.equal(final.message.content, 'Buku tamu siap.');
  const [, alpine, css] = toolResults(sent(3));
  assert.match(alpine, /^Ditulis, TAPI ada masalah di "buku\.html": <button @click="n\+\+\)">: SyntaxError/);
  assert.match(css, /^Ditulis, TAPI ada masalah di "buku\.css": kurung \{ untuk "\.a" di baris 1 tidak pernah ditutup/);
  assert.match(sent(2).messages.at(-1).content, /- buku\.html: data yang dikirim ke \/api\/db\/tamu berisi "pesan", tapi tabel tamu tidak punya kolom itu \(kolomnya: nama, ucapan\)/);
  const row = stack.db().prepare("SELECT checks FROM ai_requests WHERE user_id = ? AND action = 'build'").get(user.userId);
  assert.deepEqual(JSON.parse(row.checks), { found: { alpine: 2, css: 2, column: 1 }, rounds: 4, tools: { create_table: 1, write_file: 4 } });
});

test('Builder: perbaikan otomatis error preview gratis, sekali per jawaban', { skip: goOnly }, async () => {
  const user = await stack.register();
  stack.ai.script.push(calls(call('write_file', { path: 'a.js', content: 'console.log(1);' })), { text: 'Dibuat.' });
  const first = await user.build('buat a.js');
  const threadId = first.started.body.threadId;
  const target = first.final.message.id;
  const credits = (await user.credits()).freeRemaining;

  // Daftar error kosong ditolak; prompt dari klien diabaikan.
  assert.equal((await user.startPrompt('apa saja', { mode: 'build', autoFix: target, errors: [' '], threadId })).status, 400);
  stack.ai.script.push(calls(call('write_file', { path: 'a.js', content: 'console.log(2);' })), { text: 'Diperbaiki.' });
  const fix = await user.prompt('buat toko online lengkap', { autoFix: target, errors: ['[/] Uncaught ReferenceError: x is not defined', 'GET /api/db/x → 404'], threadId });
  assert.equal(fix.started.status, 201);
  assert.equal(fix.final.message.content, 'Diperbaiki.');
  assert.equal(fix.started.body.userMessage.autoFix, target);
  assert.equal(fix.started.body.userMessage.content, 'Setelah perubahan terakhir, preview menampilkan error ini:\n'
    + '- [/] Uncaught ReferenceError: x is not defined\n- GET /api/db/x → 404\n\nCari penyebabnya (terutama di kode yang baru diubah) dan perbaiki. Jangan mengubah hal lain.');
  assert.ok(sent(2).messages.at(-1).content.endsWith('Jangan mengubah hal lain.'));
  assert.equal((await user.credits()).freeRemaining, credits, 'gratis');
  // Jawaban sebelumnya dianggap disimpan, sama seperti prompt biasa.
  assert.equal(stack.db().prepare('SELECT apply_state FROM ai_messages WHERE id = ?').get(target).apply_state, 'kept');

  // Sekali per jawaban, dan jawaban hasil perbaikan otomatis tidak diperbaiki otomatis lagi.
  const again = (id) => user.startPrompt('', { autoFix: id, errors: ['Uncaught Error: y'], threadId });
  assert.equal((await again(target)).status, 409);
  assert.equal((await again(fix.final.message.id)).status, 409);
  // Riwayat percakapan menandai permintaan perbaikan otomatis.
  const thread = (await user.get(`/api/ai/threads/${threadId}`)).body.messages;
  assert.deepEqual(thread.map((m) => m.autoFix ?? null), [null, null, target, null]);

  // Jawaban yang dibatalkan, jawaban Plan, dan jawaban orang lain tidak bisa.
  stack.ai.script.push(calls(call('write_file', { path: 'b.js', content: '1' })), { text: 'Ok.' });
  const third = await user.build('buat b.js', { threadId });
  assert.equal((await user.post(`/api/ai/messages/${third.final.message.id}/revert`)).status, 200);
  assert.equal((await again(third.final.message.id)).status, 409);
  stack.ai.script.push({ text: 'Rencana.' });
  const plan = await user.prompt('rencanakan', { threadId });
  assert.equal((await again(plan.final.message.id)).status, 409);
  const stranger = await stack.register();
  assert.equal((await stranger.startPrompt('', { autoFix: target, errors: ['x'], threadId })).status, 400);
  assert.equal((await user.credits()).freeRemaining, credits - 2);

  // Riwayat: jawaban yang dibatalkan ditandai, isi perubahan jawaban terbaru ikut terkirim.
  stack.ai.script.push({ text: 'Oke.' });
  await user.prompt('tadi apa saja?', { threadId });
  // Catatan perubahan ada di pesan user sesudah jawabannya, bukan di jawaban AI (supaya tidak ditiru).
  const replies = sent().messages.filter((m) => m.role === 'assistant').map((m) => m.content);
  assert.ok(replies.every((c) => !c.includes('memanggil tool') && !c.includes('Isi perubahan')));
  const notes = sent().messages.filter((m) => m.role === 'user').map((m) => m.content);
  assert.ok(notes.some((c) => c.includes('Jawaban AI sebelumnya memanggil tool: tulis b.js.\nPerubahan ini DIBATALKAN pengguna')));
  assert.ok(notes.some((c) => c.includes('Jawaban AI sebelumnya memanggil tool: tulis a.js.\nIsi perubahan (- sebelum, + sesudah):\na.js (baris 1):\n- console.log(1);\n+ console.log(2);\n\n')));
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
  assert.equal(empty.final.credits.freeRemaining, 48);
});

test('indikator konteks: jawaban mencatat token input terbesar satu panggilan model', { skip: goOnly }, async () => {
  const user = await stack.register();
  assert.equal((await user.credits()).contextWindow, 128000);
  stack.ai.script.push(
    { ...calls(call('write_file', { path: 'a.html', content: '<p>a</p>' })), usage: { prompt_tokens: 9000, completion_tokens: 50 } },
    { text: 'Selesai.', usage: { prompt_tokens: 4000, completion_tokens: 10 } },
  );
  const { final } = await user.build('buat a');
  assert.equal(final.message.contextTokens, 9000);
  // Ikut tersimpan: percakapan yang dibuka lagi tetap menampilkannya.
  const thread = (await user.get(`/api/ai/threads/${final.message.threadId}`)).body;
  assert.equal(thread.messages.find((m) => m.id === final.message.id).contextTokens, 9000);

  stack.ai.script.push({ text: 'Rencana', usage: { prompt_tokens: 1234, completion_tokens: 5 } });
  assert.equal((await user.prompt('rencana')).final.message.contextTokens, 1234);
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

  assert.equal((await user.credits()).freeRemaining, 50);
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
  if (goOnly) assert.equal(history[2].content, 'Judul diganti.\n\n(Perubahan: tulis index.html)');
  else {
    assert.equal(history[2].content, 'Judul diganti.');
    assert.match(history[3].content, /^\[Catatan sistem, bukan tulisan pengguna[^\n]*\]\nJawaban AI sebelumnya memanggil tool: tulis index\.html\.\nIsi perubahan \(- sebelum, \+ sesudah\):\nindex\.html \(baris 1\):\n- <!DOCTYPE html>[\s\S]*\n\+ v1\n\n/);
  }
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
  // contextTokens (indikator konteks) hanya dari server Go.
  assert.deepEqual(Object.keys(detail.body.messages[1]).sort(), ['applyState', 'before', 'changes', 'content', ...(GO ? ['contextTokens'] : []), 'createdAt', 'error', 'id', 'images', 'mode', 'role', 'status', 'threadId']);
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
  assert.deepEqual(types.filter((t) => !['progress', 'reasoning', 'say'].includes(t)), ['running', 'thinking', 'done']);
  // Proses berpikir & teks jawaban ikut dikirim (untuk panel "Proses AI").
  const textOf = (list, type) => list.filter((e) => e.type === type).map((e) => e.text).join('');
  assert.equal(textOf(events, 'reasoning'), 'berpikir...');
  assert.equal(textOf(events, 'say'), 'a'.repeat(500) + 'b'.repeat(500));
  assert.ok(types.includes('progress'));
  assert.equal(events.filter((e) => e.type === 'progress').at(-1).chars, 1000);
  assert.equal(events.at(-1).message.content.length, 1000);

  // Sambung ulang setelah selesai: event diputar ulang dan langsung ditutup.
  // Event progres hanya disimpan yang terbaru; potongan teks berurutan disatukan.
  const replay = await user.jobEvents(id);
  assert.deepEqual(replay.map((e) => e.type).filter((t) => t !== 'say'), ['running', 'thinking', 'reasoning', 'progress', 'done']);
  assert.equal(replay.find((e) => e.type === 'progress').chars, 1000);
  assert.equal(textOf(replay, 'say'), 'a'.repeat(500) + 'b'.repeat(500));

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
  assert.equal(blind.final.credits.freeRemaining, 47);

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
  assert.deepEqual(events.map((e) => e.type), ['running', 'retry', 'running', 'say', 'done']);
  assert.deepEqual(events[1], { type: 'retry', attempt: 1, max: 3, seconds: 1 });
  assert.equal(events.at(-1).message.content, 'Akhirnya.');
});

test('server dimulai ulang saat AI bekerja: job ditandai gagal dan kredit dikembalikan', async () => {
  const user = await stack.register();
  stack.ai.script.push({ hang: true });
  const called = stack.ai.nextRequest();
  const started = await user.startPrompt('terputus');
  await called;
  assert.equal((await user.credits()).freeRemaining, 49);
  await stack.restart();

  const final = await user.finishJob(started.body.assistantMessage.id);
  assert.equal(final.type, 'error');
  assert.equal(final.error, 'Server dimulai ulang saat AI sedang bekerja. Kredit dikembalikan, silakan kirim ulang.');
  assert.equal(final.message.status, 'error');
  assert.equal(final.credits.freeRemaining, 50);
  assert.equal((await user.get('/api/ai/threads')).body.activeJob, null);
  // Setelah itu bisa langsung mengirim prompt lagi.
  stack.ai.script.push({ text: 'Jalan lagi.' });
  assert.equal((await user.prompt('ulang')).final.message.content, 'Jalan lagi.');
});

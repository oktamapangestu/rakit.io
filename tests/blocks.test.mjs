// Pilih blok di preview: skrip pemilih hanya untuk halaman di dalam iframe, prompt AI yang membawa blok
// terpilih, dan peringatan bila AI mengubah bagian di luar blok. Fitur ini hanya ada di server Go.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

const skip = !process.env.RAKIT_SERVER_CMD?.includes('go/bin/rakit') && 'fitur khusus server Go';

let stack;
before(async () => { if (!skip) stack = await startStack({ AI_BONUS_CREDITS: '50', AI_DAILY_CREDITS: '0' }); });
after(() => stack?.stop());

let callId = 0;
const call = (name, args) => ({ index: 0, id: `call_${++callId}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const calls = (...list) => ({ toolCalls: list.map((c, index) => ({ ...c, index })) });

const PAGE = `<!doctype html>
<html lang="id">
<head><title>Toko</title></head>
<body>
  <header><a href="/">Toko</a></header>
  <section class="hero"><h1>Halo</h1></section>
  <section class="pricing"><h2>Harga</h2></section>
  <footer>© 2026</footer>
</body>
</html>`;
const HERO = 'body > section:nth-of-type(1)';
const heroBlock = { page: '/', selector: HERO, label: 'Halo', html: '<section class="hero"><h1>Halo</h1></section>' };

async function owner(name) {
  const user = await stack.register(name);
  fs.writeFileSync(path.join(stack.dataDir, 'sites', name, 'index.html'), PAGE);
  return user;
}

test('skrip pemilih hanya disisipkan ke halaman HTML yang dimuat di iframe', { skip }, async () => {
  await owner('toko-pilih');
  const plain = await stack.site('toko-pilih', '/');
  assert.equal(plain.body, PAGE);
  assert.equal(plain.headers.vary, 'Sec-Fetch-Dest');

  const framed = await stack.site('toko-pilih', '/', { headers: { 'Sec-Fetch-Dest': 'iframe' } });
  assert.equal(framed.status, 200);
  // Skrip Console & pemilih dipasang paling awal di <head>, satu baris (nomor baris halaman tidak bergeser);
  // sisanya tidak berubah. Pemilih memakai defer, jadi tetap berjalan setelah halaman selesai dibaca.
  const tags = framed.body.match(/<head><script src="\/api\/_console\.js\?v=\w+" data-app="[^"]+"><\/script><script defer src="\/api\/_picker\.js\?v=(\w+)" data-app="[^"]+"><\/script>/);
  assert.ok(tags, 'skrip Console & pemilih di awal <head>');
  assert.equal(framed.body.replace(tags[0], '<head>'), PAGE);
  const picker = await stack.site('toko-pilih', `/api/_picker.js?v=${tags[1]}`);
  assert.equal(picker.status, 200);
  assert.match(picker.headers['content-type'], /javascript/);
  assert.match(picker.body, /document\.currentScript/);
  assert.equal(Number(framed.headers['content-length']), Buffer.byteLength(framed.body));
  assert.notEqual(framed.headers.etag, plain.headers.etag);
  const again = await stack.site('toko-pilih', '/', { headers: { 'Sec-Fetch-Dest': 'iframe', 'If-None-Match': framed.headers.etag } });
  assert.equal(again.status, 304);

  // CSS/JS dan halaman yang dibuka langsung tidak pernah disisipi.
  const css = await stack.site('toko-pilih', '/style.css', { headers: { 'Sec-Fetch-Dest': 'iframe' } });
  assert.ok(!css.body.includes('data-app'));
  assert.ok(!(await stack.site('toko-pilih', '/', { headers: { 'Sec-Fetch-Dest': 'document' } })).body.includes('data-app'));
});

test('prompt dengan blok: AI menerima blok dan batasannya; tanpa peringatan bila hanya blok yang diubah', { skip }, async () => {
  const user = await owner('toko-blok');
  stack.ai.script.push(
    calls(call('write_file', { path: 'index.html', content: PAGE.replace('<h1>Halo</h1>', '<h1 class="besar">Halo dunia</h1><a href="#">Mulai</a>') })),
    { text: 'Hero sudah diperbarui.' },
  );
  const { started, final } = await user.build('buat hero lebih menarik', { blocks: [heroBlock] });
  assert.equal(started.status, 201);
  assert.deepEqual(started.body.userMessage.blocks, [{ label: 'Halo', page: 'index.html' }]);

  const asked = stack.ai.requests.at(-2).messages.at(-1).content;
  assert.match(asked, /Request:\nbuat hero lebih menarik\n\nSelected blocks/);
  assert.ok(asked.includes(`1. "Halo" in index.html (CSS path: ${HERO})`));
  assert.ok(asked.includes(`<block>\n${heroBlock.html}\n</block>`));
  assert.ok(asked.includes('Change ONLY the selected blocks'));

  assert.equal(final.type, 'done');
  assert.equal(final.message.content, 'Hero sudah diperbarui.');
  assert.equal(final.message.blocks, undefined);
  // Blok ikut tersimpan di riwayat percakapan.
  const thread = (await user.get(`/api/ai/threads/${started.body.threadId}`)).body;
  assert.deepEqual(thread.messages.find((m) => m.role === 'user').blocks, [{ label: 'Halo', page: 'index.html' }]);
});

test('peringatan bila AI juga mengubah bagian lain halaman atau halaman lain', { skip }, async () => {
  const user = await owner('toko-luar');
  stack.ai.script.push(
    calls(call('write_file', { path: 'index.html', content: PAGE.replace('<h1>Halo</h1>', '<h1>Hai</h1>').replace('© 2026', '© 2027') })),
    { text: 'Selesai.' },
  );
  let { final } = await user.build('ubah hero', { blocks: [heroBlock] });
  assert.equal(final.message.content, 'Selesai.\n\n⚠️ **Perhatian:** AI juga mengubah bagian di luar blok yang kamu pilih (index.html). Cek dulu hasilnya di preview; kalau tidak sesuai, tekan **Batalkan**.');
  await user.post(`/api/ai/messages/${final.message.id}/keep`);

  // Menghapus blok yang dipilih itu wajar; CSS boleh ikut berubah; halaman lain tidak.
  const current = fs.readFileSync(path.join(stack.dataDir, 'sites', 'toko-luar', 'index.html'), 'utf8');
  stack.ai.script.push(
    calls(
      call('write_file', { path: 'index.html', content: current.replace(/<section class="hero">.*?<\/section>/, '') }),
      call('write_file', { path: 'style.css', content: '.hero{display:none}' }),
      call('write_file', { path: 'tentang.html', content: '<p>Baru</p>' }),
    ),
    { text: 'Hero dihapus.' },
  );
  ({ final } = await user.build('hapus hero', { blocks: [heroBlock] }));
  assert.match(final.message.content, /^Hero dihapus\.\n\n⚠️ .*\(tentang\.html\)/);

  // Tanpa blok: tidak ada pemeriksaan.
  stack.ai.script.push(calls(call('write_file', { path: 'index.html', content: '<p>Semua baru</p>' })), { text: 'Oke.' });
  ({ final } = await user.build('rombak semuanya'));
  assert.equal(final.message.content, 'Oke.');
});

test('blok yang tidak valid ditolak sebelum kredit dipakai', { skip }, async () => {
  const user = await owner('toko-salah');
  const before = (await user.credits()).remaining;
  for (const [blocks, error] of [
    ['x', 'Daftar blok tidak valid'],
    [[{ ...heroBlock, selector: 'section.hero' }], 'Blok tidak valid. Pilih ulang bloknya di preview.'],
    [[{ ...heroBlock, page: '/tidak-ada' }], 'Halaman blok tidak ditemukan. Pilih ulang bloknya di preview.'],
    [[{ ...heroBlock, page: '/style.css' }], 'Halaman blok tidak ditemukan. Pilih ulang bloknya di preview.'],
    [Array.from({ length: 6 }, () => heroBlock), 'Maksimal 5 blok sekaligus'],
  ]) {
    const res = await user.startPrompt('ubah', { mode: 'build', blocks });
    assert.deepEqual([res.status, res.body.error], [400, error], JSON.stringify(blocks).slice(0, 60));
  }
  assert.equal((await user.credits()).remaining, before);
});

test('blok dari beberapa halaman sekaligus: diperiksa per halaman', { skip }, async () => {
  const user = await owner('toko-dua');
  const ABOUT = '<!doctype html><html><body><main><h1>Tentang</h1></main><footer>Kontak</footer></body></html>';
  fs.writeFileSync(path.join(stack.dataDir, 'sites', 'toko-dua', 'tentang.html'), ABOUT);
  const footer = { page: '/tentang', selector: 'body > footer:nth-of-type(1)', label: 'Footer', html: '<footer>Kontak</footer>' };
  stack.ai.script.push(
    calls(
      call('write_file', { path: 'index.html', content: PAGE.replace('<h1>Halo</h1>', '<h1>Hai</h1>') }),
      call('write_file', { path: 'tentang.html', content: ABOUT.replace('Kontak', 'Kontak kami') }),
    ),
    { text: 'Dua bagian diperbarui.' },
  );
  let { started, final } = await user.build('rapikan', { blocks: [heroBlock, footer] });
  assert.deepEqual(started.body.userMessage.blocks, [{ label: 'Halo', page: 'index.html' }, { label: 'Footer', page: 'tentang.html' }]);
  const asked = stack.ai.requests.at(-2).messages.at(-1).content;
  assert.ok(asked.includes('1. "Halo" in index.html') && asked.includes('2. "Footer" in tentang.html (CSS path: body > footer:nth-of-type(1))'));
  assert.equal(final.message.content, 'Dua bagian diperbarui.');
  await user.post(`/api/ai/messages/${final.message.id}/revert`);

  // Bagian lain di halaman kedua ikut berubah: peringatan menyebut halaman itu saja.
  stack.ai.script.push(
    calls(
      call('write_file', { path: 'index.html', content: PAGE.replace('<h1>Halo</h1>', '<h1>Hai</h1>') }),
      call('write_file', { path: 'tentang.html', content: ABOUT.replace('Kontak', 'Kontak kami').replace('Tentang', 'Tentang kami') }),
    ),
    { text: 'Selesai.' },
  );
  ({ final } = await user.build('rapikan', { blocks: [heroBlock, footer] }));
  assert.match(final.message.content, /\(tentang\.html\)\. Cek dulu/);
});

test('CSS dan JS terkait blok ikut dikirim ke AI dan didahulukan di konteks', { skip }, async () => {
  const user = await owner('toko-css');
  const root = path.join(stack.dataDir, 'sites', 'toko-css');
  // Project besar: style.css (terkait blok) lebih besar dari file lain, total melebihi batas konteks AI.
  fs.writeFileSync(path.join(root, 'style.css'), `.hero { padding: 2rem; }\n/* ${'x'.repeat(90_000)} */`);
  fs.writeFileSync(path.join(root, 'script.js'), "const x = 1;\ndocument.querySelector('.hero').classList.add('tampil');\n");
  fs.writeFileSync(path.join(root, 'a.js'), `// ${'a'.repeat(60_000)}`);
  fs.writeFileSync(path.join(root, 'b.js'), `// ${'b'.repeat(60_000)}`);
  stack.ai.script.push({ text: 'Rencana: ubah padding hero.' });
  const block = { ...heroBlock, css: [{ file: '/style.css', rules: '.hero { padding: 2rem; }' }, { file: '', rules: 'h1 { margin: 0; }' }] };
  const { final } = await user.prompt('rencanakan perubahan hero', { mode: 'plan', blocks: [block] });
  assert.equal(final.type, 'done');

  const asked = stack.ai.requests.at(-1).messages.at(-1).content;
  assert.ok(asked.includes('CSS rules that currently style this block (recorded by the browser):\n<css file="style.css">\n.hero { padding: 2rem; }\n</css>\n<css file="inline <style> in index.html">\nh1 { margin: 0; }\n</css>'));
  assert.ok(asked.includes("JavaScript lines that refer to this block's id/class names:\n- script.js:2: document.querySelector('.hero').classList.add('tampil');"));
  // Didahulukan: halaman blok, CSS-nya, lalu JS-nya; file lain yang tidak muat dilewati.
  assert.ok(asked.includes('<file path="index.html">') && asked.includes('<file path="style.css">') && asked.includes('<file path="script.js">'));
  assert.match(asked, /Not included because the project is too large \(read them with read_file when needed\): (a\.js|b\.js)$/m);
});

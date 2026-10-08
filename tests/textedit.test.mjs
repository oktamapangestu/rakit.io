// Edit teks di preview: perubahan teks elemen di preview diterapkan ke HTML sumber (assets-source/js/textedit.js)
// tanpa mengubah bagian lain file, dan ditolak bila teks di sumber tidak sama dengan yang dilihat di preview.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../assets-source/js/textedit.js', import.meta.url), 'utf8'), context);
const { apply } = context.rakitTextEdit;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', copy: '©' };
const decode = (raw) => raw.replace(/&(#\d+|[a-z]+);/gi, (all, name) => (name[0] === '#' ? String.fromCodePoint(Number(name.slice(1))) : ENTITIES[name] ?? all));

// edit: terapkan perubahan lalu kembalikan HTML barunya (atau pesan error).
function edit(src, selector, before, after) {
  const res = apply(src, selector, before, after, decode);
  if (res.error) return { error: res.error };
  let out = src;
  for (const e of [...res.edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

const PAGE = `<!doctype html>
<html lang="id">
<head>
  <title>Toko</title>
  <style>h1 { color: red }</style>
</head>
<body>
  <header class="top">
    <nav><ul><li><a href="/">Beranda</a></li><li><a href="/produk">Produk</a></li></ul></nav>
  </header>
  <!-- hero -->
  <section class="hero">
    <h1 class="title">
      Bangun <span class="hl">website</span> cepat
    </h1>
    <p>Mulai gratis &amp; tanpa kartu kredit.</p>
  </section>
  <section>
    <p>Satu<p>Dua
    <table><tr><td>Sel A</td><td>Sel B</td></tr></table>
  </section>
  <footer>&copy; 2025 Toko</footer>
  <script>document.title = "<h1>bukan teks</h1>"</script>
</body>
</html>`;

test('mengubah satu bagian teks tanpa menyentuh format & indentasi', () => {
  const sel = 'body > section:nth-of-type(1) > h1:nth-of-type(1)';
  const before = ['\n      Bangun ', 'website', ' cepat\n    '];
  const out = edit(PAGE, sel, before, ['\n      Bangun ', 'toko online', ' cepat\n    ']);
  assert.equal(out, PAGE.replace('<span class="hl">website</span>', '<span class="hl">toko online</span>'));
});

test('seluruh isi elemen diganti teks polos (format dihapus di preview)', () => {
  const sel = 'body > section:nth-of-type(1) > h1:nth-of-type(1)';
  const out = edit(PAGE, sel, ['\n      Bangun ', 'website', ' cepat\n    '], 'Halo dunia');
  assert.match(out, /<h1 class="title">\n {6}Halo dunia\n {4}<\/h1>/);
});

test('karakter khusus di-escape, entitas di teks lama dibaca', () => {
  const sel = 'body > section:nth-of-type(1) > p:nth-of-type(1)';
  const out = edit(PAGE, sel, ['Mulai gratis & tanpa kartu kredit.'], ['Gratis <selamanya> & cepat']);
  assert.ok(out.includes('<p>Gratis &lt;selamanya&gt; &amp; cepat</p>'));
  const footer = edit(PAGE, 'body > footer:nth-of-type(1)', ['© 2025 Toko'], ['© 2026 Toko']);
  assert.ok(footer.includes('<footer>© 2026 Toko</footer>'));
});

test('tag penutup tersirat, <tbody> otomatis, dan daftar menu', () => {
  assert.ok(edit(PAGE, 'body > section:nth-of-type(2) > p:nth-of-type(2)', ['Dua\n    '], ['Tiga\n    ']).includes('<p>Satu<p>Tiga\n    <table>'));
  const cell = 'body > section:nth-of-type(2) > table:nth-of-type(1) > tbody:nth-of-type(1) > tr:nth-of-type(1) > td:nth-of-type(2)';
  assert.ok(edit(PAGE, cell, ['Sel B'], ['Sel C']).includes('<td>Sel A</td><td>Sel C</td>'));
  const li = 'body > header:nth-of-type(1) > nav:nth-of-type(1) > ul:nth-of-type(1) > li:nth-of-type(2)';
  assert.ok(edit(PAGE, li, ['Produk'], ['Katalog']).includes('<a href="/produk">Katalog</a>'));
});

test('halaman tanpa <body> tertulis', () => {
  const src = '<meta charset="utf-8">\n<title>A</title>\n<h1>Halo</h1>\n<p>Isi</p>';
  assert.equal(edit(src, 'body > p:nth-of-type(1)', ['Isi'], ['Konten']), src.replace('Isi', 'Konten'));
});

test('ditolak bila teks sumber tidak sama dengan preview (mis. dibuat JavaScript)', () => {
  const sel = 'body > section:nth-of-type(1) > p:nth-of-type(1)';
  assert.deepEqual(edit(PAGE, sel, ['Teks dari JavaScript'], ['Baru']), { error: 'mismatch' });
  assert.deepEqual(edit(PAGE, 'body > section:nth-of-type(9) > p:nth-of-type(1)', ['x'], ['y']), { error: 'missing' });
});

test('atribut berisi ">" dan komentar tidak mengacaukan posisi', () => {
  const src = '<body><div data-x="a>b"><!-- <p>palsu</p> --><p title=\'1 > 0\'>Asli</p></div></body>';
  assert.equal(edit(src, 'body > div:nth-of-type(1) > p:nth-of-type(1)', ['Asli'], ['Baru']), src.replace('>Asli<', '>Baru<'));
});

// Ganti gambar: src/alt <img> diubah di tempatnya, atribut lain tetap.
function editImage(src, selector, before, changes) {
  const res = context.rakitTextEdit.applyImage(src, selector, before, changes, decode);
  if (res.error) return { error: res.error };
  let out = src;
  for (const e of [...res.edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

const GALLERY = `<body>
  <figure><img class="hero" src="/images/lama.jpg" alt="Foto lama" loading="lazy"></figure>
  <a href="/"><img src='logo.png'/></a>
  <img src=/a.png srcset="/a-2x.png 2x" sizes="100vw" alt=Gambar>
</body>`;

test('ganti src & alt gambar tanpa mengubah atribut lain', () => {
  const sel = 'body > figure:nth-of-type(1) > img:nth-of-type(1)';
  const out = editImage(GALLERY, sel, { src: '/images/lama.jpg', alt: 'Foto lama' }, { src: '/images/baru "x".png', alt: 'Foto & baru' });
  assert.ok(out.includes('<img class="hero" src="/images/baru &quot;x&quot;.png" alt="Foto &amp; baru" loading="lazy">'));
});

test('alt ditambahkan bila belum ada; kutip tunggal & tanpa kutip dipertahankan/dirapikan', () => {
  const logo = editImage(GALLERY, 'body > a:nth-of-type(1) > img:nth-of-type(1)', { src: 'logo.png', alt: null }, { src: '/logo-baru.png', alt: 'Logo' });
  assert.ok(logo.includes(`<img src='/logo-baru.png' alt="Logo"/>`));
  const plain = editImage(GALLERY, 'body > img:nth-of-type(1)', { src: '/a.png', alt: 'Gambar' }, { src: '/b.png', alt: 'Gambar B' });
  assert.ok(plain.includes('<img src="/b.png" alt="Gambar B">'), plain);
});

test('hanya alt diubah: srcset tetap; gambar yang tidak cocok ditolak', () => {
  const sel = 'body > img:nth-of-type(1)';
  assert.ok(editImage(GALLERY, sel, { src: '/a.png', alt: 'Gambar' }, { alt: 'Baru' }).includes('srcset="/a-2x.png 2x" sizes="100vw" alt="Baru"'));
  assert.deepEqual(editImage(GALLERY, sel, { src: '/dari-js.png', alt: '' }, { src: '/b.png' }), { error: 'mismatch' });
  assert.deepEqual(editImage(GALLERY, 'body > figure:nth-of-type(1)', { src: '' }, { src: '/b.png' }), { error: 'missing' });
});

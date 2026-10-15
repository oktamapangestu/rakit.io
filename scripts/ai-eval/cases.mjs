// Kasus uji tetap untuk evaluasi AI Builder (lihat run.mjs). Setiap kasus berjalan di project baru dari template
// default (index.html, style.css, script.js dengan komponen Alpine "penghitung").
//   files:      isi file yang ditimpa/ditambahkan sebelum prompt (null = hapus file template)
//   allow:      file yang boleh diubah; file lain yang ikut diubah dilaporkan "di luar lingkup"
//               (path berakhiran "/" = seluruh folder)
//   must:       [file, regex] yang harus cocok di hasil akhir — pemeriksaan kasar "sesuai permintaan"
//   needsTable: permintaan ini seharusnya membuat tabel database

const LONG_PAGE = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kopi Senja</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="top">
    <a class="brand" href="/">Kopi Senja</a>
    <nav><a href="#menu">Menu</a><a href="#lokasi">Lokasi</a></nav>
  </header>
  <section class="hero">
    <h1>Kopi lokal, diseduh pelan-pelan</h1>
    <p>Biji kopi dari petani Temanggung dan Gayo, disangrai sendiri setiap minggu.</p>
    <a class="btn" href="#menu">Lihat menu</a>
  </section>
  <section id="menu">
    <h2>Menu</h2>
    <ul class="menu">
      <li><span>Kopi susu senja</span><span>Rp22.000</span></li>
      <li><span>V60 Gayo</span><span>Rp28.000</span></li>
      <li><span>Es teh tarik</span><span>Rp18.000</span></li>
    </ul>
  </section>
  <section id="lokasi">
    <h2>Lokasi</h2>
    <p>Jl. Kaliurang km 5, Yogyakarta. Buka setiap hari 08.00–22.00.</p>
  </section>
  <footer>© Kopi Senja</footer>
</body>
</html>
`;

const LONG_CSS = `* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #2b2118; background: #fbf7f2; }
.top { display: flex; justify-content: space-between; padding: 16px 24px; }
.top nav a { margin-left: 16px; color: inherit; }
.brand { font-weight: 700; color: inherit; text-decoration: none; }
.hero { padding: 64px 24px; text-align: center; }
.btn { display: inline-block; padding: 12px 20px; border-radius: 8px; background: #8a4b2a; color: #fff; text-decoration: none; }
section { max-width: 720px; margin: 0 auto; padding: 32px 24px; }
.menu { list-style: none; padding: 0; }
.menu li { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e8dccf; }
footer { padding: 24px; text-align: center; color: #7a6a5a; }
`;

export const CASES = [
  {
    id: 'landing-portofolio',
    prompt: 'Buat landing page portofolio untuk desainer grafis bernama Rina: hero, daftar karya, tentang saya, dan kontak.',
    must: [['index.html', /Rina/]],
  },
  {
    id: 'navbar-hamburger',
    prompt: 'Tambahkan navbar responsif dengan menu hamburger di HP.',
    allow: ['index.html', 'style.css', 'script.js'],
    must: [['index.html', /<nav/]],
  },
  {
    id: 'dark-mode',
    prompt: 'Tambahkan tombol dark mode yang pilihannya diingat saat halaman dibuka lagi.',
    allow: ['index.html', 'style.css', 'script.js'],
    must: [['*', /localStorage/]],
  },
  {
    id: 'buku-tamu',
    prompt: 'Buat buku tamu: pengunjung bisa menulis nama dan ucapan, lalu semua ucapan tampil di bawahnya (terbaru di atas).',
    needsTable: true,
    must: [['*', /\/api\/db\//]],
  },
  {
    id: 'form-kontak',
    prompt: 'Tambahkan form kontak (nama, email, pesan). Pesannya cukup bisa dibaca pemilik saja.',
    needsTable: true,
    must: [['*', /\/api\/db\//]],
  },
  {
    id: 'toko-katalog',
    prompt: 'Buat katalog produk toko kue dari database (nama, harga, foto) dengan keranjang belanja dan total harga.',
    needsTable: true,
    must: [['*', /Alpine\.data\(/]],
  },
  {
    id: 'halaman-tentang',
    prompt: 'Buat halaman Tentang Kami terpisah dan tambahkan tautannya di menu semua halaman.',
    must: [['index.html', /tentang/i]],
  },
  {
    id: 'faq-accordion',
    prompt: 'Tambahkan bagian FAQ berbentuk accordion dengan 4 pertanyaan seputar pemesanan.',
    allow: ['index.html', 'style.css', 'script.js'],
  },
  {
    id: 'galeri-modal',
    prompt: 'Buat galeri foto 6 gambar dari folder /images (galeri-1.jpg sampai galeri-6.jpg); klik foto membukanya besar di modal.',
    must: [['*', /galeri-1\.jpg/]],
  },
  {
    id: 'undangan-rsvp',
    prompt: 'Buat website undangan pernikahan Dimas & Ayu tanggal 14 Februari 2027 dengan hitung mundur dan form RSVP (nama, jumlah tamu, hadir/tidak).',
    needsTable: true,
    must: [['index.html', /Dimas/]],
  },
  {
    id: 'fungsi-telegram',
    prompt: 'Setiap ada pesanan baru dari form di halaman utama (nama, no HP, pesanan), simpan ke database dan kirim notifikasi ke Telegram saya.',
    needsTable: true,
    must: [['functions/', /export default/], ['functions/', /env\./]],
  },
  {
    id: 'chatbot',
    prompt: 'Tambahkan chatbot AI untuk menjawab pertanyaan pengunjung.',
    allow: ['index.html'],
    must: [['index.html', /\/api\/ai\/widget\.js/]],
  },
  {
    id: 'perbaiki-bug',
    prompt: 'Tombol "Tambah" di halamanku tidak berfungsi sama sekali. Tolong perbaiki.',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daftar belanja</title>
  <link rel="stylesheet" href="style.css">
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js"></script>
  <script defer src="script.js"></script>
</head>
<body>
  <main x-data="belanja">
    <h1>Daftar belanja</h1>
    <input x-model="baru" placeholder="Barang">
    <button type="button" @click="tambah()">Tambah</button>
    <ul><template x-for="(b, i) in daftar" :key="i"><li x-text="b"></li></template></ul>
  </main>
</body>
</html>
`,
      'script.js': `document.addEventListener('alpine:init', () => {
  Alpine.data('belanja', () => ({
    baru: '',
    daftar: [],
    tambah() {
      if (!this.baru.trim() return;
      this.daftar.push(this.baru.trim());
      this.baru = '';
    },
  }));
});
`,
    },
    allow: ['index.html', 'script.js'],
  },
  {
    id: 'edit-kecil',
    prompt: 'Ganti warna tombol "Lihat menu" jadi hijau tua.',
    files: { 'index.html': LONG_PAGE, 'style.css': LONG_CSS, 'script.js': null },
    allow: ['style.css', 'index.html'],
    must: [['index.html', /Biji kopi dari petani Temanggung dan Gayo/], ['index.html', /Jl\. Kaliurang km 5/]],
  },
  {
    id: 'filter-pencarian',
    prompt: 'Di halaman menu, tambahkan kotak pencarian dan filter kategori (kopi, non-kopi). Data menu ambil dari database.',
    files: { 'index.html': LONG_PAGE, 'style.css': LONG_CSS, 'script.js': null },
    needsTable: true,
    must: [['index.html', /Jl\. Kaliurang km 5/]],
  },
  {
    id: 'validasi-form',
    prompt: 'Buat form pendaftaran kelas (nama, email, no WA, pilih kelas) dengan validasi yang jelas di setiap kolom sebelum dikirim.',
    needsTable: true,
  },
];

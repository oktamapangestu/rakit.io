// Ekspor tab Dokumentasi (assets-source/editor/docs/export.js): Markdown dari data GET /api/docs. Murni JS, tanpa server.
import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.document = { documentElement: { lang: 'id' } };
const { docsMarkdown } = await import('../assets-source/editor/docs/export.js');

const data = {
  project: { slug: 'tokokue', name: 'Toko Kue', siteUrl: 'https://tokokue.rakit.io' },
  notes: '## Gaya\n- Warna | cokelat',
  pages: [
    { path: 'index.html', title: 'Beranda', description: 'Kue rumahan', orphan: false, linkedFrom: [],
      links: [{ from: 'index.html', to: 'rusak.html', broken: true }], forms: [{ page: 'index.html', action: '/api/fn/pesan', method: 'post' }],
      assets: [{ from: 'index.html', to: 'app.js', kind: 'js', missing: false }] },
    { path: 'lain.html', title: '', description: '', orphan: true, linkedFrom: [], links: [], forms: [], assets: [] },
  ],
  tables: [{ name: 'pesanan', rowCount: 3, rules: { list: 'owner', view: 'owner', create: 'public', update: 'owner', delete: 'owner' },
    columns: [{ name: 'nama', type: 'text', required: true }, { name: 'produk', type: 'reference', refTable: 'produk' }],
    usedBy: [{ file: 'app.js', table: 'pesanan', op: 'create', status: 'ok' }] }],
  relations: [{ from: 'pesanan', column: 'produk', to: 'produk' }],
  functions: [{ name: 'pesan', path: 'functions/pesan.js', url: 'https://tokokue.rakit.io/api/fn/pesan', summary: 'Kirim notifikasi.',
    methods: ['POST'], query: [], body: ['nama'], secrets: ['TG_TOKEN'], tables: [{ table: 'pesanan', ops: ['create'] }], ai: [], fetches: ['api.telegram.org'],
    schedule: { cron: '0 8 * * *', active: false }, usedBy: ['app.js'] }],
  secrets: [{ name: 'TG_TOKEN', usedBy: ['pesan'] }],
  aiProviders: [],
  issues: [{ kind: 'broken_link', name: 'rusak.html', file: 'index.html' }],
};

test('docsMarkdown: semua bagian, judul catatan diturunkan, tabel aman dari "|", tanpa nilai rahasia', () => {
  const md = docsMarkdown(data);
  for (const want of [
    '# Toko Kue\n',
    '## Catatan Project\n\n### Gaya\n- Warna | cokelat',
    '- 2 halaman',
    '### Perlu dicek\n\n- index.html menautkan ke rusak.html, tapi halaman itu tidak ada.',
    '### index.html — Beranda\n\nKue rumahan',
    '- Menautkan ke: `rusak.html` (tidak ada)',
    '- Form: `POST /api/fn/pesan`',
    '- Tabel: `pesanan` (Tambah)', // lewat app.js yang dimuat halaman
    '- Fungsi: `pesan`',
    '### lain.html\n\n- Tidak ditautkan dari halaman lain',
    '| POST | `/api/db/pesanan` | Publik | Tambah baris (body JSON) |',
    '| GET | `/api/db/pesanan` | Pemilik |',
    '- Method: POST',
    '- Jadwal: setiap hari 08.00 WIB (tidak aktif)',
    '| `produk` | Relasi | → produk |',
    '- `pesanan.produk` → `produk`',
    '- Rahasia (env): `TG_TOKEN` — nilainya tidak ikut diekspor',
    "body: JSON.stringify({ nama: 'teks' }),",
  ]) assert.ok(md.includes(want), `tidak ada: ${want}\n---\n${md}`);
  assert.ok(!/\n{3,}/.test(md), 'tidak ada baris kosong berlebih');
});

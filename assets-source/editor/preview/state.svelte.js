// Keadaan panel preview, dipakai PreviewPanel.svelte, kotak prompt AI (chip blok), dan editor.js (pesan dari iframe).
// pick: pilih blok untuk AI (maks. MAX_BLOCKS dari semua halaman; tiap blok membawa halamannya). textEdit: mode Edit
// (klik teks/gambar di preview). bar: isi bar alamat — host website & route halaman yang tampil.
export const MAX_BLOCKS = 5;

export const preview = $state({
  pick: { on: false, page: null, blocks: [] },
  textEdit: { on: false },
  device: 'desktop',
  host: '',
  route: '',
  url: '',
});

// "/" -> "index", "/produk/sepatu.html" -> "sepatu"
export const pageName = (page) => decodeURIComponent(page.replace(/\/+$/, '').split('/').pop() || 'index').replace(/\.html$/i, '') || 'index';

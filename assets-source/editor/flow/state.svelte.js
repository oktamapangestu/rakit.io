// Baca Alur Kode: keadaan panel, dipakai bersama FlowPanel.svelte (tampilan) dan editor.js (logika yang menyentuh
// Monaco: sorotan baris, klik baris -> langkah, buka file rujukan).
export const flow = $state({
  open: false,
  path: null, // file yang sedang ditampilkan panel
  saved: null, // { explanation, hash, createdAt } dari server
  hash: null, // hash isi editor sekarang
  step: 0, // indeks langkah aktif
  loading: null, // path yang sedang dijelaskan AI
  remaining: null,
  limit: null,
  back: [], // [{ path, step }] untuk tombol "Kembali"
  chats: {}, // path -> [{ q, a }]
  asking: false,
  playTimer: null,
  seq: 0,
  pending: null, // { path, step }: langkah yang dibuka setelah penjelasan file itu dimuat (tombol Kembali)
  showChart: true,
});

export const flowSteps = () => flow.saved?.explanation?.steps ?? [];
export const flowStale = () => Boolean(flow.saved && flow.hash && flow.saved.hash !== flow.hash);

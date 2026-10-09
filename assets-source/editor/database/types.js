// Tipe kolom & jenis akses tabel database project (lihat go/internal/userdb).
export const DB_TYPES = { text: 'Teks', number: 'Angka', boolean: 'Ya/Tidak', date: 'Tanggal', reference: 'Relasi', image: 'Gambar' };
export const DB_OPS = [
  ['list', 'Lihat daftar'],
  ['view', 'Lihat satu baris'],
  ['create', 'Tambah'],
  ['update', 'Ubah'],
  ['delete', 'Hapus'],
];
export const DB_PAGE = 50;
export const tableUrl = (name) => `/api/database/tables/${encodeURIComponent(name)}`;

// Class Keranjang untuk mengelola item belanjaan
class Keranjang {
  constructor() {
    // Muat data dari localStorage saat inisialisasi
    this.items = this.muat();
  }

  // Menambah item baru ke keranjang
  tambah(item) {
    // Validasi item memiliki properti yang dibutuhkan
    if (!item || !item.id || !item.nama || !item.harga || !item.jumlah) {
      throw new Error('Item tidak valid');
    }

    // Cek apakah item dengan id sama sudah ada
    const existing = this.items.find((i) => i.id === item.id);
    if (existing) {
      // Jika ada, tambahkan jumlahnya
      existing.jumlah += item.jumlah;
    } else {
      // Jika belum ada, tambahkan item baru
      this.items.push({ ...item });
    }

    this.simpan();
  }

  // Menghapus item berdasarkan id
  hapus(id) {
    this.items = this.items.filter((item) => item.id !== id);
    this.simpan();
  }

  // Menghitung subtotal sebelum diskon
  subtotal() {
    return this.items.reduce(
      (sum, item) => sum + item.harga * item.jumlah,
      0
    );
  }

  // Menghitung total setelah diskon
  total() {
    const sub = this.subtotal();
    // Diskon 10% jika subtotal lebih dari 500000
    return sub > 500000 ? sub * 0.9 : sub;
  }

  // Mengembalikan daftar item
  daftar() {
    return [...this.items];
  }

  // Menyimpan data ke localStorage
  simpan() {
    localStorage.setItem('keranjang', JSON.stringify(this.items));
  }

  // Memuat data dari localStorage
  muat() {
    const data = localStorage.getItem('keranjang');
    try {
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }
}
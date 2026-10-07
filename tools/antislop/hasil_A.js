class Keranjang {
  constructor() {
    // Kunci untuk penyimpanan di localStorage
    this.storageKey = 'keranjang_items';
    // Muat data dari localStorage saat inisialisasi, atau array kosong
    this.items = this.muat();
  }

  // Menyimpan daftar item ke localStorage
  simpan() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.items));
  }

  // Memuat daftar item dari localStorage
  muat() {
    const data = localStorage.getItem(this.storageKey);
    try {
      return data ? JSON.parse(data) : [];
    } catch {
      // Jika data korup, kembalikan array kosong
      return [];
    }
  }

  // Menambahkan item baru ke keranjang
  tambah(item) {
    // Validasi sederhana: pastikan id, nama, harga, dan jumlah ada
    if (!item || !item.id || !item.nama || typeof item.harga !== 'number' || typeof item.jumlah !== 'number') {
      throw new Error('Format item tidak valid');
    }
    this.items.push(item);
    this.simpan();
  }

  // Menghapus item berdasarkan id
  hapus(id) {
    this.items = this.items.filter(item => item.id !== id);
    this.simpan();
  }

  // Menghitung subtotal (sebelum diskon)
  subtotal() {
    return this.items.reduce((sum, item) => sum + (item.harga * item.jumlah), 0);
  }

  // Menghitung total akhir, dengan diskon 10% bila subtotal > 500000
  total() {
    const sub = this.subtotal();
    return sub > 500000 ? sub * 0.9 : sub;
  }

  // Mengembalikan salinan daftar item (agar tidak bisa dimodifikasi langsung)
  daftar() {
    return [...this.items];
  }
}
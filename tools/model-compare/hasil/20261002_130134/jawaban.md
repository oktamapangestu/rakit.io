# Perbandingan Model AI rakit.io

- Model A: **deepseek-v4-pro**
- Model B: **gpt-6-sol**
- Waktu: 2026-10-02 13:01
- Kasus: 2 prompt × 1 run


---

## plan_landing — Plan

**Prompt:** Saya mau bikin website untuk warung kopi kecil di Pekanbaru. Isinya: halaman depan dengan menu, foto-foto, alamat, dan formulir pesan. Bisa terima pesanan online juga. Tolong rencanakan dulu.

*Catatan:* Plan harus konkret: file, tabel DB, tampilan. Tanpa kode penuh.


### A · deepseek-v4-pro  (skor 80.7)

```
Siap, Bang. Saya bantu rencanakan dulu sebelum kita eksekusi. Ini bukan sekadar "bikin website", tapi website yang bisa bantu warung kopi Bang dapat pelanggan dan terima pesanan online. Berikut rencananya:

---

## 1. Tujuan Website
- Menampilkan menu dan foto warung kopi agar menarik pelanggan.
- Memberikan informasi lokasi, jam buka, dan kontak.
- Menerima pesanan online (take away / delivery).
- Meningkatkan kepercayaan dan jangkauan pelanggan di Pekanbaru.

---

## 2. Halaman yang Dibutuhkan

### a. Halaman Depan (Home)
- **Hero Section**: Foto suasana warung / kopi andalan, nama warung, tagline singkat.
- **Tentang Singkat**: Cerita singkat warung kopi.
- **Menu Unggulan**: 3–4 menu terlaris dengan foto dan harga.
- **Testimoni Singkat** (opsional): Kata-kata pelanggan.
- **CTA (Call to Action)**: Tombol "Pesan Sekarang" atau "Lihat Menu".

### b. Halaman Menu
- Daftar menu lengkap dengan kategori:
  - Kopi (espresso, latte, manual brew, dll)
  - Non-Kopi (coklat, matcha, teh)
  - Makanan ringan / pendamping
- Setiap item: foto, nama, deskripsi singkat, harga.
- Filter kategori (opsional).

### c. Halaman Galeri / Foto
- Foto suasana warung, proses pembuatan kopi, interior, dll.
- Ditata rapi dalam grid.

### d. Halaman Kontak & Lokasi
- Alamat lengkap (kelurahan, kecamatan, Pekanbaru).
- Jam buka.
- Nomor WA / telepon.
- Google Maps embed.
- Formulir kontak / pertanyaan.

### e. Halaman Pesan Online (bisa jadi bagian dari menu atau halaman tersendiri)
- Pilih menu + jumlah.
- Masukkan nama, nomor WA, alamat (untuk delivery) atau pilih take away.
- Metode pembayaran (opsional: transfer / bayar di tempat).
- Tombol kirim pesanan ke WhatsApp atau admin.

---

## 3. Fitur Pesanan Online
- **Keranjang sederhana**: pilih menu, tambah jumlah.
- **Form pengiriman**: nama, alamat, no HP, catatan.
- **Integrasi WhatsApp**: pesanan langsung masuk ke WA admin warung.
- **Opsional**: integrasi pembayaran QRIS / transfer manual.

---

## 4. Desain & Kesan
- Tema: hangat, kopi, warna coklat/krem.
- Font mudah dibaca, mobile friendly.
- Foto-foto asli warung kalau ada.

---

## 5. Teknis Website
- **Platform**: Website statis atau WordPress? Untuk warung kecil, WordPress + plugin toko bisa lebih mudah dikelola.
- **Hosting & Domain**: domain contoh: warungkopiBang.com / kopipekanbaru.id
- **Kecepatan**: gambar dioptimalkan.
- **SEO dasar**: kata kunci "warung kopi Pekanbaru", "kopi enak Pekanbaru".

---

## 6. Konten yang Perlu Disiapkan
- Nama warung, tagline.
- Daftar menu + harga + foto tiap menu.
- Foto warung (minimal 5–10 foto).
- Alamat lengkap + titik Google Maps.
- Nomor WA untuk pesanan.
- Jam buka.

---

## 7. Langkah Pengerjaan (Roadmap)

| Tahap | Kegiatan |
|-------|----------|
| 1 | Kumpulkan konten: menu, foto, alamat, jam buka |
| 2 | Tentukan platform & desain |
| 3 | Buat struktur halaman & desain awal |
| 4 | Input konten & pasang formulir pesanan |
| 5 | Integrasi WhatsApp / Google Maps |
| 6 | Uji coba di HP & desktop |
| 7 | Publikasi + pendaftaran Google Bisnisku |
| 8 | Pemeliharaan & update menu |

---

## 8. Estimasi Biaya Awal (opsional)
- Domain: Rp100–200 ribu/tahun
- Hosting: Rp50–100 ribu/bulan (jika WordPress)
- Tema premium (opsional): Rp0–1 juta
- Total awal: bisa mulai dari Rp500 ribuan.

---

Kalau Bang sudah setuju dengan rencana ini, langkah berikutnya saya bisa bantu:
- Buat daftar menu contoh,
- Susun teks untuk website,
- Atau langsung mulai desain struktur halaman.

Mau lanjut ke mana dulu?
```


### B · gpt-6-sol  (skor 80.0)

```
Tentu. Untuk warung kopi kecil di Pekanbaru, saya sarankan mulai dari website yang sederhana, cepat dibuka di ponsel, dan mudah diperbarui.

## Rencana website

**1. Halaman depan**
- Nama warung, foto utama, jam buka, dan tombol **Lihat Menu** serta **Pesan Sekarang**
- Ringkasan menu favorit dan promo yang sedang berlaku
- Foto suasana warung dan produk
- Alamat lengkap, tautan Google Maps, dan kontak WhatsApp

**2. Halaman menu**
- Kategori seperti kopi, non-kopi, makanan, dan camilan
- Foto, nama, harga, serta keterangan singkat tiap produk
- Penanda jika produk sedang habis

**3. Pemesanan online**
Untuk tahap awal, pilihan paling praktis adalah pelanggan memilih menu di website, lalu mengirim rincian pesanan ke WhatsApp warung. Pemilik bisa mengonfirmasi ketersediaan, total harga, dan waktu pengambilan atau pengantaran. Setelah alurnya berjalan lancar, barulah dipertimbangkan pembayaran online dan pengelolaan pesanan otomatis.

**4. Formulir pesan**
Formulir terpisah untuk pertanyaan, saran, atau reservasi, berisi nama, kontak, dan pesan. Tambahkan perlindungan spam sederhana.

## Tahapan pengerjaan

1. **Siapkan bahan:** logo atau nama warung, daftar menu dan harga, foto, alamat, jam buka, nomor WhatsApp, serta area layanan pesan antar.
2. **Buat rancangan tampilan:** utamakan tampilan ponsel dan tombol pesan yang mudah ditemukan.
3. **Bangun dan isi website:** halaman depan, menu, galeri, lokasi, formulir, dan alur pemesanan.
4. **Uji sebelum tayang:** cek harga, tautan WhatsApp, formulir, peta, dan proses pesanan dari ponsel.
5. **Terbitkan dan rawat:** gunakan domain, lalu perbarui menu, harga, foto, dan jam buka saat berubah.

Agar rencananya lebih tepat, apakah pesanan online nantinya **untuk ambil di tempat saja**, atau juga **diantar**? Dan apakah warung sudah punya daftar menu beserta harganya?
```


---

## plan_vague — Plan

**Prompt:** buat website dong

*Catatan:* Harus bertanya balik (maks 3 pertanyaan), bukan menebak.


### A · deepseek-v4-pro  (skor 96.0)

```
Halo! Saya dengan senang hati akan membantu Anda membuat website. Namun, saya perlu informasi lebih detail dulu untuk bisa memberikan hasil yang sesuai dengan kebutuhan Anda. 

Berikut beberapa pertanyaan yang bisa membantu saya memahami apa yang Anda inginkan:

1. **Jenis website apa yang ingin dibuat?**  
   - Website pribadi / portofolio  
   - Website bisnis / company profile  
   - Toko online / e-commerce  
   - Blog / berita  
   - Landing page  
   - Lainnya  

2. **Fitur apa saja yang diinginkan?**  
   Contoh:  
   - Halaman kontak  
   - Formulir pendaftaran  
   - Galeri foto  
   - Integrasi media sosial  
   - Sistem login  
   - Keranjang belanja & pembayaran  
   - dsb.  

3. **Teknologi yang diinginkan?**  
   - Website statis (HTML, CSS, JavaScript)  
   - Framework seperti React, Vue, Laravel, Next.js, dsb.  
   - CMS seperti WordPress  
   - Website builder  

4. **Apakah Anda sudah punya desain atau referensi?**  
   Jika ada, Anda bisa menjelaskan atau memberikan contoh website yang Anda suka.  

5. **Apakah ini untuk produksi langsung atau hanya belajar?**  
   Ini akan memengaruhi cara saya menyusun kode dan penjelasannya.  

6. **Apakah Anda memerlukan backend/database?**  
   Jika ya, database apa yang ingin digunakan? (MySQL, MongoDB, Firebase, dll.)  

7. **Apakah Anda ingin saya memberikan kode lengkap atau hanya panduan langkah demi langkah?**  

Silakan jawab pertanyaan di atas, dan saya akan bantu buatkan website sesuai kebutuhan Anda. 😊
```


### B · gpt-6-sol  (skor 86.0)

```
Bisa! Mau website seperti apa—portofolio, toko online, company profile, atau landing page?

Kalau belum ada gambaran, kirim saja:
1. Nama website
2. Tujuan website
3. Warna atau gaya yang disukai
4. Fitur yang dibutuhkan

Nanti aku bantu buatkan kode yang siap dicoba.
```

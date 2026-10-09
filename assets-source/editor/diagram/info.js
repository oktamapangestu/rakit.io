// Jenis diagram dan penjelasannya untuk pemula (tombol ⓘ di toolbar).
export const DIAGRAM_NAMES = {
  usecase: 'Use Case', activity: 'Activity', sequence: 'Sequence', class: 'Class', state: 'State',
  erd: 'ERD', site: 'Peta halaman', flow: 'Alur data',
};
// Penjelasan tiap jenis diagram (tombol ⓘ di toolbar), untuk pemula.
export const DIAGRAM_INFO = {
  usecase: {
    what: 'Gambaran siapa saja yang memakai website (aktor) dan apa saja yang bisa mereka lakukan (use case). Diagram ini tidak membahas cara kerjanya, hanya "siapa bisa apa".',
    use: 'Mengecek apakah semua kebutuhan pengguna sudah tersedia, dan menjelaskan fitur website ke orang lain tanpa bahasa teknis.',
    read: [['Aktor (👤)', 'orang atau sistem di luar website, mis. Pengunjung, Pemilik, layanan pembayaran.'], ['Oval', 'satu hal yang bisa dilakukan, mis. "Mengirim ucapan".'], ['Kotak besar', 'batas sistem: semua yang ada di dalamnya adalah fitur websitemu.'], ['Garis', 'aktor tersebut bisa melakukan use case itu.']],
  },
  activity: {
    what: 'Alur langkah demi langkah sebuah proses, dari mulai sampai selesai — mirip diagram alir (flowchart).',
    use: 'Memahami urutan proses (mis. mengisi form sampai data tersimpan), menemukan langkah yang terlewat, dan memikirkan apa yang terjadi kalau ada yang gagal.',
    read: [['Lingkaran', 'titik mulai; lingkaran ganda = selesai.'], ['Kotak', 'satu langkah/aktivitas.'], ['Belah ketupat', 'keputusan atau kondisi (ya/tidak), tiap cabang diberi label.'], ['Panah', 'urutan langkah.']],
  },
  sequence: {
    what: 'Urutan pesan yang dikirim antarbagian sistem dari waktu ke waktu, mis. Pengunjung → Halaman → API → Database.',
    use: 'Memahami apa yang terjadi "di balik layar" saat tombol ditekan, dan mencari di bagian mana sebuah request bisa gagal.',
    read: [['Kolom (peserta)', 'pihak yang terlibat; garis putus-putus ke bawah menunjukkan waktu berjalan.'], ['Panah penuh', 'permintaan/pesan yang dikirim.'], ['Panah putus-putus', 'jawaban yang kembali.'], ['Nomor', 'urutan kejadian dari atas ke bawah.'], ['Kotak alt/opt', 'langkah yang hanya terjadi pada kondisi tertentu (mis. kalau gagal).']],
  },
  class: {
    what: 'Struktur "benda" di dalam sistem: data (atribut) dan kemampuan (method) masing-masing, serta hubungan antarbenda. Di sini biasanya berupa tabel database dan modul JavaScript.',
    use: 'Melihat rancangan program secara keseluruhan sebelum menambah fitur atau merapikan kode.',
    read: [['Kotak', 'satu class: nama di atas, atribut di tengah, method di bawah.'], ['+ / -', 'publik / privat.'], ['Garis', 'hubungan antarclass; angka/label menunjukkan jumlah atau arti hubungannya.']],
  },
  state: {
    what: 'Kondisi (status) yang bisa dialami satu objek dan apa yang membuatnya berpindah kondisi, mis. pesanan: Baru → Dibayar → Dikirim.',
    use: 'Memastikan setiap status punya jalan masuk dan keluar yang jelas, dan tidak ada status yang "macet".',
    read: [['Titik hitam', 'kondisi awal; titik dalam lingkaran = kondisi akhir.'], ['Kotak membulat', 'satu kondisi/status.'], ['Panah berlabel', 'kejadian yang memindahkan ke kondisi lain.']],
  },
  erd: {
    what: 'Entity Relationship Diagram: struktur database — tabel, kolom beserta tipenya, dan hubungan antartabel.',
    use: 'Merancang dan mengecek database: kolom apa yang dibutuhkan, dan tabel mana saling terhubung (mis. pesanan milik satu pelanggan).',
    read: [['Kotak', 'satu tabel dengan daftar kolom dan tipenya.'], ['PK', 'primary key, pengenal unik tiap baris (kolom id).'], ['FK', 'foreign key, kolom yang menunjuk ke baris di tabel lain.'], ['Ujung garis', '|| = tepat satu, o{ = nol atau banyak; mis. satu pelanggan punya banyak pesanan.']],
  },
  site: {
    what: 'Peta semua halaman website, link antarhalaman, dan file CSS/JS yang dimuat tiap halaman.',
    use: 'Melihat struktur navigasi, menemukan halaman yang tidak bisa dicapai dari mana pun, link rusak, atau file yang hilang.',
    read: [['Kotak', 'satu halaman HTML.'], ['Bentuk miring', 'file CSS/JS yang dimuat halaman.'], ['Panah', 'link dari satu halaman ke halaman lain.'], ['Garis putus-putus', 'link rusak atau file yang tidak ditemukan.']],
  },
  flow: {
    what: 'Alur data: halaman, script, atau fungsi mana yang membaca/menulis tabel mana, dan dengan operasi apa.',
    use: 'Memastikan aturan akses tabel cocok dengan pemakaiannya — request yang akan ditolak server langsung terlihat.',
    read: [['Kotak kiri', 'halaman, script, atau fungsi yang memakai data.'], ['Kotak kanan', 'tabel database atau layanan luar.'], ['Label panah', 'operasinya: baca, tambah, ubah, hapus.'], ['Garis putus-putus "ditolak"', 'request yang akan ditolak (tabel belum ada atau aksesnya belum publik).']],
  },
};

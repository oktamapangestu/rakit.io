# qjs (salinan dengan tambalan untuk rakit.io)

Salinan [github.com/fastschema/qjs](https://github.com/fastschema/qjs) v0.0.6 (lisensi MIT, lihat LICENSE),
dipakai untuk fungsi serverless pengguna (`internal/fn`). Tambalan, ditandai `rakit:` di kode:

- `Option.MemoryLimitPages`: batas keras memori WebAssembly (halaman 64 KiB). Batas memori QuickJS sendiri
  tidak menghitung semua alokasi (mis. string besar), jadi tanpa ini satu fungsi bisa memakai hingga 4 GiB.
- `Option.NoFS`: tidak memasang folder apa pun ke dalam sandbox. Versi asli selalu memasang folder kerja
  server sebagai `/`, sehingga kode JS bisa membaca/menulis file server lewat modul `std`/`os`.
- `NoStrict()`: opsi eval/compile tanpa mode strict (bawaan selalu strict), untuk memeriksa sintaks skrip
  browser klasik (`internal/jscheck`).

File test dan testdata tidak ikut disalin.

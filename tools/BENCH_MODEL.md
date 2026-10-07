# Benchmark Koding: DeepSeek V4 Pro vs V4.1 Flash

Tanggal: 2026-10-06 · Provider: `api.kelontongai.id` · Harness: `tools/bench_model.py`

## Cara menjalankan

```bash
python3 /srv/rakit/tools/bench_model.py                  # semua soal, 2 model
python3 /srv/rakit/tools/bench_model.py --only lru       # satu soal
python3 /srv/rakit/tools/bench_model.py --models deepseek-v4-pro --temperature 0.2
```

Metode: soal sama ke kedua model, temperature 0, jawaban diekstrak lalu **dites otomatis**
(penilaian objektif, bukan opini). Hasil mentah tersimpan di `tools/bench_result.json`.

## Hasil — 14 soal, 118 tes

| Metrik | deepseek-v4-pro | deepseek-v4.1-flash |
|---|---|---|
| Soal sempurna | **14/14** | **14/14** |
| Tes lulus | **118/118** | **118/118** |
| Rata-rata latensi | **~3.1 s** | ~3.2 s |
| Token output (total) | **~2.6 ribu** | ~7.5 ribu (**~2.7×**) |
| Token input (total) | ~3.3 ribu | ~1.5 ribu |

**Soal**: lru, roman, bugfix (two-sum), jsonflat, tokenbucket, dag, median (O(log)),
expr (parser), interval, wordbreak, regex_lite, calc_prec, sort_stable, iterbits.
Mencakup struktur data, algoritma, perbaikan bug, parsing, edge case halus,
dan larangan memakai builtin tertentu.

## Kesimpulan

1. **Kemampuan menulis kode yang benar: SETARA.** Pada seluruh 118 tes — termasuk
   soal sulit (mesin regex mini, evaluator unary-minus berantai, bit-count tanpa
   `bin()`) — kedua model sama-sama lulus sempurna. Tidak ada satu pun kasus di
   mana salah satu jelas lebih baik.

2. **Perbedaan nyata hanya pada verbositas.** `flash` menghasilkan kode yang sama
   benarnya tetapi **~2.7× lebih banyak token output** (docstring panjang + komentar
   per baris). `pro` lebih ringkas dan padat.

3. **Profil token berbeda.** `pro` mengirim ~2× token **input** (indikasi penalaran/
   langkah internal sebelum menjawab); `flash` langsung menjawab dengan output lebih
   panjang. Biaya efektif bergantung tarif input vs output provider.

4. **Rekomendasi untuk rakit.** Konfigurasi sekarang (`pro` utama, `flash` fallback
   & vision) sudah tepat:
   - pakai **`pro`** untuk kualitas & output ringkas (hemat token keluaran),
   - pakai **`flash`** sebagai fallback saat `pro` kena 429/503, dan untuk vision —
     verbositasnya tidak masalah karena hanya dipakai saat perlu.

## Catatan kejujuran

- Ini menguji **tulis kode dari deskripsi** pada **14 soal**. Bukan klaim umum
  "X lebih pintar". Untuk tugas lain (debugging repo besar, refactor multi-file,
  menaati format output ketat), hasil bisa berbeda — jalankan harness dengan soal
  baru untuk mengujinya.
- ID model (`deepseek-v4-pro`, `deepseek-v4.1-flash`) adalah penamaan **provider**
  `api.kelontongai.id`, bukan nama resmi DeepSeek publik.
- Satu-satunya kegagalan di iterasi pertama (`jsonflat`, `flatten({})` → `{'': {}}`)
  ternyata **soal awal yang ambigu**, dan kedua model membuat bug yang sama;
  setelah soal dipertegas, keduanya lulus. Ini justru menunjukkan keduanya
  menafsirkan spesifikasi longgar dengan cara yang sama.

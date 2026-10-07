# Uji A/B: antislop-code — Apakah Benar Mengurangi Komentar Slop?

Tanggal: 2026-10-07 · Skrip: `tools/uji_antislop.py`, `tools/uji_antislop2.py`
Model: deepseek-v4-pro, deepseek-v4.1-flash · 3 tugas × 2 kondisi × 3 sampel × 2 model = 36 sampel

## Statistik (36 sampel)

| Metrik | A (tanpa) | B (dengan antislop) | Arah |
|---|---|---|---|
| Rata-rata jenis pola slop | 0.17 | 0.11 | B sedikit lebih baik |
| Rata-rata jumlah komentar | 5.3 | 3.1 | B **-42%** (lebih ringkas) |
| Rata-rata komentar bisnis/berguna | 0.39 | 0.5 | B sedikit naik |
| Rata-rata token output | 598 | 486 | B **-19%** (lebih hemat) |
| Sampel yang mengandung slop | 11% | 11% | seri |

Jenis slop yang muncul:
- A: banner pemisah (2), restating obvious (1)
- B: restating obvious (2)

## Temuan kualitatif (contoh nyata, tugas `pesan.js`)
- **A** memakai banner `// --- Validasi ---`, `// --- Jika offline ---` (pola slop yang dilarang).
- **B** tidak memakai banner; komentarnya menjelaskan *mengapa* (asumsi, edge case, persistensi).

## Kesimpulan jujur
1. **Efeknya nyata tapi HALUS, bukan dramatis.** Komentar turun 42% dan output 19% lebih hemat — itu bagus untuk biaya.
2. **Uji 1 sampel pertama menyesatkan** — di sana B justru tampak lebih buruk. Dengan 36 sampel, gambaran sebenarnya jauh lebih seimbang.
3. **Model dasar sudah cukup bersih** — hanya 11% sampel yang mengandung pola slop, di kedua kondisi. Jadi anti-slop "memperbaiki" masalah yang di model ini jarang muncul.
4. **Kualitas kode BUKAN lebih buruk** — B bahkan lebih disiplin soal banner.
5. **Biaya:** aturan ini 8,9 KB (~2.400 token input) dibayar di SETIAP request. Penghematan output (±110 token) jauh lebih kecil dari biaya input tetapnya → **secara ekonomi merugi** bila dipasang permanen.

## Rekomendasi
- **Jangan pasang `antislop-code` utuh** di prompt produksi rakit — biaya input tetap > penghematan output.
- **Ekstrak 5-6 aturan inti** (larangan banner `// ---`, narasi langkah, label kosong, restating) ke dalam prompt builder yang sudah ada. Itu ~150 token, bukan 2.400.
- Fokus nilai anti-slop ada di **UI/copywriting** (`antislop-ui`, `antislop-copywriting`), bukan di komentar kode, karena model dasar sudah lumayan bersih untuk kode.

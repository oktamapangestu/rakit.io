# Performa `gpt-6-luna` vs `gpt-5.6-luna` (koding)

Tanggal: 2026-10-07 · Provider: `api.kelontongai.id` · Harness: `tools/bench_model.py`
Metode: 14 soal (10 umum + 4 keras), 118 tes otomatis, temperature 0. Data: `bench_luna.json`.

## Hasil

| Model | Soal sempurna | Tes | Latensi rata² | Token out rata² | Vision | Reasoning |
|---|---|---|---|---|---|---|
| **gpt-6-luna** | **14/14** | **118/118** | **8.7 s** | **251** | ✅ | ✅ |
| **gpt-5.6-luna** | **14/14** | **118/118** | 7.8 s | 560 | ✅ | ✅ |

## Perbandingan dengan model lain (10 soal umum)

| Model | Soal | Tes | Latensi | Token out | Catatan |
|---|---|---|---|---|---|
| claude-sonnet-5.5 | 10/10 | 79/79 | **3.3 s** | 482 | tercepat |
| deepseek-v4.1-flash | 10/10 | 79/79 | 3.5 s | 645 | |
| gemini-3.7-flash | 10/10 | 79/79 | 4.2 s | 679 | |
| deepseek-v4-pro | 9/10 | 77/79 | 4.4 s | 380 | 1 anomali |
| gpt-6.1-sol | 10/10 | 79/79 | 5.0 s | **233** | paling hemat |
| **gpt-5.6-luna** | **10/10** | **79/79** | 7.8 s | 560 | |
| **gpt-6-luna** | **10/10** | **79/79** | 8.7 s | 251 | |

## Temuan

1. **Kualitas: keduanya SEMPURNA (14/14, 118/118).** Terminal soal mudah, sedang,
   maupun keras (mesin regex mini, evaluator unary-minus berantai, bit-count tanpa `bin()`).
   Tidak ada satu pun kegagalan.

2. **Keduanya LAMBAT.** ~8 s rata-rata, **2.4× lebih lambat dari claude-sonnet-5.5** (3.3 s).
   Soal `roman` konsisten 9–24 s (diuji ulang 2×, tetap lambat). Sebab: keduanya punya
   **`reasoning=True`** — model "berpikir" dulu sebelum menjawab, memakan waktu.

3. **`gpt-6-luna` lebih hemat token** (251 vs 560, ~2.2× lebih ringkas) dengan kualitas sama.
   Bahkan lebih hemat dari claude-sonnet-5.5 (482), mendekati gpt-6.1-sol (233).

4. **`gpt-5.6-luna` lebih verbose** (560 token) — mirip deepseek-v4.1-flash (645).

5. **Keduanya punya vision + reasoning** — kombinasi langka (mayoritas model lain
   di provider ini `reasoning=False`). Menarik untuk tugas yang butuh analisis gambar.

## Kesimpulan & rekomendasi

- **Kualitas: aman** — keduanya 100% benar pada semua yang diuji.
- **Kelemahan utama: lambat.** Karena mode reasoning, ~8 s/request. Untuk editor
  interaktif (user menunggu), ini terasa.
- **Pilihan di antara keduanya:**
  - **`gpt-6-luna`** → unggul: lebih ringkas (251 tok), lebih cepat sedikit (8.7 vs 7.8 — praktis
    sama), kualitas sama. **Pilih ini** bila butuh Luna.
  - `gpt-5.6-luna` → hanya bila ingin output lebih detail/verbose.
- **Dibanding pemimpin:** untuk produksi rakit, **claude-sonnet-5.5** (3.3 s, 100%) masih
  lebih baik sebagai utama; **gpt-6-luna** bisa jadi cadangan beralasan (hemat token +
  punya reasoning/vision), tapi jangan sebagai utama karena latensi.

## Catatan kejujuran
- 14 soal tulis-kode dari deskripsi; tugas lain (debugging repo besar, tool-calling)
  bisa beda peringkat.
- Latensi = waktu tunggu API provider, bisa berubah tergantung beban server.
- ID model = penamaan provider, bukan nama resmi vendor.

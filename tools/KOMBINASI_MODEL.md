# Analisis Kombinasi Model Optimal — rakit.io

Tanggal: 2026-10-06 · Provider: `api.kelontongai.id` (34 model) · Harness: `tools/bench_model.py`

## Metode

- **Uji kandidat**: 16 model hidup (2 mati: `mimo-v2.6-pro`, `minimax-m3` — token habis).
- **Kualitas kode**: 14 soal tulis-kode dari deskripsi, 118 tes otomatis, temperature 0.
- **Latensi & token**: rata-rata per soal.
- **Kepatuhan format**: minta output JSON ketat (seperti parser operasi-file rakit).
- Semua penilaian objektif (tes dijalankan, bukan opini). Data: `bench_all.jsonl`, `bench_result.json`.

## Hasil (soal koding: SEMUA model ~100% lulus)

Kualitas dasar menulis kode **tidak lagi membedakan** model di kelas ini. Pembeda = latensi,
verbositas token, kepatuhan format, dan keandalan.

| Model | Kualitas | Latensi | Token out | Format JSON | Error |
|---|---|---|---|---|---|
| **claude-sonnet-5.5** | 100% | **3.3 s** | 482 | fence+`<think>` | 0 |
| **claude-opus-5.5** | 100% | 3.4 s | 329 | **GAGAL total** | 0 |
| **deepseek-v4.1-flash** | 100% | 3.5 s | 645 | **lulus** | 0 |
| gemini-3.7-flash | 100% | 4.2 s | 679 | **lulus** | 0 |
| deepseek-v4-pro | 97.5% | 4.4 s | 380 | **lulus** | 0 |
| **gpt-6.1-sol** | 100% | 5.0 s | **233** | fence | 0 |
| gpt-5.6-sol | 100% | 6.4 s | 330 | — | 0 |
| gpt-6-astra | 100% | 6.6 s | 240 | lulus(fence) | 0 |
| kimi-k2.7-code | 100% | 9.1 s | 728 | — | 0 |
| gemini-3.1-pro | 100% | 22.8 s | 2878 | — | 0 |
| glm-5.3-flash | 100% | 25.8 s | 1593 | — | 1 |
| kimi-k3 | 100% | 31.2 s | 811 | — | 0 |
| glm-5.3 | 100% | 36.7 s | 1537 | — | 2 |
| qwen3.8-max | 97.4% | 12.7 s | 1243 | — | 0 |
| hy4 / atria-dawn | 100% | 31–46 s | — | — | **5–7** |

## Temuan kunci

1. **Tidak ada satu model yang menang di semua aspek.**
   - Claude = tercepat + kualitas terbaik, TAPI paling buruk menaati format ketat
     (`claude-opus-5.5` bahkan mengabaikan instruksi JSON sepenuhnya).
   - DeepSeek = paling patuh format, TAPI `pro` pernah gagal 1 soal (konsistensi).
   - gpt-6.1-sol = paling hemat token, TAPI lebih lambat + pakai fence.

2. **Verbositas (token out) tidak berkorelasi dengan kualitas.** Semua 100%, tapi token
   berbeda hingga **12×** (`gpt-6.1-sol` 233 vs `gemini-3.1-pro` 2878). Untuk biaya, ini
   yang paling menentukan.

3. **Model "mahal" justru buruk untuk peran ini.** `gemini-3.1-pro` (22.8 s, 2878 tok),
   `glm-5.3` (36.7 s + error), `hy4` (46 s, 7 error) — lambat dan/atau tidak andal.

4. **`deepseek-v4-pro` sedikit kurang tahan server sibuk.** Saat 6 request paralel, ia gagal
   1 soal; diuji ulang sendirian, 3/3 sempurna. Anomali, bukan kelemahan mendasar.

## Rekomendasi kombinasi

### Opsi 1 — Kualitas maksimal (rekomendasi utama)
```
utama   : claude-sonnet-5.5     # tercepat (3.3s), 100%, hemat
fallback: deepseek-v4-pro       # patuh format, ringkas, kebal rate-limit
vision  : gemini-3.7-flash      # patuh format + vision + cepat 4.2s
```
Alasan: kualitas kode terbaik + format-aman untuk fallback/vision. Prefiks
`<think>`/fence dari Claude perlu dibersihkan parser (sudah ada pola di harness).

### Opsi 2 — Patuh-format & seimbang (paling aman untuk rakit)
```
utama   : deepseek-v4-pro       # patuh JSON, ringkas, stabil
fallback: claude-sonnet-5.5     # cadangan kualitas terbaik
vision  : deepseek-v4.1-flash   # tetap DeepSeek, vision ok
```
Alasan: minim perubahan dari konfigurasi sekarang; format paling bisa diandalkan parser.

### Opsi 3 — Paling hemat token
```
utama   : gpt-6.1-sol           # 233 token (paling hemat) + 100%
fallback: deepseek-v4-pro
vision  : gpt-6-astra           # 240 token
```
Alasan: biaya token keluaran paling rendah bila tarif output mahal.

## Catatan kejujuran

- Kualitas di sini = **tulis kode dari deskripsi pendek**. Tugas lain (debugging repo besar,
  refactor multi-file, tool-calling) bisa memberi peringkat berbeda — uji dengan harness.
- ID model = penamaan **provider**, bukan nama resmi vendor.
- Benchmark paralel 6-worker sempat kena 502/timeout (rate limit); metrik diambil dari
  permintaan yang berhasil. Untuk produksi, jaga `AI_MAX_CONCURRENT` agar tak kena limit.
- Kepatuhan format diuji dengan 1 skema JSON; skema lain bisa beda hasil.

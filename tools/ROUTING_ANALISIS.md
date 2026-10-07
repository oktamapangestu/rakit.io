# Strategi Routing Model berdasarkan Kerumitan — Analisis Biaya Nyata

Tanggal: 2026-10-07 · Basis: data nyata 1.511 request di `rakit.data.rakit.db`

## Pertanyaan
Prompt dinilai level kerumitannya → tiap level ditangani AI berbeda. Bagus?

## Jawaban: arahnya benar, tapi untuk tujuan "HEMAT BIAYA" ini SALAH SASARAN.

## Data nyata (1.511 request)

| Metrik | Nilai |
|---|---|
| Total input token | **68.094.186** (68,1 juta) |
| Total output token | 8.354.496 (8,4 juta) |
| **Porsi INPUT dari total biaya** | **89,1%** |
| Rata-rata input / request | **45.066** token |
| Rata-rata output / request | 5.529 token |
| Rasio input:output | **8,2×** |

Per aksi:
| aksi | n | avg input | avg output |
|---|---|---|---|
| (kosong/lama) | 1464 | 44.229 | 5.317 |
| build | 40 | **80.663** | 13.552 |
| plan | 4 | 20.575 | 6.976 |
| diagram | 3 | 11.434 | 233 |

## Mengapa routing model TIDAK menghemat banyak

Routing mengubah **model** → mengubah **output** (dan tarif). Tapi output hanya **10,9%** dari biaya.

- Output diganti model 2× lebih hemat → hemat **5,5%** total. **Kecil.**
- Input dipangkas 50% → hemat **44,5%** total. **Besar.**

>>> **Penghematan sesungguhnya ada di INPUT, bukan output.**

## Dari mana 45.000 token input berasal (dari kode `src/ai.js`)

| Konstanta | Nilai | ≈ token |
|---|---|---|
| `MAX_CONTEXT_CHARS` | **200.000** karakter | **≈50.000** ← sumber utama |
| `MAX_HISTORY_TOTAL` | 40.000 | ≈10.000 |
| `MAX_PROMPT_CHARS` | 20.000 | ≈5.000 |
| `MAX_HISTORY` | 10 pesan | — |

`MAX_CONTEXT_CHARS = 200.000` = **seluruh isi project dikirim tiap request.** Inilah 45rb token itu.

## Jev: TIDAK tersedia di provider

Dicek 34 model `api.kelontongai.id` → **tidak ada** `jev`/`route`/`judge`/`classif`.
Jev (TypeSafe AI) = layanan terpisah, early access, waitlist. Tidak bisa dipakai di sini tanpa integrasi API baru + biaya tambahan.

## Rekomendasi (berdasarkan urutan dampak)

### 1. PALING BESAR: Kurangi `MAX_CONTEXT_CHARS` (hemat ~44%)
Seluruh project 200rb karakter dikirim, padahal biasanya model hanya butuh
**file yang relevan**. Kirim hanya file terkait (yang disebut/diubah) + ringkasan sisanya.
- Dampak: **~30–50% biaya total**
- Risiko: model bisa kurang konteks → mitigasi: sertakan daftar file + isi file terkait saja

### 2. Prompt caching (bila provider mendukung)
Konteks project yang sama diulang-ulang → cache = bayar sekali, bukan tiap request.
- Dampak: bisa **sangat besar** untuk konteks 45rb yang berulang

### 3. Routing berdasarkan AKSI (gratis, tanpa penilai)
`plan` (20rb in) vs `build` (80rb in) sudah berbeda 4×.
- `plan`/chat → model murah (rate lebih rendah)
- `build` → model terbaik
- **Tidak perlu penilai Jev**, cukup dari `mode` yang sudah ada di kode

### 4. Routing berdasarkan KERUMITAN (yang kamu usulkan)
- Hanya menyentuh **~11% biaya** (output)
- Butuh penilai (biaya/latensi tambahan) — Jev tidak ada
- **Tidak direkomendasikan sebagai strategi utama** untuk tujuan hemat

## Kesimpulan jujur
Ide "nilai kerumitan → pilih AI" **masuk akal secara konsep**, TAPI:
- Tujuanmu **hemat biaya** → sasaran salah (output cuma 11%)
- Model di providermu **semua 100% benar** (benchmark) → tak ada kualitas untuk ditingkatkan
- **Penghematan 4× lebih besar** ada di memangkas **INPUT (konteks project)**

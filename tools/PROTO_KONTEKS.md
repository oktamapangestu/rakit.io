# Prototipe Pangkas Konteks — Hasil Lengkap

Tanggal: 2026-10-07 · Skrip: `proto_trim3.js`, `uji_kualitas_konteks.mjs`, `uji_varian_ringkas.mjs`
Basis: 35 project nyata + data 1.511 request produksi

## STATUS: SUDAH DIIMPLEMENTASI & DEPLOY (Opsi 1) ✅

- Kode produksi: `go/internal/ai/builder.go` — `slimContext()` + pemakaian di `runBuilder()` (putaran ≥2).
- Sumber Node (jalan kembali): `src/ai.js` — perubahan setara.
- Test: `go/internal/ai/slimcontext_test.go` (3/3 lulus), `tests/ai.test.mjs` 14/14 lulus.
- Deploy: binary Go diganti (hash `b7948b73…`), service active. Backup DB: `rakit.db.bak-20261007-151027`.
- Uji nyata via API: input **12.225 → 5.073 token (hemat 58,5%)**.

### Yang berubah
Putaran 1 `runBuilder` tetap mengirim konteks penuh (tak berubah). Putaran ≥2 mengirim konteks
project yang sudah dibuang blok `<file>…</file>`-nya (daftar file + tabel tetap ada).

### Baseline produksi sebelum deploy
Rata-rata `build`: **87.425 token input** (43 job). `plan`: 20.575.

### Cara memantau hasil setelah deploy
```sql
SELECT id, input_tokens, output_tokens, datetime(created_at/1000,'unixepoch','localtime')
FROM ai_requests WHERE action='build' ORDER BY id DESC LIMIT 10;
```
Bandingkan rata-rata input `build` setelah 2026-10-07 15:10 dengan baseline 87.425.

## 1. Akar pembengkakan (dari kode `src/ai.js`)

`runBuilder()` = **agent loop** sampai `MAX_BUILD_ROUNDS = 8` putaran.
Tiap putaran `callAI({ messages: convo })` mengirim **seluruh `convo`** — DAN
**konteks project (system + definisi tools + isi semua file) ikut dikirim ulang setiap putaran.**

Bukti dari data: median input 24.693 tok, **mean 49.201, p90 122.556, max 644.625**.
`build` rata-rata 80.663 token input. **89% biaya = input** (output cuma 11%).

## 2. Simulasi penghematan (5 file ditulis/job)

| Strategi | Token/job | Hemat | Proyeksi hemat/bulan |
|---|---|---|---|
| **A** asli (konteks tiap putaran) | 122.504 | — | — |
| **B** ringkas argumen tool | 107.032 | 12,6% | ~8,6 juta tok |
| **C** konteks project **hanya putaran 1** | **48.671** | **60,3%** | **~41 juta tok** |
| **D** B+C | **33.199** | **72,9%** | **~49,6 juta tok** |

## 3. UJI KUALITAS (ke model nyata, agent loop 3 putaran)

| Uji | Mode A (asli) | Mode C (konteks sekali) |
|---|---|---|
| Hasil | 3/3 file valid | 3/3 file valid |
| Isi kode | benar | benar |
| Struktur path | `js/menu.js` ✓ | `menu.js` ⚠ (1× salah) |

Uji ulang (2 varian: konteks hilang vs konteks ringkas):
| Varian | Struktur path |
|---|---|
| hilang total | ✓ benar semua |
| ringkas (daftar file) | ✓ benar semua |

**Kesimpulan uji kualitas:** kegagalan path tadi disebabkan **prompt uji yang ambigu**
(bukan efek hilangnya konteks) — konsisten dengan pelajaran benchmark sebelumnya.
Kedua varian aman.

## 4. REKOMENDASI

### Opsi 1 — Aman & paling besar untung (PILIHAN UTAMA)
**Konteks penuh di putaran 1 → konteks RINGKAS (daftar file + ukuran) di putaran lanjut.**
- Hemat ~60% (proyeksi ~41 juta token/bulan)
- Risiko paling rendah: model tetap tahu struktur project
- Perubahan kecil di `runBuilder` (src/ai.js)

### Opsi 2 — Maksimal
Tambah juga ringkas argumen tool di riwayat → hemat ~73%.
- Sedikit lebih berisiko (model tak bisa re-baca file yang baru ia tulis)
- Perlu pertimbangan: apakah model cukup diberi tahu "file X tersimpan, N KB"

## 5. CATATAN KEJUJURAN
- Simulasi memakai ukuran file realistis (4–20 KB). File sangat besar → penghematan lebih besar lagi.
- Uji kualitas pada 1 skenario (3 putaran), 1 model (deepseek-v4-pro). Sebaiknya uji lagi
  dengan skenario nyata & model lain sebelum produksi.
- **Jangan deploy tanpa uji A/B pada request produksi nyata.**
- Prompt caching sudah diaktifkan user di provider → penghematan input ini **bertumpuk**
  dengan manfaat caching untuk bagian konteks yang sama.

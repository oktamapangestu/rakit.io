# #1 & #3: Pemeriksa Kualitas Deterministik + Aturan Liveliness

Tanggal: 2026-10-08

## #1 — Pemeriksa kontras & tautan mati (DETERMINISTIK)
`go/internal/ai/htmlquality.go`, disambung ke `stageToolCall` di `builder.go` (pola sama seperti `apiPathProblems`).

Saat AI menulis file `.html`, hasilnya diperiksa otomatis:
- `deadLinkProblems`: `<a href="#">` dan anchor ke id yang tidak ada.
- `contrastProblems`: pasangan color/background-color di bawah 4.5:1 (WCAG AA).

Kalau ada masalah, balikan ke AI: *"Ditulis, TAPI ada masalah kualitas di ... Perbaiki lalu panggil write_file lagi."*
→ AI dipaksa memperbaiki. Ini TIDAK bergantung pada kepatuhan model.

Akurasi rasio kontras diverifikasi sama dengan `skills/antislop-human/contrast-check.py`:
`#555555/#000000 = 2.82:1`, `#ffffff/#1a1a1a = 17.40:1`, `#777777/#ffffff = 4.48:1` (semua cocok).

Bukti pada sampel nyata: 3 masalah terdeteksi (2 link mati, 1 anchor menggantung, 1 kontras rendah) —
semuanya lolos dari aturan prompt.

## #2 — Aturan link berbasis prompt: GAGAL (kali ketiga)
Uji 3 tugas x 4 sampel x 2 kondisi. `href="#"` malah NAIK 2.42 → 4.92; tidak ada "Coming soon" yang dipakai.
**Kesimpulan: prompt tidak bisa menghentikan href="#". Deterministik (#1) adalah jawabannya.**

## #3 — Liveliness (arahan positif)
Ditambahkan ke BUILD_PROMPT: set arah 1 baris, satu focal point per layar, hierarki kontras, satu warna
aksen, whitespace sebagai struktur, dan fallback "sederhana & jujur" bila user tak memberi arah.
Ini mengatasi masalah "slop dibuang -> output jadi kosong/generik".

## Biaya
Prompt builder: 2.041 → 3.282 char (+1.241 char ≈ +310 token). Masih jauh di bawah anti-slop penuh (2.400 token).
Pemeriksa Go: tanpa biaya token sama sekali (berjalan lokal, deterministik).

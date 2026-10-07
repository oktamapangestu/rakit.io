# Uji Aturan Anti-Slop RINGAN di prompt builder rakit

Tanggal: 2026-10-07 · Skrip: `tools/uji_antislop_ringan.py`
Aturan disisipkan ke `BUILD_PROMPT` (src/ai.js), di-generate ke `prompts.go`.
Ukuran: prompt builder **2.041 → 2.763 char (+722 char ≈ +180 token)** vs anti-slop penuh 8.944 char (~2.400 token).

## Metode
3 tugas (landing/toko/filler) × 2 kondisi (lama/baru) × 2 sampel = 12 sampel, model deepseek-v4-pro.

## Hasil
| Pola terdeteksi | Lama | Baru | Arah |
|---|---|---|---|
| angka/statistik palsu | 3 | 2.67 | sedikit turun |
| bintang dekoratif ★ | 2.83 | 0 | **hilang total** |
| emoji dekoratif | 5.17 | 3.67 | turun |
| testimoni | 7.17 | 7.33 | seri |
| tombol/tautan mati | 0.33 | 0.83 | **naik** (aturan diabaikan) |
| token output | 1918.5 | 1983.67 | naik (varians) |

## Temuan kualitatif
- Bintang dekoratif (★★★★★) **hilang** di kondisi baru — aturan bekerja.
- Namun pada satu sampel, output tetap punya **16 <a href="#">** tanpa aksi — aturan "no dead link" **diabaikan model**.
- Varians antar-sampel sangat tinggi (output 4 KB s/d 15 KB), jadi 12 sampel belum cukup untuk klaim kuat.

## Kesimpulan jujur
1. **Efeknya sebagian & tidak konsisten.** Bintang & emoji membaik; link mati & angka palsu tidak.
2. **Biaya murah (+180 token)** — jauh lebih rasional daripada anti-slop penuh (2.400 token) yang terbukti merugi.
3. Aturan teks saja **tidak cukup menjamin kepatuhan**; untuk hal seperti link mati, model sering mengabaikan instruksi negatif panjang.


---

## UJI ULANG: aturan link DIPERKUAT (2026-10-07)

Setelah aturan link dibuat lebih tegas & positif ("Every link must point to something real...
NEVER use href='#' as a placeholder"), diuji ulang: 2 tugas × 2 kondisi × 4 sampel = 16 sampel.

| Pola | Lama | Baru (diperkuat) | Arah |
|---|---|---|---|
| **href="#" mati** | 7.5 | 7.62 | **NAIK — aturan diabaikan** |
| anchor valid (#fitur) | 3.62 | 2.62 | turun |
| angka palsu | 2.75 | 1.75 | turun (ini tetap membaik) |
| bintang dekoratif | 0 | 0 | seri (sudah 0) |
| token output | 3274.12 | 2969.12 | turun |

**Bukti langsung:** pada satu sampel kondisi baru dengan aturan tergas sekalipun, output tetap
memuat **8 `<a href="#">`**. Aturan teks tidak dipatuhi untuk pola ini.

### Kesimpulan akhir (jujur)
1. **Aturan prompt-only GAGAL untuk link mati.** Memperkuat kalimatnya tidak menolong — malah sedikit naik.
   Model cenderung memakai `href="#"` sebagai cara aman mengisi tautan nav/footer.
2. **Yang BERHASIL:** larangan larangan angka palsu (turun 2,75→1,75) & bintang/emoji dekoratif.
3. **Cara yang benar untuk link mati bukan di prompt**, melainkan **pasca-proses**: setelah file ditulis,
   deteksi `href="#"` dan (a) ubah ke anchor seksi yang ada, atau (b) tandai untuk pengguna.
   Ini deterministik dan tidak bergantung kepatuhan model.
4. Biaya aturan tetap murah (+200-300 token), jadi tidak masalah dipertahankan; tapi jangan berharap
   ia menyelesaikan masalah link mati.

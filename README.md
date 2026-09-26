# rakit.icu

Editor kode online ala VS Code (Monaco) dengan live preview. Setiap user yang mendaftar
otomatis mendapat website di `https://<username>.rakit.icu`. Hanya file **.html, .css, .js**.

## Jalankan lokal

```bash
npm install
cp .env.example .env
npm run dev
```

- Aplikasi: http://localhost:3000
- Website user: http://<username>.localhost:3000
  (Chrome & Firefox otomatis mengarahkan `*.localhost` ke 127.0.0.1. Safari tidak — pakai Chrome.)

Butuh Node.js ≥ 22.13 (memakai SQLite bawaan `node:sqlite`).

## Struktur

```
src/
  server.js    routing berdasarkan host: rakit.icu -> aplikasi, <user>.rakit.icu -> website user
  api.js       REST API: register/login/logout/me + CRUD file
  auth.js      hash password (scrypt), sesi di SQLite, cek Origin (anti-CSRF), rate limit
  files.js     penyimpanan file per user di disk, validasi path, kuota
  sites.js     menyajikan website user (index.html, URL bersih, 404.html kustom, ETag)
  ai.js        asisten AI: konteks proyek, panggilan ke provider AI
  credits.js   kredit AI: jatah gratis bulanan + saldo yang dibeli
  billing.js   isi ulang kredit via QRIS (Kasera Pay) + webhook
  userdb.js    database per proyek (SQLite), validasi & aturan akses
  database.js  API editor database (khusus pemilik)
  siteapi.js   API publik /api/db/* di domain user
  admin.js     dashboard pemilik: statistik platform (khusus ADMIN_EMAILS)
  aiqueue.js   antrean & batas concurrency adaptif untuk panggilan ke provider AI
  aiapply.js   menerapkan & membatalkan perubahan Builder di server (dengan snapshot)
  db.js        skema SQLite
public/        landing page + editor (Monaco dari CDN jsDelivr)
templates/     file awal untuk user baru
data/          database & file user (dibuat otomatis, jangan di-commit)
```

## Asisten AI

Panel AI di editor (tombol **✦ AI** atau `Ctrl/⌘+I`) membuat/mengubah kode lewat provider AI
yang kompatibel dengan API chat completions OpenAI. AI membaca semua file proyek, lalu mengusulkan
perubahan yang bisa dilihat (diff) sebelum diterapkan, dan bisa dibatalkan setelahnya.

Konfigurasi di `.env`:

| Variabel | Default | Keterangan |
|---|---|---|
| `AI_BASE_URL` | — | Wajib. Contoh: `https://api.kelontongai.id/v1` |
| `AI_API_KEY` | — | Wajib. Tanpa ini fitur AI nonaktif. |
| `AI_MODEL` | `deepseek-v4-pro` | Nama model di provider. |
| `AI_MAX_TOKENS` | `64000` | Batas token output per putaran AI (termasuk token "berpikir" model reasoning). |
| `AI_MAX_CONCURRENT` | `4` | Maks. panggilan ke provider yang berjalan bersamaan (lihat Antrean AI). |
| `AI_QUEUE_MAX` | `30` | Panjang antrean maksimal; lebih dari ini ditolak dengan pesan "AI sedang penuh". |
| `AI_QUEUE_TIMEOUT_S` | `120` | Batas menunggu di antrean (detik). |
| `AI_DEBUG` | — | Isi `1` untuk mencetak jawaban mentah AI ke log (berisi kode user — jangan di production). |
| `AI_MONTHLY_CREDITS` | `30` | Kredit gratis per user per bulan (reset tanggal 1, UTC). |
| `AI_CREDITS_PER_PROMPT` | `1` | Kredit yang dipakai per prompt. |

- Mode **Builder** memakai *tool calling* (`write_file`, `delete_file`, `create_table`); server memvalidasi setiap
  panggilan dan memeriksa alamat `/api/db/...` di kode sebelum hasilnya dikirim ke editor. Mode **Plan** hanya teks.
- **Antrean AI:** panggilan ke provider dibatasi `AI_MAX_CONCURRENT`; sisanya menunggu urut (FIFO) dan panel AI
  menampilkan posisinya. Bila provider tetap menolak (429/503), server mencoba lagi sampai 3 kali (mengikuti
  `Retry-After`) dan **menurunkan batasnya sendiri**, lalu menaikkannya lagi perlahan setelah 20 panggilan lancar —
  jadi antrean menyesuaikan diri dengan batas provider tanpa perlu tahu angkanya. Antrean penuh, terlalu lama,
  atau dihentikan user → kredit dikembalikan. Statistiknya ada di dashboard pemilik. Antrean disimpan di memori
  (satu proses server); bila nanti memakai beberapa server, pindahkan ke Redis.
- **Riwayat & job:** percakapan AI disimpan di server (tabel `ai_threads`/`ai_messages`) dan muncul lagi saat editor
  dibuka; ada daftar percakapan, percakapan baru, dan hapus semua riwayat. Setiap prompt berjalan sebagai job di
  server — refresh atau tutup tab tidak membatalkannya; editor menyambung lagi ke progresnya. Perubahan Builder
  diterapkan server beserta snapshot, jadi Simpan/Batalkan tetap bisa setelah refresh. Job yang terputus karena
  server restart ditandai gagal dan kreditnya dikembalikan. Riwayat disimpan maks. 50 percakapan per user dan
  dihapus otomatis setelah 90 hari tidak dipakai.
- Kredit dipotong di awal dan **dikembalikan** kalau request gagal, dihentikan, atau ditolak.
- Setiap request dicatat di tabel `ai_requests` (token input/output) untuk memantau biaya:
  ```sql
  SELECT substr(datetime(created_at/1000,'unixepoch'),1,7) AS bulan,
         COUNT(*), SUM(input_tokens), SUM(output_tokens)
  FROM ai_requests WHERE status = 'ok' GROUP BY bulan;
  ```

## Isi ulang kredit (QRIS via Kasera Pay)

Kalau kredit habis, user bisa membeli paket kredit dan membayar dengan QRIS langsung dari editor.
Kredit yang dibeli tidak hangus dan dipakai setelah kredit gratis bulanan habis.

| Variabel | Keterangan |
|---|---|
| `KASERA_API_KEY` | Dari dashboard Kasera → Developer. `kp_test_...` untuk uji coba, `kp_live_...` untuk produksi. Tanpa ini fitur isi ulang nonaktif. |
| `KASERA_WEBHOOK_SECRET` | Signing secret endpoint webhook di dashboard Kasera. |
| `CREDIT_PACKAGES` | Paket `kredit:harga`, dipisah koma. Default `20:10000,50:20000,150:50000`. |

Di dashboard Kasera, daftarkan URL webhook: `https://rakit.icu/api/billing/webhook`.

- Kredit ditambahkan saat webhook `payment.paid` masuk (tanda tangan `Kasera-Signature-V1` diverifikasi,
  nominal dicocokkan). Selama modal pembayaran terbuka, status juga dicek langsung ke API Kasera, jadi
  tetap berfungsi di localhost tanpa webhook.
- Setiap pembayaran hanya menambah kredit sekali, walaupun webhook terkirim berulang.
- Riwayat pembayaran ada di tabel `payments`.

## Database proyek

Setiap proyek punya database sendiri (satu file SQLite di `data/db/<username>.db`) yang dikelola lewat
mode **Data** di editor: buat tabel, atur kolom, dan lihat/ubah isi seperti spreadsheet.

Website user memakainya lewat API otomatis di domainnya sendiri:

| Request | Fungsi |
|---|---|
| `GET /api/db/<tabel>?sort=-created_at&limit=20&offset=0&<kolom>=<nilai>` | daftar baris → `{ rows, total }` |
| `GET /api/db/<tabel>/<id>` | satu baris |
| `POST /api/db/<tabel>` | tambah baris (body JSON) |
| `PATCH /api/db/<tabel>/<id>` | ubah baris |
| `DELETE /api/db/<tabel>/<id>` | hapus baris |

- Setiap operasi per tabel diatur **Publik** atau **Hanya pemilik** (default: semua hanya pemilik).
- Kolom **privat** tidak pernah dikirim lewat API publik.
- Tipe kolom: teks, angka, ya/tidak, tanggal. Kolom `id` dan `created_at` otomatis.
- Batas per proyek: 10 MB, 20 tabel, 30 kolom per tabel (`DB_LIMITS` di `src/userdb.js`).
- Rate limit API publik per situs per IP: 300 baca dan 60 tulis per menit.
- Path `/api/` di domain user dicadangkan untuk sistem.
- Di mode Builder, AI bisa membuat tabel sendiri; perubahannya ikut dikonfirmasi (Simpan/Batalkan).

## Dashboard pemilik

`https://rakit.icu/admin` menampilkan statistik platform: pengguna, pendapatan, request AI (termasuk
yang gagal per status dan pemakaian token), kredit terjual, pengguna paling aktif, transaksi dan
pendaftar terbaru, serta ukuran penyimpanan. Periode bisa dipilih 7/30/90 hari (waktu WIB).

Hanya akun dengan email di `ADMIN_EMAILS` (dipisah koma) yang bisa membukanya; link-nya muncul di
menu avatar editor. Pengguna lain diarahkan kembali ke editor, dan API `/api/admin/*` menolak dengan 403.

## Batasan (ubah di `src/files.js` → `LIMITS`)

- 512 KB per file, 20 MB & 500 file/folder per user, kedalaman folder 8.

## Deploy ke VPS

1. **DNS** — arahkan dua record ke IP VPS:
   - `A  rakit.icu    -> <IP>`
   - `A  *.rakit.icu  -> <IP>`
2. **Aplikasi**
   ```bash
   git clone ... /opt/rakit.icu && cd /opt/rakit.icu
   npm ci --omit=dev
   cat > .env <<'ENV'
   PORT=3000
   BASE_DOMAIN=rakit.icu
   PROTOCOL=https
   PUBLIC_PORT=
   NODE_ENV=production
   DATA_DIR=/opt/rakit.icu/data
   ENV
   sudo cp deploy/rakit.service /etc/systemd/system/ && sudo systemctl enable --now rakit
   ```
3. **HTTPS wildcard** — pakai `deploy/Caddyfile`. Sertifikat `*.rakit.icu` wajib lewat
   DNS challenge, jadi Caddy perlu plugin DNS provider tempat domain dikelola (contoh: Cloudflare).
4. **Backup** folder `data/` secara berkala.

## Catatan keamanan

Website user berjalan di subdomain `rakit.icu` dan bisa menjalankan JavaScript bebas, jadi:

- Cookie sesi **host-only** (tanpa atribut `Domain`) dan memakai prefix `__Host-` di HTTPS,
  sehingga tidak terkirim ke / tidak bisa ditimpa oleh `*.rakit.icu`.
- Semua request API yang mengubah data wajib punya `Origin` = `https://rakit.icu`
  (subdomain dianggap "same-site" oleh browser, jadi SameSite=Lax saja tidak cukup).
- Halaman aplikasi mengirim `X-Frame-Options: DENY`.
- **Disarankan:** daftarkan `rakit.icu` ke [Public Suffix List](https://publicsuffix.org/)
  supaya browser memperlakukan tiap subdomain sebagai situs terpisah (seperti github.io).
  Kalau belum, pertimbangkan menaruh website user di domain terpisah (mis. `*.rakit.site`).
- Website user bisa dipakai untuk phishing — siapkan cara melaporkan & menonaktifkan akun.

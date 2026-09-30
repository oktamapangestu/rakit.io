# rakit.icu

Editor kode online ala VS Code (Monaco) dengan live preview. Setiap user yang mendaftar
otomatis mendapat website di `https://<username>.rakit.icu`. File kode **.html, .css, .js**, plus gambar yang diunggah.

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
  credits.js   kredit AI: kuota langganan, jatah gratis harian, saldo yang dibeli
  billing.js   isi ulang kredit & langganan via QRIS (Kasera Pay) + webhook
  plans.js     paket langganan Pro/Unlimited: kuota AI & bonus storage
  assistant.js asisten AI untuk website pengguna: saldo, model, proxy /api/ai/chat, widget
  versions.js  riwayat versi file project: simpan otomatis/manual, bandingkan, kembalikan
  userdb.js    database per proyek (SQLite), validasi & aturan akses
  database.js  API editor database (khusus pemilik)
  siteapi.js   API publik /api/db/* di domain user
  admin.js     dashboard pemilik: statistik platform (khusus ADMIN_EMAILS)
  projects.js  project/workspace per subdomain: buat, pilih (header X-Project), hapus
  google.js    login & daftar dengan Google (OAuth 2.0 + PKCE)
  diagrams.js  bahan diagram otomatis: ERD, peta halaman, alur data
  aiqueue.js   antrean & batas concurrency adaptif untuk panggilan ke provider AI
  aiapply.js   menerapkan & membatalkan perubahan Builder di server (dengan snapshot)
  db.js        skema SQLite
public/        landing page + editor (Monaco dari CDN jsDelivr)
assets-source/ JS & CSS sumber (yang diedit manusia); hasil minify di public/
templates/     file awal untuk user baru
data/          database & file user (dibuat otomatis, jangan di-commit)
```

### Aset frontend (JS/CSS)

`public/js` dan `public/css` berisi **hasil minify** — jangan diedit langsung.
Edit sumbernya di `assets-source/`, lalu bangun ulang:

```bash
npm install     # sekali saja (memasang esbuild)
npm run build   # minify assets-source/ -> public/
```

Server menyisipkan `?v=<hash>` pada referensi aset di HTML dan mengirimnya dengan
`Cache-Control: immutable`, sehingga pengunjung otomatis memuat versi baru saat
berkas berubah tanpa perlu membersihkan cache.


## Akun & project

- **Akun** bisa dibuat dengan username + email + password, atau **Lanjutkan dengan Google**
  (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`; redirect URI `<domain>/auth/google/callback`). Akun Google baru
  mendapat username dari email. Email yang sudah terdaftar dengan password **tidak** ditautkan otomatis ke Google
  (pendaftaran password tidak memverifikasi email), jadi pemiliknya masuk memakai password.
- **Project = workspace**: setiap project punya subdomain sendiri (`<slug>.rakit.icu`), file (`data/sites/<slug>`),
  database (`data/db/<slug>.db`), dan riwayat AI sendiri. Maksimal `MAX_PROJECTS` (default 5) per akun; kuota
  file & database dihitung per project. Ganti, buat, ganti nama, atau hapus project lewat tombol folder di chip
  alamat website (atau menu avatar di HP). Project terakhir tidak bisa dihapus.
- **Kredit AI milik akun** dan dipakai bersama semua project; satu prompt berjalan per akun di project mana pun.
- Akun lama (sebelum ada project) otomatis mendapat project pertama dengan slug = username, jadi URL-nya tetap.

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
| `AI_DAILY_CREDITS` | `3` | Default kredit gratis per user per hari (reset 00.00 WIB, tidak menumpuk). Diatur di dashboard owner setelah pernah disimpan. |
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
Kredit yang dibeli tidak hangus dan dipakai setelah kredit gratis harian habis.

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

## Langganan (Pro & Unlimited)

Selain membeli kredit, user bisa berlangganan 30 hari lewat QRIS yang sama. Pembayarannya sekali bayar tanpa tagihan
otomatis, dan bisa diperpanjang kapan saja. Paket dibuka dari badge kredit AI atau menu avatar → **Langganan & kredit AI**.

| Paket | Default awal | AI | Storage file / project | Database / project | File & folder | Gambar / file |
|---|---|---|---|---|---|---|
| Gratis | — | `AI_DAILY_CREDITS` per hari (default 3, tidak menumpuk) | 20 MB | 10 MB | 500 | 1 MB |
| Pro | `PLAN_PRO=49000:300` | 300 kredit tiap siklus 30 hari | 100 MB | 50 MB | 2.000 | 5 MB |
| Unlimited | `PLAN_UNLIMITED=149000:60` | tanpa kuota bulanan, maks. 60 prompt/hari (WIB) | 250 MB | 100 MB | 5.000 | 10 MB |

- **Harga, kuota AI, dan status dijual diatur di dashboard owner** (`/admin` → kartu *Harga langganan*) dan
  disimpan di tabel `settings`. `PLAN_PRO`/`PLAN_UNLIMITED` di `.env` hanya default sebelum owner pernah menyimpan.
  Kartu yang sama mengatur **kredit gratis per hari** (reset 00.00 WIB; sisa hari itu hangus, tidak menumpuk).
  Perubahan harga berlaku untuk pembelian baru; tagihan QRIS yang masih menunggu tetap dengan nominal lamanya. Paket
  yang tidak dijual tetap berlaku bagi pelanggan yang sudah membayar. Kartu itu juga menghitung harga per
  kredit/prompt dan perkiraan margin terburuk dari rata-rata token per prompt 30 hari terakhir × biaya model
  (Rp per 1 juta token, diisi owner).
- Urutan pemakaian kredit: kuota langganan → kredit gratis harian → saldo kredit yang dibeli. Jadi pelanggan
  Unlimited yang mencapai batas harian tetap bisa memakai kredit gratis/belinya.
- **Perpanjang** paket yang sama: masa aktif ditambah 30 hari dari tanggal berakhir. **Upgrade** Pro → Unlimited:
  langsung aktif, sisa hari Pro dikonversi ke hari Unlimited sesuai harga. Downgrade ditolak selama paket lebih tinggi aktif.
- **Bonus storage** berlaku untuk semua project milik pelanggan dan langsung aktif setelah pembayaran. Saat
  langganan berakhir, batas kembali ke paket gratis: file yang ada tidak dihapus, tetapi file baru atau file yang
  makin besar ditolak sampai pemakaian turun di bawah batas (mengecilkan/menghapus file tetap bisa).
- Data di tabel `subscriptions` (satu baris per user); pembayarannya di `payments` dengan `package_id = 'plan:<id>'`.
  Batas storage per paket diatur di `src/plans.js`.

## Asisten AI untuk website pengguna

Pemilik website bisa memasang **chatbot AI** untuk pengunjungnya, memakai AI dari rakit.icu (gateway
`AI_BASE_URL`/`AI_API_KEY`) dan dibayar dari **Saldo Asisten** dalam Rupiah. API key tidak pernah sampai ke browser.

- **Editor** → menu avatar → **Asisten AI website**: aktifkan, pilih model (ditampilkan "≈ Rp per jawaban"),
  nama & sapaan, instruksi (info usaha yang boleh dijawab), batas pemakaian per hari, isi saldo (QRIS), grafik
  pemakaian 7 hari, dan tombol pasang otomatis. Pengaturan per project.
- **Pasang di halaman:** `<script src="/api/ai/widget.js" defer></script>` (gelembung chat; opsi `data-color`,
  `data-position="left"`, `data-open="true"`; `rakitAssistant.open()`). Atau panggil sendiri
  `POST /api/ai/chat` dengan `{ messages: [{ role, content }] }` → `{ reply }` (`stream: true` → NDJSON
  `{type:"delta",text}` … `{type:"done"}`). AI Builder tahu cara memasangnya.
- **Biaya:** token sebenarnya (laporan provider) × biaya model per 1 juta token × margin. Dana dicadangkan dulu
  sebesar perkiraan, lalu diselesaikan ke biaya sebenarnya. Urutan dana: **jatah asisten dari langganan**
  (Pro Rp10.000, Unlimited Rp30.000 per siklus 30 hari, `assistant` di `src/plans.js`) → **saldo** (saldo
  percobaan sekali per akun + isi ulang, tidak hangus). Isi ulang lewat `ASSISTANT_PACKAGES`.
- **Dashboard owner** → kartu *Asisten AI website*: daftar model (aktif/nonaktif, ID model di gateway, biaya,
  margin, perkiraan harga jual & modal per jawaban), tambah/hapus model, saldo percobaan, dan daftar website
  pemakai dengan tombol **Blokir**. Model yang dinonaktifkan otomatis diganti model aktif pertama di website yang
  memakainya (pemilik diberi tahu). Default awal: DeepSeek V4.1 Flash & Pro — **cek ID model & biayanya**.
- **Pengaman:** hanya menerima permintaan dari halaman website itu sendiri (header Origin), 30 pesan/jam per
  pengunjung, 60 pesan/menit per website, batas harian per website (Rupiah), maks. 20 pesan riwayat & 2.000
  karakter per pesan, jawaban maks. 800 token, instruksi dasar dikunci di server (tetap pada topik website,
  tidak membocorkan instruksi), antrean sendiri (6 bersamaan) terpisah dari AI Builder.
- Tabel: `assistant_wallet`, `assistant_allowance`, `assistant_sites`, `assistant_usage` (dibuat otomatis).

## Riwayat versi

Tab **Riwayat** di editor menyimpan "foto" semua file project, supaya user bisa melihat dan kembali ke
kondisi sebelumnya. Bahasanya sengaja dibuat untuk pemula (tanpa istilah seperti commit/branch).

- Versi dibuat **otomatis** sebelum user mulai mengedit (paling sering sekali per 10 menit, atau langsung
  setelah AI/restore), **sebelum AI mengubah file**, dan **sebelum dikembalikan** (jadi restore bisa dibatalkan).
  User juga bisa **Simpan versi sekarang** dengan nama sendiri. Versi yang isinya sama dengan versi terakhir dilewati.
- Detail versi menunjukkan file yang berbeda / sudah dihapus / baru sejak itu, dengan **Lihat perbedaan**
  (diff Monaco, atau gambar berdampingan), **Kembalikan file ini**, dan **Kembalikan ke versi ini** (seluruh
  project; file yang dibuat setelahnya ikut dihapus, dan hasilnya harus muat di kuota paket sekarang).
- **Database tidak ikut** disimpan/dikembalikan, supaya data kiriman pengunjung tidak hilang.
- Penyimpanan: isi file disimpan sekali per hash SHA-256 di `data/versions/<slug>/`, dan tiap versi (tabel
  `versions`) hanya mencatat path → hash. File yang tidak berubah tidak memakan tempat lagi. Riwayat tidak
  dihitung ke kuota storage.
- Batas riwayat per project mengikuti paket pemilik: Gratis 7 hari / 20 versi, Pro 30 hari / 200 versi,
  Unlimited 90 hari / 2.000 versi (`history` di `src/plans.js`). Versi lama dan isi file yang tak terpakai
  dibersihkan otomatis saat versi baru dibuat. Menghapus project ikut menghapus riwayatnya.
- API: `GET/POST /api/versions`, `GET /api/versions/:id`, `GET /api/versions/:id/file?path=`,
  `POST /api/versions/:id/restore` (body `{ path }` untuk satu file).

## Gambar

User bisa mengunggah gambar ke project: tombol **Upload gambar** di panel File, menu klik kanan
(**Upload gambar…**, termasuk ke folder tertentu), atau seret file ke daftar file.

- Format: `.png .jpg .jpeg .gif .webp .svg .ico .avif`. Isi file diperiksa (magic bytes / tag `<svg>`),
  jadi file lain yang diganti ekstensinya ditolak.
- Batas per gambar mengikuti paket (1 / 5 / 10 MB), dan ukurannya ikut kuota storage project.
- Nama file dirapikan otomatis (huruf kecil, spasi → `-`). Kalau nama sudah ada, user memilih Ganti,
  Simpan sebagai baru, atau Lewati.
- Klik gambar untuk melihatnya (ukuran piksel & file) dan menyalin path, tag `<img>`, atau `url()` CSS.
- Gambar disajikan di website seperti file lain (`/images/logo.png`). Gambar tidak bisa dibuka di Monaco,
  dan rename harus tetap berekstensi gambar.
- AI menerima daftar gambar di project, jadi bisa memakainya di kode, tapi tidak bisa membuat, mengubah,
  atau menghapus gambar.
- API: `POST /api/files/upload?path=<path>[&overwrite=1]` dengan body = isi file mentah.

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
- Batas per proyek: 10 MB (lebih besar untuk pelanggan, lihat Langganan), 20 tabel, 30 kolom per tabel (`DB_LIMITS` di `src/userdb.js`).
- Rate limit API publik per situs per IP: 300 baca dan 60 tulis per menit.
- Path `/api/` di domain user dicadangkan untuk sistem.
- Di mode Builder, AI bisa membuat tabel sendiri; perubahannya ikut dikonfirmasi (Simpan/Batalkan).

## Dashboard pemilik

`https://rakit.icu/admin` menampilkan statistik platform: pengguna, pendapatan, request AI (termasuk
yang gagal per status dan pemakaian token), kredit terjual, pengguna paling aktif, transaksi dan
pendaftar terbaru, serta ukuran penyimpanan. Periode bisa dipilih 7/30/90 hari (waktu WIB).

Hanya akun dengan email di `ADMIN_EMAILS` (dipisah koma) yang bisa membukanya; link-nya muncul di
menu avatar editor. Pengguna lain diarahkan kembali ke editor, dan API `/api/admin/*` menolak dengan 403.

## Diagram otomatis

Tab **Diagram** di editor (di samping Data) menggambar diagram dari file & database project aktif, tanpa AI:

- **ERD** — tabel, kolom, tipe, wajib/privat. Relasi ditebak dari nama kolom (`produk_id` → tabel `produk`),
  karena database belum menyimpan relasi resmi. Menandai tabel yang bisa diubah/dihapus siapa pun.
- **Peta halaman** — halaman HTML, link antar halaman, dan file CSS/JS yang dimuat. Menandai **link rusak**,
  file yang hilang, dan halaman yang tidak ditautkan dari mana pun.
- **Alur data** — halaman → script → tabel beserta operasinya. Menandai request yang **pasti ditolak**
  (akses tabel masih "Hanya kamu") dan tabel yang belum ada.

Setiap temuan punya tombol aksi (Atur akses, Buat tabel, Minta AI perbaiki). Diagram digambar dengan Mermaid
(dimuat dari CDN hanya saat tab dibuka); kodenya bisa disalin dan hasilnya diunduh sebagai SVG. Pemakaian
`/api/db/...` dideteksi dari kode, jadi URL yang dibuat dinamis bisa terlewat.

## Batasan (ubah di `src/files.js` → `LIMITS`)

- 512 KB per file, 20 MB & 500 file/folder per project (lebih besar untuk pelanggan, lihat `src/plans.js`), kedalaman folder 8.

## Deploy ke VPS

1. **DNS** — arahkan dua record ke IP VPS:
   - `A  rakit.icu    -> <IP>`
   - `A  *.rakit.icu  -> <IP>`
2. **Aplikasi** (di server ini: `/srv/rakit`)
   ```bash
   git clone ... /srv/rakit && cd /srv/rakit
   npm ci --omit=dev
   cat > .env <<'ENV'
   PORT=3010
   BASE_DOMAIN=rakit.icu
   PROTOCOL=https
   PUBLIC_PORT=
   NODE_ENV=production
   DATA_DIR=/srv/rakit/data
   ENV
   sudo cp deploy/rakit.service /etc/systemd/system/ && sudo systemctl enable --now rakit
   ```
   > `PORT` di `.env` harus sama dengan `proxy_pass` di konfigurasi Nginx.
3. **Reverse proxy + HTTPS wildcard** — pakai Nginx (lihat `deploy/nginx-rakit.conf`):
   ```bash
   sudo cp deploy/nginx-rakit.conf /etc/nginx/sites-available/rakit
   sudo ln -sf /etc/nginx/sites-available/rakit /etc/nginx/sites-enabled/rakit
   sudo nginx -t && sudo systemctl reload nginx
   ```
   Sertifikat `*.rakit.icu` lewat Let's Encrypt (wildcard butuh DNS challenge, mis. certbot + plugin DNS).
   App hanya `listen` di `127.0.0.1` — tutup port-nya dari publik lewat firewall (lihat `/root/app-guard.nft`).
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

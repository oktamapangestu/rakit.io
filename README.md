# rakit.io

Editor kode online ala VS Code (Monaco) dengan live preview. Setiap user yang mendaftar
otomatis mendapat website di `https://<username>.rakit.io`. File kode **.html, .css, .js**, plus gambar yang diunggah.

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
  server.js    routing berdasarkan host: rakit.io -> aplikasi, <user>.rakit.io -> website user
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
  diagrams.js  bahan diagram (analisis file & database); diagram buatan AI hanya di server Go
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
- **Project = workspace**: setiap project punya subdomain sendiri (`<slug>.rakit.io`), file (`data/sites/<slug>`),
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
| `AI_BASE_URL` | — | Provider bawaan. Contoh: `https://api.kelontongai.id/v1`. Provider lain bisa ditambahkan di dashboard owner. |
| `AI_API_KEY` | — | Key provider bawaan. Tanpa ini (dan tanpa provider dari dashboard) fitur AI nonaktif. |
| `AI_MODEL` | `deepseek-v4-pro` | Nama model utama di provider. Default sebelum owner menyimpan di dashboard. |
| `AI_FALLBACK_MODEL` | — | Model cadangan saat model utama gangguan, dipisah koma bila lebih dari satu (dicoba berurutan, maks. 5). Kosong = tanpa cadangan. |
| `AI_VISION_FALLBACK_MODEL` | — | Model cadangan untuk pembaca gambar (`AI_VISION_MODEL`), dipisah koma bila lebih dari satu. |
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
- **Multi provider:** selain provider bawaan dari `.env`, owner bisa menambah, mengubah, dan menghapus provider
  kompatibel OpenAI (OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, Groq, Ollama, …) di dashboard (`/admin` → kartu
  *Provider AI*, hanya server Go; disimpan di `settings.ai_providers`). API key tidak pernah dikirim balik ke browser
  (hanya 4 karakter terakhir), dan tombol *Tes* memanggil `GET {baseUrl}/models` tanpa biaya token. Model merujuk
  provider dengan akhiran `@id` (`gpt-5@openai`; tanpa `@` = provider bawaan) — di dashboard dipilih lewat dropdown
  di samping tiap isian model, termasuk model asisten website. Provider yang masih dipakai model tidak bisa dihapus.
  Kalau kembali ke server Node, model ber-`@` tidak dikenali: kembalikan modelnya ke provider bawaan dulu.
- **Model per tugas:** di kartu *Model AI editor* → *Model per tugas*, owner bisa memberi Builder, Plan, Diagram,
  Baca Alur Kode, dan Prediksi kode model khusus + cadangannya sendiri (boleh di provider lain), mis. model kecil &
  cepat untuk prediksi kode. Tugas tanpa model khusus mengikuti model utama (prediksi kode: `AI_COMPLETE_MODEL`, lalu
  model gambar, lalu model utama). Disimpan di `settings.ai_task_models`, hanya server Go.
- **Model cadangan:** model utama & daftar cadangannya (maks. 5, tombol *+ Tambah model cadangan*; juga untuk
  pembaca gambar) diatur di dashboard owner (`/admin` → kartu *Model AI editor*, disimpan di tabel `settings`; `.env`
  hanya default). Bila model utama gangguan — error provider, jaringan putus/timeout, atau tetap sibuk (429/503)
  setelah 1 kali coba ulang — permintaan yang sama diulang dengan cadangan pertama, lalu cadangan berikutnya sesuai
  urutan — cadangan boleh di provider lain, jadi gangguan satu provider tidak menghentikan AI. Model yang gangguan dilewati 5 menit (permintaan berikutnya langsung ke model sehat berikutnya),
  lalu dicoba lagi. Tidak pindah model untuk API key ditolak (401/403), antrean penuh, atau dihentikan user. Kartu
  itu juga menampilkan keadaan tiap model dan berapa kali cadangan terpakai (di memori, sejak server dinyalakan).
- **Riwayat & job:** percakapan AI disimpan di server (tabel `ai_threads`/`ai_messages`) dan muncul lagi saat editor
  dibuka; ada daftar percakapan, percakapan baru, dan hapus semua riwayat. Setiap prompt berjalan sebagai job di
  server — refresh atau tutup tab tidak membatalkannya; editor menyambung lagi ke progresnya. Perubahan Builder
  diterapkan server beserta snapshot, jadi Simpan/Batalkan tetap bisa setelah refresh. Job yang terputus karena
  server restart ditandai gagal dan kreditnya dikembalikan. Riwayat disimpan maks. 50 percakapan per user dan
  dihapus otomatis setelah 90 hari tidak dipakai.
- **Prompt dengan gambar** (maks. 3: desain, sketsa, screenshot error): tombol *Gambar* di kotak prompt, tempel
  (Ctrl/⌘+V), atau seret file. Gambar diperkecil di browser (sisi terpanjang 1280 px, JPEG) lalu dideskripsikan
  oleh `AI_VISION_MODEL` (default `deepseek-v4.1-flash`, karena `deepseek-v4-pro` tidak bisa melihat gambar);
  deskripsinya ikut dikirim ke `AI_MODEL` dan disimpan di riwayat (kolom `ai_messages.attachments`, beserta
  thumbnail), jadi prompt lanjutan tetap "ingat" gambarnya. Memakai `AI_IMAGE_PROMPT_CREDITS` kredit (default 2).
  Isi file divalidasi (JPG/PNG/WEBP asli, maks. 2 MB per gambar).
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

Di dashboard Kasera, daftarkan URL webhook: `https://rakit.io/api/billing/webhook`.

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
- Bila satu sumber tidak cukup (mis. prompt bergambar 2 kredit, sisa gratis 1 + dibeli 1), sisanya diambil dari
  sumber berikutnya dalam satu transaksi; saat gagal/dihentikan, tiap bagian dikembalikan ke sumbernya (kolom
  `ai_messages.credit`: `{ source, period, cost, more: [...] }`).
- Batas harian Unlimited menghitung **prompt**: prompt bergambar pun memakai 1 dari jatah hari itu.
- **Perpanjang** paket yang sama: masa aktif ditambah 30 hari dari tanggal berakhir. **Upgrade** Pro → Unlimited:
  langsung aktif, sisa hari Pro dikonversi ke hari Unlimited sesuai harga. Downgrade ditolak selama paket lebih tinggi aktif.
- **Bonus storage** berlaku untuk semua project milik pelanggan dan langsung aktif setelah pembayaran. Saat
  langganan berakhir, batas kembali ke paket gratis: file yang ada tidak dihapus, tetapi file baru atau file yang
  makin besar ditolak sampai pemakaian turun di bawah batas (mengecilkan/menghapus file tetap bisa).
- Data di tabel `subscriptions` (satu baris per user); pembayarannya di `payments` dengan `package_id = 'plan:<id>'`.
  Batas storage per paket diatur di `src/plans.js`.

## Asisten AI untuk website pengguna

Pemilik website bisa memasang **chatbot AI** untuk pengunjungnya, memakai AI dari rakit.io (gateway
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

| `POST /api/db/<tabel>/upload?column=<kolom>` | upload gambar untuk kolom bertipe Gambar (body = isi file) → `{ url }` |

- **Kolom Gambar** (`image`) menyimpan *alamat* gambar, bukan isinya: file hasil upload (`/uploads/<tabel>/…`),
  path gambar di project, atau URL `https://`. Base64/data URL ditolak dengan pesan yang mengarahkan ke upload
  (kolom teks juga menolak base64 panjang), karena teks dibatasi 10.000 karakter dan database 10 MB.
  Pengunjung hanya boleh upload bila akses **Tambah** atau **Ubah** tabel itu publik; format JPG/PNG/WEBP/GIF/AVIF
  (dicek dari isi file; SVG hanya untuk pemilik), ukuran & kuota mengikuti paket, maks. 20 upload / 10 menit per
  pengunjung. File lama dihapus otomatis saat gambarnya diganti atau barisnya dihapus (bila tak dipakai baris
  lain), dan folder `uploads/<tabel>` ikut terhapus bersama tabelnya. Di tab Data kolom ini tampil sebagai
  thumbnail; klik dua kali untuk upload/ganti/kosongkan.
- Setiap operasi per tabel diatur **Publik** atau **Hanya pemilik** (default: semua hanya pemilik).
- Kolom **privat** tidak pernah dikirim lewat API publik.
- Tipe kolom: teks, angka, ya/tidak, tanggal. Kolom `id` dan `created_at` otomatis.
- Batas per proyek: 10 MB (lebih besar untuk pelanggan, lihat Langganan), 20 tabel, 30 kolom per tabel (`DB_LIMITS` di `src/userdb.js`).
- Rate limit API publik per situs per IP: 300 baca dan 60 tulis per menit.
- Path `/api/` di domain user dicadangkan untuk sistem.
- Di mode Builder, AI bisa membuat tabel sendiri; perubahannya ikut dikonfirmasi (Simpan/Batalkan).

## Dashboard pemilik

`https://rakit.io/admin` menampilkan statistik platform: pengguna, pendapatan, request AI (termasuk
yang gagal per status dan pemakaian token), kredit terjual, pengguna paling aktif, transaksi dan
pendaftar terbaru, serta ukuran penyimpanan. Periode bisa dipilih 7/30/90 hari (waktu WIB).

Tab *Pengguna* berisi ranking token per pengguna dan kartu *Aksi AI dengan token terbanyak*: 20 request AI
editor teratas (bisa diurutkan menurut total, input, atau output token) beserta aksinya (Builder, Plan, atau
diagram), cuplikan prompt (maks. 140 karakter) atau jenis diagram, project, model, status, dan pengguna yang
menjalankannya. Aksi dicatat di kolom `action`/`project_id`/`detail` tabel `ai_requests` (hanya server Go);
request yang tercatat sebelum kolom itu ada tampil sebagai "aksi belum tercatat". Prediksi kode, Baca Alur
Kode, dan asisten website tidak masuk ranking ini karena pemakaiannya dicatat per hari, bukan per request.

Hanya akun dengan email di `ADMIN_EMAILS` (dipisah koma) yang bisa membukanya; link-nya muncul di
menu avatar editor. Pengguna lain diarahkan kembali ke editor, dan API `/api/admin/*` menolak dengan 403.

## Prediksi kode (editor)

Saat menulis kode di editor lalu berhenti mengetik sebentar (±0,5 detik), AI menebak lanjutan kodenya dan
menampilkannya sebagai teks abu-abu: **Tab** menerima, **Esc** atau lanjut mengetik mengabaikan. Hanya di server Go
(`go/internal/ai/complete.go`, `POST /api/ai/complete`).

- Gratis (tidak memakai kredit), dibatasi `AI_COMPLETE_DAILY_LIMIT` permintaan per akun per hari (default 500,
  `0` = fitur mati). Pemakaian & token tercatat di tabel `ai_complete_usage`.
- Model: `AI_COMPLETE_MODEL`, atau bila kosong model gambar (cepat) yang diatur owner, lalu model utama. Tidak lewat
  antrean prompt AI dan tidak menghalangi job AI user; satu prediksi berjalan per akun, batas 12 detik.
- Yang dikirim: path file, maks. 6.000 karakter sebelum kursor dan 2.000 sesudahnya.
- Bisa dimatikan di menu avatar → **Pengaturan** → "Prediksi kode otomatis (AI)" (disimpan per browser).

## Library AI di fungsi (Provider AI)

Fungsi serverless (`functions/<nama>.js`) mendapat objek `ai` untuk memakai AI dengan **API key milik pemilik project**.
Satu cara untuk semua provider; server Go menerjemahkannya ke API tiap provider (`go/internal/fnai`). Hanya di server Go.

```js
export default async function (req, { db, ai }) {
  const { text } = await ai.chat('Buat deskripsi produk: ' + req.body.nama, { system: 'Kamu penulis toko online.' });
  const data = await ai.json('Ambil nama & HP dari: ' + req.body.pesan, { nama: 'string', hp: 'string' }); // -> objek
  const cek = await ai.chat('Apakah ini bukti transfer?', { images: ['/uploads/bukti/abc.jpg'] });            // vision
  const [a, b] = await ai.embed(['kue coklat', 'brownies']);                                                // embedding
  return { text, data, cek: cek.text, mirip: ai.similarity(a, b) };
}
```

- **Provider** diatur di tab **Fungsi → Provider AI**: OpenAI, Anthropic Claude, Google Gemini, atau **kompatibel OpenAI**
  (isi base URL; tombol cepat DeepSeek, Groq, OpenRouter, Mistral, Together). Tiap provider punya nama (dipakai di kode lewat
  `{ provider: 'gemini' }`), model chat, model embedding opsional, dan satu provider **default**. Maks. 10 per project.
  Tombol **Tes** mengirim pesan pendek untuk memeriksa key & model.
- **API key** disimpan di server (tabel `fn_ai_providers`, seperti rahasia fungsi) dan tidak pernah dikirim ke browser maupun ke
  kode fungsi; editor hanya menampilkan 4 karakter terakhirnya. Biaya ditagih provider ke akun pemiliknya — rakit.io tidak
  memotong kredit.
- **Pernyataan untuk pengguna** (tampil di bagian Provider AI dan dialognya): rakit.io tidak mengambil, membagikan, atau memakai
  API key/token AI pengguna untuk keperluan apa pun selain meneruskan panggilan `ai.*` dari fungsi milik pengguna itu sendiri ke
  provider yang dipilihnya; key dihapus dari database saat provider dihapus. Pengguna disarankan memasang spending limit di
  provider. Jaga janji ini: jangan pernah memakai `fn_ai_providers.api_key` untuk hal lain (mis. AI platform, statistik, atau
  debugging), dan jangan mencetaknya ke log.
- `ai.chat(prompt | { messages, system, images, provider, model, temperature, maxTokens })` → `{ text, model, provider, finish,
  usage }`. `ai.json(prompt, shape, options)` → objek hasil (OpenAI memakai `response_format`, Gemini `responseMimeType`; bila
  bukan JSON, diminta ulang sekali). `ai.embed(teks | array)` → vektor / array vektor (Anthropic tidak punya embedding).
  `ai.providers()` → daftar provider (tanpa key). `ai.similarity(a, b)` → kemiripan cosine.
- **Gambar** (maks. 4 per panggilan, 5 MB, JPG/PNG/WEBP/GIF): URL https publik, path gambar di project (`/uploads/…`,
  `/images/…`), atau data URL. Diunduh/dibaca server lalu dikirim sebagai base64 ke provider.
- **Batas**: maks. 5 panggilan `ai.*` per eksekusi, 60 detik per panggilan. Waktu menunggu provider **tidak dihitung** ke batas
  10 detik fungsi (jam eksekusi dijeda). Base URL & URL gambar melewati penjaga alamat internal yang sama dengan `fetch`.
- **Pemakaian** per provider per hari (panggilan, gagal, token) di tabel `fn_ai_usage`, tampil di tab Fungsi.
- AI Builder tahu library ini dan nama provider yang terpasang (tanpa key).
- AI Builder juga menerima jadwal fungsi dan maks. 5 eksekusi gagal terbaru (error + console, dilewati bila kodenya
  sudah diubah sesudahnya), jadi "perbaiki fungsi yang error" bisa langsung dikerjakan.
- Tombol **✦ … dengan AI** menghubungkan fitur lain ke panel AI (mengisi kotak prompt, tidak langsung dikirim): Fungsi
  (buat/ubah, perbaiki dari log & uji coba, buat fitur AI), Database (pakai tabel di website), temuan Diagram, catatan
  Baca Alur Kode, dan klik kanan di editor kode (ubah / tanya tentang kode terpilih).
- API: `PUT /api/functions/ai-providers` `{ name, kind, baseUrl, apiKey, model, embedModel, default }` (apiKey kosong saat
  mengubah = key lama), `DELETE /api/functions/ai-providers/:name`, `POST /api/functions/ai-providers/:name/test`;
  daftarnya ada di `GET /api/functions` (`aiProviders`, `aiKinds`).

## Baca Alur Kode

Tombol **Baca Alur Kode** di atas editor kode (file .html, .css, .js) membuka panel di samping editor. AI membaca file itu
beserta file yang terhubung, lalu menjelaskan alurnya **berurutan seperti kode berjalan**, bukan urut baris. Hanya di server Go
(`go/internal/ai/explain.go`).

- **Langkah demi langkah**: tiap langkah punya judul, jenis (mulai, keputusan, perulangan, menunggu aksi, permintaan, …),
  baris yang terlibat, penjelasan, contoh dengan nilai nyata, dan istilah penting (klik untuk melihat artinya).
- **Interaktif**: klik langkah → barisnya disorot di editor (nomor langkah muncul di awal barisnya); klik baris di editor →
  langkahnya dibuka. Tombol ‹ › dan ▶ (putar otomatis tiap 6 detik), atau tombol panah saat panel difokus.
- **Rujukan ke file lain**: langkah bisa merujuk elemen HTML, halaman, fungsi `/api/fn/…`, atau class CSS di file lain; klik untuk
  membuka file itu di baris yang dirujuk, lalu **← Kembali** ke langkah semula. Panel mengikuti file aktif, jadi alur file
  rujukan bisa langsung dibaca juga.
- **Diagram alur** digambar dari langkah-langkahnya (Mermaid, dibuat di browser, bukan oleh AI); klik kotaknya untuk pindah langkah.
- **Catatan** (bug, perlu dicek, saran) dan **kecepatan kode**; tulisan "baris 12" di penjelasan bisa diklik.
- **Tanya AI** tentang langkah yang sedang dibuka (jawaban singkat, mengingat 6 tanya-jawab terakhir).
- Isi yang dijelaskan adalah isi editor (perubahan yang belum disimpan ikut). Hasil disimpan per file beserta hash isinya
  (tabel `code_explanations`): membuka ulang file yang sama tidak bertanya ke AI; bila file berubah, panel memberi tanda dan
  tombol **Perbarui**.
- Gratis (tidak memakai kredit), dibatasi `AI_EXPLAIN_DAILY_LIMIT` permintaan per akun per hari (default 30, termasuk tanya
  lanjutan; `0` = fitur mati); satu permintaan berjalan per akun. Pemakaian & token di tabel `ai_explain_usage`. Memakai model
  utama lewat antrean AI (dengan model cadangan).
- Yang dikirim ke AI: daftar file project, file yang dijelaskan (bernomor baris, maks. 120 KB), hingga 6 file terkait (yang
  disebut file ini atau yang menyebut file ini, termasuk `functions/<nama>.js` ↔ `/api/fn/<nama>`), dan skema tabel bila file
  memakai `/api/db`.

API: `GET /api/ai/explain?path=` (tersimpan + sisa kuota), `POST /api/ai/explain` `{ path, content, force? }`,
`POST /api/ai/explain/ask` `{ path, content, step, question, history }`.

## Diagram buatan AI

Tab **Diagram** di editor (di samping Data) menampilkan diagram project aktif yang **digambar AI** (kode Mermaid)
dari file & database project. Hanya ada di server Go (`go/internal/ai/diagram.go`). Jenisnya:

- **Use Case** — aktor dan apa yang bisa mereka lakukan di website.
- **Activity** — alur proses utama pengunjung, dengan cabang keputusan.
- **Sequence** — urutan interaksi Pengunjung → Halaman/script → API (`/api/db`, `/api/fn`) → database/layanan luar.
- **Class** — tabel dan modul/objek JavaScript beserta atribut, method, dan relasinya.
- **State** — perubahan status objek terpenting (mis. pesanan, kiriman form, tampilan halaman).
- **ERD** — tabel, kolom, tipe, wajib/privat, dan relasi.
- **Peta halaman** — halaman HTML, link antar halaman, file CSS/JS yang dimuat; link rusak & file hilang ditandai.
- **Alur data** — halaman/script/fungsi → tabel beserta operasinya; request yang akan ditolak server ditandai.

Diagram disimpan per project & jenis (tabel `project_diagrams`) dan **tidak berubah sendiri**: tombol
**Update diagram** membuat ulang diagram yang sedang dibuka dari file & database terbaru (biaya sama dengan satu
prompt AI, `AI_CREDITS_PER_PROMPT`; kredit dikembalikan bila gagal). Di toolbar tertulis kapan diagram itu terakhir
diperbarui. Selain isi project, AI juga menerima analisis otomatis tanpa AI (`GET /api/diagrams`: halaman, link,
aset, form, tabel, relasi, pemakaian `/api/db` per file beserta status aksesnya) supaya hasilnya lebih tepat.

AI juga menulis catatan singkat di panel **Temuan** (mis. tabel yang bisa dihapus siapa pun, link rusak). Bila
Mermaid gagal menggambar kode dari AI, tombol **Perbaiki dengan AI** mengirim pesan error-nya ke AI — gratis,
maks. 2 kali per diagram sampai di-Update lagi. Mermaid dimuat dari CDN hanya saat tab dibuka; kodenya bisa
disalin dan hasilnya diunduh sebagai SVG.

API: `GET /api/diagrams/saved` (semua diagram tersimpan), `POST /api/diagrams/generate` `{ kind, renderError? }`.

**Zoom & geser kanvas:**

| | Zoom | Geser |
|---|---|---|
| Mouse | scroll roda (ke arah kursor), klik dua kali (Shift = perkecil) | seret; Shift + scroll = mendatar |
| Touchpad | cubit (juga Safari), atau Ctrl/⌘ + scroll | geser dua jari |
| Layar sentuh | cubit dua jari | seret satu jari |
| Keyboard (kanvas difokus) | `+` / `−`, `0` pas layar, `1` ukuran asli | tombol panah (Shift = lebih jauh) |

Zoom 10%–500%; tombol persen di toolbar = pas layar. Selama belum di-zoom/geser, diagram otomatis pas ulang saat
ukuran panel berubah.

## Batasan (ubah di `src/files.js` → `LIMITS`)

- 512 KB per file, 20 MB & 500 file/folder per project (lebih besar untuk pelanggan, lihat `src/plans.js`), kedalaman folder 8.

## Deploy ke VPS

1. **DNS** — arahkan dua record ke IP VPS:
   - `A  rakit.io    -> <IP>`
   - `A  *.rakit.io  -> <IP>`
2. **Aplikasi** (di server ini: `/srv/rakit`) — server **Go** (lihat `go/README.md`; server Node lama sudah tidak dipakai)
   ```bash
   git clone ... /srv/rakit && cd /srv/rakit
   cd go && go build -o bin/rakit . && cd ..
   cat > .env <<'ENV'
   HOST=127.0.0.1
   PORT=3011
   BASE_DOMAIN=rakit.io
   PROTOCOL=https
   PUBLIC_PORT=
   NODE_ENV=production
   DATA_DIR=/srv/rakit/data
   ENV
   sudo cp deploy/rakit.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now rakit.service
   ```
   > Hanya **satu** unit rakit yang boleh aktif. Jangan memasang unit kedua dengan binary &
   > port yang sama — proses kedua gagal bind tapi tetap me-refund job AI (kredit bisa
   > berkurang lalu kembali lagi). Bila ada unit duplikat: `sudo systemctl disable --now rakit-go.service`.
   > `PORT` di `.env` harus sama dengan `proxy_pass` di konfigurasi Nginx.
3. **Reverse proxy + HTTPS wildcard** — pakai Nginx (lihat `deploy/nginx-rakit.conf`):
   ```bash
   sudo cp deploy/nginx-rakit.conf /etc/nginx/sites-available/rakit
   sudo ln -sf /etc/nginx/sites-available/rakit /etc/nginx/sites-enabled/rakit
   sudo nginx -t && sudo systemctl reload nginx
   ```
   Sertifikat `*.rakit.io` lewat Let's Encrypt (wildcard butuh DNS challenge, mis. certbot + plugin DNS).
   App hanya `listen` di `127.0.0.1` — tutup port-nya dari publik lewat firewall (lihat `/root/app-guard.nft`).
4. **Backup** folder `data/` secara berkala.

## Catatan keamanan

Website user berjalan di subdomain `rakit.io` dan bisa menjalankan JavaScript bebas, jadi:

- Cookie sesi **host-only** (tanpa atribut `Domain`) dan memakai prefix `__Host-` di HTTPS,
  sehingga tidak terkirim ke / tidak bisa ditimpa oleh `*.rakit.io`.
- Semua request API yang mengubah data wajib punya `Origin` = `https://rakit.io`
  (subdomain dianggap "same-site" oleh browser, jadi SameSite=Lax saja tidak cukup).
- Halaman aplikasi mengirim `X-Frame-Options: DENY`.
- **Disarankan:** daftarkan `rakit.io` ke [Public Suffix List](https://publicsuffix.org/)
  supaya browser memperlakukan tiap subdomain sebagai situs terpisah (seperti github.io).
  Kalau belum, pertimbangkan menaruh website user di domain terpisah (mis. `*.rakit.site`).
- Website user bisa dipakai untuk phishing — siapkan cara melaporkan & menonaktifkan akun.

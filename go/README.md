# Backend Go

Server rakit.io sekarang berjalan **sendiri di Go**: aplikasi di `rakit.io`, website project di
`<slug>.rakit.io`, AI, pembayaran, dan dashboard owner. Go membaca `.env`, folder `data/`, dan database
SQLite yang sama dengan server Node lama, dan membuat/memperbarui skema database sendiri saat menyala.

Kode Node (`src/`) masih disimpan sebagai jalan kembali bila ada masalah setelah deploy (lihat
"Membatalkan" di bawah). Setelah Go stabil di produksi, `src/` bisa dihapus (lihat "Sesudah stabil").

## Menjalankan

```bash
npm run build:go                          # hasil: go/bin/rakit
go/bin/rakit --env-file .env              # dari folder repo (PUBLIC_DIR & TEMPLATE_DIR relatif ke sini)
```

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT`, `HOST` | `3000`, semua | Alamat server. |
| `BASE_DOMAIN`, `PROTOCOL`, `PUBLIC_PORT`, `DATA_DIR`, `ADMIN_EMAILS` | sama dengan Node | |
| `PUBLIC_DIR` | `public` | Folder halaman & aset aplikasi, relatif ke folder kerja. |
| `TEMPLATE_DIR` | `templates/default` | File awal project baru, relatif ke folder kerja. |
| `MAX_PROJECTS`, `GOOGLE_*`, `AI_*`, `KASERA_*`, `CREDIT_PACKAGES`, `ASSISTANT_PACKAGES`, `PLAN_*` | sama dengan Node | |
| `MAIL_API_URL` | `https://mail-api.flaz.id/v1/messages` | API pengirim email (lupa password). Hanya di server Go. |

## Test

Test di `tests/` hanya berbicara lewat HTTP (plus database), jadi dipakai untuk kedua backend:

```bash
npm run test:go  # server Go
npm test         # server Node lama (selama src/ masih ada)
go test ./...    # dari folder go/: konversi nilai ala JavaScript
```

Untuk mencari data race: `cd go && go build -race -o bin/rakit . && cd .. && RAKIT_SERVER_CMD=go/bin/rakit npm test`.

## Tahapan migrasi

| # | Bagian | Padanan di Node | Status |
|---|---|---|---|
| 0 | Test alur uang (kredit, QRIS, langganan) | — | selesai |
| 1 | Website project `<slug>.rakit.io` (file statis) | `sites.js` | selesai |
| 2 | Halaman & aset aplikasi (`/`, `/editor`, `/admin`, `/panduan`, `/js`, `/css`) + baca sesi | `server.js`, `auth.js` | selesai |
| 3 | API situs: `/api/db/*` di domain project (baris, relasi, upload gambar, batas request) | `siteapi.js`, `userdb.js` | selesai |
| 4 | Akun (daftar, masuk, keluar, Google), project, file, riwayat versi | `api.js`, `projects.js`, `files.js`, `versions.js`, `google.js` | selesai |
| 5 | Editor database (tabel, kolom, aturan, baris, upload) & bahan diagram | `database.js`, `diagrams.js` | selesai |
| 6 | Kredit, langganan, pembayaran QRIS, webhook | `credits.js`, `plans.js`, `billing.js` | selesai |
| 7 | AI editor (Builder/Plan, job, antrean, model cadangan) & asisten website | `ai.js`, `aiapply.js`, `aiqueue.js`, `aimodels.js`, `assistant.js` | selesai |
| 8 | Dashboard owner (statistik, harga, model asisten, blokir), skema database, pembersihan sesi; Go berdiri sendiri | `admin.js`, `db.js`, `server.js` | selesai |

Catatan:

- **Skema database** ada di `internal/store/schema.go` (salinan `src/db.js` + tabel asisten dari `src/assistant.js`).
  Selama `src/` masih ada, perubahan skema harus dibuat di kedua tempat.
- **Prompt AI** di `internal/ai/prompts.go` dihasilkan dari `src/ai.js` oleh `node scripts/gen-go-prompts.cjs`.
  Selama `src/ai.js` masih ada, ubah prompt di sana lalu jalankan skrip itu.
- **Pemeriksaan kode AI Builder** (`internal/ai/codecheck.go`, `internal/jscheck`), hanya di server Go: sintaks JS
  (dikompilasi QuickJS tanpa dijalankan) diperiksa saat file ditulis; rujukan file, komponen/urutan tag Alpine, dan
  `/api/fn/` yang tidak ada diperiksa saat AI menyatakan selesai. Masalahnya dikembalikan ke AI untuk diperbaiki
  (masalah yang sama tidak dikirim dua kali). Gambar yang belum ada disebut di ringkasan. Hasilnya tersimpan di
  `ai_requests.checks` dan tampil di dashboard owner ("Kualitas kode AI per model"). Tool `edit_file` & `read_file`
  juga ada versi minimal di `src/ai.js` (tanpa pemeriksaan kode).
- **Evaluasi AI** (`scripts/ai-eval/`): `npm run ai:eval -- --only id,id --model nama` menjalankan kasus tetap di
  `cases.mjs` dengan provider sungguhan dari `.env` (memakai biaya provider), hasil di `data/ai-eval/<waktu>/`.
- **Konversi nilai** di `internal/jsconv` dan `internal/userdb` meniru JavaScript (`Number()`, `parseInt`,
  `Date.parse`); `go test ./...` membandingkannya dengan jawaban Node yang direkam di `testdata/js.json`.
- **Statistik antrean AI** di dashboard owner kini angka asli (antrean ada di server Go).
- **Provider AI tambahan** (`internal/aimodels/providers.go`), hanya di server Go: model `nama@provider` dikirim ke
  provider itu. Server Node tidak mengenal akhiran `@` — sebelum kembali ke Node, pindahkan model ke provider bawaan.
- **Publikasi manual (dev/prod)** per project (`internal/publish`), hanya di server Go. Untuk project dengan mode
  manual, versi publik ada di `data/published/<slug>/` dan `data/db/<slug>@prod.db`; versi dev tetap di
  `data/sites/<slug>/` dan `data/db/<slug>.db`, tampil di `<slug>--dev.<BASE_DOMAIN>`. Sertakan keduanya saat backup.
  Wildcard DNS & sertifikat `*.<BASE_DOMAIN>` sudah mencakup alamat dev.
- **Fungsi serverless** (`internal/fn`), hanya di server Go: `functions/<nama>.js` di project dijalankan di
  `<slug>.<BASE_DOMAIN>/api/fn/<nama>` dengan QuickJS di WebAssembly (`third_party/qjs`, salinan fastschema/qjs
  dengan tambalan sandbox — lihat README di sana). Batas: 10 detik & 64 MB per eksekusi, 8 eksekusi bersamaan,
  kuota harian per paket (`fn.DailyLimit`). `FN_ALLOW_PRIVATE_FETCH=1` hanya untuk test lokal; **jangan** dipasang
  di produksi (membuka fetch ke jaringan internal). Folder `functions/` tidak pernah disajikan sebagai file statis
  oleh server Go — server Node tidak tahu aturan ini. Jadwal (cron, WIB) dijalankan penjadwal di proses Go tiap
  menit (Pro: min. 15 menit, Unlimited: min. 5 menit); log 100 eksekusi terakhir per project ada di tabel `fn_logs`.
  Panduan fungsi untuk AI ada di prompt `src/ai.js` (bagian "Serverless functions").
- **Library AI fungsi** (`internal/fnai` + `internal/fn/ai.go`): `ai.chat` / `ai.json` / `ai.embed` di kode fungsi memakai
  provider (OpenAI, Anthropic, Gemini, kompatibel OpenAI) dengan API key pemilik project (`fn_ai_providers`). Waktu menunggu
  provider dijeda dari batas 10 detik (`clock.go`); tiap panggilan maks. 60 detik, maks. 5 per eksekusi. Lihat README utama.

- **Lupa password** (`internal/mail` + `internal/api/password.go`), hanya di server Go. Email pengirim & API key diatur
  owner di dashboard (Pengaturan → Email, tersimpan di `settings` kunci `mail`); sebelum diisi, link "Lupa password?"
  tidak tampil dan `/api/forgot-password` menjawab 503. Link berlaku 1 jam, sekali pakai, maks. 3 per akun per jam
  (`password_resets`); dipakai = semua sesi lama keluar. Email dikirim di latar (jawaban API sama, ada akunnya atau
  tidak), jadi kegagalan kirim hanya tercatat di log — pakai tombol "Kirim tes" di dashboard untuk memeriksa pengaturan.

## Deploy tahap ini

Go menangani semuanya sendiri; unit yang dipakai adalah `rakit.service` (Go). Hanya **satu**
unit rakit yang boleh aktif:

```bash
GOOS=linux GOARCH=amd64 go build -o bin/rakit .      # dari folder go/; sesuaikan GOARCH server
sudo cp deploy/rakit.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl restart rakit.service                 # atau: enable --now bila belum pernah dipasang
# deploy/nginx-rakit.conf: proxy_pass http://127.0.0.1:3011;  lalu  sudo nginx -t && sudo systemctl reload nginx
```

> **Jangan** memasang unit kedua (mis. `rakit-go.service`) dengan binary & port yang sama.
> Proses kedua akan gagal bind port, tetapi tetap menjalankan inisialisasi sebelum listen —
> termasuk `AI.Start()` yang me-refund job `queued`/`running`, sehingga kredit AI terus
> dikembalikan (bug "kredit berkurang lalu kembali lagi"). Bila menemukan unit duplikat,
> matikan: `sudo systemctl disable --now rakit-go.service`.

`rakit.service` versi Go tidak lagi memakai `NODE_UPSTREAM` dan tidak bergantung pada server Node.


**Membatalkan (kembali ke Node, kalau perlu):** jalankan server Node di port 3010, kembalikan
`proxy_pass` ke `3010`, reload Nginx, lalu `sudo systemctl stop rakit.service` (Go). Node bisa
langsung memakai database yang sama. Job AI yang sedang berjalan di Go saat itu ditandai gagal
dan kreditnya dikembalikan saat server menyala.

## Sesudah stabil

Bila Go sudah berjalan beberapa waktu tanpa perlu dibatalkan:

1. Pindahkan sumber prompt AI dari `src/ai.js` ke Go (`internal/ai/prompts.go` jadi berkas yang diedit langsung)
   dan hapus `scripts/gen-go-prompts.cjs`.
2. Hapus `src/`, dependensi `express` & `qrcode`, dan skrip `npm start`/`dev`/`test`
   (`test:go` jadi `test`). Test di `tests/` dan rekaman `testdata/js.json` tetap dipakai.
   `deploy/rakit.service` tetap dipakai (kini unit Go).

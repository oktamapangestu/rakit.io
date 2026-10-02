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
- **Konversi nilai** di `internal/jsconv` dan `internal/userdb` meniru JavaScript (`Number()`, `parseInt`,
  `Date.parse`); `go test ./...` membandingkannya dengan jawaban Node yang direkam di `testdata/js.json`.
- **Statistik antrean AI** di dashboard owner kini angka asli (antrean ada di server Go).
- **Publikasi manual (dev/prod)** per project (`internal/publish`), hanya di server Go. Untuk project dengan mode
  manual, versi publik ada di `data/published/<slug>/` dan `data/db/<slug>@prod.db`; versi dev tetap di
  `data/sites/<slug>/` dan `data/db/<slug>.db`, tampil di `<slug>--dev.<BASE_DOMAIN>`. Sertakan keduanya saat backup.
  Wildcard DNS & sertifikat `*.<BASE_DOMAIN>` sudah mencakup alamat dev.

## Deploy tahap ini

Go menangani semuanya sendiri, jadi server Node dimatikan:

```bash
GOOS=linux GOARCH=amd64 go build -o bin/rakit .      # dari folder go/; sesuaikan GOARCH server
sudo cp deploy/rakit-go.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl restart rakit-go.service              # atau: enable --now bila belum pernah dipasang
# deploy/nginx-rakit.conf: proxy_pass http://127.0.0.1:3011;  lalu  sudo nginx -t && sudo systemctl reload nginx
sudo systemctl disable --now rakit.service           # Node
```

`rakit-go.service` versi baru tidak lagi memakai `NODE_UPSTREAM` dan tidak bergantung pada `rakit.service`.

**Membatalkan:** hapus `Environment=AI_JOBS_ELSEWHERE=1` dari `rakit.service` bila masih ada, lalu
`sudo systemctl enable --now rakit.service`, kembalikan `proxy_pass` ke `3010`, reload Nginx, dan
`sudo systemctl stop rakit-go.service`. Node bisa langsung memakai database yang sama. Job AI yang sedang
berjalan di Go saat itu ditandai gagal dan kreditnya dikembalikan saat Node menyala.

## Sesudah stabil

Bila Go sudah berjalan beberapa waktu tanpa perlu dibatalkan:

1. Pindahkan sumber prompt AI dari `src/ai.js` ke Go (`internal/ai/prompts.go` jadi berkas yang diedit langsung)
   dan hapus `scripts/gen-go-prompts.cjs`.
2. Hapus `src/`, `deploy/rakit.service`, dependensi `express` & `qrcode`, dan skrip `npm start`/`dev`/`test`
   (`test:go` jadi `test`). Test di `tests/` dan rekaman `testdata/js.json` tetap dipakai.

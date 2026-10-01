# Backend Go (migrasi bertahap dari Node)

Server Go berdiri **di depan** server Node. Rute yang sudah dipindah ditangani Go; semua yang lain
diteruskan apa adanya ke Node (`NODE_UPSTREAM`). Keduanya memakai `.env`, folder `data/`, dan database
SQLite yang sama, jadi tiap tahap bisa dibatalkan dengan mengarahkan Nginx kembali ke Node.

```
Nginx ──> Go (PORT) ──┬─> ditangani Go        (rute yang sudah dipindah)
                      └─> Node (NODE_UPSTREAM) (sisanya)
```

## Menjalankan

```bash
npm run build:go                                         # hasil: go/bin/rakit
PORT=3000 UPSTREAM_PORT=3001 bash scripts/go-with-node.sh  # Go di :3000, Node di :3001
```

| Variabel | Default | Keterangan |
|---|---|---|
| `NODE_UPSTREAM` | `http://127.0.0.1:3010` | Alamat server Node tempat sisa request diteruskan. |
| `PORT`, `HOST` | `3000`, semua | Alamat server Go. |
| `BASE_DOMAIN`, `PROTOCOL`, `PUBLIC_PORT`, `DATA_DIR`, `ADMIN_EMAILS` | sama dengan Node | Dibaca dari `.env` yang sama (`--env-file`). |
| `PUBLIC_DIR` | `public` | Folder halaman & aset aplikasi, relatif ke folder kerja. |
| `TEMPLATE_DIR` | `templates/default` | File awal project baru, relatif ke folder kerja. |
| `MAX_PROJECTS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | sama dengan Node | Dibaca dari `.env` yang sama. |

## Test

Test di `tests/` hanya berbicara lewat HTTP (plus database), jadi dipakai untuk kedua backend:

```bash
npm test         # server Node saja
npm run test:go  # Go di depan + Node di belakang
```

Aturan migrasi: sebuah rute baru dipindah ke Go setelah ada test-nya dan test itu lolos di **kedua** susunan.

## Tahapan

| # | Bagian | Padanan di Node | Status |
|---|---|---|---|
| 0 | Test alur uang (kredit, QRIS, langganan) | — | selesai |
| 1 | Website project `<slug>.rakit.icu` (file statis) | `sites.js` | selesai |
| 2 | Halaman & aset aplikasi (`/`, `/editor`, `/admin`, `/panduan`, `/js`, `/css`) + baca sesi | `server.js`, `auth.js` | selesai |
| 3 | API situs: `/api/db/*` di domain project (baris, relasi, upload gambar, batas request) | `siteapi.js`, `userdb.js` | selesai |
| 4 | Akun (daftar, masuk, keluar, Google), project, file, riwayat versi | `api.js`, `projects.js`, `files.js`, `versions.js`, `google.js` | selesai |
| 5 | Editor database (tabel, kolom, aturan, baris, upload) & bahan diagram | `database.js`, `diagrams.js` | selesai |
| 6 | Kredit, langganan, pembayaran, webhook | `credits.js`, `plans.js`, `billing.js` | berikutnya |
| 7 | AI editor (job, antrean, model cadangan) & asisten website | `ai.js`, `aiqueue.js`, `aimodels.js`, `assistant.js` | |
| 8 | Dashboard owner, lalu Node dimatikan | `admin.js` | |

Yang perlu dijaga selama dua server berjalan bersama:

- **Keadaan di memori** (rate limit, job AI, antrean, status model) hanya ada di satu proses. Karena itu
  satu kelompok rute dipindah utuh, tidak dipecah antara Go dan Node.
- **Kredit & job AI saling terikat** (potong kredit → job → refund), jadi tahap 6 dan 7 dipindah berdekatan.
- **Database project** (`data/db/<slug>.db`) masih dibuka kedua server sekaligus: Go untuk API publik dan
  editor database, Node untuk AI Builder (membuat tabel, membaca ringkasan skema). Keduanya memakai WAL + `busy_timeout`, dan Go membuang koneksinya bila
  file dihapus/diganti Node (project dihapus lalu dibuat lagi).
- **Database utama** (`data/rakit.db`): skemanya masih dibuat dan dimigrasikan Node (`src/db.js`), jadi Node
  harus pernah menyala lebih dulu. Sejak tahap 4 Go ikut menulis ke sana (akun, sesi, project, versi); kedua
  server memakai WAL + `busy_timeout`.
- **Batas request per akun** (300 tulis / 1.200 baca per menit) dihitung terpisah di Go dan di Node selama
  rute `/api` terbagi dua, jadi untuk sementara batas efektifnya bisa sampai dua kali lipat.
- **Kunci riwayat versi** per project ada di memori tiap server. Versi 'ai' masih dibuat Node (sebelum perubahan
  AI diterapkan), jadi bila user menyimpan file tepat saat AI selesai, dua snapshot bisa berjalan bersamaan.
  Akibat terburuknya versi ganda; hilang sendiri di tahap 7.
- **Pembersihan sesi kedaluwarsa** (tiap jam) masih dijalankan Node.
- **Konversi nilai** di `internal/userdb` meniru JavaScript (`Number()`, `parseInt`, `Date.parse`);
  `go test ./...` membandingkannya dengan jawaban Node yang direkam di `testdata/js.json`.

## Deploy tahap ini

Node tidak diubah (tetap di port 3010). Go dipasang di port 3011 dan Nginx diarahkan ke sana:

```bash
GOOS=linux GOARCH=amd64 go build -o bin/rakit .      # dari folder go/; sesuaikan GOARCH server
sudo cp deploy/rakit-go.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now rakit-go.service
# deploy/nginx-rakit.conf: proxy_pass http://127.0.0.1:3011;  lalu  sudo nginx -t && sudo systemctl reload nginx
```

Membatalkan: kembalikan `proxy_pass` ke `3010` dan reload Nginx.

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
| 3 | API situs: `/api/db/*` di domain project | `siteapi.js`, `userdb.js` | berikutnya |
| 4 | Akun, project, file, riwayat versi | `api.js`, `projects.js`, `files.js`, `versions.js`, `google.js` | |
| 5 | Editor database & diagram | `database.js`, `diagrams.js` | |
| 6 | Kredit, langganan, pembayaran, webhook | `credits.js`, `plans.js`, `billing.js` | |
| 7 | AI editor (job, antrean, model cadangan) & asisten website | `ai.js`, `aiqueue.js`, `aimodels.js`, `assistant.js` | |
| 8 | Dashboard owner, lalu Node dimatikan | `admin.js` | |

Yang perlu dijaga selama dua server berjalan bersama:

- **Keadaan di memori** (rate limit, job AI, antrean, status model) hanya ada di satu proses. Karena itu
  satu kelompok rute dipindah utuh, tidak dipecah antara Go dan Node.
- **Kredit & job AI saling terikat** (potong kredit → job → refund), jadi tahap 6 dan 7 dipindah berdekatan.
- **Skema database** masih dibuat dan dimigrasikan Node (`src/db.js`). Sebelum Go mulai menulis ke database
  (tahap 3 ke atas), Node perlu `PRAGMA busy_timeout` supaya tidak langsung gagal saat Go sedang menulis.

## Deploy tahap ini

Node tidak diubah (tetap di port 3010). Go dipasang di port 3011 dan Nginx diarahkan ke sana:

```bash
GOOS=linux GOARCH=amd64 go build -o bin/rakit .      # dari folder go/; sesuaikan GOARCH server
sudo cp deploy/rakit-go.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now rakit-go.service
# deploy/nginx-rakit.conf: proxy_pass http://127.0.0.1:3011;  lalu  sudo nginx -t && sudo systemctl reload nginx
```

Membatalkan: kembalikan `proxy_pass` ke `3010` dan reload Nginx.

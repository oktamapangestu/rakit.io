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
| `MAX_PROJECTS`, `GOOGLE_*`, `AI_*`, `KASERA_*`, `CREDIT_PACKAGES`, `ASSISTANT_PACKAGES`, `PLAN_*` | sama dengan Node | Dibaca dari `.env` yang sama. |

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
| 6 | Kredit, langganan, pembayaran QRIS, webhook | `credits.js`, `plans.js`, `billing.js` | selesai |
| 7 | AI editor (Builder/Plan, job, antrean, model cadangan) & asisten website | `ai.js`, `aiapply.js`, `aiqueue.js`, `aimodels.js`, `assistant.js` | selesai |
| 8 | Dashboard owner (statistik, harga, model asisten), skema database, lalu Node dimatikan | `admin.js`, `db.js` | berikutnya |

Yang perlu dijaga selama dua server berjalan bersama:

- **Yang masih di Node hanya dashboard owner** (`/api/admin`, kecuali `/api/admin/ai-models` yang sudah di Go)
  dan pembuatan skema database. Karena itu Node harus pernah menyala lebih dulu: tabel utama dibuat `src/db.js`,
  tabel asisten dibuat `src/assistant.js`.
- **`AI_JOBS_ELSEWHERE=1` wajib dipasang di server Node.** Job AI sekarang berjalan di Go. Tanpa variabel ini,
  Node yang restart akan menganggap job yang sedang berjalan di Go sebagai job terputus: menandainya gagal dan
  mengembalikan kreditnya. `scripts/go-with-node.sh` sudah memasangnya; di server, tambahkan ke `rakit.service`.
- **Panel antrean AI di dashboard owner** masih membaca antrean milik Node, yang sekarang selalu kosong.
  Angka sebenarnya ada di Go dan baru tampil lagi setelah tahap 8. Keadaan model (utama/cadangan) sudah benar.
- **Pengaturan owner** (harga langganan, kredit gratis, model asisten, blokir website) masih disimpan lewat Node
  ke tabel `settings`; Go membacanya tiap kali dipakai, jadi langsung berlaku.
- **Database** (`data/rakit.db` dan `data/db/<slug>.db`) dibuka kedua server dengan WAL + `busy_timeout`. Transaksi
  di Go selalu `BEGIN IMMEDIATE`.
- **Batas request per akun** (300 tulis / 1.200 baca per menit) dihitung terpisah untuk rute `/api/admin` di Node.
- **Pembersihan sesi kedaluwarsa** (tiap jam) masih dijalankan Node.
- **Prompt AI** di `internal/ai/prompts.go` dihasilkan dari `src/ai.js` oleh `node scripts/gen-go-prompts.cjs`.
  Selama `src/ai.js` masih ada, ubah prompt di sana lalu jalankan skrip itu.
- **Konversi nilai** di `internal/jsconv` dan `internal/userdb` meniru JavaScript (`Number()`, `parseInt`,
  `Date.parse`); `go test ./...` membandingkannya dengan jawaban Node yang direkam di `testdata/js.json`.

## Deploy tahap ini

Node tetap di port 3010 dengan satu tambahan di `rakit.service`: `Environment=AI_JOBS_ELSEWHERE=1`
(lalu `systemctl daemon-reload && systemctl restart rakit`). Go dipasang di port 3011 dan Nginx diarahkan ke sana:

```bash
GOOS=linux GOARCH=amd64 go build -o bin/rakit .      # dari folder go/; sesuaikan GOARCH server
sudo cp deploy/rakit-go.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now rakit-go.service
# deploy/nginx-rakit.conf: proxy_pass http://127.0.0.1:3011;  lalu  sudo nginx -t && sudo systemctl reload nginx
```

Membatalkan: kembalikan `proxy_pass` ke `3010`, hapus `AI_JOBS_ELSEWHERE` dari `rakit.service`, restart Node, dan reload
Nginx. Job AI yang sedang berjalan di Go saat itu akan ditandai gagal dan kreditnya dikembalikan.

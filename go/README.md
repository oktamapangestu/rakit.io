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
| `SITE_MINIFY` | `1` | Website publik dikirim dengan .html/.css/.js versi minify (`internal/sites/minify.go`); versi dev, preview editor & sandbox agen tetap asli. `0` mematikan. Hanya di server Go. |

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
- **Pemeriksaan kode AI Builder** (`internal/ai/codecheck.go`, `alpinecheck.go`, `csscheck.go`, `columncheck.go`,
  `internal/jscheck`), hanya di server Go. Saat file ditulis: sintaks JS (dikompilasi QuickJS tanpa dijalankan),
  ekspresi Alpine di atribut (`@click`, `x-text`, `:class`, …, dikompilasi seperti Alpine menyusunnya), `x-for`/`x-if`
  di `<template>` dengan satu elemen akar, dan struktur CSS (kurung `{}`, komentar, tanda kutip). Saat AI menyatakan
  selesai: rujukan file, komponen/urutan tag Alpine, `/api/fn/` yang tidak ada, dan nama kolom database (body
  `JSON.stringify({...})` ke `/api/db/<tabel>`, `p.<kolom>` di `<template x-for>`). Masalahnya dikembalikan ke AI untuk
  diperbaiki (masalah yang sama tidak dikirim dua kali). Gambar yang belum ada disebut di ringkasan. Hasilnya tersimpan
  di `ai_requests.checks` dan tampil di dashboard owner ("Kualitas kode AI per model"). Tool `edit_file` & `read_file`
  juga ada versi minimal di `src/ai.js` (tanpa pemeriksaan kode).
- **Perbaikan otomatis error preview** (`checkAutoFix` di `internal/ai/api.go`), hanya di server Go: bila preview
  menampilkan error JavaScript/request gagal setelah jawaban Builder, editor menghitung mundur 6 detik lalu mengirim
  `POST /api/ai/prompt` dengan `autoFix: <id jawaban>` dan `errors`. Gratis (tanpa kredit), sekali per jawaban, hanya
  untuk jawaban Builder terakhir di percakapan yang mengubah file, belum dibatalkan, dan berumur < 30 menit; jawaban
  hasil perbaikan otomatis tidak diperbaiki otomatis lagi. Isi permintaannya disusun server dari daftar error (maks.
  8 × 600 karakter). Server Node menolaknya ("Prompt tidak boleh kosong").
- **Riwayat percakapan AI** (`threadHistory`): dua jawaban terbaru yang mengubah file menyertakan baris yang berubah
  (maks. 3.000 karakter), dan jawaban yang dibatalkan pengguna ditandai, supaya permintaan lanjutan seperti "kembalikan
  yang tadi" bisa dikerjakan. Catatan ini ditaruh di pesan user sesudah jawabannya (bukan di jawaban AI), karena model
  menirunya sebagai teks tanpa memanggil tool. Bila ringkasan Builder tetap menyebut "(Perubahan: tulis x.js)" untuk
  file yang tidak diubah lewat tool, model diminta sekali untuk mengerjakannya (`unstagedClaims`, jenis masalah
  `claim` di statistik) dan baris itu dibuang dari ringkasan. Hanya di server Go.
- **Kode yang hilang saat file ditimpa** (`internal/ai/losscheck.go`): komentar placeholder ("// ... sisanya sama")
  dilaporkan saat ditulis dan di pemeriksaan akhir; komponen/store Alpine, fungsi global, dan id elemen yang hilang
  dari file tapi masih dipakai file lain dilaporkan di pemeriksaan akhir; `write_file` yang membuat file jauh lebih
  pendek diberi catatan (jenis `loss` dan `shrink` di statistik). `read_file` dengan `original: true` membaca isi
  file sebelum jawaban ini, untuk mengembalikan bagian yang terhapus.
- **Pemeriksaan maksud** (`internal/ai/intentcheck.go`, jenis `form` & `chatbot`): form isian pengunjung yang datanya
  tidak disimpan/dikirim ke mana pun, dan permintaan chatbot pengunjung yang tidak memakai widget asisten (atau masih
  menyisakan chat buatan sendiri). Keduanya terbukti sering dilewatkan model walau aturannya tertulis di prompt.
  Perubahan tanpa efek (isi sama seperti semula, file yang dibuat lalu dihapus lagi) tidak diterapkan.
- **Evaluasi AI** (`scripts/ai-eval/`): `npm run ai:eval -- --only id,id --model nama` menjalankan kasus tetap di
  `cases.mjs` dengan provider sungguhan dari `.env` (memakai biaya provider), hasil di `data/ai-eval/<waktu>/`.
  Kasus boleh membawa riwayat percakapan (`history`, langsung dimasukkan ke database). Kegagalan sungguhan:
  `node scripts/ai-eval/from-requests.mjs --data <folder data server>` mengambil job Builder yang masih menyisakan
  masalah (`ai_requests.checks.left`) beserta isi project sebelum AI bekerja (riwayat versi), riwayat percakapan, dan
  struktur database tanpa isi baris, ke `data/ai-eval/real/`; jalankan dengan `npm run ai:eval -- --real`. Isinya
  data pengguna: jangan dibagikan atau di-commit.
  `--engine claude` (dipisah koma untuk membandingkan, mis. `builder,claude`) mengerjakan kasus yang sama dengan
  [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) (lewat endpoint Anthropic-compatible
  provider) di container Docker (`deploy/agent/`, perlu Docker): tool bawaan mesinnya termasuk shell,
  `create_table` dengan skema Builder, dan uji halaman dengan Chromium (`cek-halaman`). Hasilnya dinilai dengan
  pemeriksaan akhir Builder yang sama lewat `rakit ai-check` (`internal/ai/evalcheck.go`), dan masalahnya dikirim
  balik ke mesin seperti di Builder. `--agents-md` menaruh aturan rakit di `AGENTS.md` ([agents.md](https://agents.md))
  di root project, dimuat mesinnya sendiri, sebagai ganti tambahan prompt sistem. `--skill` memasang skill rakit
  (`skills/rakit/SKILL.md`, format Agent Skills: semua detail teknis platform) di mesin sandbox; Builder tidak punya
  sistem skill, jadi isinya ditambahkan ke prompt Builder lewat `AI_BUILD_PROMPT_APPEND` (khusus eksperimen).
  `node scripts/ai-eval/compare.mjs
  <run> <run>…` menggabungkan beberapa run.
  Hanya untuk evaluasi, belum dipakai di produksi.
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

## Tool uji Builder

Builder punya tool uji yang meniru cara mesin agen menguji hasilnya sendiri (`internal/ai/lab.go`), tanpa container —
dari eval, ±60% perintah shell Claude Agent SDK adalah uji mandiri (`cek-halaman`, `curl` ke API, `node --check`):

- `test_api`: request HTTP ke website project (in-process lewat `AgentSite`): `/api/db` & `/api/fn` sungguhan,
  fungsi dijalankan dari salinan kerja job (file asli + perubahan yang sudah dicatat model; hard link, jadi murah).
- `check_page`: halaman dibuka di Chromium headless bersama (`internal/pagecheck`, chromedp) dengan layar HP 390 px:
  error JS/Alpine/console, request gagal, HTTP ≥ 400, dan halaman yang melebar. Satu proses browser untuk semua job,
  tab dibatasi `AI_BROWSER_MAX_CONCURRENT`, mati sendiri setelah menganggur. Jaringan browser lewat proxy penolak:
  hanya server lokal pemeriksaan & CDN umum yang bisa dijangkau (bukan 127.0.0.1 port lain atau jaringan internal).
  Tanpa browser (`AI_BROWSER=off` atau tidak ditemukan), tool ini tidak ditawarkan ke model.
- `search_files`: cari teks/regex di file terbaru.

Tabel yang dicatat model dibuat lebih awal saat tool uji pertama dipanggil (supaya bisa diuji); snapshot-nya ikut
pesan (Batalkan menghapusnya) dan dihapus lagi bila job gagal/dihentikan atau tidak ada yang diterapkan. Pemakaiannya
dicatat di statistik pemeriksaan (`found.page` = masalah dari `check_page`). Matikan dengan `AI_BUILDER_TESTS=0`.

## Mode Agen

Selain Builder dan Plan, editor punya mode **Agen** (`internal/ai/agent.go`): prompt dikerjakan Claude Agent SDK
di container Docker, untuk semua akun, 1 kredit per prompt seperti Builder. Hasilnya lewat jalur
Builder (perubahan diterapkan dengan snapshot, Simpan/Batalkan, statistik `ai_requests` dengan action `agent`).

- **Sandbox:** salinan kerja project + `AGENTS.md` (aturan prompt Builder + keadaan project, `agentsmd.go`) di-mount
  ke container. Container tanpa jaringan (`--network none`), sebagai user server non-root (`--user`, server root →
  1000:1000), tanpa capability (`--cap-drop ALL`, `no-new-privileges`), filesystem image read-only + `/tmp` sementara,
  batas memori/CPU/proses; tiga layanan
  host dibuka lewat unix socket dan dipetakan `deploy/agent/proxy.cjs` ke 127.0.0.1 di dalam container:
  website salinan kerja beserta `/api/db` & `/api/fn` project asli (`AgentSite` di `main.go`; chat asisten diblokir
  supaya saldo pemilik tidak terpakai), proxy AI (`agentproxy.go`: kunci provider tidak masuk container, model
  dipaksa ke model Builder, `max_tokens` dibatasi, token dihitung, batas `AI_AGENT_MAX_TOKENS` per prompt), dan
  `create_table` (tabel langsung dibuat supaya bisa diuji; snapshot-nya ikut Batalkan).
- **Batas kerja (anti-jailbreak):** ditegakkan sandbox, bukan prompt: layanan host terikat ke slug project itu;
  semua pembacaan salinan kerja di host (website untuk agen, fungsi serverless, selisih file) lewat `os.Root`
  (`files.OpenRegular`/`ReadRegular`/`ListTree`), jadi symlink buatan agen tidak pernah diikuti ke luar folder kerja
  (mis. ke project lain), juga bila ditukar di tengah jalan. `AGENTS.md` bagian "Security and scope" meminta agen
  menolak klaim sebagai owner/admin/sistem dan permintaan di luar project.
- **Pemeriksaan:** setiap kali agen selesai, `finalProblems` Builder dijalankan atas selisih file dan masalahnya
  dikirim balik (maks. 3 kali). File selain .html/.css/.js yang dibuat agen diabaikan dan disebut di jawaban.
- **Deploy:** `deploy/agent/build.sh` (butuh Docker), lalu `AI_AGENT_ENGINES=claude` di `.env` dan restart. Server
  mencatat di log apakah mesinnya aktif; tanpa image, mode Agen tidak ditampilkan. Claude memakai format Anthropic
  Messages (`<AI_BASE_URL>/messages`), jadi provider harus mendukungnya.
- **Pengembangan di macOS:** Docker Desktop tidak bisa membagi unix socket ke container — pakai
  `AI_AGENT_TRANSPORT=tcp` (tanpa isolasi jaringan, jangan untuk produksi).
- **Test:** `tests/agent.test.mjs` memakai mesin tiruan (`AI_AGENT_CMD`, `tests/helpers/fake-agent.mjs`) tanpa Docker;
  evaluasi dengan mesin sungguhan: `npm run ai:eval -- --engine agent:claude`
  (`--runtime` membuka setiap halaman hasil di Chromium dan menghitung error-nya).

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

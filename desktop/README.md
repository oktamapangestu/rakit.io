# rakit desktop

Versi desktop rakit.io: aplikasi **Tauri 2 (Rust)** yang menjalankan server rakit (Go, folder `go/`) di komputer
pengguna sebagai *sidecar*. Editornya sama dengan versi web, tetapi:

- project, database, dan riwayat disimpan di folder data aplikasi (bisa dipakai tanpa internet);
- satu akun lokal, masuk otomatis (tanpa daftar/login);
- AI memakai **AI pribadi** (tab *Provider AI*): API key OpenAI/DeepSeek/Groq/OpenRouter, atau **Ollama** di
  komputer sendiri (`http://localhost:11434/v1`) untuk AI yang sepenuhnya offline;
- **mode Agen (Claude Agent SDK)** berjalan langsung di komputer, tanpa Docker: Node.js, SDK (dengan binary Claude
  Code native), dan Chromium headless untuk `cek-halaman` ikut dibundel. Modelnya dari AI pribadi yang punya *Base URL
  mode Agen* berformat Anthropic (preset **Claude**: `https://api.anthropic.com/v1`, atau DeepSeek), dibayar
  pengguna langsung — tanpa jatah/kredit;
- website project tampil di `http://<slug>.localhost:<port>`;
- **akun rakit.io (opsional)**: tombol *rakit.io* di header. Masuk lewat browser (kode dicocokkan di
  `rakit.io/desktop/authorize`), lalu project lokal bisa **dipublikasikan ke rakit.io** (file + struktur tabel; data
  database dan gambar kiriman pengunjung di server tidak ditimpa, versi sebelumnya masuk Riwayat di server) dan
  project di rakit.io bisa **diunduh** ke komputer (file, gambar, dan database beserta datanya). Server tujuan:
  `RAKIT_CLOUD_URL` (bawaan `https://rakit.io`). Lihat `go/internal/api/cloud.go` (desktop) dan `sync.go` (server);
- fungsi serverless berjalan di runtime **WebAssembly** (QuickJS yang dikompilasi ke wasm, dijalankan wazero di
  dalam server Go — sama dengan versi web).

## Cara kerja

`src-tauri/src/lib.rs`:

1. memilih port bebas di `127.0.0.1` dan token acak;
2. menjalankan sidecar `rakit` dengan `DESKTOP=1` (lihat `go/internal/desktop`), `DATA_DIR` = folder data
   aplikasi, `PUBLIC_DIR`/`TEMPLATE_DIR` = resource bundle (`public/`, `templates/`);
3. menunggu server siap, lalu membuka jendela di `/desktop/start?token=…` — server membuat akun `lokal` (sekali)
   dan memasang sesi;
4. saat aplikasi ditutup, server ikut dihentikan. Log server: `<folder data>/server.log`.

macOS: WKWebView tidak mengenal `*.localhost`, jadi webview memakai server lokal sebagai proxy HTTP
(`DESKTOP_PROXY=1`, fitur Tauri `macos-proxy`, butuh macOS 14+). Windows (WebView2) dan Linux (WebKitGTK +
`nss-myhostname`) mengenal `*.localhost` sendiri.

Folder data:

| OS | Lokasi |
|---|---|
| Linux | `~/.local/share/io.rakit.desktop/data` |
| macOS | `~/Library/Application Support/io.rakit.desktop/data` |
| Windows | `%APPDATA%\io.rakit.desktop\data` |

Opsional: `.env` di folder data dibaca server (mis. `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` untuk AI bersama tanpa
mengisi tab Provider AI).

## Membangun

Butuh: Go 1.24+, Node.js 22+, Rust (rustup, stable), dan prasyarat Tauri per OS
(<https://v2.tauri.app/start/prerequisites/>). Di Debian/Ubuntu:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev build-essential
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Lalu dari folder `desktop/`:

```bash
npm install        # Tauri CLI
npm run dev        # jalankan (membangun sidecar + aset editor dulu)
npm run build      # installer: .deb/.AppImage/.rpm (Linux), .dmg/.app (macOS), .msi/.exe (Windows)
```

`scripts/build-agent-runtime.sh` menyiapkan runtime mode Agen di `src-tauri/agent-runtime/` (dibundel sebagai resource
`agent/`): Node.js 24, `@anthropic-ai/claude-agent-sdk` dkk. dengan versi yang sama dengan image Docker
(`deploy/agent/Dockerfile.claude`), dan Chromium headless Playwright. Ukurannya ±740 MB sebelum dikompres (Chromium
±320 MB, binary Claude ±230 MB, Node ±115 MB), jadi installer jauh lebih besar. Runtime harus dibangun di OS yang sama
dengan target.

`scripts/build-sidecar.sh` membangun aset editor (`npm run build` di akar repo) dan server Go untuk target Tauri
(`binaries/rakit-<target-triple>`, `CGO_ENABLED=0` — server Go murni, jadi bisa dibangun silang). Untuk melewati
build aset yang sudah ada: `RAKIT_SKIP_ASSETS=1`.

Installer dibangun per OS (build macOS di Mac, Windows di Windows), atau lewat CI
(<https://v2.tauri.app/distribute/pipelines/github/>).

## Batasan

- **Mode Agen tidak terkurung.** Tanpa Docker, agen berjalan sebagai proses biasa di salinan kerja project
  (`<folder data>/agent-jobs/…`) dengan HOME terpisah. Instruksinya melarang menyentuh file lain, tetapi secara teknis
  agen bisa membaca/mengubah file milik pengguna di luar folder itu.
- **Windows:** Claude Code butuh Git for Windows (Git Bash) untuk menjalankan perintah; tanpa itu mode Agen gagal.
- Linux: Chromium memakai build Playwright untuk Ubuntu 24.04 (berjalan di kebanyakan distro); pustaka sistemnya
  (`libnss3`, `libgbm1`, dsb.) harus ada.
- Tanpa *Base URL mode Agen* di AI pribadi, permintaan Agen dikerjakan Builder.
- Pembayaran, login Google, dan dashboard pemilik tidak dipakai.
- Tautan yang membuka tab baru (mis. "Lihat situs") belum diatur khusus; alamat `*.localhost` bisa dibuka di
  Chrome/Firefox selama aplikasi berjalan.

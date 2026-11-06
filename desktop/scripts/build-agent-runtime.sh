#!/usr/bin/env bash
# Runtime mode Agen tanpa Docker untuk aplikasi desktop (AI_AGENT_LOCAL, lihat go/internal/ai/agent.go):
#   src-tauri/agent-runtime/
#     claude_driver.mjs, cek-halaman.cjs   dari deploy/agent (sama dengan image Docker)
#     node_modules/                        Claude Agent SDK + Playwright (versi dikunci = deploy/agent/Dockerfile.claude)
#     ms-playwright/                       Chromium headless untuk cek-halaman
#     node/                                Node.js untuk OS target
#     bin/cek-halaman(.cmd)                perintah yang dipakai agen untuk membuka halaman
# Dibangun di OS yang sama dengan target (node_modules & Chromium bergantung platform).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
out="$here/../src-tauri/agent-runtime"
NODE_VERSION=24.11.1
triple="${TAURI_ENV_TARGET_TRIPLE:-$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')}"
case "$triple" in
  x86_64-unknown-linux-gnu)  dist=linux-x64    ;;
  aarch64-unknown-linux-gnu) dist=linux-arm64  ;;
  x86_64-apple-darwin)       dist=darwin-x64   ;;
  aarch64-apple-darwin)      dist=darwin-arm64 ;;
  x86_64-pc-windows-msvc)    dist=win-x64      ;;
  aarch64-pc-windows-msvc)   dist=win-arm64    ;;
  *) echo "target ${triple:-?} belum didukung" >&2; exit 1 ;;
esac

mkdir -p "$out/bin"
cp "$repo/deploy/agent/claude_driver.mjs" "$repo/deploy/agent/cek-halaman.cjs" "$out/"

# Node.js
if [ ! -e "$out/node/.version-$NODE_VERSION-$dist" ]; then
  rm -rf "$out/node" && mkdir -p "$out/node"
  tmp="$(mktemp -d)"
  if [[ $dist == win-* ]]; then
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$dist.zip" -o "$tmp/node.zip"
    unzip -q "$tmp/node.zip" -d "$tmp"
    cp "$tmp/node-v$NODE_VERSION-$dist/node.exe" "$out/node/"
  else
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$dist.tar.gz" | tar -xz -C "$tmp"
    cp "$tmp/node-v$NODE_VERSION-$dist/bin/node" "$out/node/"
  fi
  rm -rf "$tmp"
  touch "$out/node/.version-$NODE_VERSION-$dist"
fi

# SDK & Playwright (pakai npm dari sistem; skrip instalasi paket tidak dijalankan, sama dengan image Docker).
cd "$out"
[ -f package.json ] || echo '{ "private": true, "type": "commonjs" }' > package.json
npm install --no-audit --no-fund --ignore-scripts --save-exact \
  @anthropic-ai/claude-agent-sdk@0.3.286 @anthropic-ai/sdk@0.131.0 @modelcontextprotocol/sdk@1.31.0 zod@4.6.5 playwright@1.56.1
# Binary Claude Code native per platform (±230 MB): buang varian musl yang ikut terpasang di Linux glibc.
rm -rf node_modules/@anthropic-ai/claude-agent-sdk-*-musl

# Linux: Playwright hanya mengenal distro tertentu; build Ubuntu 24.04 berjalan di distro lain (juga yang lebih baru).
case "$dist" in
  linux-x64)   export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE="${PLAYWRIGHT_HOST_PLATFORM_OVERRIDE:-ubuntu24.04-x64}" ;;
  linux-arm64) export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE="${PLAYWRIGHT_HOST_PLATFORM_OVERRIDE:-ubuntu24.04-arm64}" ;;
esac
PLAYWRIGHT_BROWSERS_PATH="$out/ms-playwright" npx --no-install playwright install --only-shell chromium

# Perintah cek-halaman untuk agen (folder bin/ ada di PATH proses agen).
cat > bin/cek-halaman <<'SH'
#!/bin/sh
# Linux: pakai build Chromium Ubuntu 24.04 (lihat build-agent-runtime.sh).
if [ "$(uname -s)" = Linux ] && [ -z "${PLAYWRIGHT_HOST_PLATFORM_OVERRIDE:-}" ]; then
  case "$(uname -m)" in
    aarch64|arm64) export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64 ;;
    *) export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 ;;
  esac
fi
exec node "$(dirname "$0")/../cek-halaman.cjs" "$@"
SH
chmod +x bin/cek-halaman
printf '@node "%%~dp0..\\cek-halaman.cjs" %%*\r\n' > bin/cek-halaman.cmd
echo "runtime agen siap: $out ($(du -sh "$out" | cut -f1))"

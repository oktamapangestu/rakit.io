#!/usr/bin/env bash
# Membangun sidecar server rakit (Go) untuk target aplikasi desktop, plus aset frontend (public/).
# Tauri mencari binary sidecar bernama binaries/rakit-<target-triple>[.exe].
# Target diambil dari TAURI_ENV_TARGET_TRIPLE (diisi Tauri saat build), atau host rustc.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
triple="${TAURI_ENV_TARGET_TRIPLE:-$(rustc -vV | sed -n 's/^host: //p')}"

case "$triple" in
  x86_64-unknown-linux-gnu)  goos=linux   goarch=amd64 ;;
  aarch64-unknown-linux-gnu) goos=linux   goarch=arm64 ;;
  x86_64-apple-darwin)       goos=darwin  goarch=amd64 ;;
  aarch64-apple-darwin)      goos=darwin  goarch=arm64 ;;
  x86_64-pc-windows-msvc)    goos=windows goarch=amd64 ;;
  aarch64-pc-windows-msvc)   goos=windows goarch=arm64 ;;
  *) echo "target $triple belum didukung" >&2; exit 1 ;;
esac
ext=""
[ "$goos" = windows ] && ext=".exe"

# Aset editor (public/js, public/css) — dibundel sebagai resource aplikasi.
if [ ! -f "$repo/public/js/editor.js" ] || [ "${RAKIT_SKIP_ASSETS:-0}" != 1 ]; then
  (cd "$repo" && npm run build)
fi

out="$here/../src-tauri/binaries/rakit-$triple$ext"
echo "membangun sidecar $goos/$goarch -> $out"
(cd "$repo/go" && CGO_ENABLED=0 GOOS=$goos GOARCH=$goarch go build -trimpath -ldflags="-s -w" -o "$out" .)

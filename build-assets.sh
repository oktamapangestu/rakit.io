#!/usr/bin/env bash
# Minify aset frontend rakit.io.
# Sumber asli: assets-source/js, assets-source/css (+ modul & komponen Svelte di assets-source/editor, dibundel
#              ke skrip yang mengimpornya oleh scripts/bundle.mjs)
# Hasil:       public/js, public/css  (nama file sama, isi diminify), plus versi Inggris di public/js/en
#              dan public/en/editor.html (lihat scripts/i18n.mjs)
set -euo pipefail

cd "$(dirname "$0")"
ESBUILD="./node_modules/.bin/esbuild"

[ -x "$ESBUILD" ] || { echo "esbuild belum terpasang. Jalankan: npm install"; exit 1; }

echo "== Minify JavaScript =="
for f in assets-source/js/*.js; do
  name=$(basename "$f")
  before=$(wc -c < "$f")
  node scripts/bundle.mjs "$f" "public/js/$name"
  after=$(wc -c < "public/js/$name")
  pct=$(( (before - after) * 100 / before ))
  printf "  %-14s %7d -> %7d bytes  (-%d%%)\n" "$name" "$before" "$after" "$pct"
done

echo "== Minify CSS =="
for f in assets-source/css/*.css; do
  name=$(basename "$f")
  before=$(wc -c < "$f")
  "$ESBUILD" "$f" --minify --legal-comments=none --loader:.css=css \
    --outfile="public/css/$name" --log-level=warning
  after=$(wc -c < "public/css/$name")
  pct=$(( (before - after) * 100 / before ))
  printf "  %-14s %7d -> %7d bytes  (-%d%%)\n" "$name" "$before" "$after" "$pct"
done

echo
# Versi bahasa Inggris (public/js/en, public/en/editor.html) dari kamus assets-source/i18n/en.
node scripts/i18n.mjs build

echo
echo "Selesai. Total public/js + public/css: $(du -sh public/js public/css | awk '{s+=$1} END{print s}' 2>/dev/null || du -ch public/js public/css | tail -1 | cut -f1)"

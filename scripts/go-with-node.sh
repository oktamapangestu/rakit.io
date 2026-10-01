#!/usr/bin/env bash
# Jalankan server Go di depan (PORT) dengan server Node di belakangnya (UPSTREAM_PORT) — susunan
# selama migrasi bertahap. Dipakai untuk test (npm run test:go) dan pengembangan lokal.
#   PORT=3000 UPSTREAM_PORT=3001 bash scripts/go-with-node.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${PORT:=3000}"
: "${UPSTREAM_PORT:=$((PORT + 1))}"
[ -x go/bin/rakit ] || { echo "go/bin/rakit belum ada. Jalankan: npm run build:go"; exit 1; }

# Node tetap menulis URL publik dengan port server depan.
FRONT_PORT="$PORT"
# AI_JOBS_ELSEWHERE: job AI dijalankan server Go, jadi Node tidak ikut "memulihkan" job saat menyala.
PORT="$UPSTREAM_PORT" PUBLIC_PORT="${PUBLIC_PORT-$FRONT_PORT}" AI_JOBS_ELSEWHERE=1 node src/server.js &
NODE_PID=$!
# Node yang membuat skema database: tunggu sampai siap sebelum Go menerima request.
for _ in $(seq 1 100); do
  (exec 3<>"/dev/tcp/127.0.0.1/$UPSTREAM_PORT") 2>/dev/null && break
  kill -0 "$NODE_PID" 2>/dev/null || exit 1
  sleep 0.1
done
NODE_UPSTREAM="http://127.0.0.1:$UPSTREAM_PORT" go/bin/rakit &
GO_PID=$!

trap 'kill "$NODE_PID" "$GO_PID" 2>/dev/null || true' EXIT INT TERM
# Bila salah satu mati, hentikan yang lain juga.
while kill -0 "$NODE_PID" 2>/dev/null && kill -0 "$GO_PID" 2>/dev/null; do sleep 0.2; done

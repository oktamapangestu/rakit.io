#!/usr/bin/env bash
# Membangun image mesin mode Agen (Claude Agent SDK) untuk server rakit:
#   deploy/agent/build.sh
# Lalu aktifkan di .env: AI_AGENT_ENGINES=claude (lihat go/README.md, "Mode Agen").
set -euo pipefail
cd "$(dirname "$0")"
for engine in "${@:-claude}"; do
  for e in $engine; do
    echo "== rakit-agent-$e"
    docker build -t "rakit-agent-$e" -f "Dockerfile.$e" .
  done
done

#!/usr/bin/env bash
# Membangun image mesin mode Agen (Claude Agent SDK, Pi, OpenHands) untuk server rakit:
#   deploy/agent/build.sh            # ketiganya
#   deploy/agent/build.sh pi claude  # sebagian
# Lalu aktifkan di .env, mis. AI_AGENT_ENGINES=claude,pi,openhands (lihat go/README.md, "Mode Agen").
set -euo pipefail
cd "$(dirname "$0")"
for engine in "${@:-claude pi openhands}"; do
  for e in $engine; do
    echo "== rakit-agent-$e"
    docker build -t "rakit-agent-$e" -f "Dockerfile.$e" .
  done
done

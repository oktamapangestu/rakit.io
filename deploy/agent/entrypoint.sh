#!/bin/sh
# Jaringan container lewat proxy.cjs (website project di http://localhost/, proxy AI, create_table — lihat isinya),
# lalu jalankan mesin AI-nya.
set -e
node /opt/rakit/proxy.cjs &
exec "$@"

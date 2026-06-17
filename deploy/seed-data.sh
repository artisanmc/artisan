#!/usr/bin/env bash
#
# Seed the backend's data volume (mc-assets icons etc., ~2.2 GB, gitignored)
# onto the production server ONCE, after the backend app + its volume exist.
#
# Why: the 3D item icons are pre-rendered locally (Playwright + Three.js, heavy)
# and aren't regenerated in prod. backend/data/ is a persistent volume, not part
# of the image, so it must be populated out-of-band.
#
# Streams a tar over SSH (no rsync dependency — works from Git Bash on Windows).
# PNGs are already compressed, so we skip gzip for speed.
#
# Usage (run from the repo root):
#   VPS_HOST=root@1.2.3.4 VOLUME_PATH=/data/coolify/applications/<id>/data ./deploy/seed-data.sh
#
# Find VOLUME_PATH in Coolify → backend app → Storages (the host path of the
# volume mounted at /app/data), or:  docker volume inspect <name>
set -euo pipefail

: "${VPS_HOST:?set VPS_HOST=user@host}"
: "${VOLUME_PATH:?set VOLUME_PATH=/host/path/of/the/app/data volume}"

if [ ! -d backend/data ]; then
  echo "error: run from the repo root (backend/data not found)" >&2
  exit 1
fi

echo "[seed] sending backend/data → ${VPS_HOST}:${VOLUME_PATH}"
tar -C backend/data -cf - . | ssh "$VPS_HOST" "mkdir -p '$VOLUME_PATH' && tar -C '$VOLUME_PATH' -xf -"
echo "[seed] done. Restart the backend app in Coolify if it was already running."

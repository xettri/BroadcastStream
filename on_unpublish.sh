#!/bin/sh
# on_unpublish.sh — MediaMTX runOnNotReady callback (v1.16.2+)
#
# Alpine Linux (MediaMTX base image) has wget but NOT curl.

set -eu

RAW_PATH="${MTX_PATH:-}"
REMOTE_ADDR="${MTX_REMOTEADDR:-unknown}"
STREAM_KEY="${RAW_PATH#live/}"

echo "[on_unpublish] Stream ended: path=${RAW_PATH} key=${STREAM_KEY}"


wget -qO- \
  --post-data="name=${STREAM_KEY}&remoteAddr=${REMOTE_ADDR}" \
  "http://api:4000/webhook/on-unpublish" \
  && echo "[on_unpublish] API webhook OK" \
  || echo "[on_unpublish] WARNING: API webhook failed"

# Delayed cleanup: Wait 30s so viewers can finish the buffered part of the stream.
# We run this in the background (&) so the script exits immediately.
(
  echo "[on_unpublish] Cleanup scheduled in 30s for ${STREAM_KEY}..."
  sleep 30
  OUT_DIR="/var/www/hls/${STREAM_KEY}"
  if [ -d "${OUT_DIR}" ]; then
    echo "[on_unpublish] Cleanup: Removing expired HLS files for ${STREAM_KEY}"
    rm -rf "${OUT_DIR}"
  fi
) &

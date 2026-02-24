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

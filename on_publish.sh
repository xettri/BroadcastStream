#!/bin/sh
# on_publish.sh — MediaMTX runOnReady wrapper (v1.16.2+)
#
# Alpine Linux (MediaMTX base image) has wget but NOT curl.
#
# MediaMTX env vars:
#   MTX_PATH       — full stream path (e.g. "live/test")
#   MTX_REMOTEADDR — publisher IP:port
#   MTX_PROTOCOL   — protocol (rtmp, rtsp, etc.)

set -eu

RAW_PATH="${MTX_PATH:-}"
REMOTE_ADDR="${MTX_REMOTEADDR:-unknown}"
PROTOCOL="${MTX_PROTOCOL:-rtmp}"

if [ -z "${RAW_PATH}" ]; then
  echo "[on_publish] ERROR: MTX_PATH is empty" >&2
  exit 1
fi

# Strip leading "live/" prefix (OBS sends rtmp://host:1935/live/<key>)
STREAM_KEY="${RAW_PATH#live/}"

echo "[on_publish] Stream ready: path=${RAW_PATH} key=${STREAM_KEY} from=${REMOTE_ADDR}"

# Notify API webhook (use wget — curl not available in Alpine MediaMTX image)
wget -qO- \
  --post-data="name=${STREAM_KEY}&remoteAddr=${REMOTE_ADDR}&proto=${PROTOCOL}" \
  "http://api:4000/webhook/on-publish" \
  && echo "[on_publish] API webhook OK" \
  || echo "[on_publish] WARNING: API webhook failed (stream continues)"

# Launch FFmpeg ABR (blocks; MediaMTX kills this process on stream end)
exec /transcode.sh "${RAW_PATH}" "${STREAM_KEY}"

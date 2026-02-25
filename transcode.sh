#!/bin/sh
# ABR Low-Latency HLS Transcoder

set -eu

RTSP_PATH="${1:?Error: RTSP path (arg 1) required}"
# If key not provided, strip "live/" prefix from path
STREAM_KEY="${2:-}"
if [ -z "${STREAM_KEY}" ]; then
  STREAM_KEY="${RTSP_PATH#live/}"
fi

HLS_ROOT="/var/www/hls"
# Force TCP for internal relay to avoid UDP packet loss within Docker
RTSP_INPUT="rtsp://localhost:8554/${RTSP_PATH}?transport=tcp"
OUT_DIR="${HLS_ROOT}/${STREAM_KEY}"

echo "[transcode] Starting: key=${STREAM_KEY} input=${RTSP_INPUT}"

# Clear any old cache for this stream key
rm -rf "${OUT_DIR}"

# Create per-quality output directories
mkdir -p \
  "${OUT_DIR}/1080p" \
  "${OUT_DIR}/720p"  \
  "${OUT_DIR}/480p"  \
  "${OUT_DIR}/360p"

# Write ABR master playlist explicitly (HLS variant manifest)
cat > "${OUT_DIR}/master.m3u8" << 'EOF'
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=4692000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1296000,RESOLUTION=854x480,CODECS="avc1.64001e,mp4a.40.2"
480p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=664000,RESOLUTION=640x360,CODECS="avc1.640015,mp4a.40.2"
360p/index.m3u8
EOF

echo "[transcode] master.m3u8 written to ${OUT_DIR}"

# Run FFmpeg: 4-rendition ABR HLS output with 1s segments for low latency
ffmpeg \
  -hide_banner \
  -loglevel warning \
  -fflags nobuffer \
  -flags low_delay \
  -i "${RTSP_INPUT}" \
  -filter_complex \
    "[v:0]split=4[v1][v2][v3][v4]; \
     [v1]scale=1920:1080:flags=lanczos[v1out]; \
     [v2]scale=1280:720:flags=lanczos[v2out];  \
     [v3]scale=854:480:flags=lanczos[v3out];   \
     [v4]scale=640:360:flags=lanczos[v4out]"   \
  -map "[v1out]" -map "a:0" \
    -c:v:0 libx264 -preset ultrafast -tune zerolatency \
    -r 30 -g 30 -sc_threshold 0 \
    -b:v:0 0 -crf 23 -maxrate:v:0 4500k -bufsize:v:0 8000k \
    -c:a:0 aac -b:a:0 192k -ar 48000 \
    -f hls -hls_time 1 -hls_list_size 10 \
    -hls_flags "delete_segments+independent_segments" \
    -hls_segment_filename "${OUT_DIR}/1080p/%04d.ts" \
    "${OUT_DIR}/1080p/index.m3u8" \
  -map "[v2out]" -map "a:0" \
    -c:v:1 libx264 -preset ultrafast -tune zerolatency \
    -r 30 -g 30 -sc_threshold 0 \
    -b:v:1 0 -crf 23 -maxrate:v:1 2500k -bufsize:v:1 5000k \
    -c:a:1 aac -b:a:1 128k -ar 48000 \
    -f hls -hls_time 1 -hls_list_size 10 \
    -hls_flags "delete_segments+independent_segments" \
    -hls_segment_filename "${OUT_DIR}/720p/%04d.ts" \
    "${OUT_DIR}/720p/index.m3u8" \
  -map "[v3out]" -map "a:0" \
    -c:v:2 libx264 -preset ultrafast -tune zerolatency \
    -r 30 -g 30 -sc_threshold 0 \
    -b:v:2 0 -crf 23 -maxrate:v:2 1200k -bufsize:v:2 2400k \
    -c:a:2 aac -b:a:2 96k -ar 48000 \
    -f hls -hls_time 1 -hls_list_size 10 \
    -hls_flags "delete_segments+independent_segments" \
    -hls_segment_filename "${OUT_DIR}/480p/%04d.ts" \
    "${OUT_DIR}/480p/index.m3u8" \
  -map "[v4out]" -map "a:0" \
    -c:v:3 libx264 -preset ultrafast -tune zerolatency \
    -r 30 -g 30 -sc_threshold 0 \
    -b:v:3 0 -crf 23 -maxrate:v:3 600k -bufsize:v:3 1200k \
    -c:a:3 aac -b:a:3 64k -ar 48000 \
    -f hls -hls_time 1 -hls_list_size 10 \
    -hls_flags "delete_segments+independent_segments" \
    -hls_segment_filename "${OUT_DIR}/360p/%04d.ts" \
    "${OUT_DIR}/360p/index.m3u8"

echo "[transcode] FFmpeg exited for: ${STREAM_KEY}"
rm -rf "${OUT_DIR}"
echo "[transcode] Cleaned up: ${OUT_DIR}"

# BroadcastStream — Live Broadcast Streaming Microservice

> **Multi-source live streaming stack with ABR, ~2–4s latency, and Cloudflare CDN support.**
> Accepts streams from **OBS / RTMP**, **mobile RTMP apps**, and **browser/phone webcams (WebRTC)** — all through the same HLS pipeline.

```
  OBS / RTMP App              Browser / Phone
  rtmp://:1935             WebRTC/WHIP :8889
        │                         │
        └────────────┬────────────┘
                     ▼
            ┌─────────────────┐  runOnReady  ┌──────────────────┐
            │    MediaMTX     │─────────────►│  on_publish.sh   │
            │  (RTMP + WHIP)  │              │  → API webhook   │
            └────────┬────────┘              │  → transcode.sh  │
                     │ RTSP pull             └────────┬─────────┘
                     ▼                               │ FFmpeg ABR
            ┌─────────────────┐  /var/www/hls        │
            │     FFmpeg      │◄────────────────────-┘
            │  (4-rendition)  │──────────────────────►┌──────────────┐
            └─────────────────┘                       │  NGINX :8080 │
                                                      │  (HLS + HTML)│
            ┌─────────────────┐                       └──────┬───────┘
            │  Node.js API    │                              │ HLS
            │    :4000        │                              ▼
            │  /streams       │                    Viewer Browser / CDN
            └─────────────────┘
```

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture](#architecture)
3. [Project Structure](#project-structure)
4. [Configuration](#configuration)
5. [API Reference](#api-reference)
6. [Streaming Methods](#streaming-methods)
7. [Viewer](#viewer)
8. [ABR Quality Levels](#abr-quality-levels)
9. [Latency Deep Dive](#latency-deep-dive)
10. [CDN Integration (Cloudflare)](#cdn-integration-cloudflare)
11. [Environment Variables](#environment-variables)
12. [Local Dev (without Docker)](#local-dev-without-docker)
13. [TypeScript API Development](#typescript-api-development)
14. [Scaling Guide](#scaling-guide)
15. [How Big Players Do It](#how-big-players-do-it)
16. [Troubleshooting](#troubleshooting)
17. [Testing Changes in Docker (Hot Reloading)](#testing-changes-in-docker-hot-reloading)

---

## Quick Start

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/)

```bash
# 1. Clone and start the full stack
git clone <repo> broadcaststream && cd broadcaststream
docker compose up --build

# 2. Start streaming
#    From OBS (desktop):
#      Settings → Stream → Service: Custom
#      Server:     rtmp://localhost:1935/live
#      Stream Key: my-show
#      Click “Start Streaming”
#    From browser or phone (no app required):
#      Open: http://localhost:8080/broadcaster.html
#      Click “Open Camera” → “Go Live”

# 3. Watch the stream
#     Open: http://localhost:8080/viewer.html
#     Enter key (e.g. “my-show” or “webcam”) → Watch Live
```

**Ports exposed:**

| Port   | Protocol | Purpose                                         |
| ------ | -------- | ----------------------------------------------- |
| `1935` | TCP      | RTMP ingest — OBS / Larix / mobile apps         |
| `8080` | HTTP     | HLS + static pages (viewer, broadcaster)        |
| `8889` | HTTP     | WebRTC/WHIP ingest — browser + phone camera     |
| `8189` | UDP      | WebRTC ICE — actual media packets (WebRTC only) |
| `4000` | HTTP     | REST API — health, stream list, webhooks        |
| `9997` | HTTP     | MediaMTX internal API (debugging only)          |

---

## Architecture

### Services

| Service    | Image                                 | Role                                               |
| ---------- | ------------------------------------- | -------------------------------------------------- |
| `mediamtx` | `bluenviron/mediamtx:latest-ffmpeg`   | RTMP + WebRTC ingest, RTSP relay, webhook triggers |
| `nginx`    | `nginx:1.25-alpine`                   | HLS HTTP server + static HTML pages                |
| `api`      | Built from `Dockerfile.api` (Node 20) | REST API, stream registry                          |

### How a stream goes live (step by step)

Works identically for both RTMP (OBS) and WebRTC (browser/phone) — MediaMTX normalises both to RTSP internally.

1. **Broadcaster** connects via RTMP `:1935` (OBS) or WebRTC/WHIP `:8889` (browser)
2. **MediaMTX** accepts the stream and triggers `runOnReady: /on_publish.sh`
3. **`on_publish.sh`** fires a `wget` POST to the Node.js API (`/webhook/on-publish`) to register the stream in memory, then `exec`s `transcode.sh`
4. **`transcode.sh`** writes the `master.m3u8` ABR playlist, then starts a single FFmpeg process that:
   - Pulls the stream from MediaMTX internally via RTSP
   - Splits it into 4 resolution variants with `filter_complex`
   - Writes 1-second `.ts` segments + per-quality `index.m3u8` to `/var/www/hls/test/`
5. **NGINX** serves files from `/var/www/hls` (shared Docker volume) with correct CORS and cache headers
6. **Viewer** loads `master.m3u8` via Video.js → VHS (HLS), auto-selects quality based on bandwidth
7. When OBS stops, MediaMTX kills `transcode.sh` and calls `runOnNotReady: /on_unpublish.sh` which notifies the API

### Shared volume

`hls_data` is a Docker volume mounted to both `mediamtx` (write) and `nginx` (read). FFmpeg writes segments in-process — zero network hops between transcoding and serving.

---

## Project Structure

```
broadcaststream/
├── docker-compose.yml          # 3-service orchestration
├── Dockerfile.api              # Multi-stage TypeScript → Node.js image
│
├── mediamtx.yml                # MediaMTX config: RTMP, RTSP, hooks
├── on_publish.sh               # runOnReady: webhook + launches transcode.sh
├── on_unpublish.sh             # runOnNotReady: deregisters stream via API
├── transcode.sh                # FFmpeg ABR HLS (4-rendition, 1-pass)
│
├── nginx/
│   └── nginx.conf              # HLS HTTP server, cache + CORS headers
│
├── src/                        # Node.js TypeScript API
│   ├── index.ts                # Express app entry (port 4000)
│   ├── types/index.ts          # Shared interfaces
│   ├── services/
│   │   └── streamTracker.ts    # In-memory active stream registry
│   └── routes/
│       ├── health.ts           # GET /health
│       ├── streams.ts          # GET /streams, GET /streams/:key
│       └── webhooks.ts         # POST /webhook/on-publish|on-unpublish
│
├── public/
│   ├── viewer.html         # Video.js HLS viewer (http://localhost:8080/viewer.html)
│   └── broadcaster.html    # WebRTC/WHIP browser broadcaster (http://localhost:8080/broadcaster.html)
│
├── package.json                # Node.js deps (express, typescript, cors)
└── tsconfig.json               # TypeScript strict mode config
```

---

## Configuration

### `mediamtx.yml`

Key settings and why they matter:

```yaml
rtmpEncryption: "no" # Must be quoted — bare `no` is YAML bool, causes crash
rtspEncryption: "no" # Same rule

hls: false # We serve HLS ourselves via NGINX
webrtc: false # Disabled (can enable for sub-1s WebRTC)
srt: false # Disabled (enable for resilient mobile ingest)

api: true # MediaMTX REST API on :9997 (debugging)

paths:
  all_others: # Wildcard — accepts ANY stream key
    runOnReady: "/on_publish.sh" # Fires when stream goes live
    runOnReadyRestart: true # Re-run if FFmpeg crashes
    runOnNotReady: "/on_unpublish.sh" # Fires when stream ends
```

> **Note:** `pathDefaults:` does **not** accept new paths in MediaMTX v1+. You must use `paths: all_others:` (the built-in wildcard).

### `nginx/nginx.conf`

Cache strategy:

```nginx
location ~* \.m3u8$ {
    # Playlists change every ~1s — never cache
    add_header 'Cache-Control' 'no-cache, no-store, must-revalidate';
}

location ~* \.ts$ {
    # Segments are immutable once written — cache aggressively
    add_header 'Cache-Control' 'public, max-age=3600, immutable';
}
```

### `transcode.sh`

Single FFmpeg pass generating 4 HLS outputs simultaneously:

```bash
ffmpeg \
  -fflags nobuffer -flags low_delay \     # Minimize pipeline latency
  -i "rtsp://localhost:8554/live/test" \  # Pull live stream from MediaMTX
  -filter_complex "[v:0]split=4[v1][v2][v3][v4]; \
    [v1]scale=1920:1080[v1out]; ..." \    # Split → 4 scaled variants
  -preset ultrafast -tune zerolatency \   # Fastest encode (~100ms delay)
  -hls_time 1 \                           # 1-second segments (vs 6s default)
  -hls_list_size 6 \                      # Keep 6 segments in playlist (6s window)
  -hls_flags "delete_segments+independent_segments" \
  # × 4 outputs: 1080p, 720p, 480p, 360p
```

---

## API Reference

### `GET /health`

Liveness probe — returns service status, uptime, and active stream count.

```bash
curl http://localhost:4000/health
```

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "broadcaststream-api",
    "version": "1.0.0",
    "uptime": 3600,
    "activeStreams": 1,
    "timestamp": "2026-02-25T00:00:00.000Z"
  }
}
```

### `GET /streams`

Returns all currently live streams with their quality level URLs.

```bash
curl http://localhost:4000/streams
```

```json
{
  "success": true,
  "data": {
    "count": 1,
    "streams": [
      {
        "streamKey": "test",
        "startedAt": "2026-02-25T00:00:00.000Z",
        "clientIp": "1.2.3.4",
        "qualities": [
          {
            "label": "1080p",
            "bitrate": 4500,
            "resolution": "1920x1080",
            "playlistUrl": "http://localhost:8080/hls/test/1080p/index.m3u8"
          },
          {
            "label": "720p",
            "bitrate": 2500,
            "resolution": "1280x720",
            "playlistUrl": "http://localhost:8080/hls/test/720p/index.m3u8"
          },
          {
            "label": "480p",
            "bitrate": 1200,
            "resolution": "854x480",
            "playlistUrl": "http://localhost:8080/hls/test/480p/index.m3u8"
          },
          {
            "label": "360p",
            "bitrate": 600,
            "resolution": "640x360",
            "playlistUrl": "http://localhost:8080/hls/test/360p/index.m3u8"
          }
        ],
        "masterPlaylistUrl": "http://localhost:8080/hls/test/master.m3u8"
      }
    ]
  }
}
```

### `GET /streams/:key`

Returns info for a single active stream. Returns `404` if not live.

```bash
curl http://localhost:4000/streams/test
```

### `POST /webhook/on-publish` _(internal)_

Called by `on_publish.sh` when a stream goes live. Body fields: `name`, `remoteAddr`, `proto`.

### `POST /webhook/on-unpublish` _(internal)_

Called by `on_unpublish.sh` when a stream ends. Body fields: `name`, `remoteAddr`.

---

## Streaming Methods

### Method 1: OBS (Desktop, highest quality)

Best for: screen capture, game streaming, production setups with scene switching.

1. Open OBS → **Settings** → **Stream**
2. **Service:** `Custom`
3. **Server:** `rtmp://localhost:1935/live`
4. **Stream Key:** anything (e.g. `my-show`)
5. Click **Start Streaming**

**Recommended OBS encoding settings (low-latency):**

| Setting           | Value                    |
| ----------------- | ------------------------ |
| Encoder           | x264                     |
| Rate Control      | CBR                      |
| Bitrate           | 2500–6000 kbps           |
| Keyframe Interval | **1 second** (critical!) |
| Preset            | `veryfast` / `superfast` |
| Tune              | `zerolatency`            |
| Profile           | `High`                   |

---

### Method 2: Browser / Phone Camera (WebRTC, no app required)

Best for: casual phone live, shopping demos, quick broadcasts from any device.

1. Open **`http://localhost:8080/broadcaster.html`** in Chrome, Firefox, or Safari
2. (On phone: connect to same WiFi, then open the URL with your Mac's LAN IP instead of `localhost`)
3. Select camera and quality
4. Click **Open Camera** → **⬤ Go Live**
5. Stream key is `webcam` by default — change to anything

### Method 3: Mobile RTMP App

Download **Larix Broadcaster** (iOS/Android, free) or Streamlabs Mobile:

- **Server:** `rtmp://your-server-ip:1935/live`
- **Stream Key:** anything

All RTMP apps work the same way as OBS.

---

## Viewer

Open `public/viewer.html` directly in a browser — no web server needed (it's a static file).

**Powered by:**

- [Video.js 8](https://videojs.com/) — professional HTML5 player with dark skin
- [`@videojs/http-streaming`](https://github.com/videojs/http-streaming) (VHS) — built-in HLS support
- [`videojs-contrib-quality-levels`](https://github.com/videojs/videojs-contrib-quality-levels) — ABR rendition access
- [`videojs-hls-quality-selector`](https://github.com/chrisboustead/videojs-hls-quality-selector) — ⚙ quality menu in control bar

**Features:**

- Auto-detection of available stream qualities
- Manual quality override via control bar menu
- Live latency, buffer, and bandwidth stat chips
- Active Streams list (fetched from the API) — click any stream to watch
- Fullscreen support

**Direct URL** (VLC, mpv, ffplay):

```
http://localhost:8080/hls/{key}/master.m3u8
```

Low-latency VHS config used in the viewer:

```javascript
html5: {
  vhs: {
    lowLatencyMode: true,          // minimal playlist hold-back
    overrideNative: true,          // use VHS in Safari too
    allowSeeksWithinUnsafeLiveWindow: true,
    backBufferLength: 30,
  }
}
```

---

## ABR Quality Levels

All 4 quality levels are produced from a **single FFmpeg pass** using **CRF 23** (constant quality, not constant bitrate). This works for any input source — high-bitrate OBS, low-bitrate webcam, or phone camera — without VBV overflow errors.

| Quality | Resolution | Max Bitrate | Audio | Target Viewer           |
| ------- | ---------- | ----------- | ----- | ----------------------- |
| 1080p   | 1920×1080  | 4,500 kbps  | 192k  | Fast WiFi, desktop      |
| 720p    | 1280×720   | 2,500 kbps  | 128k  | Broadband, laptop       |
| 480p    | 854×480    | 1,200 kbps  | 96k   | Mobile 4G               |
| 360p    | 640×360    | 600 kbps    | 64k   | Weak / congested mobile |

Video.js VHS selects automatically based on measured throughput. Viewers can also override via the ⚙ button.

FFmpeg flags: `-b:v 0 -crf 23 -maxrate {cap} -bufsize {2×cap}`

---

## Latency Deep Dive

### How it adds up

```
OBS capture → RTMP push → MediaMTX relay → FFmpeg encode → segment write
  [≈0]          [≈50ms]     [≈30ms]          [≈100ms]        [1s segment]
                         → playlist update → VHS poll → decode → render
                             [≈0ms]           [≈500ms]   [≈50ms]
```

| Stage                          | Delay      | Optimization                          |
| ------------------------------ | ---------- | ------------------------------------- |
| RTMP ingest                    | ~50ms      | —                                     |
| RTSP relay (MediaMTX → FFmpeg) | ~30ms      | internal Docker loopback              |
| FFmpeg encode                  | **~100ms** | `-preset ultrafast -tune zerolatency` |
| HLS segment accumulation       | **~1s**    | `hls_time 1` (vs default 6s)          |
| Playlist poll interval (VHS)   | ~0.5–1s    | VHS polls aggressively in LL mode     |
| Viewer buffer minimum          | ~1–2s      | VHS `lowLatencyMode: true`            |
| **Total (best case)**          | **~2–3s**  |                                       |
| **Total (typical)**            | **~3–5s**  |                                       |

> Standard HLS (6s segments, no LL mode) = **8–14s latency**. This stack cuts it to **~2–5s** with no proprietary protocol.

---

## CDN Integration (Cloudflare)

### Why it works

| File type | Extension | Cache policy (NGINX header)           | Reason                                   |
| --------- | --------- | ------------------------------------- | ---------------------------------------- |
| Playlist  | `.m3u8`   | `no-cache, no-store, must-revalidate` | Updates every ~1s — must always be fresh |
| Segment   | `.ts`     | `public, max-age=3600, immutable`     | Written once, never mutated              |

Cloudflare caches `.ts` segments at 300+ PoPs. Your NGINX origin only answers `.m3u8` polls from CDN edge nodes — not from every viewer.

### Cloudflare setup

```
1. DNS: A record  stream.yourdomain.com → your-server-ip  (Proxied ON)
2. SSL: Full (strict)
3. Cache Rules:
   - URL: stream.yourdomain.com/hls/*.m3u8  →  Cache Level: Bypass
   - URL: stream.yourdomain.com/hls/*.ts    →  Cache Level: Standard (default)
4. Update docker-compose.yml environment:
   HLS_BASE_URL=https://stream.yourdomain.com/hls
5. Restart the API: docker compose restart api
```

Viewer URL: `https://stream.yourdomain.com/hls/{key}/master.m3u8`

---

## Environment Variables

Set in `docker-compose.yml` under the `api` service.

| Variable       | Default                     | Description                                                                   |
| -------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `PORT`         | `4000`                      | Node.js API port                                                              |
| `HLS_BASE_URL` | `http://localhost:8080/hls` | Base URL for HLS URLs returned by the API. Set to your CDN URL in production. |
| `NODE_ENV`     | `production`                | Node environment                                                              |

---

## Testing Changes in Docker (Hot Reloading)

Because we map source code into the containers as **Docker volumes** (in `docker-compose.yml`), you **don't need to rebuild or push anything** for most changes!

### 1. HTML / Frontend Changes (`public/*.html`)

Content is mapped directly into NGINX and updates are **instantaneous**. NGINX reads them directly from your Mac's hard drive.

- **How to test:** Save the file in your editor and refresh your browser.

### 2. Shell Scripts Config (`*.sh`)

Files like `transcode.sh`, `on_publish.sh`, and `on_unpublish.sh` are also mapped instantly into MediaMTX. However, if a stream is _already running_, it's using the old version of the script loaded into memory.

- **How to test:** Stop your stream (in OBS or click "End Stream" in the broadcaster), wait 2 seconds, and start streaming again. MediaMTX will load the newly saved scripts automatically!

### 3. Node.js API (`src/*.ts` or `package.json`)

The Node.js code is baked directly into the `broadcaststream-api` Docker image, so it requires a rebuild.

- **How to test:**
  ```bash
  docker compose up -d --build api
  ```

If you ever need to completely wipe the slate clean and restart MediaMTX to guarantee freshly loaded scripts and empty caches:

```bash
docker compose restart mediamtx
```

---

## Local Dev (without Docker)

For faster iteration on the API without rebuilding containers.

**Prerequisites:**

```bash
brew install ffmpeg
brew install mediamtx   # or: go install github.com/bluenviron/mediamtx@latest
```

```bash
# 1. Create HLS output directory
sudo mkdir -p /var/www/hls && sudo chmod 777 /var/www/hls

# 2. Start MediaMTX
mediamtx mediamtx.yml

# 3. Start the API (hot-reload)
npm install
npm run dev

# 4. Start NGINX for HLS serving
# (or skip NGINX and serve /var/www/hls with any static server)
npx serve -l 8080 /var/www/hls

# 5. Configure OBS → rtmp://localhost:1935/live  key: test
# 6. Open public/viewer.html
```

---

## TypeScript API Development

```bash
npm install          # Install all dependencies
npm run dev          # ts-node-dev with hot reload (port 4000)
npm run build        # Compile TypeScript → dist/
npm run type-check   # Type-check without emitting
npm start            # Run compiled dist/index.js
```

**Key source files:**

| File                            | Purpose                                                       |
| ------------------------------- | ------------------------------------------------------------- |
| `src/index.ts`                  | Express app setup, middleware, route mounting                 |
| `src/types/index.ts`            | `StreamInfo`, `QualityLevel`, `ApiResponse` interfaces        |
| `src/services/streamTracker.ts` | In-memory `Map<string, StreamInfo>` — add/remove/list streams |
| `src/routes/health.ts`          | `GET /health` — liveness probe                                |
| `src/routes/streams.ts`         | `GET /streams` + `GET /streams/:key`                          |
| `src/routes/webhooks.ts`        | `POST /webhook/on-publish` + `/on-unpublish`                  |

---

## Scaling Guide

### Vertical (more streams per server)

- **CPU bottleneck:** `libx264 ultrafast` uses ~80–100% of one CPU core per stream at 1080p.
  - Add more cores or enable GPU transcoding (see below).
- **GPU transcoding (NVIDIA):** Replace `-c:v:0 libx264` with `-c:v:0 h264_nvenc` in `transcode.sh`
  - One NVIDIA T4 GPU can transcode 30+ 1080p streams simultaneously.
  - Apple Silicon alternative: `-c:v:0 h264_videotoolbox`
- **Memory:** 1-second segments are tiny; disk/volume I/O is the constraint, not RAM.

### Horizontal (more viewers)

- Behind Cloudflare CDN, NGINX origin can serve **unlimited viewers** — CDN absorbs the load.
- For higher origin resilience, replicate NGINX + the `hls_data` volume via NFS or S3FS.

### Multi-region ingest

```
OBS (EU)   → rtmp://ingest-eu.yourdomain.com:1935/live
OBS (US)   → rtmp://ingest-us.yourdomain.com:1935/live
OBS (Asia) → rtmp://ingest-asia.yourdomain.com:1935/live
```

Use Anycast IP + GeoDNS (Cloudflare Load Balancing) to route streamers to the nearest MediaMTX ingest point. Each ingest runs its own FFmpeg and writes to a regional origin.

### Stream recording / VOD

Add `-f segment` or `-f hls` with S3 as output in `transcode.sh`:

```bash
# Write HLS simultaneously to S3 (requires s3fs or AWS CLI pipe)
-f hls ... s3://your-bucket/recordings/${STREAM_KEY}/index.m3u8
```

---

## How Big Players Do It

| Technique       | YouTube Live            | Twitch            | Amazon IVS        | **This Stack**                           |
| --------------- | ----------------------- | ----------------- | ----------------- | ---------------------------------------- |
| Ingest protocol | RTMP (proprietary ext.) | RTMP              | RTMP              | RTMP via MediaMTX                        |
| Transcoding     | GPU fleet (custom ASIC) | NVIDIA GPU        | AWS GPU instances | CPU libx264 (GPU-ready via h264_nvenc)   |
| Delivery        | Google Global Cache     | Akamai CDN        | CloudFront        | NGINX + Cloudflare                       |
| ABR renditions  | Up to 8 (144p–4K)       | Up to 6           | Up to 6           | 4 (360p–1080p)                           |
| Minimum latency | 2–4s (LL-HLS)           | 3–5s (LSHS)       | 2–5s (LL-HLS)     | ~2–5s (VHS LL mode)                      |
| Stream registry | Proprietary DB          | Proprietary DB    | DynamoDB          | In-memory Map (add Redis for multi-node) |
| Segment storage | RAM + GCS               | RAM (no disk I/O) | EFS + S3          | Docker volume (tmpfs for RAM)            |

---

## Troubleshooting

### MediaMTX crashes on startup

**Error:** `ERR: json: cannot unmarshal bool into Go struct field Conf.rtmpEncryption`

**Cause:** YAML bare `no` is parsed as boolean. MediaMTX expects a string enum.

**Fix:** Quote the value: `rtmpEncryption: "no"` ✓

---

### OBS connects but stream not accepted

**Error in logs:** `path 'live/test' is not configured`

**Cause:** MediaMTX v1+ requires `paths: all_others:` to accept arbitrary paths. `pathDefaults:` alone does not open new paths.

**Fix:** `mediamtx.yml` must have:

```yaml
paths:
  all_others:
    runOnReady: "/on_publish.sh"
```

---

### `bash: not found` in scripts

**Error in logs:** `env: can't execute 'bash': No such file or directory`

**Cause:** `bluenviron/mediamtx:latest-ffmpeg` is Alpine Linux — it has `/bin/sh` but no `bash`.

**Fix:** All scripts use `#!/bin/sh` (not `#!/usr/bin/env bash`). ✓ Already fixed.

---

### Active Streams always shows empty / webhooks fail

**Error in logs:** `/on_publish.sh: line N: curl: not found`

**Cause:** Alpine Linux ships `wget`, not `curl`.

**Fix:** `on_publish.sh` and `on_unpublish.sh` use `wget --post-data=...` instead of `curl -X POST`. ✓ Already fixed.

---

### `master.m3u8` returns 404 after stream starts

**Cause:** The `master.m3u8` is not auto-generated by FFmpeg for multi-output HLS — it must be written explicitly.

**Fix:** `transcode.sh` writes `master.m3u8` before starting FFmpeg. ✓ Already fixed.

---

### FFmpeg `runOnPublish` not found

**Error:** `ERR: json: unknown field "runOnPublish"`

**Cause:** Breaking change in MediaMTX v0.18 — hooks were renamed.

**Fix:**
| Old name (removed) | New name (v1+) |
|-----------------------|------------------------|
| `runOnPublish` | `runOnReady` |
| `runOnPublishRestart` | `runOnReadyRestart` |
| `runOnUnpublish` | `runOnNotReady` |

---

### High latency (>6s)

- Ensure OBS keyframe interval is set to **1 second** (matches `hls_time 1`)
- Check that `lowLatencyMode: true` is set in the Video.js VHS config
- Check network between OBS and server — RTMP needs stable low-jitter connection
- Reduce `hls_time` to `0.5` for lower latency (may cause decoder issues on some clients)

---

### FFmpeg codec option warnings

```
Codec AVOption b has not been used for any stream
```

These are **harmless warnings** — they occur because FFmpeg checks global options against all outputs, not just the intended one. They do not affect transcoding quality or correctness.

### Local testing with real link on different devices (Secure Context & HTTPS)

To access your camera on a phone, browser security requires **HTTPS**. We have implemented a **Unified Gateway** in NGINX so you only need one tunnel to rule them all.

#### 1. Start your tunnel (Port 8080)

```bash
# This one tunnel handles Web UI, API, and Video Ingest
cloudflared tunnel --url http://localhost:8080
```

#### 2. Open the link on your phone or desktop

- **Broadcaster:** `https://xxxx.trycloudflare.com/broadcaster.html`
- **Viewer:** `https://xxxx.trycloudflare.com/viewer.html`

The Broadcaster will automatically detect the tunnel URL and route your video through the tunnel's `/ingest` path—no manual configuration required!

#### ⚠️ What about RTMP / Mobile Apps?

Standard Cloudflare tunnels are for web traffic and **do not support RTMP**. If you are using an app like **OBS** or **Larix Broadcaster**:

- **On your Local:** Use your computer's Local IP address (e.g., `rtmp://[IP_ADDRESS]/live`) or `rtmp://localhost:1935/live` if you are testing on the same machine where the server is hosted.
- **Over the Internet:** Use a dedicated TCP tunnel (e.g., `ngrok tcp 1935`).
- **Viewing:** Regardless of how you ingest, anyone can watch via your secure Cloudflare link: `https://xxxx.trycloudflare.com/viewer.html`

---

## Deep Restart (Clean Slate)

If you have persistent "ghost" sessions or old video files sticking around, perform a deep restart to wipe the cache and rebuild everything:

```bash
# Stop containers and REMOVE the HLS video volume
docker compose down -v

# Start everything fresh
docker compose up --build -d
```

> **Note:** The `-v` flag is critical—it deletes the internal volume where old stream segments live.

/**
 * streamTracker.ts
 *
 * In-memory registry of currently active live streams.
 * MediaMTX fires HTTP webhooks (on-publish / on-unpublish) to keep
 * this map accurate in real time — no polling, no database required.
 *
 * This is a simple singleton Map; swap for Redis if you need
 * multi-instance horizontal scaling.
 */

import { StreamInfo, QualityLevel } from '../types/index.js';

/** HLS base URL for segment serving (NGINX on port 8080) */
const HLS_BASE_URL = process.env.HLS_BASE_URL ?? 'http://localhost:8080/hls';

/** ABR quality configuration — must match transcode.sh */
const QUALITY_LEVELS: Omit<QualityLevel, 'playlistUrl'>[] = [
  { label: '1080p', bitrate: 4500, resolution: '1920x1080' },
  { label: '720p', bitrate: 2500, resolution: '1280x720' },
  { label: '480p', bitrate: 1200, resolution: '854x480' },
  { label: '360p', bitrate: 600, resolution: '640x360' },
];

/** Active streams keyed by streamKey */
const activeStreams = new Map<string, StreamInfo>();

/**
 * Register a new stream when MediaMTX fires the on-publish webhook.
 */
export function addStream(streamKey: string, clientIp: string): StreamInfo {
  // Strip leading path prefix if MediaMTX sends "live/mykey"
  const key = streamKey.replace(/^live\//, '');

  const qualities: QualityLevel[] = QUALITY_LEVELS.map((q) => ({
    ...q,
    playlistUrl: `${HLS_BASE_URL}/${key}/${q.label}/index.m3u8`,
  }));

  const info: StreamInfo = {
    streamKey: key,
    startedAt: new Date().toISOString(),
    clientIp,
    qualities,
    masterPlaylistUrl: `${HLS_BASE_URL}/${key}/master.m3u8`,
  };

  activeStreams.set(key, info);
  console.log(`[StreamTracker] Stream added: ${key} from ${clientIp}`);
  return info;
}

/**
 * Remove a stream when MediaMTX fires the on-unpublish webhook.
 */
export function removeStream(streamKey: string): boolean {
  const key = streamKey.replace(/^live\//, '');
  const existed = activeStreams.delete(key);
  if (existed) {
    console.log(`[StreamTracker] Stream removed: ${key}`);
  }
  return existed;
}

/**
 * Return all currently active streams as an array.
 */
export function getStreams(): StreamInfo[] {
  return Array.from(activeStreams.values());
}

/**
 * Return a single stream by key, or undefined if not found.
 */
export function getStream(streamKey: string): StreamInfo | undefined {
  const key = streamKey.replace(/^live\//, '');
  return activeStreams.get(key);
}

/** Total count of active streams */
export function streamCount(): number {
  return activeStreams.size;
}

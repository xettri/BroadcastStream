/**
 * index.ts — ShopStream API Entry Point
 *
 * Minimal Express server that:
 *  - Receives MediaMTX webhooks to track live streams in memory
 *  - Exposes /health and /streams endpoints
 *  - Serves CORS headers for cross-origin browser requests
 *
 * Ports:
 *  API: 4000  (this service)
 *  HLS: 8080  (NGINX, separate container)
 *  RTMP: 1935 (MediaMTX, separate container)
 */

import express from 'express';
import cors from 'cors';

import healthRouter from './routes/health.js';
import streamsRouter from './routes/streams.js';
import webhookRouter from './routes/webhooks.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '4000', 10);

// ── Middleware ────────────────────────────────────────────────────────────────

/** Allow any origin — CDN / browser / admin tools all need access */
app.use(cors());

/** Parse JSON bodies (for future use) */
app.use(express.json());

/**
 * Parse URL-encoded bodies — MediaMTX sends webhooks as
 * application/x-www-form-urlencoded
 */
app.use(express.urlencoded({ extended: false }));

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/health', healthRouter);
app.use('/streams', streamsRouter);
app.use('/webhook', webhookRouter);

/** Root — API discovery */
app.get('/', (_req, res) => {
  res.json({
    service: 'shopstream-api',
    version: '1.0.0',
    endpoints: {
      health: 'GET  /health',
      streams: 'GET  /streams',
      stream: 'GET  /streams/:key',
      onPublish: 'POST /webhook/on-publish',
      onUnpublish: 'POST /webhook/on-unpublish',
    },
  });
});

/** 404 fallback */
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[ShopStream API] Running on http://0.0.0.0:${PORT}`);
  console.log(`[ShopStream API] Webhook endpoint: POST /webhook/on-publish`);
});

export default app;

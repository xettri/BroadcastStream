import express from 'express';
import cors from 'cors';

import healthRouter from './routes/health.js';
import streamsRouter from './routes/streams.js';
import webhookRouter from './routes/webhooks.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '4000', 10);

// Middleware
app.use(cors()); // Enable CORS for browser-based viewer and broadcaster
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Support MediaMTX form-encoded webhooks

// Routes
app.use('/health', healthRouter);
app.use('/streams', streamsRouter);
app.use('/webhook', webhookRouter);

/** Root — API discovery */
app.get('/', (_req, res) => {
  res.json({
    service: 'broadcaststream-api',
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


app.listen(PORT, () => {
  console.log(`[BroadcastStream API] Running on http://0.0.0.0:${PORT}`);
  console.log(`[BroadcastStream API] Webhook endpoint: POST /webhook/on-publish`);
});

export default app;

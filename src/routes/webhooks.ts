/**
 * webhooks.ts — MediaMTX HTTP Webhook Receivers
 *
 * MediaMTX is configured to POST to these endpoints when a stream
 * publishes or unpublishes. This is zero-polling real-time tracking
 * with no database required.
 *
 * Webhook config in mediamtx.yml:
 *   runOnPublish:     "curl -s -X POST http://api:4000/webhook/on-publish   -d 'name=%%name%%&remoteAddr=%%remoteAddr%%'"
 *   runOnUnpublish:   "curl -s -X POST http://api:4000/webhook/on-unpublish -d 'name=%%name%%&remoteAddr=%%remoteAddr%%'"
 */

import { Router, Request, Response } from 'express';
import { addStream, removeStream } from '../services/streamTracker.js';
import { MediaMTXWebhookPayload } from '../types/index.js';

const router = Router();

/**
 * POST /webhook/on-publish
 * Called by MediaMTX when a new RTMP/SRT stream starts publishing.
 * Body is x-www-form-urlencoded (MediaMTX default).
 */
router.post('/on-publish', (req: Request, res: Response): void => {
  const payload = req.body as MediaMTXWebhookPayload;
  const streamKey = payload.name ?? '';
  const clientIp = payload.remoteAddr ?? 'unknown';

  if (!streamKey) {
    res.status(400).json({ success: false, error: 'Missing stream name' });
    return;
  }

  const stream = addStream(streamKey, clientIp);
  console.log(`[Webhook] on-publish: ${streamKey} from ${clientIp}`);

  // Return 200 — MediaMTX will abort the stream if we return 4xx/5xx
  res.status(200).json({ success: true, data: stream });
});

/**
 * POST /webhook/on-unpublish
 * Called by MediaMTX when a stream disconnects or ends.
 */
router.post('/on-unpublish', (req: Request, res: Response): void => {
  const payload = req.body as MediaMTXWebhookPayload;
  const streamKey = payload.name ?? '';

  if (!streamKey) {
    res.status(400).json({ success: false, error: 'Missing stream name' });
    return;
  }

  const existed = removeStream(streamKey);
  console.log(`[Webhook] on-unpublish: ${streamKey} (existed=${existed})`);
  res.status(200).json({ success: true, data: { removed: existed } });
});

export default router;

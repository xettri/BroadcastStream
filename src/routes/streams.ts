/**
 * streams.ts — GET /streams, GET /streams/:key
 *
 * Returns the list of currently active live streams tracked by
 * the in-memory streamTracker. Populated via MediaMTX webhooks.
 */

import { Router, Request, Response } from 'express';
import { getStreams, getStream } from '../services/streamTracker.js';

const router = Router();

/** GET /streams — all active streams */
router.get('/', (_req: Request, res: Response): void => {
  const streams = getStreams();
  res.status(200).json({
    success: true,
    data: {
      count: streams.length,
      streams,
    },
    timestamp: new Date().toISOString(),
  });
});

/** GET /streams/:key — single stream info */
router.get('/:key', (req: Request, res: Response): void => {
  const stream = getStream(req.params['key'] ?? '');
  if (!stream) {
    res.status(404).json({
      success: false,
      data: null,
      timestamp: new Date().toISOString(),
    });
    return;
  }
  res.status(200).json({
    success: true,
    data: stream,
    timestamp: new Date().toISOString(),
  });
});

export default router;

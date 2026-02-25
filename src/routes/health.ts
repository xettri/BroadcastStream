/**
 * health.ts — GET /health
 *
 * Simple liveness probe used by Docker healthchecks, load balancers,
 * and uptime monitoring (e.g. Cloudflare Health Checks).
 */

import { Router, Request, Response } from 'express';
import { streamCount } from '../services/streamTracker.js';

const router = Router();

router.get('/', (_req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      service: 'broadcaststream-api',
      version: '1.0.0',
      uptime: Math.floor(process.uptime()),
      activeStreams: streamCount(),
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Dashboard API Authentication middleware.
 *
 * Migrated from apps/api/src/middleware/auth.ts requireDashboardAuth().
 * Protects /api/* dashboard endpoints with an API key.
 */
export function requireDashboardAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = config.ADMIN_API_KEY;

  // Skip auth in development if no key is configured
  if (!apiKey && config.NODE_ENV === 'development') {
    next();
    return;
  }

  if (!apiKey) {
    logger.error('ADMIN_API_KEY not configured in production — blocking all dashboard requests');
    res.status(503).json({ error: 'Dashboard authentication not configured' });
    return;
  }

  const authHeader = req.headers.authorization;
  const xApiKey = req.headers['x-api-key'] as string | undefined;

  let providedKey: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7);
  } else if (xApiKey) {
    providedKey = xApiKey;
  }

  if (!providedKey) {
    res.status(401).json({
      error: 'Authentication required. Provide API key via Authorization: Bearer <key> or x-api-key header.',
    });
    return;
  }

  const providedBuffer = Buffer.from(providedKey, 'utf-8');
  const expectedBuffer = Buffer.from(apiKey, 'utf-8');

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    logger.warn({ ip: req.ip }, 'Invalid dashboard API key');
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  next();
}

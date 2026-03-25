import { Router, Request, Response } from 'express';
import { getPool } from '@flowguard/db';

/**
 * Health check endpoint.
 * Migrated from apps/api/src/routes/health.ts.
 */
const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const dbResult = await pool.query('SELECT 1');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbResult ? 'connected' : 'disconnected',
      },
      version: '0.2.0',
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'disconnected',
      },
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;

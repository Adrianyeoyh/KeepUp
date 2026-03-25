import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const dbResult = await pool.query('SELECT 1');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbResult ? 'connected' : 'disconnected',
      },
      version: '0.1.0',
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

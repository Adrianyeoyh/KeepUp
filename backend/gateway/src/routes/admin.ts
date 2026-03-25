import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { query } from '@flowguard/db';
import { config } from '../config.js';

/**
 * Admin routes — company and integration management.
 * Migrated from apps/api/src/routes/admin.ts.
 */

const router = Router();

const CompanySettingsPatchSchema = z.object({
  insight_budget_per_day: z.number().int().min(1).max(10).optional(),
  confidence_threshold: z.number().min(0).max(1).optional(),
  digest_cron: z.string().optional(),
  digest_user_ids: z.array(z.string()).optional(),
  digest_channel_ids: z.array(z.string()).optional(),
});

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!config.ADMIN_API_KEY) { next(); return; }

  const providedKey = req.header('x-admin-key') || '';
  const expectedKey = config.ADMIN_API_KEY;
  const providedBuffer = Buffer.from(providedKey);
  const expectedBuffer = Buffer.from(expectedKey);

  const isValid = providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);

  if (!isValid) { res.status(401).json({ error: 'Unauthorized' }); return; }
  next();
}

router.use(requireAdminKey);

router.get('/companies', async (_req: Request, res: Response) => {
  const companies = await query(
    `SELECT id, name, slug, settings, created_at, updated_at FROM companies ORDER BY created_at DESC`,
  );
  res.json({ companies: companies.rows });
});

router.patch('/companies/:companyId/settings', async (req: Request, res: Response) => {
  const companyId = req.params.companyId;
  const parsed = CompanySettingsPatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'Provide at least one settings field to update.' });
    return;
  }

  const current = await query<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM companies WHERE id = $1 LIMIT 1`,
    [companyId],
  );
  if (!current.rows[0]) { res.status(404).json({ error: 'Company not found' }); return; }

  const mergedSettings = { ...(current.rows[0].settings || {}), ...patch };
  const updated = await query(
    `UPDATE companies SET settings = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, slug, settings, updated_at`,
    [JSON.stringify(mergedSettings), companyId],
  );

  res.json({ company: updated.rows[0] });
});

export default router;

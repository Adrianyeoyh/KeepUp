import { Router, Request, Response } from 'express';
import { query } from '@flowguard/db';
import { logger } from '../logger.js';

/**
 * AI Engine HTTP routes — mounted by the gateway.
 *
 * Migrated from apps/api/src/routes/inference.ts.
 */
const router = Router();

router.post('/inference/run', async (req: Request, res: Response) => {
  try {
    const { team_id: teamId, project_id: projectId, dry_run: dryRun } = req.body as {
      team_id?: string;
      project_id?: string;
      dry_run?: boolean;
    };

    const companiesResult = await query<{ id: string }>(
      `SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`,
    );
    const companyId = companiesResult.rows[0]?.id;
    if (!companyId) {
      res.status(404).json({ error: 'No company found to run inference against' });
      return;
    }

    // Placeholder: trigger inference engine via event bus or direct call
    res.json({
      ok: true,
      company_id: companyId,
      team_id: teamId || null,
      project_id: projectId || null,
      result: { message: 'Inference engine triggered' },
    });
  } catch (err) {
    logger.error({ err }, 'Inference engine run failed');
    res.status(500).json({ error: 'Failed to run inference engine' });
  }
});

router.patch('/inferred-links/:id', async (req: Request, res: Response) => {
  try {
    const inferredLinkId = req.params.id;
    const { status, actor } = req.body as {
      status?: 'confirmed' | 'dismissed';
      actor?: string;
    };

    if (status !== 'confirmed' && status !== 'dismissed') {
      res.status(400).json({ error: 'status must be "confirmed" or "dismissed"' });
      return;
    }

    const result = await query(
      `UPDATE inferred_links
       SET status = $1::varchar,
         confidence = CASE WHEN $1::varchar = 'confirmed' THEN 1.0 ELSE confidence END,
         confirmed_by = $2, confirmed_at = NOW(), updated_at = NOW()
       WHERE id = $3
       RETURNING id, status, confidence, confirmed_by, confirmed_at, updated_at`,
      [status, actor || 'web_ui', inferredLinkId],
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Inferred link not found' });
      return;
    }

    res.json({ inferred_link: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Inferred link status update failed');
    res.status(500).json({ error: 'Failed to update inferred link status' });
  }
});

export default router;

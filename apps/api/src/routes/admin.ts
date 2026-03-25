import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import {
  IntegrationSchema,
  IntegrationProviderSchema,
  IntegrationStatusSchema,
} from '@flowguard/shared';
import { config } from '../config.js';
import { query } from '../db/client.js';
import { integrationService } from '../services/integration.js';

const router = Router();

const CompanySettingsPatchSchema = z.object({
  insight_budget_per_day: z.number().int().min(1).max(10).optional(),
  confidence_threshold: z.number().min(0).max(1).optional(),
  digest_cron: z.string().optional(),
  digest_user_ids: z.array(z.string()).optional(),
  digest_channel_ids: z.array(z.string()).optional(),
});

const IntegrationUpsertBodySchema = z.object({
  status: IntegrationStatusSchema.optional(),
  installation_data: z.record(z.unknown()).optional(),
  token_data: z.record(z.unknown()).optional(),
  scopes: z.array(z.string()).optional(),
  webhook_secret: z.string().nullable().optional(),
});

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!config.ADMIN_API_KEY) {
    next();
    return;
  }

  const providedKey = req.header('x-admin-key') || '';
  const expectedKey = config.ADMIN_API_KEY;

  const providedBuffer = Buffer.from(providedKey);
  const expectedBuffer = Buffer.from(expectedKey);

  const isValid = providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);

  if (!isValid) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

type IntegrationRecord = z.infer<typeof IntegrationSchema>;

function sanitizeIntegrationForResponse(integration: IntegrationRecord) {
  const tokenData = integration.token_data && typeof integration.token_data === 'object'
    ? integration.token_data as Record<string, unknown>
    : {};

  return {
    id: integration.id,
    company_id: integration.company_id,
    provider: integration.provider,
    status: integration.status,
    installation_data: integration.installation_data,
    scopes: integration.scopes,
    webhook_secret_configured: Boolean(integration.webhook_secret),
    token_keys: Object.keys(tokenData),
    updated_at: integration.updated_at,
    created_at: integration.created_at,
  };
}

router.use(requireAdminKey);

router.get('/companies', async (_req: Request, res: Response) => {
  const companies = await query(
    `SELECT id, name, slug, settings, created_at, updated_at
     FROM companies
     ORDER BY created_at DESC`,
  );

  res.json({
    companies: companies.rows,
  });
});

router.patch('/companies/:companyId/settings', async (req: Request, res: Response) => {
  const companyId = Array.isArray(req.params.companyId) ? req.params.companyId[0] : req.params.companyId;
  const parsed = CompanySettingsPatchSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'Provide at least one settings field to update.' });
    return;
  }

  const current = await query<{ settings: Record<string, unknown> }>(
    `SELECT settings
     FROM companies
     WHERE id = $1
     LIMIT 1`,
    [companyId],
  );

  if (!current.rows[0]) {
    res.status(404).json({ error: 'Company not found' });
    return;
  }

  const mergedSettings = {
    ...(current.rows[0].settings || {}),
    ...patch,
  };

  const updated = await query(
    `UPDATE companies
     SET settings = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, name, slug, settings, updated_at`,
    [JSON.stringify(mergedSettings), companyId],
  );

  res.json({
    company: updated.rows[0],
  });
});

router.get('/integrations/:companyId', async (req: Request, res: Response) => {
  const companyId = Array.isArray(req.params.companyId) ? req.params.companyId[0] : req.params.companyId;
  const integrations = await integrationService.listByCompany(companyId);

  res.json({
    integrations: integrations.map(sanitizeIntegrationForResponse),
  });
});

router.put('/integrations/:companyId/:provider', async (req: Request, res: Response) => {
  const companyId = Array.isArray(req.params.companyId) ? req.params.companyId[0] : req.params.companyId;
  const provider = Array.isArray(req.params.provider) ? req.params.provider[0] : req.params.provider;

  const providerResult = IntegrationProviderSchema.safeParse(provider);
  if (!providerResult.success) {
    res.status(400).json({ error: 'Invalid integration provider' });
    return;
  }

  const parsedBody = IntegrationUpsertBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.flatten() });
    return;
  }

  const body = parsedBody.data;

  const integration = await integrationService.upsert({
    companyId,
    provider: providerResult.data,
    status: body.status,
    installationData: body.installation_data,
    tokenData: body.token_data,
    scopes: body.scopes,
    webhookSecret: body.webhook_secret,
  });

  res.json({
    integration: sanitizeIntegrationForResponse(integration),
  });
});

export default router;

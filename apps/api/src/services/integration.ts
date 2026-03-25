import type { Integration, IntegrationProvider, IntegrationStatus } from '@flowguard/shared';
import { query } from '../db/client.js';

type UpsertIntegrationInput = {
  companyId: string;
  provider: IntegrationProvider;
  status?: IntegrationStatus;
  installationData?: Record<string, unknown>;
  tokenData?: Record<string, unknown>;
  scopes?: string[];
  webhookSecret?: string | null;
};

class IntegrationService {
  async getByCompanyProvider(companyId: string, provider: IntegrationProvider): Promise<Integration | null> {
    const result = await query<Integration>(
      `SELECT *
       FROM integrations
       WHERE company_id = $1 AND provider = $2
       LIMIT 1`,
      [companyId, provider],
    );

    return result.rows[0] || null;
  }

  async listByCompany(companyId: string): Promise<Integration[]> {
    const result = await query<Integration>(
      `SELECT *
       FROM integrations
       WHERE company_id = $1
       ORDER BY provider ASC`,
      [companyId],
    );

    return result.rows;
  }

  async upsert(input: UpsertIntegrationInput): Promise<Integration> {
    const existing = await this.getByCompanyProvider(input.companyId, input.provider);

    const status = input.status || existing?.status || 'active';
    const installationData = input.installationData ?? existing?.installation_data ?? {};
    const tokenData = input.tokenData ?? existing?.token_data ?? {};
    const scopes = input.scopes ?? existing?.scopes ?? [];
    const hasWebhookSecret = Object.prototype.hasOwnProperty.call(input, 'webhookSecret');
    const webhookSecret = hasWebhookSecret
      ? (input.webhookSecret ?? null)
      : (existing?.webhook_secret ?? null);

    const result = await query<Integration>(
      `INSERT INTO integrations (
        company_id,
        provider,
        status,
        installation_data,
        token_data,
        scopes,
        webhook_secret
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (company_id, provider)
      DO UPDATE SET
        status = EXCLUDED.status,
        installation_data = EXCLUDED.installation_data,
        token_data = EXCLUDED.token_data,
        scopes = EXCLUDED.scopes,
        webhook_secret = EXCLUDED.webhook_secret,
        updated_at = NOW()
      RETURNING *`,
      [
        input.companyId,
        input.provider,
        status,
        JSON.stringify(installationData),
        JSON.stringify(tokenData),
        scopes,
        webhookSecret,
      ],
    );

    return result.rows[0];
  }

  async getActive(companyId: string, provider: IntegrationProvider): Promise<Integration | null> {
    const integration = await this.getByCompanyProvider(companyId, provider);
    return integration?.status === 'active' ? integration : null;
  }
}

export const integrationService = new IntegrationService();

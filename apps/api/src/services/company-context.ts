import type { IntegrationProvider } from '@flowguard/shared';
import { query } from '../db/client.js';

type CompanyRow = {
  id: string;
  slug: string;
};

const DEFAULT_COMPANY_SLUG = process.env.DEFAULT_COMPANY_SLUG || 'flowguard-default';
const DEFAULT_COMPANY_NAME = process.env.DEFAULT_COMPANY_NAME || 'FlowGuard Default Company';

async function getOrCreateDefaultCompany(): Promise<CompanyRow> {
  const existing = await query<CompanyRow>(
    'SELECT id, slug FROM companies WHERE slug = $1 LIMIT 1',
    [DEFAULT_COMPANY_SLUG],
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const created = await query<CompanyRow>(
    `INSERT INTO companies (name, slug)
     VALUES ($1, $2)
     RETURNING id, slug`,
    [DEFAULT_COMPANY_NAME, DEFAULT_COMPANY_SLUG],
  );

  return created.rows[0];
}

export async function ensureDefaultCompanyId(): Promise<string> {
  const company = await getOrCreateDefaultCompany();
  return company.id;
}

export async function resolveCompanyByProviderContext(
  provider: IntegrationProvider,
  context: {
    slackTeamId?: string;
    jiraCloudId?: string;
    jiraProjectKey?: string;
    githubRepoFullName?: string;
  },
): Promise<string> {
  if (provider === 'slack' && context.slackTeamId) {
    const result = await query<{ company_id: string }>(
      `SELECT company_id
       FROM integrations
       WHERE provider = 'slack'
         AND installation_data->>'team_id' = $1
       LIMIT 1`,
      [context.slackTeamId],
    );

    if (result.rows[0]?.company_id) {
      return result.rows[0].company_id;
    }
  }

  if (provider === 'jira' && context.jiraCloudId) {
    const result = await query<{ company_id: string }>(
      `SELECT company_id
       FROM integrations
       WHERE provider = 'jira'
         AND installation_data->>'cloud_id' = $1
       LIMIT 1`,
      [context.jiraCloudId],
    );

    if (result.rows[0]?.company_id) {
      return result.rows[0].company_id;
    }
  }

  if (provider === 'jira' && context.jiraProjectKey) {
    const result = await query<{ company_id: string }>(
      `SELECT company_id
       FROM integrations
       WHERE provider = 'jira'
         AND installation_data->'project_keys' ? $1
       LIMIT 1`,
      [context.jiraProjectKey],
    );

    if (result.rows[0]?.company_id) {
      return result.rows[0].company_id;
    }
  }

  if (provider === 'github' && context.githubRepoFullName) {
    const result = await query<{ company_id: string }>(
      `SELECT company_id
       FROM integrations
       WHERE provider = 'github'
         AND (
           installation_data->>'repo_full_name' = $1
           OR installation_data->'repositories' ? $1
         )
       LIMIT 1`,
      [context.githubRepoFullName],
    );

    if (result.rows[0]?.company_id) {
      return result.rows[0].company_id;
    }
  }

  return ensureDefaultCompanyId();
}

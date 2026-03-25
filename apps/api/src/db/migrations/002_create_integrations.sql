-- Migration: 002_create_integrations
-- Per-tool connection per company (Slack, Jira, GitHub)

CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('slack', 'jira', 'github', 'zendesk')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'error', 'revoked')),
  installation_data JSONB NOT NULL DEFAULT '{}',
  token_data JSONB NOT NULL DEFAULT '{}',
  scopes TEXT[] NOT NULL DEFAULT '{}',
  webhook_secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(company_id, provider)
);

CREATE INDEX idx_integrations_company ON integrations(company_id);
CREATE INDEX idx_integrations_provider ON integrations(provider);

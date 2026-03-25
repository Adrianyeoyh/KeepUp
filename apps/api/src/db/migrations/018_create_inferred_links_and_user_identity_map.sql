-- Migration 018: Inferred links + cross-platform identity map
--
-- inferred_links:
--   Stores confidence-scored inferred entity relationships used to augment
--   sparse explicit metadata links.
--
-- user_identity_map:
--   Team-scoped mapping between Slack, GitHub, and Jira identities for
--   temporal + author correlation strategies.

CREATE TABLE IF NOT EXISTS inferred_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_provider VARCHAR(20) NOT NULL CHECK (source_provider IN ('slack', 'jira', 'github')),
  source_entity_type VARCHAR(30) NOT NULL DEFAULT '',
  source_entity_id TEXT NOT NULL,
  target_provider VARCHAR(20) NOT NULL CHECK (target_provider IN ('slack', 'jira', 'github')),
  target_entity_type VARCHAR(30) NOT NULL DEFAULT '',
  target_entity_id TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  inference_reason JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'confirmed', 'dismissed', 'expired')),
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inferred_links_unique_pair
  ON inferred_links(
    company_id,
    source_provider,
    source_entity_type,
    source_entity_id,
    target_provider,
    target_entity_type,
    target_entity_id
  );

CREATE INDEX IF NOT EXISTS idx_inferred_links_company
  ON inferred_links(company_id, status, confidence DESC);

CREATE INDEX IF NOT EXISTS idx_inferred_links_source
  ON inferred_links(company_id, source_provider, source_entity_id);

CREATE INDEX IF NOT EXISTS idx_inferred_links_target
  ON inferred_links(company_id, target_provider, target_entity_id);

CREATE INDEX IF NOT EXISTS idx_inferred_links_team
  ON inferred_links(company_id, team_id, status);

CREATE TABLE IF NOT EXISTS user_identity_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  slack_user_id TEXT,
  github_username TEXT,
  jira_account_id TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    slack_user_id IS NOT NULL OR github_username IS NOT NULL OR jira_account_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identity_team_slack
  ON user_identity_map(team_id, slack_user_id)
  WHERE slack_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identity_team_github
  ON user_identity_map(team_id, github_username)
  WHERE github_username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identity_team_jira
  ON user_identity_map(team_id, jira_account_id)
  WHERE jira_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_identity_team
  ON user_identity_map(team_id);

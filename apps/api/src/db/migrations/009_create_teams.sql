-- Migration 009: Create teams table
-- Teams represent groups of people (e.g., Platform Squad, Mobile Squad)
-- that share ownership of a set of Slack channels, Jira projects, and GitHub repos.

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  description TEXT,
  -- Who leads this team (user ID from any provider, or email)
  lead_user_id TEXT,
  -- Display settings for UI badges
  color VARCHAR(7),   -- hex color e.g. #3B82F6
  icon VARCHAR(50),   -- lucide icon name
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, slug)
);

CREATE INDEX idx_teams_company ON teams(company_id);

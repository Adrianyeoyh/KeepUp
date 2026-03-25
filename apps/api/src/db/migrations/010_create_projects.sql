-- Migration 010: Create projects table
-- A project maps to a Jira epic/project or high-level initiative.
-- It ties together Slack channels, Jira issues, and GitHub repos.
-- The jira_project_keys, github_repos, and slack_channel_ids arrays are used
-- by the EntityResolver to auto-scope incoming events to this project.

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  description TEXT,
  -- External identifiers that auto-link events to this project
  jira_project_keys TEXT[] NOT NULL DEFAULT '{}',   -- e.g. ['PLAT', 'AUTH']
  github_repos TEXT[] NOT NULL DEFAULT '{}',         -- e.g. ['acme/api', 'acme/web']
  slack_channel_ids TEXT[] NOT NULL DEFAULT '{}',    -- e.g. ['C0123ABC', 'C0456DEF']
  -- Lifecycle
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'archived')),
  start_date DATE,
  target_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, slug)
);

CREATE INDEX idx_projects_company ON projects(company_id);
CREATE INDEX idx_projects_team ON projects(company_id, team_id);

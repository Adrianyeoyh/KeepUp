-- Migration 014: Add team_id and project_id to leak_instances table
-- Allows leaks to be scoped to a team for per-team dashboards.

ALTER TABLE leak_instances
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leaks_team ON leak_instances(company_id, team_id);
CREATE INDEX IF NOT EXISTS idx_leaks_project ON leak_instances(company_id, project_id);

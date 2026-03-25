-- Migration 015: Add team/project scoping and graph metadata to ledger_commits
-- - team_id: which team made this decision
-- - project_id: which project this decision relates to
-- - scope_level: is this an org-wide policy, team decision, or project-level note?
-- - promoted_from: if this org commit was promoted from a team commit, track the lineage

ALTER TABLE ledger_commits
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_level VARCHAR(20)
    DEFAULT 'team' CHECK (scope_level IN ('org', 'team', 'project')),
  ADD COLUMN IF NOT EXISTS promoted_from UUID REFERENCES ledger_commits(id);

CREATE INDEX IF NOT EXISTS idx_ledger_team ON ledger_commits(company_id, team_id);
CREATE INDEX IF NOT EXISTS idx_ledger_project ON ledger_commits(company_id, project_id);
CREATE INDEX IF NOT EXISTS idx_ledger_scope_level ON ledger_commits(company_id, scope_level);

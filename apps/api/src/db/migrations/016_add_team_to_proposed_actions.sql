-- Migration 016: Add team_id to proposed_actions table
-- Allows approvals to be filtered by team in the Approvals dashboard view.

ALTER TABLE proposed_actions
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proposed_actions_team ON proposed_actions(company_id, team_id);

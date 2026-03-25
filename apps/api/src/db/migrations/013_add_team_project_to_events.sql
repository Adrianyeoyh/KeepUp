-- Migration 013: Add team_id and project_id to events table
-- These nullable columns allow events to be scoped to a team and project.
-- The EntityResolver service populates them during event ingestion.
-- Events without a match remain with NULL values and appear in org-wide views.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_team ON events(company_id, team_id);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(company_id, project_id);

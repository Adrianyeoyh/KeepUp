-- Migration 012: Create ledger_edges table
-- Typed relationships between ledger commits and other entities.
-- This turns the flat commit list into a directed acyclic graph.
-- Example: "Commit A was triggered by Leak #7 which was detected from events X, Y, Z"

CREATE TABLE IF NOT EXISTS ledger_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Source is always a ledger commit
  commit_id UUID NOT NULL REFERENCES ledger_commits(id) ON DELETE CASCADE,
  -- Target can be any entity type
  target_type VARCHAR(30) NOT NULL CHECK (target_type IN (
    'leak_instance',
    'event',
    'metric_snapshot',
    'proposed_action',
    'executed_action',
    'ledger_commit',   -- commit-to-commit dependencies
    'entity_link'      -- cross-tool context
  )),
  target_id UUID NOT NULL,
  -- Edge semantics
  edge_type VARCHAR(30) NOT NULL CHECK (edge_type IN (
    'triggered_by',    -- this commit was triggered by a leak
    'references',      -- this commit references an event as evidence
    'measured_by',     -- metric that quantifies the impact
    'resulted_in',     -- this commit caused an action
    'supersedes',      -- this commit replaces a previous commit
    'depends_on',      -- this commit depends on another being merged
    'related_to',      -- general association
    'promoted_to',     -- team decision promoted to org policy (team commit → org commit)
    'branched_from'    -- one leak triggered multiple team decisions (fork point)
  )),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(commit_id, target_type, target_id, edge_type)
);

CREATE INDEX idx_ledger_edges_commit ON ledger_edges(commit_id);
CREATE INDEX idx_ledger_edges_target ON ledger_edges(target_type, target_id);
CREATE INDEX idx_ledger_edges_company ON ledger_edges(company_id);

-- Migration 011: Create entity_links table
-- Explicit cross-tool links between entities (e.g. Slack thread → Jira issue → GitHub PR).
-- This is the backbone of the connected graph — it answers:
-- "This Slack thread led to this Jira ticket which has this PR."

CREATE TABLE IF NOT EXISTS entity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Source entity
  source_provider VARCHAR(20) NOT NULL CHECK (source_provider IN ('slack', 'jira', 'github')),
  source_entity_type VARCHAR(30) NOT NULL,   -- 'thread', 'issue', 'pr', 'channel', 'commit'
  source_entity_id TEXT NOT NULL,
  -- Target entity
  target_provider VARCHAR(20) NOT NULL CHECK (target_provider IN ('slack', 'jira', 'github')),
  target_entity_type VARCHAR(30) NOT NULL,
  target_entity_id TEXT NOT NULL,
  -- Link metadata
  link_type VARCHAR(30) NOT NULL CHECK (link_type IN (
    'mentions',       -- Slack message mentions PROJ-123
    'fixes',          -- PR fixes Jira issue (from commit message)
    'blocks',         -- Jira issue blocks another
    'caused_by',      -- leak caused by this entity
    'results_in',     -- decision resulted in this action
    'discussed_in',   -- Jira issue discussed in Slack thread
    'reviewed_in',    -- PR reviewed via GitHub
    'duplicates',     -- Jira duplicate link (two teams reported same issue)
    'parent_of',      -- Jira epic→story or parent→child relationship
    'auto_detected',  -- system-detected relationship
    'manual'          -- user-created link
  )),
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0
    CHECK (confidence >= 0.0 AND confidence <= 1.0),  -- 1.0 = explicit, <1.0 = inferred
  detected_by VARCHAR(20) NOT NULL DEFAULT 'system'
    CHECK (detected_by IN ('system', 'user', 'ai')),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, source_provider, source_entity_id, target_provider, target_entity_id, link_type)
);

CREATE INDEX idx_entity_links_source
  ON entity_links(company_id, source_provider, source_entity_id);
CREATE INDEX idx_entity_links_target
  ON entity_links(company_id, target_provider, target_entity_id);
CREATE INDEX idx_entity_links_company
  ON entity_links(company_id);

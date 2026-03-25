-- Migration 019: Persisted ledger routes + review dispatch audit
--
-- ledger_routes
--   Stores named graph traversal snapshots with optional proposed solution text.
--
-- ledger_route_dispatches
--   Stores outbound review dispatch attempts (Slack/Jira/GitHub) and outcomes.

CREATE TABLE IF NOT EXISTS ledger_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  solution_draft TEXT,
  snapshot JSONB NOT NULL,
  dataset_signature TEXT NOT NULL,
  focus_node_ids TEXT[] NOT NULL DEFAULT '{}',
  created_by TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_routes_company_scope
  ON ledger_routes(company_id, team_id, project_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_routes_focus_nodes
  ON ledger_routes USING GIN (focus_node_ids);

CREATE TABLE IF NOT EXISTS ledger_route_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_route_id UUID NOT NULL REFERENCES ledger_routes(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('slack', 'jira', 'github')),
  target TEXT NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('sent', 'failed')),
  message TEXT,
  response JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  dispatched_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_route_dispatches_route_created
  ON ledger_route_dispatches(ledger_route_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_route_dispatches_company_provider
  ON ledger_route_dispatches(company_id, provider, created_at DESC);

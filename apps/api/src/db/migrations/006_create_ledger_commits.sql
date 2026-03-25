-- Migration: 006_create_ledger_commits
-- Git-style memory anchors (Decision Records, Action Items, Policies)

CREATE TABLE IF NOT EXISTS ledger_commits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  commit_type VARCHAR(20) NOT NULL CHECK (commit_type IN (
    'decision', 'action', 'policy', 'template_change'
  )),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  rationale TEXT,
  dri TEXT, -- Directly Responsible Individual (user name or ID)
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'proposed', 'approved', 'merged', 'rejected'
  )),
  branch_name VARCHAR(100) NOT NULL DEFAULT 'main',
  parent_commit_id UUID REFERENCES ledger_commits(id),
  evidence_links JSONB NOT NULL DEFAULT '[]',
  tags TEXT[] NOT NULL DEFAULT '{}',
  leak_instance_id UUID REFERENCES leak_instances(id),
  created_by TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_company ON ledger_commits(company_id);
CREATE INDEX idx_ledger_status ON ledger_commits(company_id, status);
CREATE INDEX idx_ledger_type ON ledger_commits(company_id, commit_type);
CREATE INDEX idx_ledger_branch ON ledger_commits(company_id, branch_name);

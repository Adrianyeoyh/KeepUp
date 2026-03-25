-- Migration: 004_create_metric_snapshots
-- Daily computed metrics + rolling baselines

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  metric_name VARCHAR(60) NOT NULL,
  scope VARCHAR(20) NOT NULL DEFAULT 'company',
  scope_id TEXT, -- team_id, project_key, channel_id, repo name, etc.
  value DOUBLE PRECISION NOT NULL,
  baseline_value DOUBLE PRECISION, -- rolling 14-28 day baseline
  date DATE NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One snapshot per metric per scope per day
  UNIQUE(company_id, metric_name, scope, scope_id, date)
);

CREATE INDEX idx_snapshots_company_date ON metric_snapshots(company_id, date DESC);
CREATE INDEX idx_snapshots_metric ON metric_snapshots(company_id, metric_name, date DESC);

-- Migration: 005_create_leak_instances
-- Detected process leaks with evidence and AI diagnosis

CREATE TABLE IF NOT EXISTS leak_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  leak_type VARCHAR(30) NOT NULL CHECK (leak_type IN (
    'decision_drift',
    'unlogged_action_items',
    'reopen_bounce_spike',
    'cycle_time_drift',
    'pr_review_bottleneck'
  )),
  severity INTEGER NOT NULL CHECK (severity >= 0 AND severity <= 100),
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status VARCHAR(20) NOT NULL DEFAULT 'detected' CHECK (status IN (
    'detected', 'delivered', 'actioned', 'snoozed', 'suppressed', 'resolved'
  )),
  detected_at TIMESTAMPTZ NOT NULL,
  evidence_links JSONB NOT NULL DEFAULT '[]',
  metrics_context JSONB NOT NULL DEFAULT '{}',
  recommended_fix JSONB NOT NULL DEFAULT '{}',
  cost_estimate_hours_per_week DOUBLE PRECISION,
  ai_diagnosis JSONB, -- populated by AI orchestrator (Step 7)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leaks_company ON leak_instances(company_id);
CREATE INDEX idx_leaks_status ON leak_instances(company_id, status);
CREATE INDEX idx_leaks_detected ON leak_instances(company_id, detected_at DESC);
CREATE INDEX idx_leaks_type ON leak_instances(company_id, leak_type);

-- Migration: 008_create_executed_actions
-- Immutable audit trail with rollback support

CREATE TABLE IF NOT EXISTS executed_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  proposed_action_id UUID NOT NULL REFERENCES proposed_actions(id),
  executed_at TIMESTAMPTZ NOT NULL,
  result VARCHAR(20) NOT NULL CHECK (result IN (
    'success', 'partial_success', 'failure', 'rolled_back'
  )),
  execution_details JSONB NOT NULL DEFAULT '{}',
  rollback_info JSONB NOT NULL DEFAULT '{"can_rollback": false}',
  audit_log JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_executed_company ON executed_actions(company_id);
CREATE INDEX idx_executed_proposed ON executed_actions(proposed_action_id);
CREATE INDEX idx_executed_at ON executed_actions(company_id, executed_at DESC);

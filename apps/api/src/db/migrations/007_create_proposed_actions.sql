-- Migration: 007_create_proposed_actions
-- Remediation drafts awaiting approval

CREATE TABLE IF NOT EXISTS proposed_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  leak_instance_id UUID REFERENCES leak_instances(id),
  action_type VARCHAR(30) NOT NULL CHECK (action_type IN (
    'slack_reminder', 'slack_summary', 'slack_thread_reply',
    'jira_comment', 'jira_create_task', 'jira_template_suggest',
    'github_comment', 'github_request_review', 'github_reassign'
  )),
  target_system VARCHAR(10) NOT NULL CHECK (target_system IN ('slack', 'jira', 'github')),
  target_id TEXT NOT NULL,
  preview_diff JSONB NOT NULL DEFAULT '{}',
  risk_level VARCHAR(10) NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  blast_radius TEXT,
  approval_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (approval_status IN (
    'pending', 'approved', 'rejected', 'executed', 'failed', 'rolled_back'
  )),
  requested_by TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_proposed_company ON proposed_actions(company_id);
CREATE INDEX idx_proposed_status ON proposed_actions(company_id, approval_status);

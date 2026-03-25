-- Migration 017: Add settings JSONB column to projects
-- Stores component mappings, custom configs, and GitHub Projects v2 metadata

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Migration 017b: Add custom_leak_rules JSONB column to teams
-- Stores user-defined JQL-powered leak rule configurations per team

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS custom_leak_rules JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Migration 017c: Add 'custom_jql' to leak_type CHECK constraint
-- Allows custom JQL-powered leak rules to create leak instances

ALTER TABLE leak_instances DROP CONSTRAINT IF EXISTS leak_instances_leak_type_check;
ALTER TABLE leak_instances ADD CONSTRAINT leak_instances_leak_type_check
  CHECK (leak_type IN (
    'decision_drift',
    'unlogged_action_items',
    'reopen_bounce_spike',
    'cycle_time_drift',
    'pr_review_bottleneck',
    'custom_jql'
  ));

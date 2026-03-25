-- Migration: 003_create_events
-- Append-only normalized events from all connectors

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source VARCHAR(20) NOT NULL CHECK (source IN ('slack', 'jira', 'github', 'zendesk', 'system')),
  entity_id TEXT NOT NULL, -- thread_ts, issue key, PR number, etc.
  event_type VARCHAR(50) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  provider_event_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Idempotency: dedupe by provider event id + source + company
  UNIQUE(provider_event_id, source, company_id)
);

-- Performance indexes
CREATE INDEX idx_events_company_source ON events(company_id, source);
CREATE INDEX idx_events_company_type ON events(company_id, event_type);
CREATE INDEX idx_events_timestamp ON events(company_id, timestamp DESC);
CREATE INDEX idx_events_entity ON events(company_id, entity_id);

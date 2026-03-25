-- Migration: 001_create_companies
-- Creates the companies table

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  settings JSONB NOT NULL DEFAULT '{
    "insight_budget_per_day": 3,
    "confidence_threshold": 0.5,
    "digest_cron": "0 9 * * 1-5",
    "digest_channel_ids": [],
    "digest_user_ids": []
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_companies_slug ON companies(slug);

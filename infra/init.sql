-- FlowGuard — Postgres Initialization
-- This runs automatically when the container starts for the first time.
-- The database 'flowguard' is already created by POSTGRES_DB env var.

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

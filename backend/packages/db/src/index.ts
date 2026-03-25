// ============================================
// @flowguard/db — Shared Database Client & Migrations
// ============================================

export {
  initPool,
  getPool,
  testConnection,
  closePool,
  query,
  withTransaction,
  listCompanyIds,
} from './client.js';
export type { DbConfig } from './client.js';

export { runMigrations } from './migrate.js';

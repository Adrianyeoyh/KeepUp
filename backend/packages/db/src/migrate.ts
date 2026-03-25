import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initPool, query, closePool } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

/**
 * Ensure the schema_migrations tracking table exists.
 */
async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Get list of already-applied migration filenames.
 */
async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY filename',
  );
  return new Set(result.rows.map((r) => r.filename));
}

/**
 * Get all migration files sorted by name (001_init.sql, 002_add_snooze.sql, etc.)
 */
function getMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Run all pending migrations in order.
 * Returns the list of newly applied migration filenames.
 */
export async function runMigrations(): Promise<string[]> {
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const allFiles = getMigrationFiles();
  const pending = allFiles.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('No pending migrations.');
    return [];
  }

  console.log(`Found ${pending.length} pending migration(s).`);

  const newlyApplied: string[] = [];

  for (const filename of pending) {
    const filePath = path.join(MIGRATIONS_DIR, filename);
    const sql = fs.readFileSync(filePath, 'utf-8');

    console.log(`Applying: ${filename}...`);

    try {
      await query('BEGIN');
      await query(sql);
      await query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename],
      );
      await query('COMMIT');
      newlyApplied.push(filename);
      console.log(`  Applied: ${filename}`);
    } catch (err) {
      await query('ROLLBACK');
      console.error(`  FAILED: ${filename}`, err);
      throw err;
    }
  }

  console.log(`Applied ${newlyApplied.length} migration(s).`);
  return newlyApplied;
}

/**
 * CLI entry point: run migrations when executed directly.
 * Usage: tsx src/migrate.ts
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL env var is required');
    process.exit(1);
  }

  initPool({ databaseUrl });

  try {
    await runMigrations();
  } finally {
    await closePool();
  }
}

// Run if invoked directly
main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

import pg from 'pg';
import pino from 'pino';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let dbLogger = pino({ name: 'db' });

export interface DbConfig {
  databaseUrl: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
  logger?: pino.Logger;
}

/**
 * Initialize the database connection pool.
 * Call once at service startup.
 */
export function initPool(config: DbConfig): pg.Pool {
  if (pool) {
    return pool;
  }

  if (config.logger) {
    dbLogger = config.logger;
  }

  pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.maxConnections ?? 20,
    idleTimeoutMillis: config.idleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 5_000,
  });

  pool.on('error', (err) => {
    dbLogger.error({ err }, 'Unexpected Postgres pool error');
  });

  return pool;
}

/**
 * Get the initialized pool (throws if not initialized).
 */
export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initPool() first.');
  }
  return pool;
}

/**
 * Test database connectivity.
 */
export async function testConnection(): Promise<void> {
  const p = getPool();
  const client = await p.connect();
  try {
    const result = await client.query('SELECT NOW()');
    dbLogger.info({ time: result.rows[0].now }, 'Postgres connected');
  } finally {
    client.release();
  }
}

/**
 * Close the pool gracefully.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    dbLogger.info('Postgres pool closed');
  }
}

/**
 * Run a parameterized query with slow-query logging.
 */
export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<pg.QueryResult<T>> {
  const p = getPool();
  const start = Date.now();
  const result = await p.query<T>(text, params);
  const duration = Date.now() - start;

  if (duration > 100) {
    dbLogger.warn({ text: text.substring(0, 80), duration, rows: result.rowCount }, 'Slow query');
  }

  return result;
}

/**
 * Run a function inside a database transaction.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * List all company IDs (used by cron jobs that run per-company).
 */
export async function listCompanyIds(): Promise<string[]> {
  const result = await query<{ id: string }>('SELECT id FROM companies');
  return result.rows.map((r) => r.id);
}

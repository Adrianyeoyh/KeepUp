import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function listCompanyIds(): Promise<string[]> {
  const result = await query<{ id: string }>('SELECT id FROM companies ORDER BY created_at ASC');
  return result.rows.map((row) => row.id);
}

export async function closePool(): Promise<void> {
  await pool.end();
}

/**
 * Backfill ledger edges from existing ledger commits
 * 
 * This script creates edges for existing commits that were created
 * before the entity_links/ledger_edges v2 migration.
 *
 * Usage: npx tsx scripts/backfill-ledger-edges.ts
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

interface LedgerCommit {
  id: string;
  company_id: string;
  commit_type: string;
  leak_instance_id: string | null;
  evidence_links: Array<{ provider: string; entity_type: string; entity_id: string; url: string }>;
}

async function backfill() {
  const client = await pool.connect();

  try {
    // Fetch all commits that might need edges
    const commits = await client.query<LedgerCommit>(
      `SELECT id, company_id, commit_type, leak_instance_id, evidence_links
       FROM ledger_commits
       WHERE id NOT IN (SELECT DISTINCT commit_id FROM ledger_edges)`
    );

    console.log(`Found ${commits.rows.length} commits without edges`);

    let edgesCreated = 0;

    for (const commit of commits.rows) {
      // 1. Create triggered_by edge for leak_instance_id
      if (commit.leak_instance_id) {
        await client.query(
          `INSERT INTO ledger_edges (company_id, commit_id, edge_type, target_type, target_id, metadata)
           VALUES ($1, $2, 'triggered_by', 'leak_instance', $3, '{}')
           ON CONFLICT DO NOTHING`,
          [commit.company_id, commit.id, commit.leak_instance_id]
        );
        edgesCreated++;
      }

      // 2. Create references edges from evidence_links
      const links = commit.evidence_links;
      if (Array.isArray(links)) {
        for (const link of links) {
          if (!link.entity_id) continue;

          // Map provider to target_type
          let targetType = 'event';
          if (link.entity_type === 'issue') targetType = 'event';
          else if (link.entity_type === 'pr') targetType = 'event';
          else if (link.entity_type === 'thread') targetType = 'event';

          // Look up the actual event id
          const eventResult = await client.query(
            `SELECT id FROM events
             WHERE entity_id = $1 AND company_id = $2
             LIMIT 1`,
            [link.entity_id, commit.company_id]
          );

          if (eventResult.rows[0]) {
            await client.query(
              `INSERT INTO ledger_edges (company_id, commit_id, edge_type, target_type, target_id, metadata)
               VALUES ($1, $2, 'references', 'event', $3, $4)
               ON CONFLICT DO NOTHING`,
              [commit.company_id, commit.id, eventResult.rows[0].id, JSON.stringify({ provider: link.provider })]
            );
            edgesCreated++;
          }
        }
      }

      // 3. Create resulted_in edges for proposed_actions linked to this commit
      const actionsResult = await client.query(
        `SELECT id FROM proposed_actions
         WHERE ledger_commit_id = $1`,
        [commit.id]
      );

      for (const action of actionsResult.rows) {
        await client.query(
          `INSERT INTO ledger_edges (company_id, commit_id, edge_type, target_type, target_id, metadata)
           VALUES ($1, $2, 'resulted_in', 'proposed_action', $3, '{}')
           ON CONFLICT DO NOTHING`,
          [commit.company_id, commit.id, action.id]
        );
        edgesCreated++;
      }
    }

    console.log(`✅ Backfill complete: ${edgesCreated} edges created for ${commits.rows.length} commits`);
  } finally {
    client.release();
    await pool.end();
  }
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

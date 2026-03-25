import { query, withTransaction } from '@flowguard/db';
import { logger } from '../logger.js';

/**
 * EventStore — Append-only event storage with idempotency dedup.
 *
 * Migrated from apps/api/src/services/event-store.ts.
 * All business logic preserved.
 */

export interface ScopedCreateEvent {
  company_id: string;
  source: string;
  entity_id: string;
  event_type: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
  provider_event_id: string;
  team_id?: string | null;
  project_id?: string | null;
}

export class EventStore {
  async insert(event: ScopedCreateEvent): Promise<Record<string, any> | null> {
    const result = await query(
      `INSERT INTO events (
        company_id, source, entity_id, event_type,
        timestamp, metadata, provider_event_id,
        team_id, project_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (provider_event_id, source, company_id)
      DO NOTHING
      RETURNING *`,
      [
        event.company_id,
        event.source,
        event.entity_id,
        event.event_type,
        event.timestamp,
        JSON.stringify(event.metadata),
        event.provider_event_id,
        event.team_id ?? null,
        event.project_id ?? null,
      ],
    );

    if (result.rowCount === 0) {
      logger.debug({
        provider_event_id: event.provider_event_id,
        source: event.source,
      }, 'Duplicate event skipped');
      return null;
    }

    logger.info({
      id: result.rows[0].id,
      source: event.source,
      event_type: event.event_type,
    }, 'Event stored');

    return result.rows[0];
  }

  async insertBatch(events: ScopedCreateEvent[]): Promise<Record<string, any>[]> {
    return withTransaction(async (client) => {
      const inserted: Record<string, any>[] = [];
      for (const event of events) {
        const result = await client.query(
          `INSERT INTO events (
            company_id, source, entity_id, event_type,
            timestamp, metadata, provider_event_id,
            team_id, project_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (provider_event_id, source, company_id)
          DO NOTHING
          RETURNING *`,
          [
            event.company_id,
            event.source,
            event.entity_id,
            event.event_type,
            event.timestamp,
            JSON.stringify(event.metadata),
            event.provider_event_id,
            event.team_id ?? null,
            event.project_id ?? null,
          ],
        );
        if (result.rows[0]) {
          inserted.push(result.rows[0]);
        }
      }
      return inserted;
    });
  }

  async countByType(
    companyId: string,
    source: string,
    eventType: string,
    since: Date,
    until: Date,
  ): Promise<number> {
    const result = await query(
      `SELECT COUNT(*) as count FROM events
       WHERE company_id = $1 AND source = $2 AND event_type = $3
       AND timestamp >= $4 AND timestamp <= $5`,
      [companyId, source, eventType, since, until],
    );
    return parseInt(result.rows[0].count, 10);
  }
}

export const eventStore = new EventStore();

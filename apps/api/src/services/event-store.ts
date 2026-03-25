import type { CreateEvent, Event } from '@flowguard/shared';
import { query, withTransaction } from '../db/client.js';
import { logger } from '../logger.js';

/**
 * Extended CreateEvent that includes optional v2 scope fields.
 * These are resolved by EntityResolver during webhook ingestion.
 */
export interface ScopedCreateEvent extends CreateEvent {
  team_id?: string | null;
  project_id?: string | null;
}

/**
 * EventStore — Append-only event storage with idempotency dedup.
 *
 * Events are the atomic unit of data in FlowGuard.
 * All connector data flows through here before being processed
 * by the Metrics Engine and Leak Engine.
 */
export class EventStore {
  /**
   * Insert a normalized event. Skips duplicates (idempotent).
   * Returns the inserted event, or null if it was a duplicate.
   */
  async insert(event: ScopedCreateEvent): Promise<Event | null> {
    const result = await query<Event>(
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
      team_id: event.team_id ?? null,
      project_id: event.project_id ?? null,
    }, 'Event stored');

    return result.rows[0];
  }

  /**
   * Insert multiple events in a batch (within a transaction).
   */
  async insertBatch(events: ScopedCreateEvent[]): Promise<Event[]> {
    return withTransaction(async (client) => {
      const inserted: Event[] = [];
      for (const event of events) {
        const result = await client.query<Event>(
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

  /**
   * Query events by company and source, ordered by timestamp.
   */
  async getByCompany(
    companyId: string,
    options: {
      source?: string;
      event_type?: string;
      since?: Date;
      until?: Date;
      limit?: number;
    } = {},
  ): Promise<Event[]> {
    const conditions: string[] = ['company_id = $1'];
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (options.source) {
      conditions.push(`source = $${paramIdx++}`);
      params.push(options.source);
    }
    if (options.event_type) {
      conditions.push(`event_type = $${paramIdx++}`);
      params.push(options.event_type);
    }
    if (options.since) {
      conditions.push(`timestamp >= $${paramIdx++}`);
      params.push(options.since);
    }
    if (options.until) {
      conditions.push(`timestamp <= $${paramIdx++}`);
      params.push(options.until);
    }

    const limit = options.limit || 1000;
    params.push(limit);
    const sql = `
      SELECT * FROM events
      WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp DESC
      LIMIT $${paramIdx}
    `;

    const result = await query<Event>(sql, params);
    return result.rows;
  }

  /**
   * Count events for a company within a time range (for metrics).
   */
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

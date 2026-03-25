import type { NormalizedEvent } from '@flowguard/adapter-sdk';
import type { EventEnvelope } from '@flowguard/event-bus';
import { query } from '@flowguard/db';
import { eventStore } from '../services/event-store.js';
import { logger } from '../logger.js';

/**
 * Handler for events.ingested topic.
 *
 * Persists normalized events to the database, resolves team/project scope,
 * and creates entity_links from cross-references.
 *
 * Migrated from the inline logic in apps/api/src/routes/webhooks/*.ts
 */
export async function onEventIngested(
  payload: NormalizedEvent,
  envelope: EventEnvelope<NormalizedEvent>,
): Promise<void> {
  logger.debug(
    { provider: payload.provider, eventType: payload.eventType, traceId: envelope.traceId },
    'Processing ingested event',
  );

  // Resolve team + project scope from entity metadata
  const scope = await resolveScope(payload);

  // Persist to events table
  const stored = await eventStore.insert({
    company_id: payload.companyId,
    source: payload.provider,
    entity_id: payload.entityId,
    event_type: payload.eventType,
    timestamp: payload.timestamp,
    metadata: payload.metadata,
    provider_event_id: payload.providerEventId,
    team_id: scope.teamId,
    project_id: scope.projectId,
  });

  if (!stored) return; // Duplicate

  // Create entity_links from cross-references
  if (payload.crossReferences && payload.crossReferences.length > 0) {
    void createEntityLinks(payload).catch((err) => {
      logger.warn({ err }, 'Entity link creation failed — non-fatal');
    });
  }
}

/**
 * Resolve team and project scope from event metadata.
 * Looks up channel_id (Slack), project_key (Jira), or repo_full_name (GitHub)
 * in the projects table to find matching team/project.
 */
async function resolveScope(event: NormalizedEvent): Promise<{
  teamId: string | null;
  projectId: string | null;
}> {
  const metadata = event.metadata as Record<string, any>;

  try {
    if (event.provider === 'slack' && metadata.channel_id) {
      const result = await query<{ id: string; team_id: string }>(
        `SELECT id, team_id FROM projects
         WHERE company_id = $1 AND $2 = ANY(slack_channel_ids)
         LIMIT 1`,
        [event.companyId, metadata.channel_id],
      );
      if (result.rows[0]) {
        return { teamId: result.rows[0].team_id, projectId: result.rows[0].id };
      }
    }

    if (event.provider === 'jira' && metadata.project_key) {
      const result = await query<{ id: string; team_id: string }>(
        `SELECT id, team_id FROM projects
         WHERE company_id = $1 AND $2 = ANY(jira_project_keys)
         LIMIT 1`,
        [event.companyId, metadata.project_key],
      );
      if (result.rows[0]) {
        return { teamId: result.rows[0].team_id, projectId: result.rows[0].id };
      }
    }

    if (event.provider === 'github' && metadata.repo_full_name) {
      const result = await query<{ id: string; team_id: string }>(
        `SELECT id, team_id FROM projects
         WHERE company_id = $1 AND $2 = ANY(github_repos)
         LIMIT 1`,
        [event.companyId, metadata.repo_full_name],
      );
      if (result.rows[0]) {
        return { teamId: result.rows[0].team_id, projectId: result.rows[0].id };
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Scope resolution failed — using null');
  }

  return { teamId: null, projectId: null };
}

/**
 * Create entity_links from cross-references detected in the event.
 */
async function createEntityLinks(event: NormalizedEvent): Promise<void> {
  for (const ref of event.crossReferences) {
    try {
      await query(
        `INSERT INTO entity_links (
          company_id, source_provider, source_entity_type, source_entity_id,
          target_provider, target_entity_type, target_entity_id,
          link_type, confidence
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT DO NOTHING`,
        [
          event.companyId,
          event.provider,
          'event',
          event.entityId,
          ref.provider,
          ref.entityType,
          ref.entityId,
          'cross_reference',
          0.8,
        ],
      );
    } catch (err) {
      logger.warn({ err, ref }, 'Failed to create entity link');
    }
  }
}

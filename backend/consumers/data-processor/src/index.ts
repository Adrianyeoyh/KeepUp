import { initPool } from '@flowguard/db';
import { EventBus, TOPICS } from '@flowguard/event-bus';
import { config } from './config.js';
import { logger } from './logger.js';
import { onEventIngested } from './handlers/on-event-ingested.js';

/**
 * Data Processor Consumer entry point.
 *
 * Subscribes to:
 * - events.ingested: Persist events, resolve scope, create entity links
 *
 * Contains migrated services:
 * - event-store (from apps/api)
 * - entity-resolver / entity-link-extractor (logic inlined in handler)
 * - leak-engine, metrics-engine, feedback-flywheel (to be migrated from apps/worker)
 */

// Initialize shared infrastructure
const db = initPool({ databaseUrl: config.DATABASE_URL });

const eventBus = new EventBus({
  redisUrl: config.REDIS_URL,
  serviceName: 'consumer-data-processor',
  logger,
});

// Subscribe to event bus topics
eventBus.subscribe(TOPICS.EVENTS_INGESTED, onEventIngested);

logger.info('Data processor consumer started');

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down data processor...');
  await eventBus.shutdown();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled rejection');
});

import { initPool } from '@flowguard/db';
import { EventBus, TOPICS } from '@flowguard/event-bus';
import { config } from './config.js';
import { logger } from './logger.js';
import { onDigestTick } from './handlers/on-digest-tick.js';

/**
 * Digest Consumer entry point.
 *
 * Subscribes to:
 * - digest.tick: Build and deliver digests
 * - leaks.detected: Trigger leak-specific notifications
 *
 * All outbound delivery goes through the adapter registry.
 */

const db = initPool({ databaseUrl: config.DATABASE_URL });

const eventBus = new EventBus({
  redisUrl: config.REDIS_URL,
  serviceName: 'consumer-digest',
  logger,
});

eventBus.subscribe(TOPICS.DIGEST_TICK, onDigestTick);

logger.info('Digest consumer started');

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down digest consumer...');
  await eventBus.shutdown();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

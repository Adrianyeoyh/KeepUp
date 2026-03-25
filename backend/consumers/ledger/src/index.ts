import { initPool } from '@flowguard/db';
import { EventBus, TOPICS } from '@flowguard/event-bus';
import { config } from './config.js';
import { logger } from './logger.js';
import { onCommitApproved } from './handlers/on-commit-approved.js';

/**
 * Ledger Consumer entry point.
 *
 * Subscribes to:
 * - ledger.approved: Trigger writeback to originating platforms
 *
 * Exposes HTTP routes (mounted by gateway):
 * - /ledger/commits CRUD
 * - /ledger/routes CRUD
 */

const db = initPool({ databaseUrl: config.DATABASE_URL });

const eventBus = new EventBus({
  redisUrl: config.REDIS_URL,
  serviceName: 'consumer-ledger',
  logger,
});

eventBus.subscribe(TOPICS.LEDGER_APPROVED, onCommitApproved);

logger.info('Ledger consumer started');

// Export the routes for gateway mounting
export { default as ledgerRoutes } from './routes/ledger-routes.js';

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down ledger consumer...');
  await eventBus.shutdown();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

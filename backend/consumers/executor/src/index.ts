import { initPool } from '@flowguard/db';
import { EventBus, TOPICS } from '@flowguard/event-bus';
import { config } from './config.js';
import { logger } from './logger.js';
import { onActionApproved } from './handlers/on-action-approved.js';

/**
 * Executor Consumer entry point.
 *
 * Subscribes to:
 * - actions.approved: Execute approved remediation actions via adapter registry
 *
 * Key architectural change: the executor uses adapterRegistry.executeAction()
 * instead of importing @slack/web-api or Octokit directly. Adding a new target
 * system (e.g., Linear) requires zero changes to this consumer.
 */

const db = initPool({ databaseUrl: config.DATABASE_URL });

const eventBus = new EventBus({
  redisUrl: config.REDIS_URL,
  serviceName: 'consumer-executor',
  logger,
});

eventBus.subscribe(TOPICS.ACTIONS_APPROVED, onActionApproved);

logger.info('Executor consumer started');

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down executor consumer...');
  await eventBus.shutdown();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

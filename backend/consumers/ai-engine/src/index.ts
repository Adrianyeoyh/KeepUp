import { initPool } from '@flowguard/db';
import { EventBus, TOPICS } from '@flowguard/event-bus';
import { config } from './config.js';
import { logger } from './logger.js';
import { onDiagnosisRequested } from './handlers/on-diagnosis-requested.js';
import { onDraftRequested } from './handlers/on-draft-requested.js';

/**
 * AI Engine Consumer entry point.
 *
 * Subscribes to:
 * - ai.diagnosis.req: Run AI diagnosis on leaks
 * - ai.draft.req: Generate AI drafts (user stories, summaries)
 *
 * Exposes HTTP routes (mounted by gateway):
 * - /inference/run
 * - /inferred-links/:id
 */

const db = initPool({ databaseUrl: config.DATABASE_URL });

const eventBus = new EventBus({
  redisUrl: config.REDIS_URL,
  serviceName: 'consumer-ai-engine',
  logger,
});

eventBus.subscribe(TOPICS.AI_DIAGNOSIS_REQ, onDiagnosisRequested);
eventBus.subscribe(TOPICS.AI_DRAFT_REQ, onDraftRequested);

logger.info('AI Engine consumer started');

export { default as inferenceRoutes } from './routes/inference.js';

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down AI Engine consumer...');
  await eventBus.shutdown();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

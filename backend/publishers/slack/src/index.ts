import express from 'express';
import { initPool } from '@flowguard/db';
import { EventBus } from '@flowguard/event-bus';
import { adapterRegistry } from '@flowguard/adapter-sdk';
import { config } from './config.js';
import { logger } from './logger.js';
import { SlackAdapter } from './adapter.js';
import { createWebhookRouter } from './webhook-handler.js';

/**
 * Slack Publisher Microservice entry point.
 *
 * Initializes:
 * - Database connection pool
 * - Event bus (Redis/BullMQ)
 * - SlackAdapter (registered in adapter registry)
 * - Express server with webhook routes
 *
 * Can run standalone or be mounted as a sub-router in the gateway.
 */

// Initialize shared infrastructure
const db = initPool({ databaseUrl: config.DATABASE_URL });

const eventBus = new EventBus({
  redisUrl: config.REDIS_URL,
  serviceName: 'publisher-slack',
  logger,
});

// Create and register the Slack adapter
const slackAdapter = new SlackAdapter(config.SLACK_SIGNING_SECRET);
adapterRegistry.register(slackAdapter);

// Create the webhook router (for gateway to mount or standalone use)
export const webhookRouter = createWebhookRouter(slackAdapter, eventBus);
export { slackAdapter };

// Standalone server mode
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const app = express();

  app.use(express.json({
    limit: '5mb',
    verify: (req, _res, buffer) => {
      (req as any).rawBody = buffer.toString('utf-8');
    },
  }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/', webhookRouter);

  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'Slack publisher running');
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down Slack publisher...');
    await eventBus.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

import express from 'express';
import { initPool } from '@flowguard/db';
import { EventBus } from '@flowguard/event-bus';
import { adapterRegistry } from '@flowguard/adapter-sdk';
import { config } from './config.js';
import { logger } from './logger.js';
import { GitHubAdapter } from './adapter.js';
import { createWebhookRouter } from './webhook-handler.js';

// Initialize shared infrastructure
const db = initPool({ databaseUrl: config.DATABASE_URL });

const eventBus = new EventBus({
  redisUrl: config.REDIS_URL,
  serviceName: 'publisher-github',
  logger,
});

// Create and register the GitHub adapter
const githubAdapter = new GitHubAdapter(config.GITHUB_WEBHOOK_SECRET);
adapterRegistry.register(githubAdapter);

// Create the webhook router
export const webhookRouter = createWebhookRouter(githubAdapter, eventBus);
export { githubAdapter };

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
    logger.info({ port: config.PORT }, 'GitHub publisher running');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down GitHub publisher...');
    await eventBus.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

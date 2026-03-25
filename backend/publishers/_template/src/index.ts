import express from 'express';
import { initPool } from '@flowguard/db';
import { EventBus } from '@flowguard/event-bus';
import { adapterRegistry } from '@flowguard/adapter-sdk';
import { config } from './config.js';
import { logger } from './logger.js';
import { TemplateAdapter } from './adapter.js';
import { createWebhookRouter } from './webhook-handler.js';

// ============================================
// Publisher Entry Point Template
// ============================================
//
// This file initializes the publisher microservice:
// 1. Database connection pool (shared Postgres)
// 2. Event bus (Redis/BullMQ) for publishing normalized events
// 3. Your adapter instance (registered in the global adapter registry)
// 4. Express server with webhook routes
//
// TODO: Replace 'TemplateAdapter' with your adapter class
// TODO: Replace 'publisher-template' with your provider name
// TODO: Pass your provider-specific config to the adapter constructor

// Initialize shared infrastructure
const db = initPool({ databaseUrl: config.DATABASE_URL });

const eventBus = new EventBus({
  redisUrl: config.REDIS_URL,
  serviceName: 'publisher-template', // TODO: Replace with your provider name
  logger,
});

// Create and register the adapter
// TODO: Pass provider-specific config, e.g., new TemplateAdapter(config.TEMPLATE_SIGNING_SECRET)
const templateAdapter = new TemplateAdapter();
adapterRegistry.register(templateAdapter);

// Create the webhook router (for gateway to mount or standalone use)
export const webhookRouter = createWebhookRouter(templateAdapter, eventBus);
export { templateAdapter };

// Standalone server mode — when run directly (not mounted by gateway)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const app = express();

  // Parse JSON with raw body preservation (needed for signature verification)
  app.use(express.json({
    limit: '5mb',
    verify: (req, _res, buffer) => {
      (req as any).rawBody = buffer.toString('utf-8');
    },
  }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/', webhookRouter);

  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'Template publisher running');
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down template publisher...');
    await eventBus.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

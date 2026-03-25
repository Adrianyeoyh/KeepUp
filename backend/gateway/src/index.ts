import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initPool, testConnection, closePool } from '@flowguard/db';
import { EventBus } from '@flowguard/event-bus';
import { config } from './config.js';
import { logger } from './logger.js';
import { errorHandler, requestLogger } from './middleware/index.js';
import { requireDashboardAuth } from './middleware/auth.js';

// Route imports — gateway-owned
import healthRouter from './routes/health.js';
import adminRouter from './routes/admin.js';
import dashboardApiRouter from './routes/dashboard-api.js';
import teamsProjectsRouter from './routes/teams-projects.js';

// Publisher webhook routers — mounted as sub-routers (dev mode: in-process)
import { webhookRouter as slackWebhookRouter } from '@flowguard/publisher-slack';
import { webhookRouter as jiraWebhookRouter } from '@flowguard/publisher-jira';
import { webhookRouter as githubWebhookRouter } from '@flowguard/publisher-github';

// Consumer routes — mounted as sub-routers (dev mode: in-process)
import { ledgerRoutes } from '@flowguard/consumer-ledger';
import { inferenceRoutes } from '@flowguard/consumer-ai-engine';

/**
 * API Gateway — Single entry point for all HTTP traffic.
 *
 * In dev mode: all services run in-process as sub-routers.
 * In prod mode: services run as separate processes, gateway proxies via HTTP.
 *
 * Migrated from apps/api/src/index.ts.
 */

// Initialize shared infrastructure
const db = initPool({ databaseUrl: config.DATABASE_URL });
const app = express();

// ============================================
// Middleware
// ============================================
app.use(helmet());

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  `http://localhost:${config.PORT}`,
  `http://127.0.0.1:${config.PORT}`,
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) { callback(null, true); return; }
    if (allowedOrigins.includes(origin)) { callback(null, true); return; }
    if (origin.endsWith('.trycloudflare.com')) { callback(null, true); return; }
    if (config.NODE_ENV === 'production') { callback(new Error(`CORS: origin ${origin} not allowed`)); return; }
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-admin-key'],
}));

app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buffer) => {
    (req as any).rawBody = buffer.toString('utf-8');
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api', apiLimiter);

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many webhook requests' },
});
app.use('/webhooks', webhookLimiter);

// ============================================
// Routes
// ============================================

// Public routes
app.use('/', healthRouter);

// Admin routes (protected by x-admin-key)
app.use('/admin', adminRouter);

// Dashboard API routes (protected by API key auth)
app.use('/api', requireDashboardAuth, dashboardApiRouter);
app.use('/api', requireDashboardAuth, teamsProjectsRouter);

// Ledger consumer routes (protected by API key auth)
app.use('/api', requireDashboardAuth, ledgerRoutes);

// AI Engine routes (protected by API key auth)
app.use('/api', requireDashboardAuth, inferenceRoutes);

// Webhook routes (protected by per-provider signature verification inside each router)
app.use('/webhooks/slack', slackWebhookRouter);
app.use('/webhooks/jira', jiraWebhookRouter);
app.use('/webhooks/github', githubWebhookRouter);

// ============================================
// Error handling
// ============================================
app.use(errorHandler);

// ============================================
// Server startup
// ============================================
async function start() {
  try {
    await testConnection();

    app.listen(config.PORT, () => {
      logger.info({
        port: config.PORT,
        env: config.NODE_ENV,
        corsOrigins: allowedOrigins,
      }, `FlowGuard Gateway running on port ${config.PORT}`);
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start gateway');
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down gateway...');
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled rejection');
});

start();

export default app;

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { logger } from './logger.js';
import { testConnection, closePool } from './db/client.js';
import { errorHandler, requestLogger } from './middleware/index.js';
import { requireDashboardAuth } from './middleware/auth.js';
import healthRouter from './routes/health.js';
import docsRouter from './routes/docs.js';
import adminRouter from './routes/admin.js';
import dashboardApiRouter from './routes/dashboard-api.js';
import teamsProjectsRouter from './routes/teams-projects.js';
import inferenceRouter from './routes/inference.js';
import ledgerRoutesRouter from './routes/ledger-routes.js';
import slackRouter from './routes/webhooks/slack.js';
import jiraRouter from './routes/webhooks/jira.js';
import githubRouter from './routes/webhooks/github.js';

const app = express();

// ============================================
// Middleware
// ============================================
app.use(helmet());

// CORS — restrict origins instead of allowing all
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  `http://localhost:${config.API_PORT}`,
  `http://127.0.0.1:${config.API_PORT}`,
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server, mobile apps)
    if (!origin) {
      callback(null, true);
      return;
    }
    // Allow configured origins
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    // Allow cloudflared tunnel URLs
    if (origin.endsWith('.trycloudflare.com')) {
      callback(null, true);
      return;
    }
    // Block everything else in production
    if (config.NODE_ENV === 'production') {
      callback(new Error(`CORS: origin ${origin} not allowed`));
      return;
    }
    // Allow all in development
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

// Rate limiting — general API protection
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api', apiLimiter);

// Stricter rate limit for webhooks (high-volume but bounded)
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many webhook requests' },
});
app.use('/webhooks', webhookLimiter);

// ============================================
// Routes
// ============================================

// Public routes (no auth)
app.use('/', docsRouter);
app.use('/', healthRouter);

// Admin routes (protected by x-admin-key — handled inside admin router)
app.use('/admin', adminRouter);

// Dashboard API routes (protected by API key auth)
app.use('/api', requireDashboardAuth, ledgerRoutesRouter);
app.use('/api', requireDashboardAuth, dashboardApiRouter);
app.use('/api', requireDashboardAuth, teamsProjectsRouter);
app.use('/api', requireDashboardAuth, inferenceRouter);

// Webhook routes (protected by per-provider signature verification — handled inside each router)
app.use('/webhooks/slack', slackRouter);
app.use('/webhooks/jira', jiraRouter);
app.use('/webhooks/github', githubRouter);

// ============================================
// Error handling
// ============================================
app.use(errorHandler);

// ============================================
// Server startup
// ============================================
async function start() {
  try {
    // Test database connection
    await testConnection();

    app.listen(config.API_PORT, () => {
      logger.info({
        port: config.API_PORT,
        env: config.NODE_ENV,
        corsOrigins: allowedOrigins,
      }, `🚀 FlowGuard API running on port ${config.API_PORT}`);
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down...');
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

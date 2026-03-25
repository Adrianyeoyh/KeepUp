import { Queue, Worker } from 'bullmq';
import { config } from './config.js';
import { logger } from './logger.js';
import { listCompanyIds, closePool } from './db/client.js';
import { runDailyMetricsAggregation } from './services/metrics-engine.js';
import { runLeakDetection } from './services/leak-engine.js';
import { runDailyDigest } from './services/digest-service.js';
import { runMorningPulse } from './services/morning-pulse.js';
import { runProactiveNudges } from './services/proactive-nudges.js';
import { runDecisionCapture } from './services/decision-capture.js';
import { runSprintRetrospective } from './services/sprint-retro.js';
import { generateRecommendationDrafts } from './services/ai-recommendation-drafts.js';
import { runAIEntityLinkInference } from './services/ai-entity-link-inference.js';
import { runAIImpactSummaries } from './services/ai-impact-summary.js';
import { runThresholdCalibration } from './services/feedback-flywheel.js';
import { runCrossTeamPatternDetection } from './services/cross-team-patterns.js';

type CompanyJobData = { companyId?: string };

const redisUrl = config.REDIS_URL;
const digestCron = config.DIGEST_CRON;

// ============================================
// Redis Connection
// ============================================
const parsedRedisUrl = new URL(redisUrl);

const connection = {
  host: parsedRedisUrl.hostname,
  port: Number(parsedRedisUrl.port || 6379),
  username: parsedRedisUrl.username || undefined,
  password: parsedRedisUrl.password || undefined,
  db: parsedRedisUrl.pathname && parsedRedisUrl.pathname !== '/'
    ? Number(parsedRedisUrl.pathname.slice(1))
    : 0,
  maxRetriesPerRequest: null as any,
};

logger.info({ host: connection.host, port: connection.port, db: connection.db }, '✅ Worker Redis connection configured');

// ============================================
// Job Queues
// ============================================

export const slackEventQueue = new Queue('slack-events', { connection });
export const jiraEventQueue = new Queue('jira-events', { connection });
export const githubEventQueue = new Queue('github-events', { connection });
export const metricsQueue = new Queue('metrics-aggregation', { connection });
export const leakDetectionQueue = new Queue('leak-detection', { connection });
export const digestQueue = new Queue('digest-generation', { connection });
export const pulseQueue = new Queue('morning-pulse', { connection });
export const nudgesQueue = new Queue('proactive-nudges', { connection });
export const decisionCaptureQueue = new Queue('decision-capture', { connection });
export const sprintRetroQueue = new Queue('sprint-retro', { connection });
export const aiDraftsQueue = new Queue('ai-drafts', { connection });
export const aiEntityLinkQueue = new Queue('ai-entity-link', { connection });
export const aiImpactQueue = new Queue('ai-impact-summary', { connection });
export const feedbackCalibrationQueue = new Queue('feedback-calibration', { connection });
export const crossTeamPatternsQueue = new Queue('cross-team-patterns', { connection });

async function withCompanies(
  data: CompanyJobData,
  processor: (companyId: string) => Promise<void>,
): Promise<void> {
  const companyIds = data.companyId ? [data.companyId] : await listCompanyIds();

  for (const companyId of companyIds) {
    await processor(companyId);
  }
}

// ============================================
// Workers (process jobs)
// ============================================

// Slack event processor
const slackWorker = new Worker('slack-events', async (job) => {
  logger.info({ jobId: job.id, type: job.data?.event?.type }, 'Processing Slack event');
  logger.debug({ jobData: job.data }, 'Slack queue processor is active (API handles ingestion directly in MVP)');
}, { connection, concurrency: 5 });

// Jira event processor
const jiraWorker = new Worker('jira-events', async (job) => {
  logger.info({ jobId: job.id, event: job.data?.webhookEvent }, 'Processing Jira event');
  logger.debug({ jobData: job.data }, 'Jira queue processor is active (API handles ingestion directly in MVP)');
}, { connection, concurrency: 5 });

// GitHub event processor
const githubWorker = new Worker('github-events', async (job) => {
  logger.info({ jobId: job.id, event: job.data?.event }, 'Processing GitHub event');
  logger.debug({ jobData: job.data }, 'GitHub queue processor is active (API handles ingestion directly in MVP)');
}, { connection, concurrency: 5 });

// Metrics aggregation (daily)
const metricsWorker = new Worker<CompanyJobData>('metrics-aggregation', async (job) => {
  logger.info({ jobId: job.id, companyId: job.data?.companyId }, 'Running metrics aggregation');

  await withCompanies(job.data || {}, async (companyId) => {
    await runDailyMetricsAggregation(companyId);
    logger.info({ companyId }, 'Metrics aggregation completed');
  });
}, { connection, concurrency: 1 });

// Leak detection (daily, after metrics)
const leakDetectionWorker = new Worker<CompanyJobData>('leak-detection', async (job) => {
  logger.info({ jobId: job.id, companyId: job.data?.companyId }, 'Running leak detection');

  await withCompanies(job.data || {}, async (companyId) => {
    await runLeakDetection(companyId);
    logger.info({ companyId }, 'Leak detection completed');
  });
}, { connection, concurrency: 1 });

// Digest generation (daily)
const digestWorker = new Worker<CompanyJobData>('digest-generation', async (job) => {
  logger.info({ jobId: job.id, companyId: job.data?.companyId }, 'Generating daily digest');

  await withCompanies(job.data || {}, async (companyId) => {
    await runDailyDigest(companyId);
    logger.info({ companyId }, 'Digest generation completed');
  });
}, { connection, concurrency: 1 });

// Morning team pulse (daily, runs with digest)
const pulseWorker = new Worker<CompanyJobData>('morning-pulse', async (job) => {
  logger.info({ jobId: job.id, companyId: job.data?.companyId }, 'Generating morning pulse');

  await withCompanies(job.data || {}, async (companyId) => {
    await runMorningPulse(companyId);
    logger.info({ companyId }, 'Morning pulse completed');
  });
}, { connection, concurrency: 1 });

// Proactive nudges (runs mid-morning)
const nudgesWorker = new Worker<CompanyJobData>('proactive-nudges', async (job) => {
  logger.info({ jobId: job.id, companyId: job.data?.companyId }, 'Running proactive nudges');

  await withCompanies(job.data || {}, async (companyId) => {
    await runProactiveNudges(companyId);
    logger.info({ companyId }, 'Proactive nudges completed');
  });
}, { connection, concurrency: 1 });

// Decision capture (runs mid-morning, after nudges)
const decisionCaptureWorker = new Worker<CompanyJobData>('decision-capture', async (job) => {
  logger.info({ jobId: job.id, companyId: job.data?.companyId }, 'Running decision capture');

  await withCompanies(job.data || {}, async (companyId) => {
    await runDecisionCapture(companyId);
    logger.info({ companyId }, 'Decision capture completed');
  });
}, { connection, concurrency: 1 });

// Sprint retrospective (biweekly)
const sprintRetroWorker = new Worker<CompanyJobData>('sprint-retro', async (job) => {
  logger.info({ jobId: job.id, companyId: job.data?.companyId }, 'Running sprint retrospective');

  await withCompanies(job.data || {}, async (companyId) => {
    await runSprintRetrospective(companyId);
    logger.info({ companyId }, 'Sprint retrospective completed');
  });
}, { connection, concurrency: 1 });

// AI recommendation drafts (daily)
const aiDraftsWorker = new Worker<CompanyJobData>('ai-drafts', async (job) => {
  logger.info({ jobId: job.id }, 'Running AI recommendation drafts');
  await withCompanies(job.data || {}, async (companyId) => {
    await generateRecommendationDrafts(companyId);
    logger.info({ companyId }, 'AI drafts completed');
  });
}, { connection, concurrency: 1 });

// AI entity-link inference (daily)
const aiEntityLinkWorker = new Worker<CompanyJobData>('ai-entity-link', async (job) => {
  logger.info({ jobId: job.id }, 'Running AI entity-link inference');
  await withCompanies(job.data || {}, async (companyId) => {
    await runAIEntityLinkInference(companyId);
    logger.info({ companyId }, 'AI entity-link inference completed');
  });
}, { connection, concurrency: 1 });

// AI impact summary (daily)
const aiImpactWorker = new Worker<CompanyJobData>('ai-impact-summary', async (job) => {
  logger.info({ jobId: job.id }, 'Running AI impact summaries');
  await withCompanies(job.data || {}, async (companyId) => {
    await runAIImpactSummaries(companyId);
    logger.info({ companyId }, 'AI impact summaries completed');
  });
}, { connection, concurrency: 1 });

// Feedback calibration (weekly)
const feedbackCalibrationWorker = new Worker<CompanyJobData>('feedback-calibration', async (job) => {
  logger.info({ jobId: job.id }, 'Running feedback threshold calibration');
  await withCompanies(job.data || {}, async (companyId) => {
    await runThresholdCalibration(companyId);
    logger.info({ companyId }, 'Threshold calibration completed');
  });
}, { connection, concurrency: 1 });

// Cross-team pattern detection (weekly)
const crossTeamPatternsWorker = new Worker<CompanyJobData>('cross-team-patterns', async (job) => {
  logger.info({ jobId: job.id }, 'Running cross-team pattern detection');
  await withCompanies(job.data || {}, async (companyId) => {
    await runCrossTeamPatternDetection(companyId);
    logger.info({ companyId }, 'Cross-team pattern detection completed');
  });
}, { connection, concurrency: 1 });

// ============================================
// Scheduled Jobs (repeatable)
// ============================================

async function setupScheduledJobs() {
  // Daily metrics aggregation — runs at 8am
  await metricsQueue.add('daily-aggregation', {}, {
    jobId: 'daily-aggregation',
    repeat: { pattern: '0 8 * * *' },
    removeOnComplete: 100,
    removeOnFail: 50,
  });

  // Daily leak detection — runs at 8:30am (after metrics)
  await leakDetectionQueue.add('daily-detection', {}, {
    jobId: 'daily-detection',
    repeat: { pattern: '30 8 * * *' },
    removeOnComplete: 100,
    removeOnFail: 50,
  });

  // Daily digest — runs at configured time (default 9am weekdays)
  await digestQueue.add('daily-digest', {}, {
    jobId: 'daily-digest',
    repeat: { pattern: digestCron },
    removeOnComplete: 100,
    removeOnFail: 50,
  });

  // Morning team pulse — runs at 9:05am weekdays (after digest)
  await pulseQueue.add('morning-pulse', {}, {
    jobId: 'morning-pulse',
    repeat: { pattern: '5 9 * * 1-5' },
    removeOnComplete: 100,
    removeOnFail: 50,
  });

  // Proactive nudges — runs at 10am weekdays
  await nudgesQueue.add('proactive-nudges', {}, {
    jobId: 'proactive-nudges',
    repeat: { pattern: '0 10 * * 1-5' },
    removeOnComplete: 100,
    removeOnFail: 50,
  });

  // Decision capture — runs at 10:30am weekdays (after nudges)
  await decisionCaptureQueue.add('decision-capture', {}, {
    jobId: 'decision-capture',
    repeat: { pattern: '30 10 * * 1-5' },
    removeOnComplete: 100,
    removeOnFail: 50,
  });

  // Sprint retrospective — every other Friday at 5pm
  await sprintRetroQueue.add('sprint-retro', {}, {
    jobId: 'sprint-retro',
    repeat: { pattern: '0 17 * * 5', every: 1209600000 },
    removeOnComplete: 50,
    removeOnFail: 20,
  });

  // AI recommendation drafts — runs at 11am weekdays (after leak detection)
  await aiDraftsQueue.add('ai-drafts', {}, {
    jobId: 'ai-drafts',
    repeat: { pattern: '0 11 * * 1-5' },
    removeOnComplete: 50,
    removeOnFail: 20,
  });

  // AI entity-link inference — runs at 11:15am weekdays
  await aiEntityLinkQueue.add('ai-entity-link', {}, {
    jobId: 'ai-entity-link',
    repeat: { pattern: '15 11 * * 1-5' },
    removeOnComplete: 50,
    removeOnFail: 20,
  });

  // AI impact summaries — runs at 11:30am weekdays
  await aiImpactQueue.add('ai-impact-summary', {}, {
    jobId: 'ai-impact-summary',
    repeat: { pattern: '30 11 * * 1-5' },
    removeOnComplete: 50,
    removeOnFail: 20,
  });

  // Feedback threshold calibration — runs every Monday at 6am
  await feedbackCalibrationQueue.add('feedback-calibration', {}, {
    jobId: 'feedback-calibration',
    repeat: { pattern: '0 6 * * 1' },
    removeOnComplete: 20,
    removeOnFail: 10,
  });

  // Cross-team pattern detection — runs every Wednesday at 7am
  await crossTeamPatternsQueue.add('cross-team-patterns', {}, {
    jobId: 'cross-team-patterns',
    repeat: { pattern: '0 7 * * 3' },
    removeOnComplete: 20,
    removeOnFail: 10,
  });

  logger.info({ digestCron }, '📅 Scheduled jobs registered');
}

// ============================================
// Worker Error Handling
// ============================================

for (const worker of [slackWorker, jiraWorker, githubWorker, metricsWorker, leakDetectionWorker, digestWorker, pulseWorker, nudgesWorker, decisionCaptureWorker, sprintRetroWorker, aiDraftsWorker, aiEntityLinkWorker, aiImpactWorker, feedbackCalibrationWorker, crossTeamPatternsWorker]) {
  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, queue: job.queueName }, 'Job completed');
  });
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, queue: job?.queueName, err }, 'Job failed');
  });
}

// ============================================
// Startup
// ============================================

async function start() {
  try {
    await setupScheduledJobs();
    logger.info('🚀 FlowGuard Worker started');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start worker');
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down worker...');
  await Promise.all([
    slackWorker.close(),
    jiraWorker.close(),
    githubWorker.close(),
    metricsWorker.close(),
    leakDetectionWorker.close(),
    digestWorker.close(),
  ]);
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();

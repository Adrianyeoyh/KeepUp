import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';

// ============================================
// Slack Request Signing Verification
// ============================================
// Follows: https://api.slack.com/authentication/verifying-requests-from-slack
//
// 1. Grab timestamp + raw body from request
// 2. Compute HMAC-SHA256 of "v0:{timestamp}:{body}" using signing secret
// 3. Compare against x-slack-signature header with timingSafeEqual
// 4. Reject if timestamp is >5 minutes old (replay protection)

const SLACK_TIMESTAMP_MAX_AGE_SECONDS = 300; // 5 minutes

export function verifySlackSignature(req: Request, res: Response, next: NextFunction): void {
  const signingSecret = config.SLACK_SIGNING_SECRET;

  // Skip verification if signing secret is not configured (local development)
  if (!signingSecret) {
    logger.warn('Slack signing secret not configured — skipping verification');
    next();
    return;
  }

  // Allow url_verification challenges through without signature check
  // (needed for initial Slack app setup when signatures may not be configured yet)
  if (req.body?.type === 'url_verification') {
    next();
    return;
  }

  const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;
  const slackSignature = req.headers['x-slack-signature'] as string | undefined;
  const rawBody = (req as any).rawBody as string | undefined;

  if (!timestamp || !slackSignature) {
    logger.warn('Missing Slack signature headers');
    res.status(401).json({ error: 'Missing Slack signature headers' });
    return;
  }

  if (!rawBody) {
    logger.warn('Missing raw body for Slack signature verification');
    res.status(401).json({ error: 'Missing request body for verification' });
    return;
  }

  // Replay protection: reject if timestamp is older than 5 minutes
  const requestTime = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - requestTime) > SLACK_TIMESTAMP_MAX_AGE_SECONDS) {
    logger.warn({ requestTime, now, delta: Math.abs(now - requestTime) }, 'Slack request timestamp too old (possible replay)');
    res.status(401).json({ error: 'Request timestamp too old' });
    return;
  }

  // Compute expected signature
  const sigBaseString = `v0:${timestamp}:${rawBody}`;
  const expectedSignature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(sigBaseString, 'utf-8')
    .digest('hex');

  // Constant-time comparison
  if (
    expectedSignature.length !== slackSignature.length ||
    !crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf-8'),
      Buffer.from(slackSignature, 'utf-8'),
    )
  ) {
    logger.warn('Invalid Slack signature');
    res.status(401).json({ error: 'Invalid Slack signature' });
    return;
  }

  next();
}

// ============================================
// Jira Webhook Signature Verification
// ============================================
// Jira Cloud can send a webhook secret in custom headers.
// We verify HMAC-SHA256 of the raw body against the configured secret.

export function verifyJiraSignature(req: Request, res: Response, next: NextFunction): void {
  const webhookSecret = config.JIRA_WEBHOOK_SECRET;

  // Skip verification if webhook secret is not configured (graceful degradation)
  if (!webhookSecret) {
    logger.warn('Jira webhook secret not configured — skipping verification');
    next();
    return;
  }

  const rawBody = (req as any).rawBody as string | undefined;

  if (!rawBody) {
    logger.warn('Missing raw body for Jira signature verification');
    res.status(401).json({ error: 'Missing request body for verification' });
    return;
  }

  // Jira sends the signature in various header formats depending on configuration
  // Support common patterns: x-hub-signature, x-atlassian-webhook-signature
  const signature = (
    req.headers['x-hub-signature-256'] ||
    req.headers['x-atlassian-webhook-signature'] ||
    req.headers['x-hub-signature']
  ) as string | undefined;

  if (!signature) {
    // If no signature header present but secret is configured, reject
    logger.warn('Missing Jira webhook signature header');
    res.status(401).json({ error: 'Missing webhook signature' });
    return;
  }

  // Compute expected HMAC
  const expectedHmac = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody, 'utf-8')
    .digest('hex');

  // Support both "sha256=..." prefix format and raw hex
  const receivedHex = signature.startsWith('sha256=')
    ? signature.slice(7)
    : signature;

  if (
    expectedHmac.length !== receivedHex.length ||
    !crypto.timingSafeEqual(
      Buffer.from(expectedHmac, 'utf-8'),
      Buffer.from(receivedHex, 'utf-8'),
    )
  ) {
    logger.warn('Invalid Jira webhook signature');
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  next();
}

// ============================================
// Dashboard API Authentication
// ============================================
// Protects /api/* dashboard endpoints with an API key.
// Accepts key via:
//   - Authorization: Bearer <key>
//   - x-api-key: <key>
//
// In development mode with no key configured, allows all requests.

export function requireDashboardAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = config.ADMIN_API_KEY;

  // Skip auth in development if no key is configured
  if (!apiKey && config.NODE_ENV === 'development') {
    next();
    return;
  }

  if (!apiKey) {
    logger.error('ADMIN_API_KEY not configured in production — blocking all dashboard requests');
    res.status(503).json({ error: 'Dashboard authentication not configured' });
    return;
  }

  // Extract key from request
  const authHeader = req.headers.authorization;
  const xApiKey = req.headers['x-api-key'] as string | undefined;

  let providedKey: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7);
  } else if (xApiKey) {
    providedKey = xApiKey;
  }

  if (!providedKey) {
    res.status(401).json({ error: 'Authentication required. Provide API key via Authorization: Bearer <key> or x-api-key header.' });
    return;
  }

  // Constant-time comparison
  const providedBuffer = Buffer.from(providedKey, 'utf-8');
  const expectedBuffer = Buffer.from(apiKey, 'utf-8');

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    logger.warn({ ip: req.ip }, 'Invalid dashboard API key');
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  next();
}

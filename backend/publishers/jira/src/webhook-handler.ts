import { Router, Request, Response } from 'express';
import type { EventBus } from '@flowguard/event-bus';
import { TOPICS } from '@flowguard/event-bus';
import { JiraAdapter } from './adapter.js';
import { logger } from './logger.js';

/**
 * Create the Jira webhook Express router.
 *
 * Migrated from apps/api/src/routes/webhooks/jira.ts.
 * Handles: POST / — Jira Webhook (issue lifecycle events)
 *
 * All normalized events are published to the event bus.
 */
export function createWebhookRouter(adapter: JiraAdapter, eventBus: EventBus): Router {
  const router = Router();

  // ---- Signature Verification Middleware ----
  router.use(async (req: Request, res: Response, next) => {
    const webhookReq = {
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: req.body,
      rawBody: (req as any).rawBody || '',
    };

    const valid = await adapter.verifySignature(webhookReq);
    if (!valid) {
      logger.warn('Invalid Jira webhook signature');
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }
    next();
  });

  // ---- POST / — Jira Webhook ----
  router.post('/', async (req: Request, res: Response) => {
    const body = req.body;
    const webhookEvent = body.webhookEvent;

    logger.info(
      { webhookEvent, issue_key: body.issue?.key },
      'Jira webhook received',
    );

    // Acknowledge immediately
    res.status(200).send();

    void (async () => {
      try {
        const webhookReq = {
          headers: req.headers as Record<string, string | string[] | undefined>,
          body: req.body,
          rawBody: (req as any).rawBody || '',
        };

        const normalizedEvents = await adapter.handleWebhook(webhookReq);

        if (normalizedEvents.length === 0) {
          logger.debug({ webhookEvent }, 'Jira webhook ignored (unsupported event)');
          return;
        }

        // Publish each normalized event to the event bus
        for (const normalized of normalizedEvents) {
          await eventBus.publish(TOPICS.EVENTS_INGESTED, normalized);
        }

        logger.info(
          { count: normalizedEvents.length, webhookEvent },
          'Jira events published to bus',
        );
      } catch (error) {
        logger.error({ error }, 'Failed processing Jira webhook');
      }
    })();
  });

  return router;
}

import { Router, Request, Response } from 'express';
import type { EventBus } from '@flowguard/event-bus';
import { TOPICS } from '@flowguard/event-bus';
import { GitHubAdapter } from './adapter.js';
import { logger } from './logger.js';

/**
 * Create the GitHub webhook Express router.
 *
 * Migrated from apps/api/src/routes/webhooks/github.ts.
 * Handles: POST / — GitHub Webhook (PR lifecycle, reviews, deployments, etc.)
 *
 * All normalized events are published to the event bus.
 */
export function createWebhookRouter(adapter: GitHubAdapter, eventBus: EventBus): Router {
  const router = Router();

  // ---- POST / — GitHub Webhook ----
  router.post('/', async (req: Request, res: Response) => {
    const githubEvent = req.headers['x-github-event'] as string;
    const deliveryId = req.headers['x-github-delivery'] as string;

    // Verify signature
    const webhookReq = {
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: req.body,
      rawBody: (req as any).rawBody || JSON.stringify(req.body),
      query: req.query as Record<string, string>,
    };

    const valid = await adapter.verifySignature(webhookReq);
    if (!valid) {
      logger.warn({ deliveryId }, 'Invalid GitHub webhook signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    logger.info(
      {
        event: githubEvent,
        action: req.body.action,
        deliveryId,
        repo: req.body.repository?.full_name,
      },
      'GitHub webhook received',
    );

    // Acknowledge immediately
    res.status(200).send();

    void (async () => {
      try {
        const normalizedEvents = await adapter.handleWebhook(webhookReq);

        if (normalizedEvents.length === 0) {
          logger.debug(
            { githubEvent, action: req.body.action },
            'GitHub webhook ignored (unsupported event)',
          );
          return;
        }

        // Publish each normalized event to the event bus
        for (const normalized of normalizedEvents) {
          await eventBus.publish(TOPICS.EVENTS_INGESTED, normalized);
        }

        logger.info(
          { count: normalizedEvents.length, githubEvent },
          'GitHub events published to bus',
        );
      } catch (error) {
        logger.error({ error }, 'Failed processing GitHub webhook');
      }
    })();
  });

  return router;
}

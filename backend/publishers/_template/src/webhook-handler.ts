import { Router, Request, Response } from 'express';
import type { EventBus } from '@flowguard/event-bus';
import { TOPICS } from '@flowguard/event-bus';
import { TemplateAdapter } from './adapter.js';
import { logger } from './logger.js';

// ============================================
// Webhook Handler Template
// ============================================
//
// This file creates an Express router that handles incoming webhooks
// from your provider. The gateway mounts this router at
// /webhooks/<your-provider>.
//
// TODO: Replace 'TemplateAdapter' with your adapter class name
// TODO: Implement signature verification middleware
// TODO: Add routes for each webhook endpoint your provider uses
//
// See backend/publishers/slack/src/webhook-handler.ts for a complete example.

export function createWebhookRouter(adapter: TemplateAdapter, eventBus: EventBus): Router {
  const router = Router();

  // ---- Signature Verification Middleware ----
  //
  // TODO: Verify webhook signatures before processing.
  //       This prevents spoofed webhooks from being processed.

  router.use(async (req: Request, res: Response, next) => {
    const webhookReq = {
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: req.body,
      rawBody: (req as any).rawBody || '',
      query: req.query as Record<string, string>,
    };

    const valid = await adapter.verifySignature(webhookReq);
    if (!valid) {
      logger.warn('Invalid webhook signature');
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }
    next();
  });

  // ---- POST /events — Main Webhook Endpoint ----
  //
  // TODO: Rename this route if your provider uses a different path.
  //       Some providers send all events to one URL; others use
  //       separate URLs per event type.
  //
  // TODO: Handle any challenge/verification handshake your provider
  //       requires during webhook registration (like Slack's url_verification).

  router.post('/events', async (req: Request, res: Response) => {
    const body = req.body;

    // TODO: Handle provider-specific verification challenges
    //
    // Example (Slack-style):
    // if (body.type === 'url_verification') {
    //   res.json({ challenge: body.challenge });
    //   return;
    // }

    logger.info({ eventType: body.type || body.event_type }, 'Webhook event received');

    // Acknowledge immediately — most providers require a fast response
    // (e.g., Slack requires < 3 seconds)
    res.status(200).send();

    // Process in background after acknowledging
    void (async () => {
      try {
        const webhookReq = {
          headers: req.headers as Record<string, string | string[] | undefined>,
          body: req.body,
          rawBody: (req as any).rawBody || '',
        };

        const normalizedEvents = await adapter.handleWebhook(webhookReq);

        // Publish each normalized event to the event bus
        for (const event of normalizedEvents) {
          await eventBus.publish(TOPICS.EVENTS_INGESTED, event);
        }

        if (normalizedEvents.length > 0) {
          logger.info(
            { count: normalizedEvents.length },
            'Events published to bus',
          );
        }
      } catch (error) {
        logger.error({ error }, 'Failed processing webhook event');
      }
    })();
  });

  // TODO: Add additional routes if your provider needs them.
  //
  // Examples:
  //
  // Interactive actions endpoint:
  // router.post('/actions', async (req, res) => { ... });
  //
  // OAuth callback:
  // router.get('/oauth/callback', async (req, res) => { ... });
  //
  // Status/health endpoint:
  // router.get('/health', (req, res) => {
  //   res.json({ status: 'ok', provider: 'template' });
  // });

  return router;
}

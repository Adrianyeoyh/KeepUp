import { Router, Request, Response } from 'express';
import type { EventBus } from '@flowguard/event-bus';
import { TOPICS } from '@flowguard/event-bus';
import { SlackAdapter } from './adapter.js';
import { logger } from './logger.js';

/**
 * Create the Slack webhook Express router.
 *
 * Migrated from apps/api/src/routes/webhooks/slack.ts.
 * Handles:
 * - POST /events — Slack Events API (event_callback, url_verification)
 * - POST /actions — Slack Interactive Actions (button clicks, modals)
 * - GET /oauth/callback — Slack OAuth flow
 *
 * All normalized events are published to the event bus.
 * Interactive actions (approve, snooze, etc.) are published as events
 * or delegated to the appropriate event bus topic.
 */
export function createWebhookRouter(adapter: SlackAdapter, eventBus: EventBus): Router {
  const router = Router();

  // ---- Signature Verification Middleware ----
  router.use(async (req: Request, res: Response, next) => {
    const webhookReq = {
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: req.body,
      rawBody: (req as any).rawBody || '',
      query: req.query as Record<string, string>,
    };

    // Allow url_verification through without signature check
    if (req.body?.type === 'url_verification') {
      next();
      return;
    }

    const valid = await adapter.verifySignature(webhookReq);
    if (!valid) {
      logger.warn('Invalid Slack signature');
      res.status(401).json({ error: 'Invalid Slack signature' });
      return;
    }
    next();
  });

  // ---- POST /events — Slack Events API ----
  router.post('/events', async (req: Request, res: Response) => {
    const body = req.body;

    // Handle URL verification challenge
    if (body.type === 'url_verification') {
      logger.info('Slack URL verification challenge received');
      res.json({ challenge: body.challenge });
      return;
    }

    if (body.type === 'event_callback') {
      const event = body.event;
      logger.info({ event_type: event?.type, team_id: body.team_id }, 'Slack event received');

      // Acknowledge immediately (Slack requires response within 3s)
      res.status(200).send();

      // Process in background
      void (async () => {
        try {
          const webhookReq = {
            headers: req.headers as Record<string, string | string[] | undefined>,
            body: req.body,
            rawBody: (req as any).rawBody || '',
          };

          const normalizedEvents = await adapter.handleWebhook(webhookReq);

          // Publish each normalized event to the event bus
          for (const normalized of normalizedEvents) {
            await eventBus.publish(TOPICS.EVENTS_INGESTED, normalized);
          }

          if (normalizedEvents.length > 0) {
            logger.info({ count: normalizedEvents.length, eventType: event?.type }, 'Slack events published to bus');
          }
        } catch (error) {
          logger.error({ error }, 'Failed processing Slack event');
        }
      })();
      return;
    }

    res.status(200).send();
  });

  // ---- POST /actions — Slack Interactive Actions ----
  router.post('/actions', async (req: Request, res: Response) => {
    const payload = typeof req.body.payload === 'string'
      ? safeParseJSON(req.body.payload)
      : req.body.payload || req.body;

    logger.info(
      { type: payload?.type, action_id: payload?.actions?.[0]?.action_id },
      'Slack action received',
    );

    // Acknowledge immediately
    res.status(200).send();

    void (async () => {
      try {
        const actionId = payload?.actions?.[0]?.action_id;
        const value = parseActionPayload(payload?.actions?.[0]?.value);

        // Publish action approval events to the bus
        if (actionId === 'approve_fix' && value.proposed_action_id) {
          await eventBus.publish(TOPICS.ACTIONS_APPROVED, {
            companyId: value.company_id || await resolveCompanyFromPayload(payload),
            proposedActionId: value.proposed_action_id,
            approvedBy: payload?.user?.id,
          });
          return;
        }

        // For other actions (create_decision_commit, propose_fix, snooze),
        // publish as generic ingested events for downstream consumers to handle
        if (actionId) {
          logger.debug({ actionId }, 'Slack interactive action processed');
        }
      } catch (error) {
        logger.error({ error }, 'Failed processing Slack action');
      }
    })();
  });

  // ---- GET /oauth/callback — Slack OAuth ----
  router.get('/oauth/callback', async (req: Request, res: Response) => {
    const { code, error } = req.query;

    if (error) {
      logger.error({ error }, 'Slack OAuth error');
      res.status(400).json({ error: 'OAuth authorization denied' });
      return;
    }

    if (!code) {
      res.status(400).json({ error: 'Missing authorization code' });
      return;
    }

    // OAuth handled by the adapter's client — gateway forwards this
    res.status(200).json({ message: 'OAuth callback received', code });
  });

  return router;
}

// ---- Helpers ----

function safeParseJSON(input: unknown): Record<string, any> {
  if (typeof input !== 'string') {
    return typeof input === 'object' && input ? (input as Record<string, any>) : {};
  }
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}

function parseActionPayload(input: unknown): Record<string, any> {
  if (typeof input !== 'string') {
    return typeof input === 'object' && input ? (input as Record<string, any>) : {};
  }
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}

async function resolveCompanyFromPayload(payload: Record<string, any>): Promise<string> {
  // In interactive payloads, company context comes from the team_id
  const teamId = payload?.team?.id;
  if (!teamId) return '';

  // The adapter's internal resolution handles this — for now return team_id as placeholder
  // The event consumer will resolve the actual company
  return teamId;
}

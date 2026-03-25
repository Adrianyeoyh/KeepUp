import { Router, Request, Response } from 'express';
import { WebClient } from '@slack/web-api';
import type { CreateEvent, EventType, RiskLevel, TargetSystem } from '@flowguard/shared';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import { query } from '../../db/client.js';
import { eventStore } from '../../services/event-store.js';
import { entityResolver } from '../../services/entity-resolver.js';
import { extractAndStoreLinks } from '../../services/entity-link-extractor.js';
import { ledgerService } from '../../services/ledger.js';
import { remediationService } from '../../services/remediation.js';
import { updateLeakStatusById } from '../../services/leaks.js';
import { integrationService } from '../../services/integration.js';
import { ensureDefaultCompanyId, resolveCompanyByProviderContext } from '../../services/company-context.js';
import { executeApprovedAction } from '../../services/executor.js';
import { handleWorkflowStepEdit, handleWorkflowStepExecute, handleWorkflowStepSave } from '../../services/slack-workflow-step.js';
import { verifySlackSignature } from '../../middleware/auth.js';

const router = Router();

// Apply Slack signing verification to all routes in this router
router.use(verifySlackSignature);

const RESOLUTION_REACTIONS = new Set(['white_check_mark', 'heavy_check_mark']);

function parseActionPayload(input: unknown): Record<string, any> {
  if (typeof input !== 'string') {
    return typeof input === 'object' && input ? (input as Record<string, any>) : {};
  }

  try {
    return JSON.parse(input) as Record<string, any>;
  } catch {
    return {};
  }
}

function detectImpliedAction(text: string): boolean {
  if (!text) {
    return false;
  }

  return /\b(todo|action item|follow up|follow-up|please|we should|let's)\b/i.test(text);
}

function hasLinkedJiraIssue(text: string): boolean {
  if (!text) {
    return false;
  }

  return /\b[A-Z][A-Z0-9]+-\d+\b/.test(text);
}

/**
 * Detect whether a message edit is substantive (decision reversal signal)
 * vs cosmetic (typo fix, formatting).
 */
function isSubstantiveEdit(previousText: string, newText: string): boolean {
  if (!previousText || !newText) return false;
  // Significant length change (>30% of original or >50 chars)
  const delta = Math.abs(newText.length - previousText.length);
  if (delta > Math.max(previousText.length * 0.3, 50)) return true;
  // Check for reversal keywords in the new text
  return /\b(actually|never ?mind|scratch that|disregard|changed my mind|correction|update:|revised)\b/i.test(newText);
}

function slackTsToDate(ts: string | number | undefined): Date {
  if (!ts) {
    return new Date();
  }

  const seconds = typeof ts === 'number' ? ts : Number(ts.split('.')[0] || ts);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

function extractCompanyIdFromState(state: string | undefined): string | undefined {
  if (!state) {
    return undefined;
  }

  if (/^[0-9a-fA-F-]{36}$/.test(state)) {
    return state;
  }

  try {
    const parsed = JSON.parse(state) as { company_id?: string };
    return parsed.company_id;
  } catch {
    return undefined;
  }
}

function inferTargetSystem(actionType: string | undefined): TargetSystem {
  if (!actionType) {
    return 'slack';
  }

  if (actionType.startsWith('jira_')) {
    return 'jira';
  }

  if (actionType.startsWith('github_')) {
    return 'github';
  }

  return 'slack';
}

function normalizeSlackEvent(body: Record<string, any>, companyId: string): CreateEvent | null {
  const event = body.event || {};
  const teamId = body.team_id || event.team || 'unknown-team';

  if (event.type === 'message' && !event.subtype) {
    const text = typeof event.text === 'string' ? event.text : '';
    const channelId = event.channel || 'unknown-channel';
    const threadTs = event.thread_ts || event.ts;
    const isThreadReply = Boolean(event.thread_ts && event.thread_ts !== event.ts);
    const eventType: EventType = isThreadReply ? 'slack.thread_reply' : 'slack.message';

    return {
      company_id: companyId,
      source: 'slack',
      entity_id: `${channelId}:${threadTs}`,
      event_type: eventType,
      timestamp: slackTsToDate(event.ts),
      metadata: {
        team_id: teamId,
        channel_id: channelId,
        thread_ts: threadTs,
        message_ts: event.ts,
        user_id: event.user || null,
        message_count_increment: 1,
        resolved_marker_present: false,
        implied_action: detectImpliedAction(text),
        linked_jira_issue: hasLinkedJiraIssue(text),
        participant_count: event.reply_users_count || undefined,
      },
      provider_event_id: body.event_id || event.client_msg_id || `${teamId}:${event.ts}:${event.user || 'unknown'}`,
    };
  }

  if (event.type === 'reaction_added' || event.type === 'reaction_removed') {
    const channelId = event.item?.channel || event.channel || 'unknown-channel';
    const threadTs = event.item?.ts || event.ts;
    const isResolvedReaction = RESOLUTION_REACTIONS.has(event.reaction);

    const eventType: EventType = event.type === 'reaction_added'
      ? (isResolvedReaction ? 'slack.thread_resolved' : 'slack.reaction_added')
      : 'slack.reaction_removed';

    return {
      company_id: companyId,
      source: 'slack',
      entity_id: `${channelId}:${threadTs}`,
      event_type: eventType,
      timestamp: new Date(),
      metadata: {
        team_id: teamId,
        channel_id: channelId,
        thread_ts: threadTs,
        reaction: event.reaction,
        user_id: event.user || null,
        resolved_marker_present: isResolvedReaction,
      },
      provider_event_id: body.event_id || `${teamId}:${event.type}:${channelId}:${threadTs}:${event.reaction}`,
    };
  }

  if (event.type === 'channel_created') {
    return {
      company_id: companyId,
      source: 'slack',
      entity_id: event.channel?.id || 'unknown-channel',
      event_type: 'slack.channel_created',
      timestamp: new Date(),
      metadata: {
        team_id: teamId,
        channel_id: event.channel?.id || null,
        channel_name: event.channel?.name || null,
      },
      provider_event_id: body.event_id || `${teamId}:channel_created:${event.channel?.id || 'unknown'}`,
    };
  }

  if (event.type === 'member_joined_channel') {
    return {
      company_id: companyId,
      source: 'slack',
      entity_id: event.channel || 'unknown-channel',
      event_type: 'slack.member_joined_channel',
      timestamp: new Date(),
      metadata: {
        team_id: teamId,
        channel_id: event.channel || null,
        user_id: event.user || null,
        inviter_id: event.inviter || null,
      },
      provider_event_id: body.event_id || `${teamId}:member_joined:${event.channel || 'unknown'}:${event.user || 'unknown'}`,
    };
  }

  // v3: Track message edits — detect decision reversals
  if (event.type === 'message' && event.subtype === 'message_changed') {
    const channelId = event.channel || 'unknown-channel';
    const previousText = typeof event.previous_message?.text === 'string' ? event.previous_message.text : '';
    const newText = typeof event.message?.text === 'string' ? event.message.text : '';
    const threadTs = event.message?.thread_ts || event.message?.ts || event.ts;

    return {
      company_id: companyId,
      source: 'slack',
      entity_id: `${channelId}:${threadTs}`,
      event_type: 'slack.message_changed',
      timestamp: new Date(),
      metadata: {
        team_id: teamId,
        channel_id: channelId,
        thread_ts: threadTs,
        message_ts: event.message?.ts || event.ts,
        user_id: event.message?.user || null,
        previous_text_length: previousText.length,
        new_text_length: newText.length,
        edit_delta: Math.abs(newText.length - previousText.length),
        is_substantive_edit: isSubstantiveEdit(previousText, newText),
      },
      provider_event_id: body.event_id || `${teamId}:message_changed:${channelId}:${event.message?.ts || event.ts}`,
    };
  }

  return null;
}

async function processSlackEvent(body: Record<string, any>): Promise<void> {
  const teamId = body.team_id || body.event?.team;
  const companyId = await resolveCompanyByProviderContext('slack', {
    slackTeamId: teamId,
  });

  const normalized = normalizeSlackEvent(body, companyId);
  if (!normalized) {
    logger.debug({ eventType: body.event?.type }, 'Slack event ignored (unsupported type)');
    return;
  }

  // v2: Resolve team + project scope from channel_id
  const channelId = body.event?.channel || (normalized.metadata as Record<string, any>)?.channel_id;
  const scope = await entityResolver.resolveScope(companyId, 'slack', { channelId });

  await eventStore.insert({
    ...normalized,
    team_id: scope.team_id,
    project_id: scope.project_id,
  });

  // v2: Extract cross-tool entity links from message content
  void extractAndStoreLinks(normalized).catch((err) => {
    logger.warn({ err }, 'Entity link extraction failed — non-fatal');
  });
}

async function processSlackAction(payload: Record<string, any>): Promise<void> {
  const action = payload.actions?.[0];
  if (!action) {
    return;
  }

  const actionId = action.action_id as string;
  const value = parseActionPayload(action.value);

  const companyId = value.company_id || await resolveCompanyByProviderContext('slack', {
    slackTeamId: payload.team?.id,
  });
  const leakId = value.leak_instance_id as string | undefined;
  const actorId = payload.user?.id as string | undefined;

  if (actionId === 'create_decision_commit' || actionId === 'create_action_commit') {
    await ledgerService.create({
      company_id: companyId,
      commit_type: actionId === 'create_decision_commit' ? 'decision' : 'action',
      title: value.title || (actionId === 'create_decision_commit' ? 'Decision Commit Draft' : 'Action Commit Draft'),
      summary: value.summary || 'Generated from Slack interactive action.',
      rationale: value.rationale,
      dri: value.dri || actorId,
      status: 'proposed',
      branch_name: 'main',
      evidence_links: Array.isArray(value.evidence_links) ? value.evidence_links : [],
      tags: [],
      leak_instance_id: leakId,
      created_by: actorId,
    });

    if (leakId) {
      await updateLeakStatusById(leakId, 'actioned');
    }

    return;
  }

  if (actionId === 'propose_fix') {
    const actionType = value.action_type || 'slack_reminder';

    await remediationService.createProposal({
      company_id: companyId,
      leak_instance_id: leakId,
      action_type: actionType,
      target_system: (value.target_system || inferTargetSystem(actionType)) as TargetSystem,
      target_id: value.target_id || value.channel_id || payload.channel?.id || 'unknown-target',
      preview_diff: {
        description: value.description || 'FlowGuard remediation draft generated from digest.',
        before: value.before,
        after: value.after || 'FlowGuard reminder: please confirm owner and due date for this thread.',
        structured: value.structured || {},
      },
      risk_level: (value.risk_level || 'low') as RiskLevel,
      blast_radius: value.blast_radius,
      approval_status: 'pending',
      requested_by: actorId,
    });

    if (leakId) {
      await updateLeakStatusById(leakId, 'actioned');
    }

    return;
  }

  if (actionId === 'approve_fix') {
    const proposedActionId = value.proposed_action_id as string | undefined;
    const actionType = value.action_type || 'slack_reminder';

    const proposal = proposedActionId
      ? await remediationService.updateApproval(proposedActionId, 'approved', actorId)
      : await remediationService.createProposal({
        company_id: companyId,
        leak_instance_id: leakId,
        action_type: actionType,
        target_system: (value.target_system || inferTargetSystem(actionType)) as TargetSystem,
        target_id: value.target_id || value.channel_id || payload.channel?.id || 'unknown-target',
        preview_diff: {
          description: value.description || 'Auto-approved remediation generated from digest.',
          before: value.before,
          after: value.after || 'FlowGuard approved reminder: please assign owner + due date.',
          structured: value.structured || {},
        },
        risk_level: (value.risk_level || 'low') as RiskLevel,
        blast_radius: value.blast_radius,
        requested_by: actorId,
        approval_status: 'approved',
      });

    if (proposal) {
      if (!proposedActionId) {
        await remediationService.updateApproval(proposal.id, 'approved', actorId);
      }
      await executeApprovedAction(proposal);
      if (leakId) {
        await updateLeakStatusById(leakId, 'actioned');
      }
    }

    return;
  }

  if (actionId === 'snooze') {
    if (leakId) {
      await updateLeakStatusById(leakId, 'snoozed');
    }
    return;
  }

  logger.debug({ actionId }, 'Unhandled Slack action');
}

/**
 * Slack Event Subscription endpoint
 * Receives events from Slack Events API
 */
router.post('/events', async (req: Request, res: Response) => {
  const body = req.body;

  // Handle Slack URL verification challenge
  if (body.type === 'url_verification') {
    logger.info('Slack URL verification challenge received');
    res.json({ challenge: body.challenge });
    return;
  }

  // Handle event callbacks
  if (body.type === 'event_callback') {
    const event = body.event;
    logger.info({ event_type: event.type, team_id: body.team_id }, 'Slack event received');

    // Acknowledge immediately (Slack requires response within 3s)
    res.status(200).send();

    // v3: Handle workflow_step_execute events
    if (event.type === 'workflow_step_execute') {
      const teamId = body.team_id || event.team;
      void (async () => {
        try {
          const companyId = await resolveCompanyByProviderContext('slack', { slackTeamId: teamId });
          await handleWorkflowStepExecute(companyId, body);
        } catch (error) {
          logger.error({ error }, 'Failed processing workflow step execute');
        }
      })();
      return;
    }

    void processSlackEvent(body).catch((error) => {
      logger.error({ error }, 'Failed processing Slack event');
    });
    return;
  }

  res.status(200).send();
});

/**
 * Slack Interactive Actions endpoint
 * Handles button clicks, modals, etc.
 */
router.post('/actions', async (req: Request, res: Response) => {
  // Slack sends interactive payloads as form-encoded with a 'payload' field
  const payload = typeof req.body.payload === 'string'
    ? parseActionPayload(req.body.payload)
    : req.body.payload || req.body;

  logger.info({ type: payload?.type, action_id: payload?.actions?.[0]?.action_id }, 'Slack action received');

  // Acknowledge immediately
  res.status(200).send();

  // v3: Handle Workflow Builder step configuration
  if (payload?.type === 'workflow_step_edit') {
    void (async () => {
      try {
        const teamId = payload.workflow_step?.workflow_id ? payload.team?.id : payload.team?.id;
        const companyId = await resolveCompanyByProviderContext('slack', { slackTeamId: teamId });
        await handleWorkflowStepEdit(companyId, payload);
      } catch (error) {
        logger.error({ error }, 'Failed processing workflow step edit');
      }
    })();
    return;
  }

  // v3: Handle Workflow Builder step config submission
  if (payload?.type === 'view_submission' && payload?.view?.callback_id === 'flowguard_workflow_step_config') {
    void (async () => {
      try {
        const teamId = payload.team?.id;
        const companyId = await resolveCompanyByProviderContext('slack', { slackTeamId: teamId });
        await handleWorkflowStepSave(companyId, payload);
      } catch (error) {
        logger.error({ error }, 'Failed processing workflow step save');
      }
    })();
    return;
  }

  void processSlackAction(payload).catch((error) => {
    logger.error({ error }, 'Failed processing Slack action');
  });
});

/**
 * Slack OAuth callback
 */
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

  if (!config.SLACK_CLIENT_ID || !config.SLACK_CLIENT_SECRET) {
    res.status(400).json({
      error: 'Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in .env.',
    });
    return;
  }

  const client = new WebClient();

  try {
    const oauthResponse = await client.oauth.v2.access({
      client_id: config.SLACK_CLIENT_ID,
      client_secret: config.SLACK_CLIENT_SECRET,
      code: String(code),
      redirect_uri: process.env.SLACK_REDIRECT_URI,
    });

    if (!oauthResponse.ok) {
      res.status(400).json({ error: oauthResponse.error || 'OAuth exchange failed' });
      return;
    }

    const companyId = extractCompanyIdFromState(
      typeof req.query.state === 'string' ? req.query.state : undefined,
    ) || await ensureDefaultCompanyId();

    await integrationService.upsert({
      companyId,
      provider: 'slack',
      status: 'active',
      installationData: {
        team_id: oauthResponse.team?.id,
        team_name: oauthResponse.team?.name,
        app_id: oauthResponse.app_id,
        enterprise_id: oauthResponse.enterprise?.id,
      },
      tokenData: {
        bot_token: oauthResponse.access_token,
        bot_user_id: oauthResponse.bot_user_id,
        authed_user_id: oauthResponse.authed_user?.id,
      },
      scopes: oauthResponse.scope ? oauthResponse.scope.split(',') : [],
    });

    // v2: Persist enterprise_id in company settings for Slack Enterprise Grid support
    if (oauthResponse.enterprise?.id) {
      await query(
        `UPDATE companies
         SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
         WHERE id = $2`,
        [
          JSON.stringify({
            slack_enterprise_id: oauthResponse.enterprise.id,
            slack_enterprise_name: oauthResponse.enterprise.name || null,
          }),
          companyId,
        ],
      );
    }

    logger.info({ team_id: oauthResponse.team?.id, companyId }, 'Slack integration connected');
    res.json({
      message: 'Slack integration connected successfully',
      team_id: oauthResponse.team?.id,
      company_id: companyId,
    });
  } catch (oauthError) {
    logger.error({ oauthError }, 'Slack OAuth exchange failed');
    res.status(500).json({ error: 'Slack OAuth exchange failed' });
  }
});

export default router;

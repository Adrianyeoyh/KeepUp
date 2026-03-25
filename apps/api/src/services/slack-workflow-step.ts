import { WebClient } from '@slack/web-api';
import { Queue } from 'bullmq';
import { query } from '../db/client.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { integrationService } from './integration.js';

/**
 * Slack Workflow Builder — Custom Steps
 *
 * FlowGuard registers as a custom step in Slack Workflow Builder,
 * allowing teams to embed FlowGuard actions directly in their automated
 * workflows. Supported step types:
 *
 *   1. "Create Ledger Commit"  — creates a decision/action commit
 *   2. "Check Leak Status"     — returns current leak count + top leak
 *   3. "Request Team Pulse"    — triggers an on-demand morning pulse
 *
 * Slack Workflow Steps v2 (Functions) flow:
 *   1. User adds FlowGuard step in Workflow Builder
 *   2. Slack sends `workflow_step_edit` → we open a config modal
 *   3. User submits modal → we call `workflows.updateStep` with inputs/outputs
 *   4. Workflow runs → Slack sends `workflow_step_execute` → we process + respond
 */

export type StepType = 'create_commit' | 'check_leaks' | 'request_pulse';

interface StepConfig {
  step_type: StepType;
  commit_type?: 'decision' | 'action';
  team_slug?: string;
}

/**
 * Handle workflow_step_edit — open configuration modal in Slack.
 */
export async function handleWorkflowStepEdit(
  companyId: string,
  payload: Record<string, any>,
): Promise<void> {
  const triggerId = payload.trigger_id;
  const callbackId = payload.workflow_step?.workflow_step_edit_id;

  const slackToken = await getSlackBotToken(companyId);
  if (!slackToken) {
    logger.warn({ companyId }, 'Slack workflow step edit skipped — no token');
    return;
  }

  const client = new WebClient(slackToken);

  try {
    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'workflow_step',
        callback_id: 'flowguard_workflow_step_config',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Configure FlowGuard Step*\nChoose what FlowGuard should do when this workflow runs.',
            },
          },
          {
            type: 'input',
            block_id: 'step_type_block',
            element: {
              type: 'static_select',
              action_id: 'step_type',
              placeholder: { type: 'plain_text', text: 'Select a step type' },
              options: [
                { text: { type: 'plain_text', text: '📝 Create Ledger Commit' }, value: 'create_commit' },
                { text: { type: 'plain_text', text: '🔍 Check Leak Status' }, value: 'check_leaks' },
                { text: { type: 'plain_text', text: '📊 Request Team Pulse' }, value: 'request_pulse' },
              ],
            },
            label: { type: 'plain_text', text: 'Step Type' },
          },
          {
            type: 'input',
            block_id: 'team_slug_block',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'team_slug',
              placeholder: { type: 'plain_text', text: 'e.g. platform-team (leave empty for org-wide)' },
            },
            label: { type: 'plain_text', text: 'Team Slug (optional)' },
          },
        ],
      },
    });
  } catch (err) {
    logger.error({ err, companyId }, 'Failed to open workflow step config modal');
  }
}

/**
 * Handle workflow_step config submission — save inputs/outputs.
 */
export async function handleWorkflowStepSave(
  companyId: string,
  payload: Record<string, any>,
): Promise<void> {
  const slackToken = await getSlackBotToken(companyId);
  if (!slackToken) {
    logger.warn({ companyId }, 'Slack workflow step save skipped — no token');
    return;
  }

  const client = new WebClient(slackToken);
  const workflowStepEditId = payload.workflow_step?.workflow_step_edit_id;

  const values = payload.view?.state?.values || {};
  const stepType = values.step_type_block?.step_type?.selected_option?.value || 'check_leaks';
  const teamSlug = values.team_slug_block?.team_slug?.value || '';

  try {
    await client.workflows.updateStep({
      workflow_step_edit_id: workflowStepEditId,
      inputs: {
        step_type: { value: stepType },
        team_slug: { value: teamSlug },
        company_id: { value: companyId },
      },
      outputs: [
        { type: 'text', name: 'result_summary', label: 'FlowGuard Result Summary' },
        { type: 'text', name: 'result_detail', label: 'FlowGuard Result Detail' },
      ],
    });
  } catch (err) {
    logger.error({ err, companyId }, 'Failed to save workflow step config');
  }
}

/**
 * Handle workflow_step_execute — run the configured FlowGuard action.
 */
export async function handleWorkflowStepExecute(
  companyId: string,
  payload: Record<string, any>,
): Promise<void> {
  const slackToken = await getSlackBotToken(companyId);
  if (!slackToken) {
    logger.warn({ companyId }, 'Slack workflow step execute skipped — no token');
    return;
  }

  const client = new WebClient(slackToken);
  const stepExecuteId = payload.event?.workflow_step?.workflow_step_execute_id;
  const inputs = payload.event?.workflow_step?.inputs || {};
  const stepType = inputs.step_type?.value as StepType || 'check_leaks';
  const teamSlug = inputs.team_slug?.value as string || '';
  const resolvedCompanyId = inputs.company_id?.value as string || companyId;

  try {
    const { summary, detail } = await executeStep(resolvedCompanyId, stepType, teamSlug);

    await client.workflows.stepCompleted({
      workflow_step_execute_id: stepExecuteId,
      outputs: {
        result_summary: summary,
        result_detail: detail,
      },
    });

    logger.info({ stepType, teamSlug, companyId: resolvedCompanyId }, 'Workflow step executed');
  } catch (err) {
    logger.error({ err, stepType }, 'Workflow step execution failed');

    try {
      await client.workflows.stepFailed({
        workflow_step_execute_id: stepExecuteId,
        error: { message: 'FlowGuard step failed — check logs for details.' },
      });
    } catch (failErr) {
      logger.error({ failErr }, 'Failed to report workflow step failure');
    }
  }
}

async function executeStep(
  companyId: string,
  stepType: StepType,
  teamSlug: string,
): Promise<{ summary: string; detail: string }> {
  const teamId = teamSlug ? await resolveTeamId(companyId, teamSlug) : null;

  switch (stepType) {
    case 'create_commit':
      return executeCreateCommit(companyId, teamId);
    case 'check_leaks':
      return executeCheckLeaks(companyId, teamId);
    case 'request_pulse':
      return executeRequestPulse(companyId, teamId);
    default:
      return { summary: 'Unknown step type', detail: `Step type '${stepType}' is not recognized.` };
  }
}

async function executeCreateCommit(
  companyId: string,
  teamId: string | null,
): Promise<{ summary: string; detail: string }> {
  // Create an auto-generated workflow commit from the latest unresolved leak
  const teamClause = teamId ? `AND team_id = $2` : '';
  const params: unknown[] = [companyId];
  if (teamId) params.push(teamId);

  const leakResult = await query<{
    id: string;
    leak_type: string;
    severity: number;
    recommended_fix: string;
  }>(
    `SELECT id, leak_type, severity, recommended_fix
     FROM leak_instances
     WHERE company_id = $1 ${teamClause}
       AND status IN ('detected', 'delivered')
     ORDER BY severity DESC, detected_at DESC
     LIMIT 1`,
    params,
  );

  const leak = leakResult.rows[0];
  if (!leak) {
    return {
      summary: '✅ No active leaks — nothing to commit',
      detail: 'All detected leaks have been actioned or resolved.',
    };
  }

  const fix = typeof leak.recommended_fix === 'string'
    ? JSON.parse(leak.recommended_fix)
    : leak.recommended_fix;

  await query(
    `INSERT INTO ledger_commits (company_id, commit_type, title, summary, rationale, dri, status, branch_name, evidence_links, tags, team_id, created_by)
     VALUES ($1, 'action', $2, $3, $4, 'workflow-automation', 'proposed', 'main', '[]', ARRAY['workflow-generated'], $5, 'system:workflow-step')`,
    [
      companyId,
      `Workflow: Address ${leak.leak_type.replace(/_/g, ' ')}`,
      fix.summary || `Auto-generated commit for ${leak.leak_type}`,
      `Triggered by Slack Workflow Builder — severity ${leak.severity}/100`,
      teamId,
    ],
  );

  return {
    summary: `📝 Created ledger commit for ${leak.leak_type.replace(/_/g, ' ')}`,
    detail: `Severity: ${leak.severity}/100. ${fix.summary || ''}`,
  };
}

async function executeCheckLeaks(
  companyId: string,
  teamId: string | null,
): Promise<{ summary: string; detail: string }> {
  const teamClause = teamId ? `AND team_id = $2` : '';
  const params: unknown[] = [companyId];
  if (teamId) params.push(teamId);

  const result = await query<{ leak_type: string; cnt: string; max_severity: string }>(
    `SELECT leak_type, COUNT(*)::text AS cnt, MAX(severity)::text AS max_severity
     FROM leak_instances
     WHERE company_id = $1 ${teamClause}
       AND status IN ('detected', 'delivered')
     GROUP BY leak_type
     ORDER BY MAX(severity) DESC`,
    params,
  );

  if (result.rows.length === 0) {
    return {
      summary: '✅ No active leaks detected',
      detail: 'All systems healthy — no process leaks above threshold.',
    };
  }

  const total = result.rows.reduce((sum, r) => sum + Number(r.cnt), 0);
  const topLeak = result.rows[0];
  const lines = result.rows.map(
    (r) => `• ${r.leak_type.replace(/_/g, ' ')}: ${r.cnt} active (max severity ${r.max_severity})`,
  );

  return {
    summary: `⚠️ ${total} active leak${total > 1 ? 's' : ''} — top: ${topLeak.leak_type.replace(/_/g, ' ')} (severity ${topLeak.max_severity})`,
    detail: lines.join('\n'),
  };
}

async function executeRequestPulse(
  companyId: string,
  teamId: string | null,
): Promise<{ summary: string; detail: string }> {
  // Queue an on-demand pulse by inserting event AND triggering BullMQ job
  await query(
    `INSERT INTO events (company_id, source, entity_id, event_type, timestamp, metadata, provider_event_id)
     VALUES ($1, 'system', 'workflow-pulse', 'system.action_executed', NOW(),
       $2, $3)`,
    [
      companyId,
      JSON.stringify({ action: 'request_pulse', team_id: teamId, triggered_by: 'workflow_step' }),
      `workflow-pulse:${Date.now()}`,
    ],
  );

  // Trigger BullMQ morning-pulse queue for immediate processing
  try {
    const pulseQueue = new Queue('morning-pulse', {
      connection: { url: config.REDIS_URL },
    });
    await pulseQueue.add('on-demand-pulse', { companyId, teamId, source: 'workflow_step' });
    await pulseQueue.close();
  } catch (err) {
    logger.error({ err, companyId }, 'Failed to queue on-demand pulse — event still stored');
  }

  return {
    summary: '📊 Team pulse requested',
    detail: teamId
      ? `On-demand pulse queued for team. Check Slack shortly.`
      : `On-demand org-wide pulse queued. Check Slack shortly.`,
  };
}

async function resolveTeamId(companyId: string, slug: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    `SELECT id FROM teams WHERE company_id = $1 AND slug = $2 LIMIT 1`,
    [companyId, slug],
  );
  return result.rows[0]?.id || null;
}

async function getSlackBotToken(companyId: string): Promise<string | null> {
  const integration = await integrationService.getActive(companyId, 'slack');
  return (integration?.token_data as Record<string, string> | null)?.bot_token || null;
}

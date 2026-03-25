import { WebClient } from '@slack/web-api';
import type { ExecutionResult, ProposedAction, RiskLevel } from '@flowguard/shared';
import { remediationService } from './remediation.js';
import { integrationService } from './integration.js';
import { ledgerService } from './ledger.js';
import { logger } from '../logger.js';
import { query } from '../db/client.js';

type RollbackInfo = {
  can_rollback: boolean;
  rollback_data: Record<string, unknown>;
  rollback_type?: string;
  rolled_back_at?: Date;
  rolled_back_by?: string;
};

type ExecutionOutcome = {
  result: ExecutionResult;
  executionDetails: Record<string, unknown>;
  rollbackInfo: RollbackInfo;
};

async function executeSlackAction(action: ProposedAction): Promise<ExecutionOutcome> {
  const integration = await integrationService.getActive(action.company_id, 'slack');
  const token = integration?.token_data?.bot_token as string | undefined;

  if (!token) {
    return {
      result: 'failure',
      executionDetails: {
        reason: 'missing_slack_bot_token',
      },
      rollbackInfo: {
        can_rollback: false,
        rollback_data: {},
      },
    };
  }

  const client = new WebClient(token);
  const messageText =
    (action.preview_diff?.after as string | undefined) ||
    (action.preview_diff?.description as string | undefined) ||
    'FlowGuard approved reminder.';

  try {
    const response = await client.chat.postMessage({
      channel: action.target_id,
      text: messageText,
    });

    return {
      result: 'success',
      executionDetails: {
        provider: 'slack',
        channel: action.target_id,
        ts: response.ts,
      },
      rollbackInfo: {
        can_rollback: true,
        rollback_type: 'delete_message',
        rollback_data: {
          channel: action.target_id,
          ts: response.ts,
        },
      },
    };
  } catch (error) {
    logger.error({ error, actionId: action.id }, 'Slack execution failed');
    return {
      result: 'failure',
      executionDetails: {
        provider: 'slack',
        reason: 'api_error',
      },
      rollbackInfo: {
        can_rollback: false,
        rollback_data: {},
      },
    };
  }
}

async function executeJiraAction(action: ProposedAction): Promise<ExecutionOutcome> {
  const integration = await integrationService.getActive(action.company_id, 'jira');
  const accessToken = integration?.token_data?.access_token as string | undefined;
  const baseUrl = integration?.installation_data?.base_url as string | undefined;

  if (!accessToken || !baseUrl) {
    return {
      result: 'failure',
      executionDetails: {
        provider: 'jira',
        reason: 'missing_jira_credentials_or_base_url',
      },
      rollbackInfo: {
        can_rollback: false,
        rollback_data: {},
      },
    };
  }

  const commentBody =
    (action.preview_diff?.after as string | undefined) ||
    (action.preview_diff?.description as string | undefined) ||
    'FlowGuard suggestion: please review and confirm owner/due date.';

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(action.target_id)}/comment`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          body: commentBody,
        }),
      },
    );

    if (!response.ok) {
      const responseText = await response.text();
      return {
        result: 'failure',
        executionDetails: {
          provider: 'jira',
          status: response.status,
          response: responseText,
        },
        rollbackInfo: {
          can_rollback: false,
          rollback_data: {},
        },
      };
    }

    const payload = await response.json();
    return {
      result: 'success',
      executionDetails: {
        provider: 'jira',
        issue_key: action.target_id,
        comment_id: payload.id,
      },
      rollbackInfo: {
        can_rollback: true,
        rollback_type: 'delete_comment',
        rollback_data: {
          base_url: baseUrl,
          issue_key: action.target_id,
          comment_id: payload.id,
        },
      },
    };
  } catch (error) {
    logger.error({ error, actionId: action.id }, 'Jira execution failed');
    return {
      result: 'failure',
      executionDetails: {
        provider: 'jira',
        reason: 'api_error',
      },
      rollbackInfo: {
        can_rollback: false,
        rollback_data: {},
      },
    };
  }
}

function parseGitHubTarget(targetId: string): { owner: string; repo: string; prNumber: number } | null {
  const match = targetId.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
    prNumber: Number(match[3]),
  };
}

async function executeGitHubAction(action: ProposedAction): Promise<ExecutionOutcome> {
  const integration = await integrationService.getActive(action.company_id, 'github');
  const accessToken =
    (integration?.token_data?.access_token as string | undefined) ||
    (integration?.token_data?.installation_token as string | undefined);

  if (!accessToken) {
    return {
      result: 'failure',
      executionDetails: {
        provider: 'github',
        reason: 'missing_github_token',
      },
      rollbackInfo: {
        can_rollback: false,
        rollback_data: {},
      },
    };
  }

  const parsedTarget = parseGitHubTarget(action.target_id);
  if (!parsedTarget) {
    return {
      result: 'failure',
      executionDetails: {
        provider: 'github',
        reason: 'invalid_target_id_format_expected_owner_repo_pr',
      },
      rollbackInfo: {
        can_rollback: false,
        rollback_data: {},
      },
    };
  }

  const commentBody =
    (action.preview_diff?.after as string | undefined) ||
    (action.preview_diff?.description as string | undefined) ||
    'FlowGuard reviewer ping: this PR appears to be waiting for review.';

  try {
    const response = await fetch(
      `https://api.github.com/repos/${parsedTarget.owner}/${parsedTarget.repo}/issues/${parsedTarget.prNumber}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
        },
        body: JSON.stringify({ body: commentBody }),
      },
    );

    if (!response.ok) {
      const responseText = await response.text();
      return {
        result: 'failure',
        executionDetails: {
          provider: 'github',
          status: response.status,
          response: responseText,
        },
        rollbackInfo: {
          can_rollback: false,
          rollback_data: {},
        },
      };
    }

    const payload = await response.json();
    return {
      result: 'success',
      executionDetails: {
        provider: 'github',
        target: action.target_id,
        comment_id: payload.id,
        comment_url: payload.html_url,
      },
      rollbackInfo: {
        can_rollback: true,
        rollback_type: 'delete_comment',
        rollback_data: {
          owner: parsedTarget.owner,
          repo: parsedTarget.repo,
          comment_id: payload.id,
        },
      },
    };
  } catch (error) {
    logger.error({ error, actionId: action.id }, 'GitHub execution failed');
    return {
      result: 'failure',
      executionDetails: {
        provider: 'github',
        reason: 'api_error',
      },
      rollbackInfo: {
        can_rollback: false,
        rollback_data: {},
      },
    };
  }
}

async function executeNonSlackAction(action: ProposedAction): Promise<ExecutionOutcome> {
  if (action.target_system === 'jira') {
    return executeJiraAction(action);
  }

  if (action.target_system === 'github') {
    return executeGitHubAction(action);
  }

  return {
    result: 'failure',
    executionDetails: {
      provider: action.target_system,
      reason: 'external_execution_requires_customer_credentials',
      action_type: action.action_type,
    },
    rollbackInfo: {
      can_rollback: false,
      rollback_data: {},
    },
  };
}

// ============================================
// Blast-radius enforcement
// ============================================
const ALLOWED_RISK_LEVELS: RiskLevel[] = ['low', 'medium'];

function enforceBlastRadius(action: ProposedAction): { allowed: boolean; reason?: string } {
  // Only allow low and medium risk for MVP
  if (!ALLOWED_RISK_LEVELS.includes(action.risk_level)) {
    return { allowed: false, reason: `Risk level '${action.risk_level}' exceeds MVP blast-radius policy (max: medium)` };
  }

  // Enforce blast_radius scope constraints when set
  if (action.blast_radius) {
    const scope = action.blast_radius;
    // Block actions that target entire workspaces or orgs
    if (scope.startsWith('workspace:') || scope.startsWith('org:')) {
      return { allowed: false, reason: `Blast radius '${scope}' too broad for automated execution` };
    }
  }

  return { allowed: true };
}

// ============================================
// Execute approved action (with blast-radius check)
// ============================================
export async function executeApprovedAction(action: ProposedAction): Promise<void> {
  // Blast-radius enforcement
  const blastCheck = enforceBlastRadius(action);
  if (!blastCheck.allowed) {
    logger.warn({ actionId: action.id, reason: blastCheck.reason }, 'Action blocked by blast-radius policy');
    await remediationService.recordExecution({
      company_id: action.company_id,
      proposed_action_id: action.id,
      executed_at: new Date(),
      result: 'failure',
      execution_details: { reason: 'blast_radius_policy', detail: blastCheck.reason },
      rollback_info: { can_rollback: false, rollback_data: {} },
      audit_log: [{ timestamp: new Date(), action: 'blocked_by_policy', actor: 'flowguard-system', details: { reason: blastCheck.reason } }],
    });
    return;
  }

  const outcome = action.target_system === 'slack'
    ? await executeSlackAction(action)
    : await executeNonSlackAction(action);

  await remediationService.recordExecution({
    company_id: action.company_id,
    proposed_action_id: action.id,
    executed_at: new Date(),
    result: outcome.result,
    execution_details: outcome.executionDetails,
    rollback_info: outcome.rollbackInfo,
    audit_log: [
      {
        timestamp: new Date(),
        action: 'execute_proposed_action',
        actor: 'flowguard-system',
        details: {
          proposed_action_id: action.id,
          target_system: action.target_system,
          target_id: action.target_id,
          result: outcome.result,
        },
      },
    ],
  });
}

// ============================================
// Rollback execution
// ============================================
export async function rollbackExecutedAction(executedActionId: string, userId?: string): Promise<{ success: boolean; reason?: string }> {
  const result = await query<{ id: string; company_id: string; proposed_action_id: string; rollback_info: any; audit_log: any[] }>(
    'SELECT * FROM executed_actions WHERE id = $1',
    [executedActionId],
  );

  const executed = result.rows[0];
  if (!executed) {
    return { success: false, reason: 'Executed action not found' };
  }

  const rollbackInfo = typeof executed.rollback_info === 'string'
    ? JSON.parse(executed.rollback_info)
    : executed.rollback_info;

  if (!rollbackInfo?.can_rollback) {
    return { success: false, reason: 'Action does not support rollback' };
  }

  if (rollbackInfo.rolled_back_at) {
    return { success: false, reason: 'Action was already rolled back' };
  }

  const proposal = await remediationService.getProposalById(executed.proposed_action_id);
  if (!proposal) {
    return { success: false, reason: 'Original proposal not found' };
  }

  try {
    const rollbackType = rollbackInfo.rollback_type;
    const data = rollbackInfo.rollback_data;

    if (rollbackType === 'delete_message' && data.channel && data.ts) {
      // Slack: delete the posted message
      const integration = await integrationService.getActive(executed.company_id, 'slack');
      const token = integration?.token_data?.bot_token as string | undefined;
      if (token) {
        const client = new WebClient(token);
        await client.chat.delete({ channel: data.channel, ts: data.ts });
      }
    } else if (rollbackType === 'delete_comment' && data.base_url && data.issue_key && data.comment_id) {
      // Jira: delete the comment
      const integration = await integrationService.getActive(executed.company_id, 'jira');
      const accessToken = integration?.token_data?.access_token as string | undefined;
      if (accessToken) {
        await fetch(
          `${data.base_url.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(data.issue_key)}/comment/${data.comment_id}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
          },
        );
      }
    } else if (rollbackType === 'delete_comment' && data.owner && data.repo && data.comment_id) {
      // GitHub: delete the PR comment
      const integration = await integrationService.getActive(executed.company_id, 'github');
      const accessToken = integration?.token_data?.access_token as string | undefined;
      if (accessToken) {
        await fetch(
          `https://api.github.com/repos/${data.owner}/${data.repo}/issues/comments/${data.comment_id}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
          },
        );
      }
    } else {
      return { success: false, reason: `Unknown rollback type: ${rollbackType}` };
    }

    // Update rollback_info with rollback timestamp
    rollbackInfo.rolled_back_at = new Date();
    rollbackInfo.rolled_back_by = userId || 'system';

    await query(
      `UPDATE executed_actions SET rollback_info = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(rollbackInfo), executedActionId],
    );

    // Add audit entry
    const auditLog = Array.isArray(executed.audit_log) ? executed.audit_log : [];
    auditLog.push({
      timestamp: new Date(),
      action: 'rollback',
      actor: userId || 'system',
      details: { rollback_type: rollbackType },
    });
    await query(
      `UPDATE executed_actions SET audit_log = $1 WHERE id = $2`,
      [JSON.stringify(auditLog), executedActionId],
    );

    logger.info({ executedActionId, rollbackType, by: userId }, 'Action rolled back successfully');
    return { success: true };
  } catch (error) {
    logger.error({ error, executedActionId }, 'Rollback failed');
    return { success: false, reason: 'Rollback API call failed' };
  }
}

// ============================================
// Ledger writeback trigger
// ============================================
// When a ledger commit is approved/merged, post a link back to originating threads
export async function triggerLedgerWriteback(commitId: string): Promise<void> {
  const commit = await ledgerService.getById(commitId);
  if (!commit || !['approved', 'merged'].includes(commit.status)) {
    return;
  }

  const evidenceLinks = Array.isArray(commit.evidence_links) ? commit.evidence_links : [];
  if (evidenceLinks.length === 0) {
    return;
  }

  const commitUrl = `Ledger Commit: ${commit.title} [${commit.commit_type}/${commit.status}]`;
  const message = `📋 *FlowGuard Ledger*: This thread has a linked ${commit.commit_type} record.\n` +
    `> *${commit.title}*\n` +
    `> Status: \`${commit.status}\` | DRI: ${commit.dri || 'unassigned'}\n` +
    (commit.summary ? `> ${commit.summary}\n` : '');

  for (const link of evidenceLinks) {
    const evidence = link as { provider?: string; entity_id?: string; entity_type?: string };
    if (!evidence.provider || !evidence.entity_id) continue;

    try {
      if (evidence.provider === 'slack') {
        const integration = await integrationService.getActive(commit.company_id, 'slack');
        const token = integration?.token_data?.bot_token as string | undefined;
        if (!token) continue;

        const client = new WebClient(token);
        // entity_id format: "channel_id:thread_ts" or just identifier
        const [channel, threadTs] = evidence.entity_id.includes(':') 
          ? evidence.entity_id.split(':')
          : [evidence.entity_id, undefined];

        await client.chat.postMessage({
          channel,
          text: message,
          thread_ts: threadTs,
          unfurl_links: false,
        });
        logger.info({ commitId, channel, threadTs }, 'Ledger writeback posted to Slack');
      }

      if (evidence.provider === 'jira' && evidence.entity_type === 'issue') {
        const integration = await integrationService.getActive(commit.company_id, 'jira');
        const accessToken = integration?.token_data?.access_token as string | undefined;
        const baseUrl = integration?.installation_data?.base_url as string | undefined;
        if (!accessToken || !baseUrl) continue;

        await fetch(
          `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(evidence.entity_id)}/comment`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              body: `[FlowGuard] ${commit.commit_type} record linked: "${commit.title}" — Status: ${commit.status}`,
            }),
          },
        );
        logger.info({ commitId, issueKey: evidence.entity_id }, 'Ledger writeback posted to Jira');
      }

      if (evidence.provider === 'github' && evidence.entity_type === 'pr') {
        const integration = await integrationService.getActive(commit.company_id, 'github');
        const accessToken = integration?.token_data?.access_token as string | undefined;
        if (!accessToken) continue;

        const parsed = parseGitHubTarget(evidence.entity_id);
        if (!parsed) continue;

        await fetch(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.prNumber}/comments`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              Accept: 'application/vnd.github+json',
            },
            body: JSON.stringify({
              body: `📋 **FlowGuard Ledger**: ${commit.commit_type} record linked\n\n> **${commit.title}**\n> Status: \`${commit.status}\` | DRI: ${commit.dri || 'unassigned'}`,
            }),
          },
        );
        logger.info({ commitId, prTarget: evidence.entity_id }, 'Ledger writeback posted to GitHub');
      }
    } catch (error) {
      logger.error({ error, commitId, evidence }, 'Ledger writeback failed for evidence link');
    }
  }
}

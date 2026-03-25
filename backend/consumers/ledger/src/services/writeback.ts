import { adapterRegistry } from '@flowguard/adapter-sdk';
import { ledgerService } from './ledger.js';
import { logger } from '../logger.js';

/**
 * Ledger Writeback — Post commit links back to originating platforms.
 *
 * Migrated from apps/api/src/services/executor.ts triggerLedgerWriteback().
 * Now uses adapterRegistry instead of direct SDK imports.
 */
export async function triggerLedgerWriteback(commitId: string): Promise<void> {
  const commit = await ledgerService.getById(commitId);
  if (!commit || !['approved', 'merged'].includes(commit.status)) return;

  const evidenceLinks = Array.isArray(commit.evidence_links) ? commit.evidence_links : [];
  if (evidenceLinks.length === 0) return;

  const message = `FlowGuard Ledger: This thread has a linked ${commit.commit_type} record.\n` +
    `> ${commit.title}\n` +
    `> Status: ${commit.status} | DRI: ${commit.dri || 'unassigned'}\n` +
    (commit.summary ? `> ${commit.summary}\n` : '');

  for (const link of evidenceLinks) {
    const evidence = link as { provider?: string; entity_id?: string; entity_type?: string };
    if (!evidence.provider || !evidence.entity_id) continue;

    try {
      if (evidence.provider === 'slack' && adapterRegistry.has('slack')) {
        const [channel, threadTs] = evidence.entity_id.includes(':')
          ? evidence.entity_id.split(':')
          : [evidence.entity_id, undefined];

        await adapterRegistry.executeAction({
          provider: 'slack',
          actionType: 'post_message',
          targetId: channel,
          companyId: commit.company_id,
          payload: { text: message, thread_ts: threadTs, unfurl_links: false },
          riskLevel: 'low',
          metadata: { writeback: true, commit_id: commitId },
        });
        logger.info({ commitId, channel, threadTs }, 'Ledger writeback posted to Slack');
      }

      if (evidence.provider === 'jira' && evidence.entity_type === 'issue' && adapterRegistry.has('jira')) {
        const jiraMessage = `[FlowGuard] ${commit.commit_type} record linked: "${commit.title}" -- Status: ${commit.status}`;
        await adapterRegistry.executeAction({
          provider: 'jira',
          actionType: 'add_comment',
          targetId: evidence.entity_id,
          companyId: commit.company_id,
          payload: { text: jiraMessage },
          riskLevel: 'low',
          metadata: { writeback: true, commit_id: commitId },
        });
        logger.info({ commitId, issueKey: evidence.entity_id }, 'Ledger writeback posted to Jira');
      }

      if (evidence.provider === 'github' && evidence.entity_type === 'pr' && adapterRegistry.has('github')) {
        const ghMessage = `**FlowGuard Ledger**: ${commit.commit_type} record linked\n\n> **${commit.title}**\n> Status: \`${commit.status}\` | DRI: ${commit.dri || 'unassigned'}`;
        await adapterRegistry.executeAction({
          provider: 'github',
          actionType: 'add_pr_comment',
          targetId: evidence.entity_id,
          companyId: commit.company_id,
          payload: { text: ghMessage },
          riskLevel: 'low',
          metadata: { writeback: true, commit_id: commitId },
        });
        logger.info({ commitId, prTarget: evidence.entity_id }, 'Ledger writeback posted to GitHub');
      }
    } catch (error) {
      logger.error({ error, commitId, evidence }, 'Ledger writeback failed for evidence link');
    }
  }
}

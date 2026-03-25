import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Jira Remote Link Write-Back
 *
 * When FlowGuard creates an entity_link targeting a Jira issue,
 * write a remote link on the Jira issue so users see FlowGuard
 * connections inside Jira itself.
 *
 * API: POST /rest/api/3/issue/{issueIdOrKey}/remotelink
 * Auth: Basic (email:api_token)
 */

const FLOWGUARD_APP_ID = 'com.flowguard.entity-link';

interface RemoteLinkInput {
  issueKey: string;               // e.g. PLAT-89
  sourceProvider: string;         // e.g. github, slack
  sourceEntityId: string;         // e.g. acme/api#142
  linkType: string;               // e.g. references, triggered_by
  url?: string;                   // external URL to link to
}

/**
 * Write a remote link on a Jira issue.
 * Fire-and-forget — failures are logged but don't break the flow.
 */
export async function writeJiraRemoteLink(input: RemoteLinkInput): Promise<void> {
  const { JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN } = config;

  if (!JIRA_BASE_URL || !JIRA_USER_EMAIL || !JIRA_API_TOKEN) {
    logger.debug('Jira write-back skipped — no Jira credentials configured');
    return;
  }

  const log = logger.child({ issueKey: input.issueKey, source: input.sourceProvider });

  try {
    const title = buildTitle(input);
    const globalId = `${FLOWGUARD_APP_ID}:${input.sourceProvider}:${input.sourceEntityId}`;
    const linkUrl = input.url || buildFallbackUrl(input);

    const auth = Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

    const response = await fetch(
      `${JIRA_BASE_URL}/rest/api/3/issue/${encodeURIComponent(input.issueKey)}/remotelink`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          globalId,
          relationship: input.linkType.replace(/_/g, ' '),
          object: {
            url: linkUrl,
            title,
            icon: {
              url16x16: 'https://flowguard.dev/favicon.ico',
              title: 'FlowGuard',
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      log.warn({ status: response.status, body: body.substring(0, 200) }, 'Jira remote link write-back failed');
      return;
    }

    log.info({ title }, 'Jira remote link written');
  } catch (err) {
    log.warn({ err }, 'Jira remote link write-back error — non-fatal');
  }
}

function buildTitle(input: RemoteLinkInput): string {
  const providerLabel: Record<string, string> = {
    github: 'GitHub',
    slack: 'Slack',
    jira: 'Jira',
  };

  const provider = providerLabel[input.sourceProvider] || input.sourceProvider;

  if (input.sourceProvider === 'github') {
    // e.g. "FlowGuard: linked to PR #142 in acme/api"
    const parts = input.sourceEntityId.split('#');
    if (parts.length === 2) {
      return `FlowGuard: linked to PR #${parts[1]} in ${parts[0]}`;
    }
  }

  if (input.sourceProvider === 'slack') {
    return `FlowGuard: discussed in ${provider} ${input.sourceEntityId}`;
  }

  return `FlowGuard: ${input.linkType.replace(/_/g, ' ')} — ${provider} ${input.sourceEntityId}`;
}

function buildFallbackUrl(input: RemoteLinkInput): string {
  if (input.sourceProvider === 'github' && input.sourceEntityId.includes('#')) {
    const [repo, pr] = input.sourceEntityId.split('#');
    return `https://github.com/${repo}/pull/${pr}`;
  }
  // Default to FlowGuard dashboard
  return 'https://flowguard.dev/app/entity-graph';
}

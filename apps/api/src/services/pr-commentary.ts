import { query } from '../db/client.js';
import { logger } from '../logger.js';
import { getOctokitForRepo } from './github-client.js';

/**
 * Process-Aware PR Commentary Service
 *
 * Posts contextual observations to GitHub PRs — NOT code review.
 * Triggered by `pull_request.opened` and `pull_request.synchronize`.
 *
 * Signals detected:
 *   1. PR has no linked Jira ticket
 *   2. PR author has many open PRs (context-switching risk)
 *   3. PR has been open too long relative to Jira deadline
 *   4. Requested reviewer is overloaded
 */

interface PRContext {
  companyId: string;
  repoFullName: string;
  prNumber: number;
  prTitle: string;
  prBody: string;
  prAuthor: string;
  prCreatedAt: string;
  headRef: string;
  requestedReviewers: string[];
}

interface Observation {
  emoji: string;
  title: string;
  detail: string;
}

// Jira key regex: PROJECT-123
const JIRA_KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

/**
 * Analyse a PR and post commentary if applicable.
 * Designed to be fire-and-forget from the webhook handler.
 */
export async function analysePRAndComment(ctx: PRContext): Promise<void> {
  const log = logger.child({ repo: ctx.repoFullName, pr: ctx.prNumber });

  try {
    // Feature-flag check: company settings
    const companyResult = await query<{ settings: Record<string, unknown> }>(
      `SELECT settings FROM companies WHERE id = $1`,
      [ctx.companyId],
    );
    const settings = companyResult.rows[0]?.settings || {};
    const enabledFeatures = (settings.ai_enabled_features as string[] | undefined) ?? [];
    // Default-on if not configured, off only if explicitly disabled
    if (enabledFeatures.length > 0 && !enabledFeatures.includes('pr_commentary')) {
      log.debug('PR commentary disabled via company settings');
      return;
    }

    const observations = await gatherObservations(ctx);

    if (observations.length === 0) {
      log.debug('No process observations for PR');
      return;
    }

    const body = formatComment(observations);

    const octokit = await getOctokitForRepo(ctx.companyId, ctx.repoFullName);
    if (!octokit) {
      log.warn('Cannot post PR comment — no GitHub credentials');
      return;
    }

    const [owner, repo] = ctx.repoFullName.split('/');
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: ctx.prNumber,
      body,
    });

    log.info({ observationCount: observations.length }, 'Posted PR commentary');
  } catch (err) {
    log.error({ err }, 'PR commentary failed — non-fatal');
  }
}

async function gatherObservations(ctx: PRContext): Promise<Observation[]> {
  const observations: Observation[] = [];

  // Run all checks in parallel
  const [jiraObs, authorLoadObs, reviewerLoadObs, stalePRObs, largePRObs] = await Promise.all([
    checkJiraLink(ctx),
    checkAuthorLoad(ctx),
    checkReviewerLoad(ctx),
    checkStalePR(ctx),
    checkLargePR(ctx),
  ]);

  if (jiraObs) observations.push(jiraObs);
  if (authorLoadObs) observations.push(authorLoadObs);
  if (reviewerLoadObs) observations.push(reviewerLoadObs);
  if (stalePRObs) observations.push(stalePRObs);
  if (largePRObs) observations.push(largePRObs);

  return observations;
}

// ============================================
// Signal 1: No linked Jira ticket
// ============================================

async function checkJiraLink(ctx: PRContext): Promise<Observation | null> {
  // Check PR title, body, and branch name for Jira keys
  const searchText = `${ctx.prTitle} ${ctx.prBody || ''} ${ctx.headRef || ''}`;
  const keys = searchText.match(JIRA_KEY_RE);

  if (keys && keys.length > 0) {
    return null; // Has Jira reference — no issue
  }

  // Also check entity_links for this PR's entity_id
  const entityId = ctx.repoFullName + '#' + ctx.prNumber;
  const linkResult = await query(
    `SELECT 1 FROM entity_links
     WHERE company_id = $1
       AND ((source_entity_id = $2 AND target_provider = 'jira')
        OR  (target_entity_id = $2 AND source_provider = 'jira'))
     LIMIT 1`,
    [ctx.companyId, entityId],
  );

  if (linkResult.rows.length > 0) {
    return null; // Linked via entity_links
  }

  return {
    emoji: '⚠️',
    title: 'No linked Jira ticket',
    detail:
      "This PR doesn't reference a Jira ticket in its title, body, or branch name. " +
      'If this is planned work, consider linking it so the team has visibility. ' +
      "If it's unplanned, this may indicate shadow work outside the sprint scope.",
  };
}

// ============================================
// Signal 2: Author has too many open PRs
// ============================================

async function checkAuthorLoad(ctx: PRContext): Promise<Observation | null> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM events
     WHERE company_id = $1
       AND source = 'github'
       AND event_type = 'github.pr_opened'
       AND metadata->>'author' = $2
       AND created_at > NOW() - INTERVAL '14 days'
       AND NOT EXISTS (
         SELECT 1 FROM events e2
         WHERE e2.company_id = $1
           AND e2.source = 'github'
           AND e2.event_type IN ('github.pr_merged', 'github.pr_closed')
           AND e2.entity_id = events.entity_id
           AND e2.created_at > events.created_at
       )`,
    [ctx.companyId, ctx.prAuthor],
  );

  const openCount = parseInt(result.rows[0]?.count || '0', 10);

  if (openCount <= 3) return null;

  return {
    emoji: '📊',
    title: `Author has ${openCount} open PRs`,
    detail:
      `@${ctx.prAuthor} currently has ${openCount} other open PRs. ` +
      'Context-switching across many PRs correlates with longer cycle times. ' +
      'Consider finishing existing PRs before starting new work.',
  };
}

// ============================================
// Signal 3: Requested reviewer is overloaded
// ============================================

async function checkReviewerLoad(ctx: PRContext): Promise<Observation | null> {
  if (!ctx.requestedReviewers || ctx.requestedReviewers.length === 0) return null;

  const observations: string[] = [];

  for (const reviewer of ctx.requestedReviewers) {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM events
       WHERE company_id = $1
         AND source = 'github'
         AND event_type = 'github.review_requested'
         AND metadata->>'requested_reviewer' = $2
         AND created_at > NOW() - INTERVAL '7 days'
         AND NOT EXISTS (
           SELECT 1 FROM events e2
           WHERE e2.company_id = $1
             AND e2.source = 'github'
             AND e2.event_type = 'github.review_submitted'
             AND e2.metadata->>'reviewer' = $2
             AND e2.entity_id = events.entity_id
             AND e2.created_at > events.created_at
         )`,
      [ctx.companyId, reviewer],
    );

    const pendingCount = parseInt(result.rows[0]?.count || '0', 10);
    if (pendingCount >= 5) {
      observations.push(
        `@${reviewer} currently has ${pendingCount} pending reviews.`,
      );
    }
  }

  if (observations.length === 0) return null;

  return {
    emoji: '👀',
    title: 'Reviewer has high pending review count',
    detail:
      observations.join(' ') +
      ' Consider requesting review from someone with less load.',
  };
}

// ============================================
// Signal 4: PR has been open too long
// ============================================

async function checkStalePR(ctx: PRContext): Promise<Observation | null> {
  if (!ctx.prCreatedAt) return null;

  const createdAt = new Date(ctx.prCreatedAt);
  const hoursOpen = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

  // Only flag PRs open > 72 hours (3 days)
  if (hoursOpen <= 72) return null;

  const daysOpen = Math.round(hoursOpen / 24);

  return {
    emoji: '⏰',
    title: `PR has been open for ${daysOpen} days`,
    detail:
      `This PR was opened ${daysOpen} days ago. Long-lived PRs increase merge conflict risk ` +
      'and delay feedback loops. Consider breaking it into smaller, shippable increments.',
  };
}

// ============================================
// Signal 5: Large PR (many files changed)
// ============================================

async function checkLargePR(ctx: PRContext): Promise<Observation | null> {
  // Check metadata for file count (GitHub webhook payload includes changed_files)
  // We detect large PRs from the event metadata
  const result = await query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM events
     WHERE company_id = $1
       AND source = 'github'
       AND entity_id = $2
       AND event_type IN ('github.pr_opened', 'github.pr_updated')
     ORDER BY created_at DESC LIMIT 1`,
    [ctx.companyId, `${ctx.repoFullName}#${ctx.prNumber}`],
  );

  const metadata = result.rows[0]?.metadata;
  const changedFiles = (metadata?.changed_files as number) || 0;
  const additions = (metadata?.additions as number) || 0;
  const deletions = (metadata?.deletions as number) || 0;
  const totalLines = additions + deletions;

  if (changedFiles <= 15 && totalLines <= 500) return null;

  const parts: string[] = [];
  if (changedFiles > 15) parts.push(`${changedFiles} files changed`);
  if (totalLines > 500) parts.push(`${totalLines} lines modified`);

  return {
    emoji: '📦',
    title: `Large PR: ${parts.join(', ')}`,
    detail:
      'Large PRs are harder to review thoroughly and more likely to introduce regressions. ' +
      'Teams with smaller PRs typically have shorter cycle times and catch issues earlier.',
  };
}

// ============================================
// Comment formatter
// ============================================

function formatComment(observations: Observation[]): string {
  const lines = [
    '### 🔍 FlowGuard Process Insights',
    '',
    ...observations.map(
      (o) => `${o.emoji} **${o.title}**\n${o.detail}`,
    ),
    '',
    '---',
    '*Powered by [FlowGuard](https://flowguard.dev) — process intelligence, not code review.*',
  ];

  return lines.join('\n');
}

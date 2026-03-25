import type { NormalizedEvent, EntityReference } from '@flowguard/adapter-sdk';

/**
 * GitHub Normalizer — Converts raw GitHub webhook payloads into NormalizedEvent[].
 *
 * Migrated from apps/api/src/routes/webhooks/github.ts normalizeGitHubEvents().
 * Preserves all existing business logic: PR lifecycle, reviews, comments,
 * deployment_status, check_suite, projects_v2_item.
 */

const JIRA_KEY_REGEX = /\b[A-Z][A-Z0-9]+-\d+\b/g;

/**
 * Extract cross-references from PR title, body, and branch name.
 */
function extractCrossReferences(body: Record<string, any>, githubEvent: string): EntityReference[] {
  const refs: EntityReference[] = [];
  const pr = body.pull_request;

  const texts: string[] = [];
  if (pr?.title) texts.push(pr.title);
  if (pr?.body) texts.push(pr.body);
  if (pr?.head?.ref) texts.push(pr.head.ref);

  const fullText = texts.join(' ');

  // Jira issue keys in PR title/body/branch
  const jiraMatches = fullText.matchAll(JIRA_KEY_REGEX);
  for (const match of jiraMatches) {
    refs.push({
      provider: 'jira',
      entityType: 'issue',
      entityId: match[0],
    });
  }

  return refs;
}

export function normalizeGitHubEvents(
  body: Record<string, any>,
  githubEvent: string,
  deliveryId: string,
  companyId: string,
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const repoFullName = body.repository?.full_name || 'unknown/repo';
  const pr = body.pull_request;
  const prNumber = pr?.number || body.number;
  const entityId = prNumber ? `${repoFullName}#${prNumber}` : repoFullName;
  const crossRefs = extractCrossReferences(body, githubEvent);

  const pushEvent = (
    eventType: string,
    suffix: string,
    metadata: Record<string, unknown>,
    extraRefs?: EntityReference[],
  ) => {
    events.push({
      provider: 'github',
      eventType,
      entityId,
      providerEventId: `${deliveryId}:${suffix}`,
      timestamp: new Date((metadata.timestamp as string) || new Date().toISOString()),
      companyId,
      metadata,
      crossReferences: extraRefs || crossRefs,
    });
  };

  // ---- Pull Request Events ----
  if (githubEvent === 'pull_request') {
    const action = body.action as string;
    const baseMetadata = {
      timestamp: pr?.updated_at || pr?.created_at || new Date().toISOString(),
      repo_full_name: repoFullName,
      pr_number: prNumber,
      pr_state: pr?.state,
      merged: Boolean(pr?.merged),
      author: pr?.user?.login,
      requested_reviewer: body.requested_reviewer?.login,
      created_at: pr?.created_at,
      updated_at: pr?.updated_at,
      closed_at: pr?.closed_at,
      merged_at: pr?.merged_at,
      html_url: pr?.html_url,
    };

    if (action === 'opened') {
      pushEvent('github.pr_opened', 'pr_opened', baseMetadata);
    } else if (action === 'closed') {
      if (pr?.merged) {
        pushEvent('github.pr_merged', 'pr_merged', {
          ...baseMetadata,
          timestamp: pr?.merged_at || baseMetadata.timestamp,
        });
      } else {
        pushEvent('github.pr_closed', 'pr_closed', {
          ...baseMetadata,
          timestamp: pr?.closed_at || baseMetadata.timestamp,
        });
      }
    } else if (action === 'review_requested') {
      pushEvent('github.review_requested', 'review_requested', baseMetadata);
    } else if (action === 'edited' || action === 'synchronize' || action === 'reopened') {
      pushEvent('github.pr_updated', 'pr_updated', baseMetadata);
    }
  }

  // ---- Pull Request Review ----
  if (githubEvent === 'pull_request_review' && body.action === 'submitted') {
    pushEvent('github.review_submitted', 'review_submitted', {
      timestamp: body.review?.submitted_at || new Date().toISOString(),
      repo_full_name: repoFullName,
      pr_number: prNumber,
      reviewer: body.review?.user?.login,
      review_state: body.review?.state,
      html_url: body.review?.html_url,
    });
  }

  // ---- Pull Request Review Comment ----
  if (githubEvent === 'pull_request_review_comment' && body.action === 'created') {
    pushEvent('github.comment_added', 'comment_added', {
      timestamp: body.comment?.created_at || new Date().toISOString(),
      repo_full_name: repoFullName,
      pr_number: prNumber,
      commenter: body.comment?.user?.login,
      html_url: body.comment?.html_url,
    });
  }

  // ---- Deployment Status ----
  if (githubEvent === 'deployment_status') {
    const deployment = body.deployment;
    const deploymentStatus = body.deployment_status;
    const deployEntityId = deployment?.sha
      ? `${repoFullName}@${deployment.sha.substring(0, 7)}`
      : repoFullName;

    events.push({
      provider: 'github',
      eventType: 'github.deployment_status',
      entityId: deployEntityId,
      providerEventId: `${deliveryId}:deployment_status`,
      timestamp: new Date(deploymentStatus?.created_at || new Date()),
      companyId,
      metadata: {
        repo_full_name: repoFullName,
        deployment_id: deployment?.id,
        environment: deployment?.environment,
        sha: deployment?.sha,
        ref: deployment?.ref,
        status_state: deploymentStatus?.state,
        status_description: deploymentStatus?.description,
        creator: deployment?.creator?.login,
        target_url: deploymentStatus?.target_url,
      },
      crossReferences: [],
    });
  }

  // ---- Check Suite ----
  if (githubEvent === 'check_suite') {
    const suite = body.check_suite;
    const action = body.action;
    if (action === 'completed' || action === 'requested') {
      const suiteEntityId = suite?.head_sha
        ? `${repoFullName}@${suite.head_sha.substring(0, 7)}`
        : repoFullName;

      events.push({
        provider: 'github',
        eventType: 'github.check_suite',
        entityId: suiteEntityId,
        providerEventId: `${deliveryId}:check_suite:${action}`,
        timestamp: new Date(suite?.updated_at || suite?.created_at || new Date()),
        companyId,
        metadata: {
          repo_full_name: repoFullName,
          check_suite_id: suite?.id,
          head_sha: suite?.head_sha,
          head_branch: suite?.head_branch,
          status: suite?.status,
          conclusion: suite?.conclusion,
          app_name: suite?.app?.name,
          action,
        },
        crossReferences: [],
      });
    }
  }

  // ---- GitHub Projects v2 Item Events ----
  if (githubEvent === 'projects_v2_item') {
    const action = body.action;
    const item = body.projects_v2_item;
    if (item) {
      events.push({
        provider: 'github',
        eventType: `github.projects_v2_item.${action}`,
        entityId: `${repoFullName}:project_item:${item.id || 'unknown'}`,
        providerEventId: `${deliveryId}:projects_v2_item:${action}`,
        timestamp: new Date(item.updated_at || item.created_at || new Date()),
        companyId,
        metadata: {
          repo_full_name: repoFullName,
          project_item_id: item.id,
          project_id: item.project_node_id,
          content_type: item.content_type,
          action,
        },
        crossReferences: [],
      });
    }
  }

  return events;
}

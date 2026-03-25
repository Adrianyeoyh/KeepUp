import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import type { CreateEvent, EventType } from '@flowguard/shared';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import { eventStore } from '../../services/event-store.js';
import { entityResolver } from '../../services/entity-resolver.js';
import { extractAndStoreLinks } from '../../services/entity-link-extractor.js';
import { resolveCompanyByProviderContext } from '../../services/company-context.js';
import { analysePRAndComment } from '../../services/pr-commentary.js';
import { normalizeProjectV2ItemEvent } from '../../services/github-projects-v2.js';

const router = Router();

function normalizeGitHubEvents(
  body: Record<string, any>,
  githubEvent: string,
  deliveryId: string,
  companyId: string,
): CreateEvent[] {
  const events: CreateEvent[] = [];
  const repoFullName = body.repository?.full_name || 'unknown/repo';
  const pr = body.pull_request;
  const prNumber = pr?.number || body.number;
  const entityId = prNumber ? `${repoFullName}#${prNumber}` : repoFullName;

  const pushEvent = (eventType: EventType, suffix: string, metadata: Record<string, unknown>) => {
    events.push({
      company_id: companyId,
      source: 'github',
      entity_id: entityId,
      event_type: eventType,
      timestamp: new Date(metadata.timestamp as string || new Date()),
      metadata,
      provider_event_id: `${deliveryId}:${suffix}`,
    });
  };

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

  if (githubEvent === 'pull_request_review_comment' && body.action === 'created') {
    pushEvent('github.comment_added', 'comment_added', {
      timestamp: body.comment?.created_at || new Date().toISOString(),
      repo_full_name: repoFullName,
      pr_number: prNumber,
      commenter: body.comment?.user?.login,
      html_url: body.comment?.html_url,
    });
  }

  // v2: deployment_status webhook
  if (githubEvent === 'deployment_status') {
    const deployment = body.deployment;
    const deploymentStatus = body.deployment_status;
    const deployEntityId = deployment?.sha
      ? `${repoFullName}@${deployment.sha.substring(0, 7)}`
      : repoFullName;

    events.push({
      company_id: companyId,
      source: 'github',
      entity_id: deployEntityId,
      event_type: 'github.deployment_status',
      timestamp: new Date(deploymentStatus?.created_at || new Date()),
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
      provider_event_id: `${deliveryId}:deployment_status`,
    });
  }

  // v2: check_suite webhook
  if (githubEvent === 'check_suite') {
    const suite = body.check_suite;
    const action = body.action;
    if (action === 'completed' || action === 'requested') {
      const suiteEntityId = suite?.head_sha
        ? `${repoFullName}@${suite.head_sha.substring(0, 7)}`
        : repoFullName;

      events.push({
        company_id: companyId,
        source: 'github',
        entity_id: suiteEntityId,
        event_type: 'github.check_suite',
        timestamp: new Date(suite?.updated_at || suite?.created_at || new Date()),
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
        provider_event_id: `${deliveryId}:check_suite:${action}`,
      });
    }
  }

  // v3: GitHub Projects v2 item events
  if (githubEvent === 'projects_v2_item') {
    const projectEvents = normalizeProjectV2ItemEvent(body, companyId, deliveryId);
    for (const pe of projectEvents) {
      events.push(pe);
    }
  }

  return events;
}

/**
 * GitHub Webhook endpoint
 * Receives PR lifecycle events from GitHub App
 */
router.post('/', async (req: Request, res: Response) => {
  // Verify webhook signature
  const signature = req.headers['x-hub-signature-256'] as string;
  const githubEvent = req.headers['x-github-event'] as string;
  const deliveryId = req.headers['x-github-delivery'] as string;

  if (config.GITHUB_WEBHOOK_SECRET) {
    if (!signature) {
      logger.warn({ deliveryId }, 'GitHub webhook missing signature header');
      res.status(401).json({ error: 'Missing signature' });
      return;
    }

    const body = ((req as any).rawBody as string | undefined) || JSON.stringify(req.body);
    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', config.GITHUB_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    if (signature.length !== expectedSignature.length) {
      logger.warn({ deliveryId }, 'GitHub webhook signature length mismatch');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    if (!crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    )) {
      logger.warn({ deliveryId }, 'GitHub webhook signature mismatch');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  }

  logger.info({
    event: githubEvent,
    action: req.body.action,
    deliveryId,
    repo: req.body.repository?.full_name,
  }, 'GitHub webhook received');

  // Acknowledge immediately
  res.status(200).send();

  void (async () => {
    try {
      const companyId = await resolveCompanyByProviderContext('github', {
        githubRepoFullName: req.body.repository?.full_name,
      });

      const events = normalizeGitHubEvents(
        req.body,
        githubEvent,
        deliveryId || `delivery-${Date.now()}`,
        companyId,
      );

      if (events.length === 0) {
        logger.debug({ githubEvent, action: req.body.action }, 'GitHub webhook ignored (unsupported event)');
        return;
      }

      // v2: Resolve team + project scope from the GitHub repo full name
      const repoFullName = req.body.repository?.full_name;
      const scope = await entityResolver.resolveScope(companyId, 'github', { repoFullName });

      const scopedEvents = events.map((e) => ({
        ...e,
        team_id: scope.team_id,
        project_id: scope.project_id,
      }));

      await eventStore.insertBatch(scopedEvents);

      // v2: Extract cross-tool entity links from PR metadata
      for (const event of scopedEvents) {
        void extractAndStoreLinks(event).catch((err) => {
          logger.warn({ err }, 'Entity link extraction failed — non-fatal');
        });
      }

      // v2: Fire-and-forget PR commentary on new/updated PRs
      const pr = req.body.pull_request;
      if (
        githubEvent === 'pull_request' &&
        (req.body.action === 'opened' || req.body.action === 'synchronize') &&
        pr
      ) {
        void analysePRAndComment({
          companyId,
          repoFullName: req.body.repository?.full_name || '',
          prNumber: pr.number,
          prTitle: pr.title || '',
          prBody: pr.body || '',
          prAuthor: pr.user?.login || '',
          prCreatedAt: pr.created_at || new Date().toISOString(),
          headRef: pr.head?.ref || '',
          requestedReviewers: (pr.requested_reviewers || []).map((r: { login: string }) => r.login),
        }).catch((err) => {
          logger.warn({ err }, 'PR commentary failed — non-fatal');
        });
      }
    } catch (error) {
      logger.error({ error }, 'Failed processing GitHub webhook');
    }
  })();
});

export default router;

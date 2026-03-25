import { Router, Request, Response } from 'express';
import type { CreateEvent, EventType } from '@flowguard/shared';
import { logger } from '../../logger.js';
import { eventStore } from '../../services/event-store.js';
import { entityResolver } from '../../services/entity-resolver.js';
import { extractAndStoreLinks, extractAndStoreJiraIssueLinks } from '../../services/entity-link-extractor.js';
import { resolveCompanyByProviderContext } from '../../services/company-context.js';
import { syncJiraComponentsFromWebhook, resolveProjectByComponent } from '../../services/jira-component-sync.js';
import { verifyJiraSignature } from '../../middleware/auth.js';

const router = Router();

// Apply Jira webhook signature verification to all routes in this router
router.use(verifyJiraSignature);

const REOPEN_STATUSES = new Set(['open', 'reopened', 'to do', 'todo']);
const DONE_STATUSES = new Set(['done', 'closed', 'resolved']);

function normalizeJiraEvents(body: Record<string, any>, companyId: string): CreateEvent[] {
  const webhookEvent = body.webhookEvent as string | undefined;
  const issue = body.issue || {};
  const issueId = issue.id || issue.key || 'unknown-issue';
  const issueKey = issue.key || issue.id || 'UNKNOWN-ISSUE';
  const projectKey = issue.fields?.project?.key;
  const updatedAt = issue.fields?.updated || body.timestamp || new Date().toISOString();
  const createdAt = issue.fields?.created || updatedAt;
  const changelogItems = Array.isArray(body.changelog?.items) ? body.changelog.items : [];

  const events: CreateEvent[] = [];

  if (webhookEvent === 'jira:issue_created') {
    events.push({
      company_id: companyId,
      source: 'jira',
      entity_id: issueKey,
      event_type: 'jira.issue_created',
      timestamp: new Date(createdAt),
      metadata: {
        issue_id: issueId,
        issue_key: issueKey,
        project_key: projectKey,
        status: issue.fields?.status?.name,
        issue_type: issue.fields?.issuetype?.name,
      },
      provider_event_id: `${issueId}:created:${createdAt}`,
    });
  }

  if (webhookEvent === 'jira:issue_updated') {
    events.push({
      company_id: companyId,
      source: 'jira',
      entity_id: issueKey,
      event_type: 'jira.issue_updated',
      timestamp: new Date(updatedAt),
      metadata: {
        issue_id: issueId,
        issue_key: issueKey,
        project_key: projectKey,
        status: issue.fields?.status?.name,
        issue_type: issue.fields?.issuetype?.name,
        assignee: issue.fields?.assignee?.accountId || null,
      },
      provider_event_id: `${issueId}:updated:${updatedAt}`,
    });

    const statusChange = changelogItems.find((item: Record<string, any>) => item.field === 'status');
    if (statusChange) {
      const toStatus = String(statusChange.toString || '').toLowerCase();

      events.push({
        company_id: companyId,
        source: 'jira',
        entity_id: issueKey,
        event_type: 'jira.issue_transitioned',
        timestamp: new Date(updatedAt),
        metadata: {
          issue_id: issueId,
          issue_key: issueKey,
          project_key: projectKey,
          from_status: statusChange.fromString,
          to_status: statusChange.toString,
          is_done_transition: DONE_STATUSES.has(toStatus),
        },
        provider_event_id: `${issueId}:transition:${updatedAt}`,
      });

      if (REOPEN_STATUSES.has(toStatus)) {
        events.push({
          company_id: companyId,
          source: 'jira',
          entity_id: issueKey,
          event_type: 'jira.issue_reopened',
          timestamp: new Date(updatedAt),
          metadata: {
            issue_id: issueId,
            issue_key: issueKey,
            project_key: projectKey,
            from_status: statusChange.fromString,
            to_status: statusChange.toString,
          },
          provider_event_id: `${issueId}:reopened:${updatedAt}`,
        });
      }
    }
  }

  if (webhookEvent === 'comment_created') {
    events.push({
      company_id: companyId,
      source: 'jira',
      entity_id: issueKey,
      event_type: 'jira.comment_added',
      timestamp: new Date(updatedAt),
      metadata: {
        issue_id: issueId,
        issue_key: issueKey,
        project_key: projectKey,
        author: body.comment?.author?.accountId || null,
      },
      provider_event_id: `${issueId}:comment:${body.comment?.id || updatedAt}`,
    });
  }

  return events;
}

/**
 * Jira Webhook endpoint
 * Receives issue lifecycle events from Jira
 */
router.post('/', async (req: Request, res: Response) => {
  const body = req.body;
  const webhookEvent = body.webhookEvent;

  logger.info({
    webhookEvent,
    issue_key: body.issue?.key,
  }, 'Jira webhook received');

  // Acknowledge immediately
  res.status(200).send();

  void (async () => {
    try {
      const companyId = await resolveCompanyByProviderContext('jira', {
        jiraCloudId: body.cloudId,
        jiraProjectKey: body.issue?.fields?.project?.key,
      });

      const events = normalizeJiraEvents(body, companyId);
      if (events.length === 0) {
        logger.debug({ webhookEvent }, 'Jira webhook ignored (unsupported event)');
        return;
      }

      // v2: Resolve team + project scope from the Jira project key
      const projectKey = body.issue?.fields?.project?.key;
      let scope = await entityResolver.resolveScope(companyId, 'jira', { projectKey });

      // v3: Refine scope using Jira components (sub-project mapping)
      const components = Array.isArray(body.issue?.fields?.components) ? body.issue.fields.components : [];
      if (components.length > 0 && projectKey) {
        const componentScope = await resolveProjectByComponent(companyId, projectKey, components);
        if (componentScope) {
          scope = { team_id: componentScope.team_id ?? scope.team_id, project_id: componentScope.project_id };
        }
      }

      const scopedEvents = events.map((e) => ({
        ...e,
        team_id: scope.team_id,
        project_id: scope.project_id,
      }));

      await eventStore.insertBatch(scopedEvents);

      // v2: Extract cross-tool entity links from event metadata
      for (const event of scopedEvents) {
        void extractAndStoreLinks(event).catch((err) => {
          logger.warn({ err }, 'Entity link extraction failed — non-fatal');
        });
      }

      // v2: Extract Jira native issue links (blocks, duplicates, parent_of)
      const issueLinks = body.issue?.fields?.issuelinks;
      if (Array.isArray(issueLinks) && issueLinks.length > 0) {
        void extractAndStoreJiraIssueLinks(companyId, body.issue.key, issueLinks).catch((err) => {
          logger.warn({ err }, 'Jira issue link extraction failed — non-fatal');
        });
      }

      // v3: Sync Jira components → sub-project mapping
      void syncJiraComponentsFromWebhook(companyId, body.issue || {}).catch((err) => {
        logger.warn({ err }, 'Jira component sync failed — non-fatal');
      });
    } catch (error) {
      logger.error({ error }, 'Failed processing Jira webhook');
    }
  })();
});

export default router;

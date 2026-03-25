import type { Integration } from '@flowguard/adapter-sdk';
import { logger } from './logger.js';

/**
 * JiraClient — Outbound API wrapper for Jira REST API v3.
 *
 * Wraps Jira REST API. The executor consumer calls these methods
 * through the adapter interface (adapter.executeAction()), never directly.
 *
 * Migrated from apps/api/src/services/executor.ts (executeJiraAction).
 */
export class JiraClient {
  private extractCredentials(integration: Integration): {
    accessToken: string | null;
    baseUrl: string | null;
  } {
    return {
      accessToken: (integration.tokenData?.access_token as string) || null,
      baseUrl: (integration.installationData?.base_url as string) || null,
    };
  }

  /**
   * Add a comment to a Jira issue.
   * Supports both plain text and ADF (Atlassian Document Format).
   */
  async addComment(
    integration: Integration,
    issueKey: string,
    body: string,
    options?: { useAdf?: boolean },
  ): Promise<{ id: string; self: string }> {
    const { accessToken, baseUrl } = this.extractCredentials(integration);
    if (!accessToken || !baseUrl) {
      throw new Error('Missing Jira credentials or base URL');
    }

    const commentBody = options?.useAdf
      ? {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: body.slice(0, 3000) }],
            },
          ],
        }
      : body;

    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ body: commentBody }),
      },
    );

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`Jira addComment failed (${response.status}): ${responseText.slice(0, 200)}`);
    }

    const payload = await response.json() as { id: string; self: string };
    return { id: payload.id, self: payload.self };
  }

  /**
   * Get an issue by key.
   */
  async getIssue(
    integration: Integration,
    issueKey: string,
  ): Promise<Record<string, any>> {
    const { accessToken, baseUrl } = this.extractCredentials(integration);
    if (!accessToken || !baseUrl) throw new Error('Missing Jira credentials');

    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) throw new Error(`Jira getIssue failed (${response.status})`);
    return response.json() as Promise<Record<string, any>>;
  }

  /**
   * Transition an issue to a new status.
   */
  async transitionIssue(
    integration: Integration,
    issueKey: string,
    transitionId: string,
  ): Promise<void> {
    const { accessToken, baseUrl } = this.extractCredentials(integration);
    if (!accessToken || !baseUrl) throw new Error('Missing Jira credentials');

    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ transition: { id: transitionId } }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Jira transitionIssue failed (${response.status}): ${text.slice(0, 200)}`);
    }
  }

  /**
   * Delete a comment (used for rollback).
   */
  async deleteComment(
    integration: Integration,
    issueKey: string,
    commentId: string,
  ): Promise<void> {
    const { accessToken, baseUrl } = this.extractCredentials(integration);
    if (!accessToken || !baseUrl) throw new Error('Missing Jira credentials');

    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment/${commentId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) throw new Error(`Jira deleteComment failed (${response.status})`);
  }

  /**
   * Health check — test API connectivity.
   */
  async testConnection(integration: Integration): Promise<{ ok: boolean; latencyMs: number }> {
    const { accessToken, baseUrl } = this.extractCredentials(integration);
    if (!accessToken || !baseUrl) return { ok: false, latencyMs: 0 };

    const start = Date.now();
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/api/3/myself`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });
      return { ok: response.ok, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }
}

export const jiraClient = new JiraClient();

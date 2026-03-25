import type { Integration } from '@flowguard/adapter-sdk';
import { logger } from './logger.js';

/**
 * GitHubClient — Outbound API wrapper for GitHub REST API.
 *
 * Wraps GitHub REST API (no Octokit dependency — uses fetch directly).
 * The executor consumer calls these methods through the adapter interface.
 *
 * Migrated from apps/api/src/services/executor.ts (executeGitHubAction).
 */
export class GitHubClient {
  private extractToken(integration: Integration): string | null {
    return (
      (integration.tokenData?.access_token as string) ||
      (integration.tokenData?.installation_token as string) ||
      null
    );
  }

  /**
   * Add a comment to a PR or issue.
   */
  async addPRComment(
    integration: Integration,
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<{ id: number; htmlUrl: string }> {
    const token = this.extractToken(integration);
    if (!token) throw new Error('Missing GitHub token');

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
        },
        body: JSON.stringify({ body }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub addPRComment failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const payload = await response.json() as { id: number; html_url: string };
    return { id: payload.id, htmlUrl: payload.html_url };
  }

  /**
   * Request reviewers for a PR.
   */
  async requestReview(
    integration: Integration,
    owner: string,
    repo: string,
    prNumber: number,
    reviewers: string[],
  ): Promise<void> {
    const token = this.extractToken(integration);
    if (!token) throw new Error('Missing GitHub token');

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
        },
        body: JSON.stringify({ reviewers }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub requestReview failed (${response.status}): ${text.slice(0, 200)}`);
    }
  }

  /**
   * Get PR details.
   */
  async getPR(
    integration: Integration,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<Record<string, any>> {
    const token = this.extractToken(integration);
    if (!token) throw new Error('Missing GitHub token');

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      },
    );

    if (!response.ok) throw new Error(`GitHub getPR failed (${response.status})`);
    return response.json() as Promise<Record<string, any>>;
  }

  /**
   * Delete a comment (used for rollback).
   */
  async deleteComment(
    integration: Integration,
    owner: string,
    repo: string,
    commentId: number,
  ): Promise<void> {
    const token = this.extractToken(integration);
    if (!token) throw new Error('Missing GitHub token');

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      },
    );

    if (!response.ok) throw new Error(`GitHub deleteComment failed (${response.status})`);
  }

  /**
   * Health check — test API connectivity.
   */
  async testConnection(integration: Integration): Promise<{ ok: boolean; latencyMs: number }> {
    const token = this.extractToken(integration);
    if (!token) return { ok: false, latencyMs: 0 };

    const start = Date.now();
    try {
      const response = await fetch('https://api.github.com/rate_limit', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      });
      return { ok: response.ok, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }
}

export const githubClient = new GitHubClient();

/**
 * Parse a GitHub target ID in the format "owner/repo#prNumber".
 */
export function parseGitHubTarget(targetId: string): {
  owner: string;
  repo: string;
  prNumber: number;
} | null {
  const match = targetId.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    prNumber: Number(match[3]),
  };
}

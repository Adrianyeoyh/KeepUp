import { WebClient } from '@slack/web-api';
import type { Integration } from '@flowguard/adapter-sdk';
import { logger } from './logger.js';

/**
 * SlackClient — Outbound API wrapper for Slack.
 *
 * Wraps @slack/web-api WebClient. The executor consumer calls these methods
 * through the adapter interface (adapter.executeAction()), never directly.
 *
 * Migrated from apps/api/src/services/executor.ts (executeSlackAction, rollback).
 */
export class SlackClient {
  private clientCache = new Map<string, WebClient>();

  private getWebClient(token: string): WebClient {
    if (!this.clientCache.has(token)) {
      this.clientCache.set(token, new WebClient(token));
    }
    return this.clientCache.get(token)!;
  }

  private extractToken(integration: Integration): string | null {
    return (integration.tokenData?.bot_token as string) || null;
  }

  /**
   * Post a message to a Slack channel or thread.
   */
  async postMessage(
    integration: Integration,
    channel: string,
    text: string,
    options?: { threadTs?: string; unfurlLinks?: boolean },
  ): Promise<{ ts?: string; channel?: string }> {
    const token = this.extractToken(integration);
    if (!token) throw new Error('Missing Slack bot token');

    const client = this.getWebClient(token);
    const response = await client.chat.postMessage({
      channel,
      text,
      thread_ts: options?.threadTs,
      unfurl_links: options?.unfurlLinks ?? false,
    });

    if (!response.ok) {
      throw new Error(`Slack postMessage failed: ${response.error || 'unknown_error'}`);
    }

    return { ts: response.ts, channel: response.channel };
  }

  /**
   * Open a DM with a user and send a message.
   */
  async openDMAndSend(
    integration: Integration,
    userId: string,
    text: string,
  ): Promise<{ ts?: string; channel?: string }> {
    const token = this.extractToken(integration);
    if (!token) throw new Error('Missing Slack bot token');

    const client = this.getWebClient(token);
    const openResult = await client.conversations.open({ users: userId });
    const dmChannel = openResult.channel?.id;
    if (!dmChannel) throw new Error('Failed to open DM channel');

    const response = await client.chat.postMessage({
      channel: dmChannel,
      text,
    });

    return { ts: response.ts, channel: dmChannel };
  }

  /**
   * Delete a message (used for rollback).
   */
  async deleteMessage(
    integration: Integration,
    channel: string,
    ts: string,
  ): Promise<void> {
    const token = this.extractToken(integration);
    if (!token) throw new Error('Missing Slack bot token');

    const client = this.getWebClient(token);
    await client.chat.delete({ channel, ts });
  }

  /**
   * OAuth v2 access token exchange.
   */
  async exchangeOAuthCode(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri?: string,
  ): Promise<Record<string, any>> {
    const client = new WebClient();
    const response = await client.oauth.v2.access({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    if (!response.ok) {
      throw new Error(response.error || 'OAuth exchange failed');
    }

    return response as Record<string, any>;
  }

  /**
   * Health check — test API connectivity.
   */
  async testConnection(integration: Integration): Promise<{ ok: boolean; latencyMs: number }> {
    const token = this.extractToken(integration);
    if (!token) return { ok: false, latencyMs: 0 };

    const start = Date.now();
    try {
      const client = this.getWebClient(token);
      const result = await client.auth.test();
      return { ok: Boolean(result.ok), latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }
}

export const slackClient = new SlackClient();

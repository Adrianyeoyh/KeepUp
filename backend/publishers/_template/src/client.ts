import { BaseClient, type ClientConfig } from '@flowguard/adapter-sdk';
import type { Integration } from '@flowguard/adapter-sdk';
import { logger } from './logger.js';

// ============================================
// Outbound API Client Template
// ============================================
//
// This file extends BaseClient to make outbound API calls to your provider.
// BaseClient provides: retry with exponential backoff, timeout handling,
// and error normalization (see base-client.ts).
//
// The executor consumer calls these methods indirectly through the adapter
// interface — it never imports this client directly.
//
// TODO: Replace 'TemplateClient' with your provider name, e.g., 'LinearClient'
// TODO: Set the correct baseUrl for your provider's API
// TODO: Implement methods for each outbound action your adapter supports
//
// See backend/publishers/slack/src/client.ts for a complete example.

export class TemplateClient extends BaseClient {
  constructor(config?: ClientConfig) {
    super({
      // TODO: Set your provider's API base URL
      baseUrl: 'https://api.example.com',
      timeoutMs: 10_000,
      maxRetries: 3,
      logger,
      ...config,
    });
  }

  // ---- Auth Header ----
  //
  // TODO: Override getDefaultHeaders() if your API uses a static token.
  //       For per-request auth (like per-company tokens), pass headers
  //       in individual method calls instead.
  //
  // protected getDefaultHeaders(): Record<string, string> {
  //   return {
  //     Authorization: `Bearer ${this.apiKey}`,
  //   };
  // }

  // ---- Helper: Extract token from integration ----
  //
  // TODO: Implement token extraction from the Integration's tokenData.
  //       The shape of tokenData depends on how OAuth stores credentials.

  private extractToken(integration: Integration): string | null {
    // TODO: Adjust the key to match your provider's token storage
    return (integration.tokenData?.access_token as string) || null;
  }

  private getAuthHeaders(integration: Integration): Record<string, string> {
    const token = this.extractToken(integration);
    if (!token) throw new Error('Missing API token for integration');
    return { Authorization: `Bearer ${token}` };
  }

  // ============================================
  // Outbound Methods
  // ============================================
  //
  // TODO: Add methods for each action your adapter needs to perform.
  //       Each method should accept an Integration (for auth) plus
  //       action-specific parameters.
  //
  // Pattern: use this.request<ResponseType>(method, path, options)
  //          which is provided by BaseClient with retry + timeout.

  // Example: Post a comment
  //
  // async addComment(
  //   integration: Integration,
  //   entityId: string,
  //   body: string,
  // ): Promise<{ id: string }> {
  //   const response = await this.request<{ id: string }>(
  //     'POST',
  //     `/v1/entities/${entityId}/comments`,
  //     {
  //       body: { body },
  //       headers: this.getAuthHeaders(integration),
  //     },
  //   );
  //   return response.data;
  // }

  // Example: Get an entity by ID
  //
  // async getEntity(
  //   integration: Integration,
  //   entityId: string,
  // ): Promise<{ id: string; title: string; url: string; status: string }> {
  //   const response = await this.request<{
  //     id: string; title: string; url: string; status: string;
  //   }>(
  //     'GET',
  //     `/v1/entities/${entityId}`,
  //     { headers: this.getAuthHeaders(integration) },
  //   );
  //   return response.data;
  // }

  // Example: Delete a comment (for rollback)
  //
  // async deleteComment(
  //   integration: Integration,
  //   commentId: string,
  // ): Promise<void> {
  //   await this.request(
  //     'DELETE',
  //     `/v1/comments/${commentId}`,
  //     { headers: this.getAuthHeaders(integration) },
  //   );
  // }

  // ---- Health Check ----

  /**
   * Lightweight connectivity check.
   * TODO: Call a simple endpoint (e.g., /me, /ping, /status) to verify
   *       the integration's credentials are still valid.
   */
  async testConnection(
    integration: Integration,
  ): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      // TODO: Replace with a real lightweight endpoint
      // await this.request('GET', '/v1/me', {
      //   headers: this.getAuthHeaders(integration),
      // });
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }
}

// Singleton instance — used by the adapter
export const templateClient = new TemplateClient();

import { createHmac, timingSafeEqual } from 'node:crypto';
import pino from 'pino';
import type { WebhookRequest } from './types.js';

/**
 * BaseWebhookHandler — Abstract base for webhook signature verification.
 *
 * Each publisher extends this and implements:
 *   - getSignatureHeader(): which header contains the signature
 *   - computeExpectedSignature(): how to compute the expected signature from rawBody + secret
 *   - parseEvents(): platform-specific payload parsing
 */
export abstract class BaseWebhookHandler {
  protected logger: pino.Logger;

  constructor(options?: { logger?: pino.Logger }) {
    this.logger = options?.logger ?? pino({ name: 'webhook-handler' });
  }

  /**
   * Verify the webhook signature. Returns true if valid.
   */
  async verify(req: WebhookRequest, secret: string): Promise<boolean> {
    const signatureHeader = this.getSignatureHeader();
    const received = req.headers[signatureHeader.toLowerCase()];

    if (!received || typeof received !== 'string') {
      this.logger.warn({ header: signatureHeader }, 'Missing signature header');
      return false;
    }

    try {
      const expected = this.computeExpectedSignature(req.rawBody, secret);
      return this.safeCompare(received, expected);
    } catch (err) {
      this.logger.error({ err }, 'Signature verification error');
      return false;
    }
  }

  /**
   * Timing-safe string comparison to prevent timing attacks.
   */
  protected safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  /**
   * Helper: compute HMAC-SHA256 (used by Slack and GitHub).
   */
  protected hmacSha256(data: string, secret: string, prefix = ''): string {
    const hmac = createHmac('sha256', secret).update(data).digest('hex');
    return prefix ? `${prefix}${hmac}` : hmac;
  }

  // ---- Abstract methods for subclasses ----

  /** Name of the HTTP header containing the webhook signature */
  protected abstract getSignatureHeader(): string;

  /** Compute the expected signature from the raw body and signing secret */
  protected abstract computeExpectedSignature(rawBody: string, secret: string): string;
}

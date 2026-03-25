import pino from 'pino';

/**
 * BaseClient — Abstract base for outbound HTTP API clients.
 *
 * Provides retry with exponential backoff, timeout, and error normalization.
 * Each publisher extends this for platform-specific API calls.
 */

export interface ClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  logger?: pino.Logger;
}

export interface ClientResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  headers: Record<string, string>;
}

export class ClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = 'ClientError';
  }
}

export abstract class BaseClient {
  protected baseUrl: string;
  protected timeoutMs: number;
  protected maxRetries: number;
  protected baseDelayMs: number;
  protected maxDelayMs: number;
  protected logger: pino.Logger;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? '';
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.baseDelayMs = config.baseDelayMs ?? 500;
    this.maxDelayMs = config.maxDelayMs ?? 10_000;
    this.logger = config.logger ?? pino({ name: 'client' });
  }

  /**
   * Make an HTTP request with retry, timeout, and error normalization.
   */
  protected async request<T = unknown>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      headers?: Record<string, string>;
      query?: Record<string, string>;
      timeoutMs?: number;
    },
  ): Promise<ClientResponse<T>> {
    const url = this.buildUrl(path, options?.query);
    const timeout = options?.timeoutMs ?? this.timeoutMs;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...this.getDefaultHeaders(),
          ...options?.headers,
        };

        const fetchOptions: RequestInit = {
          method,
          headers,
          signal: controller.signal,
        };

        if (options?.body && method !== 'GET') {
          fetchOptions.body = JSON.stringify(options.body);
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timer);

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        if (!response.ok) {
          const responseBody = await response.text().catch(() => '');
          const error = new ClientError(
            `${method} ${path} returned ${response.status}`,
            response.status,
            responseBody,
          );

          // Don't retry 4xx (client errors) except 429 (rate limit)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            throw error;
          }

          lastError = error;
        } else {
          const data = await response.json().catch(() => ({})) as T;
          return { ok: true, status: response.status, data, headers: responseHeaders };
        }
      } catch (err) {
        if (err instanceof ClientError && err.status >= 400 && err.status < 500 && err.status !== 429) {
          throw err; // Don't retry client errors
        }
        lastError = err instanceof Error ? err : new Error(String(err));
      }

      // Retry with exponential backoff
      if (attempt < this.maxRetries) {
        const delay = Math.min(
          this.baseDelayMs * Math.pow(2, attempt),
          this.maxDelayMs,
        );
        this.logger.warn({
          attempt: attempt + 1,
          maxRetries: this.maxRetries,
          delayMs: delay,
          method,
          path,
          error: lastError?.message,
        }, 'Retrying request');
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError ?? new Error(`Request failed after ${this.maxRetries} retries`);
  }

  /**
   * Override in subclasses to add default auth headers.
   */
  protected getDefaultHeaders(): Record<string, string> {
    return {};
  }

  private buildUrl(path: string, query?: Record<string, string>): string {
    const base = this.baseUrl.replace(/\/$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${base}${cleanPath}`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }
}

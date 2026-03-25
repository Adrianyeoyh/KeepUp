import pino from 'pino';
import type {
  AdapterCapability,
  ExtendedProviderName,
  WebhookRequest,
  NormalizedEvent,
  OutboundAction,
  ActionResult,
  RollbackResult,
  EntityReference,
  ResolvedEntity,
  HealthStatus,
  Integration,
} from './types.js';

// ============================================
// Circuit Breaker State
// ============================================
type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerConfig {
  failureThreshold: number;   // Failures before opening
  resetTimeoutMs: number;     // Time before half-open
  halfOpenMaxAttempts: number; // Attempts in half-open before closing
}

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxAttempts: 2,
};

// ============================================
// Retry Configuration
// ============================================
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
};

// ============================================
// PublisherAdapter Interface
// ============================================
export interface PublisherAdapter {
  readonly provider: ExtendedProviderName;
  readonly capabilities: AdapterCapability[];

  handleWebhook(req: WebhookRequest): Promise<NormalizedEvent[]>;
  verifySignature(req: WebhookRequest): Promise<boolean>;
  executeAction(action: OutboundAction): Promise<ActionResult>;
  rollbackAction(action: OutboundAction, executionId: string): Promise<RollbackResult>;
  resolveEntity(ref: EntityReference): Promise<ResolvedEntity | null>;
  healthCheck(integration: Integration): Promise<HealthStatus>;
}

// ============================================
// BaseAdapter — Abstract base with retry, circuit breaker, logging
// ============================================
export abstract class BaseAdapter implements PublisherAdapter {
  abstract readonly provider: ExtendedProviderName;
  abstract readonly capabilities: AdapterCapability[];

  protected logger: pino.Logger;
  protected retryConfig: RetryConfig;

  // Circuit breaker state
  private circuitState: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;
  private circuitConfig: CircuitBreakerConfig;

  constructor(options?: {
    logger?: pino.Logger;
    retryConfig?: Partial<RetryConfig>;
    circuitConfig?: Partial<CircuitBreakerConfig>;
  }) {
    this.logger = options?.logger ?? pino({ name: 'adapter' });
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...options?.retryConfig };
    this.circuitConfig = { ...DEFAULT_CIRCUIT_CONFIG, ...options?.circuitConfig };
  }

  // ---- Abstract methods subclasses must implement ----

  abstract handleWebhook(req: WebhookRequest): Promise<NormalizedEvent[]>;
  abstract verifySignature(req: WebhookRequest): Promise<boolean>;

  protected abstract doExecuteAction(action: OutboundAction): Promise<ActionResult>;
  protected abstract doRollbackAction(action: OutboundAction, executionId: string): Promise<RollbackResult>;

  resolveEntity(_ref: EntityReference): Promise<ResolvedEntity | null> {
    return Promise.resolve(null);
  }

  abstract healthCheck(integration: Integration): Promise<HealthStatus>;

  // ---- Public methods with retry + circuit breaker ----

  async executeAction(action: OutboundAction): Promise<ActionResult> {
    this.assertCircuitNotOpen(action.actionType);
    return this.withRetry(
      () => this.doExecuteAction(action),
      `executeAction:${action.actionType}`,
    );
  }

  async rollbackAction(action: OutboundAction, executionId: string): Promise<RollbackResult> {
    this.assertCircuitNotOpen('rollback');
    return this.withRetry(
      () => this.doRollbackAction(action, executionId),
      `rollbackAction:${executionId}`,
    );
  }

  // ---- Retry with exponential backoff ----

  protected async withRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const result = await fn();
        this.onSuccess();
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.onFailure(lastError, context);

        if (attempt < this.retryConfig.maxRetries) {
          const delay = Math.min(
            this.retryConfig.baseDelayMs * Math.pow(2, attempt),
            this.retryConfig.maxDelayMs,
          );
          this.logger.warn({
            attempt: attempt + 1,
            maxRetries: this.retryConfig.maxRetries,
            delayMs: delay,
            context,
            error: lastError.message,
          }, 'Retrying after failure');
          await this.sleep(delay);
        }
      }
    }

    throw lastError!;
  }

  // ---- Circuit Breaker ----

  private assertCircuitNotOpen(context: string): void {
    if (this.circuitState === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.circuitConfig.resetTimeoutMs) {
        this.circuitState = 'half-open';
        this.halfOpenAttempts = 0;
        this.logger.info({ provider: this.provider, context }, 'Circuit breaker half-open');
      } else {
        throw new Error(
          `Circuit breaker OPEN for ${this.provider} — ${context}. Retry in ${Math.ceil((this.circuitConfig.resetTimeoutMs - elapsed) / 1000)}s`,
        );
      }
    }
  }

  private onSuccess(): void {
    if (this.circuitState === 'half-open') {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.circuitConfig.halfOpenMaxAttempts) {
        this.circuitState = 'closed';
        this.failureCount = 0;
        this.logger.info({ provider: this.provider }, 'Circuit breaker closed');
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(error: Error, context: string): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.circuitState === 'half-open') {
      this.circuitState = 'open';
      this.logger.error({ provider: this.provider, context, error: error.message }, 'Circuit breaker re-opened');
    } else if (this.failureCount >= this.circuitConfig.failureThreshold) {
      this.circuitState = 'open';
      this.logger.error({
        provider: this.provider,
        failureCount: this.failureCount,
        context,
      }, 'Circuit breaker opened');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

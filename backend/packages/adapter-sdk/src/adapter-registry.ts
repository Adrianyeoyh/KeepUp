import type { PublisherAdapter } from './base-adapter.js';
import type { ExtendedProviderName, OutboundAction, ActionResult, RollbackResult } from './types.js';

/**
 * AdapterRegistry — Central registry for all publisher adapters.
 *
 * Consumers use this to execute outbound actions without knowing
 * which provider SDK to import. The executor calls:
 *   adapterRegistry.get('slack').executeAction(action)
 *
 * This is the key abstraction that makes adding Linear/Zendesk/etc.
 * a zero-change operation for consumers.
 */
export class AdapterRegistry {
  private adapters = new Map<string, PublisherAdapter>();

  register(adapter: PublisherAdapter): void {
    if (this.adapters.has(adapter.provider)) {
      throw new Error(`Adapter already registered for provider: ${adapter.provider}`);
    }
    this.adapters.set(adapter.provider, adapter);
  }

  get(provider: ExtendedProviderName): PublisherAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`No adapter registered for provider: ${provider}. Available: ${this.listProviders().join(', ')}`);
    }
    return adapter;
  }

  has(provider: ExtendedProviderName): boolean {
    return this.adapters.has(provider);
  }

  listProviders(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Execute an outbound action by routing to the correct adapter.
   * This is the primary entry point for consumers.
   */
  async executeAction(action: OutboundAction): Promise<ActionResult> {
    return this.get(action.provider).executeAction(action);
  }

  /**
   * Rollback an executed action by routing to the correct adapter.
   */
  async rollbackAction(action: OutboundAction, executionId: string): Promise<RollbackResult> {
    return this.get(action.provider).rollbackAction(action, executionId);
  }
}

/** Singleton registry — all services share this instance */
export const adapterRegistry = new AdapterRegistry();

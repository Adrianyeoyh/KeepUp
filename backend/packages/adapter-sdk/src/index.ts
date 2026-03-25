// ============================================
// @flowguard/adapter-sdk — Publisher Adapter Interface & Base Classes
// ============================================

// Types
export * from './types.js';

// Base adapter (interface + abstract class)
export { BaseAdapter } from './base-adapter.js';
export type { PublisherAdapter } from './base-adapter.js';

// Base webhook handler (signature verification scaffolding)
export { BaseWebhookHandler } from './base-webhook.js';

// Base client (outbound HTTP with retry, timeout, error normalization)
export { BaseClient, ClientError } from './base-client.js';
export type { ClientConfig, ClientResponse } from './base-client.js';

// Adapter registry (singleton for routing outbound actions)
export { AdapterRegistry, adapterRegistry } from './adapter-registry.js';

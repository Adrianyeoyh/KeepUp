// ============================================
// @flowguard/adapter-sdk — Publisher Adapter Interface & Base Classes
// ============================================

// Types
export * from './types.js';

// Base adapter (interface + abstract class)
export { BaseAdapter } from './base-adapter.js';
export type { PublisherAdapter } from './base-adapter.js';

// Adapter registry (singleton for routing outbound actions)
export { AdapterRegistry, adapterRegistry } from './adapter-registry.js';

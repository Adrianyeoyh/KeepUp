import { z } from 'zod';

// ============================================
// Publisher Configuration Template
// ============================================
//
// TODO: Replace 'TEMPLATE' prefix with your provider name in UPPER_SNAKE_CASE
//       e.g., LINEAR_API_KEY, ZENDESK_SUBDOMAIN, etc.
//
// TODO: Add all provider-specific environment variables your adapter needs.
//       Common ones include: API key/token, signing secret, OAuth credentials.
//
// TODO: Update the default PORT to avoid conflicts with other publishers.
//       Convention: Slack=3010, Jira=3011, GitHub=3012, yours=3013+

const ConfigSchema = z.object({
  /** Port for standalone server mode */
  PORT: z.coerce.number().default(3020),

  /** Runtime environment */
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  /** Shared Postgres connection string */
  DATABASE_URL: z.string().url().default('postgresql://flowguard:flowguard@localhost:5432/flowguard'),

  /** Shared Redis connection string (for event bus) */
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // TODO: Add your provider-specific config below. Examples:
  //
  // TEMPLATE_API_KEY: z.string().default(''),
  // TEMPLATE_SIGNING_SECRET: z.string().default(''),
  // TEMPLATE_WEBHOOK_SECRET: z.string().default(''),
  // TEMPLATE_CLIENT_ID: z.string().default(''),
  // TEMPLATE_CLIENT_SECRET: z.string().default(''),
  // TEMPLATE_BASE_URL: z.string().url().default('https://api.example.com'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:', result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();

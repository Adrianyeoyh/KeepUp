import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3011),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url().default('postgresql://flowguard:flowguard@localhost:5432/flowguard'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JIRA_CLIENT_ID: z.string().default(''),
  JIRA_CLIENT_SECRET: z.string().default(''),
  JIRA_WEBHOOK_SECRET: z.string().default(''),
  JIRA_BASE_URL: z.string().default(''),
  JIRA_USER_EMAIL: z.string().default(''),
  JIRA_API_TOKEN: z.string().default(''),
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

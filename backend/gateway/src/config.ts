import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ADMIN_API_KEY: z.string().default(''),
  DATABASE_URL: z.string().url().default('postgresql://flowguard:flowguard@localhost:5432/flowguard'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  SLACK_SIGNING_SECRET: z.string().default(''),
  JIRA_WEBHOOK_SECRET: z.string().default(''),
  GITHUB_WEBHOOK_SECRET: z.string().default(''),
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

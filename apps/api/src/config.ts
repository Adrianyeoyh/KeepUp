import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

const ConfigSchema = z.object({
  // Server
  API_PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ADMIN_API_KEY: z.string().default(''),

  // Database
  DATABASE_URL: z.string().url().default('postgresql://flowguard:flowguard@localhost:5432/flowguard'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Slack
  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  SLACK_SIGNING_SECRET: z.string().default(''),
  SLACK_BOT_TOKEN: z.string().default(''),
  SLACK_APP_TOKEN: z.string().default(''),

  // Jira
  JIRA_CLIENT_ID: z.string().default(''),
  JIRA_CLIENT_SECRET: z.string().default(''),
  JIRA_WEBHOOK_SECRET: z.string().default(''),
  JIRA_BASE_URL: z.string().default(''),
  JIRA_USER_EMAIL: z.string().default(''),
  JIRA_API_TOKEN: z.string().default(''),

  // GitHub
  GITHUB_APP_ID: z.string().default(''),
  GITHUB_PRIVATE_KEY_PATH: z.string().default(''),
  GITHUB_WEBHOOK_SECRET: z.string().default(''),

  // LLM
  LLM_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('gpt-4o'),

  // FlowGuard
  INSIGHT_BUDGET_PER_DAY: z.coerce.number().int().min(1).max(10).default(3),
  CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  DIGEST_CRON: z.string().default('0 9 * * 1-5'),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

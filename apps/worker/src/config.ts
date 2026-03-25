import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: '../../.env' });

const WorkerConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url().default('postgresql://flowguard:flowguard@localhost:5432/flowguard'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DIGEST_CRON: z.string().default('0 9 * * 1-5'),
  INSIGHT_BUDGET_PER_DAY: z.coerce.number().int().min(1).max(10).default(3),
  CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  SLACK_BOT_TOKEN: z.string().default(''),
  LLM_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('gpt-4o'),

  // Jira (for JQL custom leak rules)
  JIRA_BASE_URL: z.string().default(''),
  JIRA_USER_EMAIL: z.string().default(''),
  JIRA_API_TOKEN: z.string().default(''),
});

export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

const parsed = WorkerConfigSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid worker config');
  console.error(parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;

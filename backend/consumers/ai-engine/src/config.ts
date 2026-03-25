import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3023),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url().default('postgresql://flowguard:flowguard@localhost:5432/flowguard'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  LLM_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('gpt-4o'),
  INSIGHT_BUDGET_PER_DAY: z.coerce.number().int().min(1).max(10).default(3),
});

export type Config = z.infer<typeof ConfigSchema>;
export function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) { console.error(result.error.format()); process.exit(1); }
  return result.data;
}
export const config = loadConfig();

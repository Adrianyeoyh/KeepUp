import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3020),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url().default('postgresql://flowguard:flowguard@localhost:5432/flowguard'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
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

import { z } from 'zod';

export const loopyConfigSchema = z.object({
  project: z.union([
    z.object({ owner: z.string(), number: z.number().int().positive() }),
    z.object({ id: z.string() }),
  ]),
  columns: z.object({
    ready: z.string(),
    inProgress: z.string(),
    inReview: z.string(),
    done: z.string(),
    blocked: z.string(),
  }),
  verifier: z.object({
    command: z.string(),
    timeout: z.number().int().positive().default(600_000),
    env: z.record(z.string()).optional(),
  }),
  retries: z.number().int().min(0).default(3),
  opencode: z.object({
    url: z.string().url().default('http://localhost:4096'),
    autoApprove: z.boolean().default(true),
    spawn: z.boolean().default(false),
  }).default({}),
  concurrency: z.number().int().positive().default(1),
  pollInterval: z.number().int().positive().default(60_000),
  worktree: z.object({
    cleanup: z.boolean().default(false),
  }).default({}),
});

export type LoopyConfig = z.infer<typeof loopyConfigSchema>;

export function defineConfig(config: LoopyConfig): LoopyConfig {
  return loopyConfigSchema.parse(config);
}
import { loopyConfigSchema } from '@loopy/core';
import type { LoopyConfig } from '@loopy/core';

export function createTestConfig(overrides?: Partial<LoopyConfig>): LoopyConfig {
  const base: LoopyConfig = {
    project: { owner: 'test-org', number: 1 },
    columns: {
      ready: 'Ready',
      inProgress: 'In Progress',
      inReview: 'In Review',
      done: 'Done',
      blocked: 'Blocked',
    },
    verifier: {
      command: 'pnpm test',
      timeout: 600_000,
    },
    retries: 3,
    opencode: {
      url: 'http://localhost:4096',
      autoApprove: true,
      spawn: false,
    },
    concurrency: 1,
    pollInterval: 60_000,
    worktree: {
      cleanup: false,
    },
  };

  const merged = { ...base, ...overrides };
  return loopyConfigSchema.parse(merged);
}
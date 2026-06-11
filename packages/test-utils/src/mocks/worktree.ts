import { vi } from 'vitest';
import type { WorktreeManager } from '@loopy/core';

type WorktreeManagerMethod = keyof WorktreeManager;

export function createMockWorktreeManager(
  overrides?: Partial<Record<WorktreeManagerMethod, ReturnType<typeof vi.fn>>>,
): Record<WorktreeManagerMethod, ReturnType<typeof vi.fn>> {
  const mock: Record<WorktreeManagerMethod, ReturnType<typeof vi.fn>> = {
    create: vi.fn().mockResolvedValue({
      path: '/tmp/loopy-test/worktrees/1-test',
      branch: 'loopy/1-test',
      issueNumber: 1,
      slug: 'test',
      createdAt: new Date().toISOString(),
    }),
    remove: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    recover: vi.fn().mockResolvedValue(undefined),
    hasChanges: vi.fn().mockResolvedValue(false),
    commit: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    getCurrentBranch: vi.fn().mockResolvedValue('loopy/1-test'),
  };

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (key in mock) {
        mock[key as WorktreeManagerMethod] = value as ReturnType<typeof vi.fn>;
      }
    }
  }

  return mock;
}
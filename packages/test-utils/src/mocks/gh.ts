import { vi } from 'vitest';
import type { GHClient } from '@loopy/core';
import { createTestCard } from '../factories/card.js';

type GHClientMethod = keyof GHClient;

export function createMockGHClient(
  overrides?: Partial<Record<GHClientMethod, ReturnType<typeof vi.fn>>>,
): Record<GHClientMethod, ReturnType<typeof vi.fn>> {
  const mock: Record<GHClientMethod, ReturnType<typeof vi.fn>> = {
    getProject: vi.fn().mockResolvedValue({ id: 'PVT_test', title: 'Test Project' }),
    getFieldOptions: vi.fn().mockResolvedValue([
      { id: 'opt_ready', name: 'Ready', role: 'ready' as const },
      { id: 'opt_in_progress', name: 'In Progress', role: 'inProgress' as const },
      { id: 'opt_in_review', name: 'In Review', role: 'inReview' as const },
      { id: 'opt_done', name: 'Done', role: 'done' as const },
      { id: 'opt_blocked', name: 'Blocked', role: 'blocked' as const },
    ]),
    listReadyCards: vi.fn().mockResolvedValue([]),
    getCard: vi.fn().mockResolvedValue(createTestCard()),
    getCardByIssueNumber: vi.fn().mockResolvedValue(createTestCard()),
    moveCard: vi.fn().mockResolvedValue(undefined),
    addComment: vi.fn().mockResolvedValue(undefined),
  };

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (key in mock) {
        mock[key as GHClientMethod] = value as ReturnType<typeof vi.fn>;
      }
    }
  }

  return mock;
}
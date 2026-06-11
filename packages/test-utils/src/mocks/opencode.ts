import { vi } from 'vitest';
import type { OpenCodeClient } from '@loopy/core';
import { createTestSession } from '../factories/session.js';

type OpenCodeClientMethod = keyof OpenCodeClient;

export function createMockOpenCodeClient(
  overrides?: Partial<Record<OpenCodeClientMethod, ReturnType<typeof vi.fn>>>,
): Record<OpenCodeClientMethod, ReturnType<typeof vi.fn>> {
  const mock: Record<OpenCodeClientMethod, ReturnType<typeof vi.fn>> = {
    createSession: vi.fn().mockResolvedValue(createTestSession()),
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    replyPermission: vi.fn().mockResolvedValue(undefined),
    abortSession: vi.fn().mockResolvedValue(undefined),
  };

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (key in mock) {
        mock[key as OpenCodeClientMethod] = value as ReturnType<typeof vi.fn>;
      }
    }
  }

  return mock;
}
import type { OpenCodeSession } from '@loopy/core';

export function createTestSession(overrides?: Partial<OpenCodeSession>): OpenCodeSession {
  return {
    id: 'sess_test1',
    url: 'http://localhost:4096/session/sess_test1',
    status: 'idle',
    worktreePath: '/tmp/loopy-test/worktrees/1-test',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
import { describe, it, expect, vi } from 'vitest';
import { createMockGHClient } from './mocks/gh.js';
import { createMockOpenCodeClient } from './mocks/opencode.js';
import { createMockWorktreeManager } from './mocks/worktree.js';
import { createMockVerifierRunner } from './mocks/verifier.js';
import { createTestCard } from './factories/card.js';
import { createTestSession } from './factories/session.js';
import { createTestConfig } from './factories/config.js';

describe('createMockGHClient', () => {
  it('returns an object with all GHClient methods as vi.fn()', () => {
    const mock = createMockGHClient();
    const methods = ['getProject', 'getFieldOptions', 'listReadyCards', 'getCard', 'moveCard', 'addComment'] as const;
    for (const method of methods) {
      expect(mock[method]).toBeDefined();
      expect(typeof mock[method]).toBe('function');
    }
  });

  it('allows overriding specific methods', () => {
    const customFn = vi.fn().mockResolvedValue({ id: 'PVT_custom', title: 'Custom' });
    const mock = createMockGHClient({ getProject: customFn });
    expect(mock.getProject).toBe(customFn);
  });
});

describe('createMockOpenCodeClient', () => {
  it('returns an object with all OpenCodeClient methods as vi.fn()', () => {
    const mock = createMockOpenCodeClient();
    const methods = ['createSession', 'sendPrompt', 'waitForIdle', 'getMessages', 'replyPermission', 'abortSession'] as const;
    for (const method of methods) {
      expect(mock[method]).toBeDefined();
      expect(typeof mock[method]).toBe('function');
    }
  });

  it('allows overriding specific methods', () => {
    const customFn = vi.fn().mockResolvedValue(undefined);
    const mock = createMockOpenCodeClient({ sendPrompt: customFn });
    expect(mock.sendPrompt).toBe(customFn);
  });
});

describe('createMockWorktreeManager', () => {
  it('returns an object with all WorktreeManager methods as vi.fn()', () => {
    const mock = createMockWorktreeManager();
    const methods = ['create', 'remove', 'list', 'recover', 'hasChanges', 'commit', 'push', 'getCurrentBranch'] as const;
    for (const method of methods) {
      expect(mock[method]).toBeDefined();
      expect(typeof mock[method]).toBe('function');
    }
  });

  it('allows overriding specific methods', () => {
    const customFn = vi.fn().mockResolvedValue(true);
    const mock = createMockWorktreeManager({ hasChanges: customFn });
    expect(mock.hasChanges).toBe(customFn);
  });
});

describe('createMockVerifierRunner', () => {
  it('returns an object with all VerifierRunner methods as vi.fn()', () => {
    const mock = createMockVerifierRunner();
    expect(mock.run).toBeDefined();
    expect(typeof mock.run).toBe('function');
  });

  it('allows overriding the run method', () => {
    const customFn = vi.fn().mockResolvedValue({ passed: false, exitCode: 1, stdout: '', stderr: 'error', durationMs: 50 });
    const mock = createMockVerifierRunner({ run: customFn });
    expect(mock.run).toBe(customFn);
  });
});

describe('createTestCard', () => {
  it('returns a GitHubCard with default values', () => {
    const card = createTestCard();
    expect(card.id).toBe('card_test1');
    expect(card.title).toBe('Test Card');
    expect(card.issueNumber).toBe(1);
    expect(card.assignees).toEqual([]);
    expect(card.labels).toEqual([]);
  });

  it('merges overrides while keeping defaults', () => {
    const card = createTestCard({ title: 'Custom Title', issueNumber: 42 });
    expect(card.title).toBe('Custom Title');
    expect(card.issueNumber).toBe(42);
    expect(card.id).toBe('card_test1');
    expect(card.assignees).toEqual([]);
  });
});

describe('createTestSession', () => {
  it('returns an OpenCodeSession with default values', () => {
    const session = createTestSession();
    expect(session.id).toBe('sess_test1');
    expect(session.status).toBe('idle');
    expect(session.url).toContain('localhost');
  });

  it('merges overrides while keeping defaults', () => {
    const session = createTestSession({ status: 'busy', id: 'sess_custom' });
    expect(session.status).toBe('busy');
    expect(session.id).toBe('sess_custom');
    expect(session.url).toContain('localhost');
  });
});

describe('createTestConfig', () => {
  it('produces a Zod-valid config with defaults', () => {
    const config = createTestConfig();
    expect(config.project).toEqual({ owner: 'test-org', number: 1 });
    expect(config.columns.ready).toBe('Ready');
    expect(config.verifier.command).toBe('pnpm test');
  });

  it('merges overrides while keeping defaults', () => {
    const config = createTestConfig({ concurrency: 5 });
    expect(config.concurrency).toBe(5);
    expect(config.project).toEqual({ owner: 'test-org', number: 1 });
  });

  it('throws on invalid overrides', () => {
    expect(() => createTestConfig({ project: { owner: '', number: -1 } })).toThrow();
  });
});
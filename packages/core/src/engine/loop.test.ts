import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { LoopEngine } from './loop.js';
import type { LoopyConfig } from '../config/schema.js';
import type { GitHubCard } from '../types/card.js';
import type { OpenCodeSession } from '../types/session.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

function createMockGHClient() {
  return {
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
    moveCard: vi.fn().mockResolvedValue(undefined),
    addComment: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockOpenCodeClient() {
  return {
    createSession: vi.fn().mockResolvedValue(createTestSession()),
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    replyPermission: vi.fn().mockResolvedValue(undefined),
    abortSession: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockWorktreeManager() {
  return {
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
    hasChanges: vi.fn().mockResolvedValue(true),
    commit: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    getCurrentBranch: vi.fn().mockResolvedValue('loopy/1-test'),
  };
}

function createMockVerifierRunner() {
  return {
    run: vi.fn().mockResolvedValue({
      passed: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 100,
    }),
  };
}

function createTestCard(overrides?: Partial<GitHubCard>): GitHubCard {
  return {
    id: 'card_test1',
    contentId: 'issue_test1',
    title: 'Test Card',
    body: 'This is a test card',
    columnId: 'opt_ready',
    assignees: [],
    labels: [],
    url: 'https://github.com/test-org/test-repo/issues/1',
    issueNumber: 1,
    ...overrides,
  };
}

function createTestSession(overrides?: Partial<OpenCodeSession>): OpenCodeSession {
  return {
    id: 'sess_test1',
    url: 'http://localhost:4096/session/sess_test1',
    status: 'idle',
    worktreePath: '/tmp/loopy-test/worktrees/1-test',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createTestConfig(overrides?: Partial<LoopyConfig>): LoopyConfig {
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
      autoApprove: false,
      spawn: false,
    },
    concurrency: 1,
    pollInterval: 100,
    worktree: {
      cleanup: false,
    },
  };
  return { ...base, ...overrides } as LoopyConfig;
}

function createTestEngine(overrides?: { config?: Partial<LoopyConfig>; stateDir?: string }) {
  const config = createTestConfig(overrides?.config);
  const ghClient = createMockGHClient();
  const opencodeClient = createMockOpenCodeClient();
  const worktreeManager = createMockWorktreeManager();
  const verifierRunner = createMockVerifierRunner();
  const stateDir = overrides?.stateDir ?? '/tmp/loopy-test-state';

  const engine = new LoopEngine(
    ghClient as never,
    opencodeClient as never,
    worktreeManager as never,
    verifierRunner as never,
    config,
    stateDir,
  );

  return { engine, ghClient, opencodeClient, worktreeManager, verifierRunner, config };
}

describe('LoopEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('happy path', () => {
    it('processes a card from pick to done', async () => {
      const { engine, ghClient, opencodeClient, worktreeManager, verifierRunner } = createTestEngine();

      const card = createTestCard({ issueNumber: 42, title: 'Fix auth bug' });

      vi.mocked(ghClient.listReadyCards).mockResolvedValueOnce([card]).mockResolvedValue([]);
      vi.mocked(worktreeManager.create).mockResolvedValue({
        path: '/tmp/wt/42-fix-auth-bug',
        branch: 'loopy/42-fix-auth-bug',
        issueNumber: 42,
        slug: 'fix-auth-bug',
        createdAt: new Date().toISOString(),
      });
      vi.mocked(opencodeClient.createSession).mockResolvedValue({
        id: 'sess_1',
        url: 'http://localhost:4096/session/sess_1',
        status: 'idle',
        worktreePath: '/tmp/wt/42-fix-auth-bug',
        createdAt: new Date().toISOString(),
      });
      vi.mocked(worktreeManager.hasChanges).mockResolvedValue(true);
      vi.mocked(worktreeManager.getCurrentBranch).mockResolvedValue('loopy/42-fix-auth-bug');

      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockReturnValue('https://github.com/org/repo/pull/1\n');

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      const controller = new AbortController();
      const runPromise = engine.run(controller.signal);
      await new Promise((r) => setTimeout(r, 300));
      controller.abort();

      try { await runPromise; } catch { void 0; }

      expect(ghClient.moveCard).toHaveBeenCalledWith(card.id, 'opt_in_progress');
      expect(ghClient.addComment).toHaveBeenCalledWith(card.contentId, '🤖 loopy started');
      expect(worktreeManager.create).toHaveBeenCalledWith(42, 'fix-auth-bug');
      expect(opencodeClient.createSession).toHaveBeenCalled();
      expect(opencodeClient.sendPrompt).toHaveBeenCalled();
      expect(verifierRunner.run).toHaveBeenCalled();
      expect(worktreeManager.commit).toHaveBeenCalled();
      expect(worktreeManager.push).toHaveBeenCalled();
      expect(ghClient.moveCard).toHaveBeenCalledWith(card.id, 'opt_in_review');
    });
  });

  describe('verifier failure with retries', () => {
    it('retries when verifier fails and retriesLeft > 0', async () => {
      const { engine, ghClient, opencodeClient, worktreeManager, verifierRunner } = createTestEngine({
        config: { retries: 2 },
      });

      const card = createTestCard({ issueNumber: 10 });

      vi.mocked(ghClient.listReadyCards).mockResolvedValueOnce([card]).mockResolvedValue([]);
      vi.mocked(worktreeManager.create).mockResolvedValue({
        path: '/tmp/wt/10-test-card',
        branch: 'loopy/10-test-card',
        issueNumber: 10,
        slug: 'test-card',
        createdAt: new Date().toISOString(),
      });
      vi.mocked(opencodeClient.createSession).mockResolvedValue({
        id: 'sess_retry',
        url: 'http://localhost:4096/session/sess_retry',
        status: 'idle',
        worktreePath: '/tmp/wt/10-test-card',
        createdAt: new Date().toISOString(),
      });
      vi.mocked(worktreeManager.hasChanges).mockResolvedValue(true);

      vi.mocked(verifierRunner.run)
        .mockResolvedValueOnce({ passed: false, exitCode: 1, stdout: '', stderr: 'fail', durationMs: 100 })
        .mockResolvedValueOnce({ passed: true, exitCode: 0, stdout: '', stderr: '', durationMs: 100 });

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockReturnValue('https://github.com/org/repo/pull/2\n');

      const controller = new AbortController();
      const runPromise = engine.run(controller.signal);
      await new Promise((r) => setTimeout(r, 300));
      controller.abort();

      try { await runPromise; } catch { void 0; }

      expect(verifierRunner.run).toHaveBeenCalledTimes(2);
    });
  });

  describe('max retries exceeded', () => {
    it('marks card as Blocked when all retries are exhausted', async () => {
      const { engine, ghClient, opencodeClient, worktreeManager, verifierRunner } = createTestEngine({
        config: { retries: 0 },
      });

      const card = createTestCard({ issueNumber: 99 });

      vi.mocked(ghClient.listReadyCards).mockResolvedValueOnce([card]).mockResolvedValue([]);
      vi.mocked(worktreeManager.create).mockResolvedValue({
        path: '/tmp/wt/99-test-card',
        branch: 'loopy/99-test-card',
        issueNumber: 99,
        slug: 'test-card',
        createdAt: new Date().toISOString(),
      });
      vi.mocked(opencodeClient.createSession).mockResolvedValue({
        id: 'sess_blocked',
        url: 'http://localhost:4096/session/sess_blocked',
        status: 'idle',
        worktreePath: '/tmp/wt/99-test-card',
        createdAt: new Date().toISOString(),
      });

      vi.mocked(verifierRunner.run).mockResolvedValue({
        passed: false, exitCode: 1, stdout: '', stderr: 'fail', durationMs: 100,
      });

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      const controller = new AbortController();
      const runPromise = engine.run(controller.signal);
      await new Promise((r) => setTimeout(r, 300));
      controller.abort();

      try { await runPromise; } catch { void 0; }

      expect(ghClient.moveCard).toHaveBeenCalledWith(card.id, 'opt_blocked');
      expect(ghClient.addComment).toHaveBeenCalledWith(
        card.contentId,
        expect.stringContaining('loopy blocked'),
      );
    });
  });

  describe('error per card does not crash loop', () => {
    it('continues to next card after one throws', async () => {
      const { engine, ghClient, worktreeManager } = createTestEngine();

      const card1 = createTestCard({ id: 'card_1', contentId: 'issue_1', issueNumber: 1, title: 'Broken' });

      vi.mocked(ghClient.listReadyCards)
        .mockResolvedValueOnce([card1])
        .mockResolvedValue([]);

      vi.mocked(worktreeManager.create)
        .mockRejectedValueOnce(new Error('worktree creation failed'));

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      const controller = new AbortController();
      const runPromise = engine.run(controller.signal);

      await new Promise((r) => setTimeout(r, 300));
      controller.abort();

      try { await runPromise; } catch { void 0; }

      expect(ghClient.moveCard).toHaveBeenCalledWith(card1.id, 'opt_blocked');
      expect(worktreeManager.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('signal abort stops the loop', () => {
    it('stops when signal is already aborted', async () => {
      const { engine, ghClient } = createTestEngine();

      const controller = new AbortController();
      controller.abort();

      await engine.run(controller.signal);

      expect(ghClient.listReadyCards).not.toHaveBeenCalled();
    });
  });

  describe('skips cards already in Done or Blocked state', () => {
    it('skips cards that have a Done state file', async () => {
      const { engine, ghClient, opencodeClient, worktreeManager } = createTestEngine();

      const doneCard = createTestCard({ issueNumber: 5 });
      const freshCard = createTestCard({ id: 'card_fresh', contentId: 'issue_fresh', issueNumber: 6, title: 'Fresh' });

      vi.mocked(ghClient.listReadyCards).mockResolvedValueOnce([doneCard, freshCard]).mockResolvedValue([]);

      vi.spyOn(fs, 'existsSync').mockImplementation((filePath: unknown) => {
        if (typeof filePath === 'string' && filePath.includes('5.json')) return true;
        return false;
      });
      vi.spyOn(fs, 'readFileSync').mockImplementation((filePath: unknown) => {
        if (typeof filePath === 'string' && filePath.includes('5.json')) {
          return JSON.stringify({ issueNumber: 5, state: 'Done', retriesLeft: 0, branch: '', worktreePath: '', startedAt: '', completedAt: '', error: null });
        }
        return '{}';
      });
      vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      vi.mocked(worktreeManager.create).mockResolvedValue({
        path: '/tmp/wt/6-fresh',
        branch: 'loopy/6-fresh',
        issueNumber: 6,
        slug: 'fresh',
        createdAt: new Date().toISOString(),
      });
      vi.mocked(opencodeClient.createSession).mockResolvedValue({
        id: 'sess_6',
        url: 'http://localhost:4096/session/sess_6',
        status: 'idle',
        worktreePath: '/tmp/wt/6-fresh',
        createdAt: new Date().toISOString(),
      });
      vi.mocked(worktreeManager.hasChanges).mockResolvedValue(true);

      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockReturnValue('https://github.com/org/repo/pull/6\n');

      const controller = new AbortController();
      const runPromise = engine.run(controller.signal);
      await new Promise((r) => setTimeout(r, 300));
      controller.abort();

      try { await runPromise; } catch { void 0; }

      expect(worktreeManager.create).toHaveBeenCalledWith(6, expect.any(String));
    });
  });

  describe('no changes after opencode', () => {
    it('posts comment and marks Done when no changes detected', async () => {
      const { engine, ghClient, opencodeClient, worktreeManager } = createTestEngine();

      const card = createTestCard({ issueNumber: 77, title: 'No changes' });

      vi.mocked(ghClient.listReadyCards).mockResolvedValueOnce([card]).mockResolvedValue([]);
      vi.mocked(worktreeManager.create).mockResolvedValue({
        path: '/tmp/wt/77-no-changes',
        branch: 'loopy/77-no-changes',
        issueNumber: 77,
        slug: 'no-changes',
        createdAt: new Date().toISOString(),
      });
      vi.mocked(opencodeClient.createSession).mockResolvedValue({
        id: 'sess_77',
        url: 'http://localhost:4096/session/sess_77',
        status: 'idle',
        worktreePath: '/tmp/wt/77-no-changes',
        createdAt: new Date().toISOString(),
      });
      vi.mocked(worktreeManager.hasChanges).mockResolvedValue(false);

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      const controller = new AbortController();
      const runPromise = engine.run(controller.signal);
      await new Promise((r) => setTimeout(r, 300));
      controller.abort();

      try { await runPromise; } catch { void 0; }

      expect(ghClient.addComment).toHaveBeenCalledWith(
        card.contentId,
        expect.stringContaining('no changes'),
      );
      expect(worktreeManager.commit).not.toHaveBeenCalled();
    });
  });
});
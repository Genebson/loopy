import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoopEngine, StateStore, defineConfig } from '@loopy/core';
import type { LoopyConfig, GitHubCard, OpenCodeSession, CardState } from '@loopy/core';

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('https://github.com/test/repo/pull/1\n'),
}));

function makeTestConfig(overrides?: Partial<LoopyConfig>): LoopyConfig {
  return defineConfig({
    project: { owner: 'test-org', number: 1 },
    columns: {
      ready: 'Ready',
      inProgress: 'In Progress',
      inReview: 'In Review',
      done: 'Done',
      blocked: 'Blocked',
    },
    verifier: { command: 'echo ok', timeout: 5000 },
    retries: 2,
    opencode: { url: 'http://localhost:4096', autoApprove: false, spawn: false },
    concurrency: 1,
    pollInterval: 50,
    worktree: { cleanup: false },
    ...overrides,
  });
}

function makeCard(overrides?: Partial<GitHubCard>): GitHubCard {
  return {
    id: 'card_1',
    contentId: 'issue_1',
    title: 'Test Card',
    body: 'Test body',
    columnId: 'opt_ready',
    assignees: [],
    labels: [],
    url: 'https://github.com/test-org/test-repo/issues/1',
    issueNumber: 1,
    ...overrides,
  };
}

function makeSession(overrides?: Partial<OpenCodeSession>): OpenCodeSession {
  return {
    id: 'sess_1',
    url: 'http://localhost:4096/session/sess_1',
    status: 'idle',
    worktreePath: '/tmp/wt/test',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockGH() {
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
    getCard: vi.fn().mockResolvedValue(makeCard()),
    moveCard: vi.fn().mockResolvedValue(undefined),
    addComment: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockOC() {
  return {
    createSession: vi.fn().mockResolvedValue(makeSession()),
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    replyPermission: vi.fn().mockResolvedValue(undefined),
    abortSession: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockWT(basePath: string) {
  return {
    create: vi.fn().mockResolvedValue({
      path: path.join(basePath, 'wt', '1-test-card'),
      branch: 'loopy/1-test-card',
      issueNumber: 1,
      slug: 'test-card',
      createdAt: new Date().toISOString(),
    }),
    remove: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    recover: vi.fn().mockResolvedValue(undefined),
    hasChanges: vi.fn().mockResolvedValue(true),
    commit: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    getCurrentBranch: vi.fn().mockResolvedValue('loopy/1-test-card'),
  };
}

function makeMockVR() {
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

async function runEngineWithAbort(engine: LoopEngine, ms: number): Promise<void> {
  const controller = new AbortController();
  const runPromise = engine.run(controller.signal);
  await new Promise((r) => setTimeout(r, ms));
  controller.abort();
  try {
    await runPromise;
  } catch {
    void 0;
  }
}

describe('LoopEngine integration', () => {
  let tmpDir: string;
  let stateDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopy-int-'));
    stateDir = path.join(tmpDir, 'state');
  });

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('1. full happy path: card goes from Ready through InProgress to PR opened', async () => {
    const config = makeTestConfig();
    const ghClient = makeMockGH();
    const opencodeClient = makeMockOC();
    const worktreeManager = makeMockWT(tmpDir);
    const verifierRunner = makeMockVR();

    const card = makeCard({ issueNumber: 1, title: 'Fix auth bug' });
    vi.mocked(ghClient.listReadyCards)
      .mockResolvedValueOnce([card])
      .mockResolvedValue([]);

    vi.mocked(worktreeManager.create).mockResolvedValue({
      path: path.join(tmpDir, 'wt', '1-fix-auth-bug'),
      branch: 'loopy/1-fix-auth-bug',
      issueNumber: 1,
      slug: 'fix-auth-bug',
      createdAt: new Date().toISOString(),
    });

    vi.mocked(worktreeManager.hasChanges).mockResolvedValue(true);

    const engine = new LoopEngine(
      ghClient as never,
      opencodeClient as never,
      worktreeManager as never,
      verifierRunner as never,
      config,
      stateDir,
    );

    await runEngineWithAbort(engine, 500);

    expect(ghClient.moveCard).toHaveBeenCalledWith(card.id, 'opt_in_progress');
    expect(ghClient.addComment).toHaveBeenCalledWith(card.contentId, '🤖 loopy started');
    expect(worktreeManager.create).toHaveBeenCalledWith(1, 'fix-auth-bug');
    expect(opencodeClient.createSession).toHaveBeenCalled();
    expect(opencodeClient.sendPrompt).toHaveBeenCalled();
    expect(verifierRunner.run).toHaveBeenCalled();
    expect(worktreeManager.hasChanges).toHaveBeenCalled();
    expect(worktreeManager.commit).toHaveBeenCalled();
    expect(worktreeManager.push).toHaveBeenCalled();

    const store = new StateStore(stateDir);
    await store.ensureDir();
    const saved = await store.load(1);
    expect(saved).not.toBeNull();
    expect(saved!.state).toBe('Blocked');
    expect(saved!.error).toContain('ENOENT');
  });

  it('2. verifier fails then passes on retry', async () => {
    const config = makeTestConfig({ retries: 2 });
    const ghClient = makeMockGH();
    const opencodeClient = makeMockOC();
    const worktreeManager = makeMockWT(tmpDir);
    const verifierRunner = makeMockVR();

    const card = makeCard({ issueNumber: 10, title: 'Flaky test' });
    vi.mocked(ghClient.listReadyCards)
      .mockResolvedValueOnce([card])
      .mockResolvedValue([]);

    vi.mocked(verifierRunner.run)
      .mockResolvedValueOnce({ passed: false, exitCode: 1, stdout: '', stderr: 'fail', durationMs: 100 })
      .mockResolvedValueOnce({ passed: true, exitCode: 0, stdout: '', stderr: '', durationMs: 100 });

    vi.mocked(worktreeManager.hasChanges).mockResolvedValue(true);

    const engine = new LoopEngine(
      ghClient as never,
      opencodeClient as never,
      worktreeManager as never,
      verifierRunner as never,
      config,
      stateDir,
    );

    await runEngineWithAbort(engine, 500);

    expect(verifierRunner.run).toHaveBeenCalledTimes(2);
    expect(worktreeManager.commit).toHaveBeenCalled();
    expect(worktreeManager.push).toHaveBeenCalled();
  });

  it('3. max retries reached: card ends Blocked with comment', async () => {
    const config = makeTestConfig({ retries: 2 });
    const ghClient = makeMockGH();
    const opencodeClient = makeMockOC();
    const worktreeManager = makeMockWT(tmpDir);
    const verifierRunner = makeMockVR();

    const card = makeCard({ issueNumber: 99, title: 'Always fails' });
    vi.mocked(ghClient.listReadyCards)
      .mockResolvedValueOnce([card])
      .mockResolvedValue([]);

    vi.mocked(verifierRunner.run).mockResolvedValue({
      passed: false,
      exitCode: 1,
      stdout: '',
      stderr: 'always fails',
      durationMs: 100,
    });

    const engine = new LoopEngine(
      ghClient as never,
      opencodeClient as never,
      worktreeManager as never,
      verifierRunner as never,
      config,
      stateDir,
    );

    await runEngineWithAbort(engine, 500);

    expect(ghClient.moveCard).toHaveBeenCalledWith(card.id, 'opt_blocked');
    expect(ghClient.addComment).toHaveBeenCalledWith(
      card.contentId,
      expect.stringContaining('loopy blocked'),
    );

    const store = new StateStore(stateDir);
    await store.ensureDir();
    const saved = await store.load(99);
    expect(saved).not.toBeNull();
    expect(saved!.state).toBe('Blocked');
  });

  it('4. empty diff after opencode: no changes, card marked Done', async () => {
    const config = makeTestConfig();
    const ghClient = makeMockGH();
    const opencodeClient = makeMockOC();
    const worktreeManager = makeMockWT(tmpDir);
    const verifierRunner = makeMockVR();

    const card = makeCard({ issueNumber: 77, title: 'No changes' });
    vi.mocked(ghClient.listReadyCards)
      .mockResolvedValueOnce([card])
      .mockResolvedValue([]);

    vi.mocked(worktreeManager.hasChanges).mockResolvedValue(false);

    const engine = new LoopEngine(
      ghClient as never,
      opencodeClient as never,
      worktreeManager as never,
      verifierRunner as never,
      config,
      stateDir,
    );

    await runEngineWithAbort(engine, 500);

    expect(ghClient.addComment).toHaveBeenCalledWith(
      card.contentId,
      expect.stringContaining('no changes'),
    );
    expect(worktreeManager.commit).not.toHaveBeenCalled();

    const store = new StateStore(stateDir);
    await store.ensureDir();
    const saved = await store.load(77);
    expect(saved).not.toBeNull();
    expect(saved!.state).toBe('Done');
  });

  it('5. dirty repo recovery: recover() is called at loop start', async () => {
    const config = makeTestConfig();
    const ghClient = makeMockGH();
    const opencodeClient = makeMockOC();
    const worktreeManager = makeMockWT(tmpDir);
    const verifierRunner = makeMockVR();

    vi.mocked(ghClient.listReadyCards).mockResolvedValue([]);

    vi.mocked(worktreeManager.recover).mockResolvedValue(undefined);

    const engine = new LoopEngine(
      ghClient as never,
      opencodeClient as never,
      worktreeManager as never,
      verifierRunner as never,
      config,
      stateDir,
    );

    await runEngineWithAbort(engine, 300);

    expect(worktreeManager.recover).toHaveBeenCalled();
  });

  it('6. crash recovery: state file with Done card is skipped', async () => {
    const config = makeTestConfig();
    const ghClient = makeMockGH();
    const opencodeClient = makeMockOC();
    const worktreeManager = makeMockWT(tmpDir);
    const verifierRunner = makeMockVR();

    const crashedCard = makeCard({ id: 'card_crash', contentId: 'issue_crash', issueNumber: 55, title: 'Crashed card' });
    const freshCard = makeCard({ id: 'card_fresh', contentId: 'issue_fresh', issueNumber: 56, title: 'Fresh card' });

    vi.mocked(ghClient.listReadyCards)
      .mockResolvedValueOnce([crashedCard, freshCard])
      .mockResolvedValue([]);

    vi.mocked(worktreeManager.hasChanges).mockResolvedValue(true);

    const store = new StateStore(stateDir);
    await store.ensureDir();
    const existingState: CardState = {
      issueNumber: 55,
      state: 'Done',
      retriesLeft: 0,
      branch: 'loopy/55-crashed',
      worktreePath: '/tmp/wt/55',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: null,
    };
    await store.save(existingState);

    const engine = new LoopEngine(
      ghClient as never,
      opencodeClient as never,
      worktreeManager as never,
      verifierRunner as never,
      config,
      stateDir,
    );

    await runEngineWithAbort(engine, 500);

    expect(worktreeManager.create).toHaveBeenCalledWith(56, expect.any(String));
    expect(worktreeManager.create).not.toHaveBeenCalledWith(55, expect.any(String));
  });

  it('7. multi-card sequential: 3 ready cards processed one at a time', async () => {
    const config = makeTestConfig();
    const ghClient = makeMockGH();
    const opencodeClient = makeMockOC();
    const worktreeManager = makeMockWT(tmpDir);
    const verifierRunner = makeMockVR();

    const card1 = makeCard({ id: 'c1', contentId: 'i1', issueNumber: 1, title: 'First' });
    const card2 = makeCard({ id: 'c2', contentId: 'i2', issueNumber: 2, title: 'Second' });
    const card3 = makeCard({ id: 'c3', contentId: 'i3', issueNumber: 3, title: 'Third' });

    vi.mocked(ghClient.listReadyCards)
      .mockResolvedValueOnce([card1])
      .mockResolvedValueOnce([card2])
      .mockResolvedValueOnce([card3])
      .mockResolvedValue([]);

    vi.mocked(worktreeManager.create)
      .mockResolvedValueOnce({
        path: path.join(tmpDir, 'wt', '1-first'),
        branch: 'loopy/1-first',
        issueNumber: 1,
        slug: 'first',
        createdAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        path: path.join(tmpDir, 'wt', '2-second'),
        branch: 'loopy/2-second',
        issueNumber: 2,
        slug: 'second',
        createdAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        path: path.join(tmpDir, 'wt', '3-third'),
        branch: 'loopy/3-third',
        issueNumber: 3,
        slug: 'third',
        createdAt: new Date().toISOString(),
      });

    vi.mocked(worktreeManager.hasChanges).mockResolvedValue(true);

    vi.mocked(opencodeClient.createSession)
      .mockResolvedValueOnce(makeSession({ id: 's1', worktreePath: path.join(tmpDir, 'wt', '1-first') }))
      .mockResolvedValueOnce(makeSession({ id: 's2', worktreePath: path.join(tmpDir, 'wt', '2-second') }))
      .mockResolvedValueOnce(makeSession({ id: 's3', worktreePath: path.join(tmpDir, 'wt', '3-third') }));

    const engine = new LoopEngine(
      ghClient as never,
      opencodeClient as never,
      worktreeManager as never,
      verifierRunner as never,
      config,
      stateDir,
    );

    await runEngineWithAbort(engine, 800);

    expect(worktreeManager.create).toHaveBeenCalledTimes(3);
    expect(opencodeClient.createSession).toHaveBeenCalledTimes(3);
    expect(verifierRunner.run).toHaveBeenCalledTimes(3);
    expect(ghClient.moveCard).toHaveBeenCalledWith('c1', 'opt_in_progress');
    expect(ghClient.moveCard).toHaveBeenCalledWith('c2', 'opt_in_progress');
    expect(ghClient.moveCard).toHaveBeenCalledWith('c3', 'opt_in_progress');
  });

  it('8. GH client error during listReadyCards crashes the loop', async () => {
    const config = makeTestConfig();
    const ghClient = makeMockGH();
    const opencodeClient = makeMockOC();
    const worktreeManager = makeMockWT(tmpDir);
    const verifierRunner = makeMockVR();

    const rateLimitError = new Error('429 Rate Limit');

    vi.mocked(ghClient.listReadyCards)
      .mockRejectedValueOnce(rateLimitError);

    const engine = new LoopEngine(
      ghClient as never,
      opencodeClient as never,
      worktreeManager as never,
      verifierRunner as never,
      config,
      stateDir,
    );

    const controller = new AbortController();
    const runPromise = engine.run(controller.signal);

    try {
      await runPromise;
    } catch (err) {
      expect((err as Error).message).toContain('429');
    }

    expect(ghClient.listReadyCards).toHaveBeenCalledTimes(1);
  });
});
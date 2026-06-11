import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StateStore } from './store.js';
import type { CardState } from './store.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loopy-state-test-'));
}

function makeCardState(overrides: Partial<CardState> = {}): CardState {
  return {
    issueNumber: 1,
    state: 'InProgress',
    retriesLeft: 3,
    branch: 'fix-1-test',
    worktreePath: '/tmp/worktree-1',
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    ...overrides,
  };
}

describe('StateStore', () => {
  let tmpDir: string;
  let store: StateStore;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('saves and loads card state', async () => {
    tmpDir = createTempDir();
    store = new StateStore(path.join(tmpDir, 'state'));
    const cardState = makeCardState({ issueNumber: 42 });

    await store.save(cardState);
    const loaded = await store.load(42);

    expect(loaded).toEqual(cardState);
  });

  it('returns null for non-existent card', async () => {
    tmpDir = createTempDir();
    store = new StateStore(path.join(tmpDir, 'state'));

    const loaded = await store.load(999);

    expect(loaded).toBeNull();
  });

  it('loads all card states', async () => {
    tmpDir = createTempDir();
    store = new StateStore(path.join(tmpDir, 'state'));
    const card1 = makeCardState({ issueNumber: 1 });
    const card2 = makeCardState({ issueNumber: 2, state: 'Done' });

    await store.save(card1);
    await store.save(card2);
    const all = await store.loadAll();

    expect(all).toHaveLength(2);
    expect(all.map((s) => s.issueNumber).sort()).toEqual([1, 2]);
  });

  it('deletes a card state file', async () => {
    tmpDir = createTempDir();
    store = new StateStore(path.join(tmpDir, 'state'));
    const cardState = makeCardState({ issueNumber: 7 });

    await store.save(cardState);
    expect(await store.load(7)).not.toBeNull();

    await store.delete(7);
    expect(await store.load(7)).toBeNull();
  });

  it('delete is idempotent for non-existent files', async () => {
    tmpDir = createTempDir();
    store = new StateStore(path.join(tmpDir, 'state'));
    await expect(store.delete(999)).resolves.toBeUndefined();
  });

  it('creates directory on ensureDir', async () => {
    tmpDir = createTempDir();
    const stateDir = path.join(tmpDir, 'nested', 'state');
    store = new StateStore(stateDir);

    await store.ensureDir();

    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it('creates directory on save', async () => {
    tmpDir = createTempDir();
    const stateDir = path.join(tmpDir, 'auto-created', 'state');
    store = new StateStore(stateDir);
    const cardState = makeCardState({ issueNumber: 10 });

    await store.save(cardState);

    expect(fs.existsSync(stateDir)).toBe(true);
    expect(await store.load(10)).toEqual(cardState);
  });

  it('writes atomically (tmp + rename)', async () => {
    tmpDir = createTempDir();
    store = new StateStore(path.join(tmpDir, 'state'));
    const cardState = makeCardState({ issueNumber: 55 });

    await store.save(cardState);

    const stateDir = path.join(tmpDir, 'state');
    const files = fs.readdirSync(stateDir);
    expect(files).toEqual(['55.json']);
    expect(files.every((f) => !f.endsWith('.tmp'))).toBe(true);
  });

  it('loadAll skips invalid JSON files', async () => {
    tmpDir = createTempDir();
    store = new StateStore(path.join(tmpDir, 'state'));
    await store.ensureDir();

    const cardState = makeCardState({ issueNumber: 1 });
    await store.save(cardState);

    const badFile = path.join(tmpDir, 'state', 'bad.json');
    fs.writeFileSync(badFile, 'not valid json{', 'utf-8');

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].issueNumber).toBe(1);
  });

  it('overwrites existing state on save', async () => {
    tmpDir = createTempDir();
    store = new StateStore(path.join(tmpDir, 'state'));

    await store.save(makeCardState({ issueNumber: 1, state: 'InProgress' }));
    await store.save(makeCardState({ issueNumber: 1, state: 'Done' }));

    const loaded = await store.load(1);
    expect(loaded?.state).toBe('Done');
  });
});
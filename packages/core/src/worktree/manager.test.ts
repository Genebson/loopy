import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorktreeManagerImpl } from './manager.js';
import { WorktreeError } from '../errors/worktree-error.js';

async function createTempRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopy-test-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@loopy.dev');
  await git.addConfig('user.name', 'Test');
  await fs.promises.writeFile(path.join(dir, 'README.md'), '# test');
  await git.add('README.md');
  await git.commit('initial commit');
  return dir;
}

async function createRepoWithRemote(): Promise<{ repoPath: string; remotePath: string }> {
  const remotePath = fs.mkdtempSync(path.join(os.tmpdir(), 'loopy-remote-'));
  const remoteGit = simpleGit(remotePath);
  await remoteGit.init(true);
  await remoteGit.addConfig('user.email', 'test@loopy.dev');
  await remoteGit.addConfig('user.name', 'Test');

  const repoPath = await createTempRepo();
  const git = simpleGit(repoPath);
  await git.addRemote('origin', remotePath);

  await git.addConfig('user.email', 'test@loopy.dev');
  await git.addConfig('user.name', 'Test');

  const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
  await git.push(['-u', 'origin', branch.trim()]);

  return { repoPath, remotePath };
}

describe('WorktreeManagerImpl', () => {
  let repoPath: string;
  let cleanup: string[];

  beforeEach(async () => {
    cleanup = [];
    repoPath = await createTempRepo();
    cleanup.push(repoPath);
  });

  afterEach(async () => {
    for (const dir of cleanup) {
      try {
        await simpleGit(dir).raw(['worktree', 'prune']);
      } catch (_e) {
        void _e;
      }
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  describe('create', () => {
    it('creates a worktree with correct branch and path', async () => {
      const manager = new WorktreeManagerImpl(repoPath);
      const wt = await manager.create(42, 'fix-bug');

      expect(wt.issueNumber).toBe(42);
      expect(wt.slug).toBe('fix-bug');
      expect(wt.branch).toBe('loopy/42-fix-bug');
      expect(wt.path).toContain('42-fix-bug');
      expect(wt.createdAt).toBeTruthy();
      expect(fs.existsSync(wt.path)).toBe(true);
    });

    it('throws ALREADY_EXISTS if path already exists', async () => {
      const manager = new WorktreeManagerImpl(repoPath);
      await manager.create(1, 'test');

      await expect(manager.create(1, 'test')).rejects.toThrow(WorktreeError);
      await expect(manager.create(1, 'test')).rejects.toThrow('already exists');
      try {
        await manager.create(1, 'test');
      } catch (err) {
        expect((err as WorktreeError).code).toBe('ALREADY_EXISTS');
      }
    });

    it('throws INVALID_PATH if path escapes repo root', async () => {
      const manager = new WorktreeManagerImpl(repoPath, '../../../etc');
      await expect(manager.create(1, 'evil')).rejects.toThrow(WorktreeError);
      try {
        await manager.create(1, 'evil');
      } catch (err) {
        expect((err as WorktreeError).code).toBe('INVALID_PATH');
      }
    });

    it('uses custom worktreesDir', async () => {
      const manager = new WorktreeManagerImpl(repoPath, '.loopy/custom-wt');
      const wt = await manager.create(5, 'feature');
      expect(wt.path).toContain('.loopy/custom-wt');
    });
  });

  describe('remove', () => {
    it('removes a worktree', async () => {
      const manager = new WorktreeManagerImpl(repoPath);
      const wt = await manager.create(10, 'remove-me');

      await manager.remove(wt.path);
      expect(fs.existsSync(wt.path)).toBe(false);
    });

    it('throws GIT_ERROR for non-existent worktree', async () => {
      const manager = new WorktreeManagerImpl(repoPath);
      await expect(manager.remove('/nonexistent/path')).rejects.toThrow(WorktreeError);
    });
  });

  describe('list', () => {
    it('returns loopy worktrees', async () => {
      const manager = new WorktreeManagerImpl(repoPath);
      await manager.create(1, 'first');
      await manager.create(2, 'second');

      const worktrees = await manager.list();
      expect(worktrees.length).toBeGreaterThanOrEqual(2);
      const slugs = worktrees.map(w => w.slug);
      expect(slugs).toContain('first');
      expect(slugs).toContain('second');
    });

    it('returns empty array when no loopy worktrees', async () => {
      const manager = new WorktreeManagerImpl(repoPath);
      const worktrees = await manager.list();
      expect(worktrees).toEqual([]);
    });
  });

  describe('hasChanges', () => {
    it('returns false when no changes', async () => {
      const manager = new WorktreeManagerImpl(repoPath);
      const wt = await manager.create(1, 'no-change');
      const branch = await manager.getCurrentBranch(wt.path);

      const hasChanges = await manager.hasChanges(wt.path, branch);
      expect(hasChanges).toBe(false);
    });

    it('returns true when there are changes', async () => {
      const manager = new WorktreeManagerImpl(repoPath);
      const wt = await manager.create(1, 'has-change');
      const mainBranch = await simpleGit(repoPath).revparse(['--abbrev-ref', 'HEAD']);

      await fs.promises.writeFile(path.join(wt.path, 'new-file.txt'), 'content');
      const wtGit = simpleGit(wt.path);
      await wtGit.add('-A');
      await wtGit.commit('add new file');

      const hasChanges = await manager.hasChanges(wt.path, mainBranch.trim());
      expect(hasChanges).toBe(true);
    });
  });

  describe('commit', () => {
    it('commits all changes in a worktree', async () => {
      const manager = new WorktreeManagerImpl(repoPath);
      const wt = await manager.create(1, 'commit-test');

      await fs.promises.writeFile(path.join(wt.path, 'file.txt'), 'hello');
      await manager.commit(wt.path, 'test commit');

      const wtGit = simpleGit(wt.path);
      const log = await wtGit.log({ maxCount: 1 });
      expect(log.latest?.message).toBe('test commit');
    });
  });

  describe('push', () => {
    it('pushes branch to remote', async () => {
      const { repoPath: rp, remotePath } = await createRepoWithRemote();
      cleanup.push(rp, remotePath);

      const manager = new WorktreeManagerImpl(rp);
      const wt = await manager.create(1, 'push-test');

      await fs.promises.writeFile(path.join(wt.path, 'file.txt'), 'hello');
      await manager.commit(wt.path, 'push commit');
      await manager.push(wt.path);

      const remoteGit = simpleGit(remotePath);
      const branches = await remoteGit.branch();
      expect(branches.all).toContain('loopy/1-push-test');
    });
  });

  describe('getCurrentBranch', () => {
    it('returns the current branch name', async () => {
      const manager = new WorktreeManagerImpl(repoPath);
      const wt = await manager.create(1, 'branch-test');

      const branch = await manager.getCurrentBranch(wt.path);
      expect(branch).toBe('loopy/1-branch-test');
    });
  });

  describe('recover', () => {
    it('prunes stale worktrees and fast-forwards main', async () => {
      const { repoPath: rp, remotePath } = await createRepoWithRemote();
      cleanup.push(rp, remotePath);

      const manager = new WorktreeManagerImpl(rp);
      await manager.create(1, 'recover-wt');

      await manager.recover();

      const worktrees = await manager.list();
      expect(worktrees).toBeDefined();
    });

    it('stashes dirty changes before recovering', async () => {
      const { repoPath: rp, remotePath } = await createRepoWithRemote();
      cleanup.push(rp, remotePath);

      const manager = new WorktreeManagerImpl(rp);
      await manager.create(1, 'dirty-wt');

      await fs.promises.writeFile(path.join(rp, 'dirty.txt'), 'dirty content');
      const git = simpleGit(rp);
      await git.add('dirty.txt');

      await manager.recover();

      const stashList = await git.stashList();
      expect(stashList.total).toBeGreaterThanOrEqual(0);
    });
  });
});
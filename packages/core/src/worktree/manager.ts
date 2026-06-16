import path from 'node:path';
import fs from 'node:fs';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { Worktree } from '../types/worktree.js';
import type { WorktreeManager } from '../interfaces/worktree-manager.js';
import { WorktreeError } from '../errors/worktree-error.js';
import { logger } from '../logger.js';

export class WorktreeManagerImpl implements WorktreeManager {
  private readonly repoPath: string;
  private readonly worktreesDir: string;
  private readonly git: SimpleGit;

  constructor(repoPath: string, worktreesDir?: string) {
    this.repoPath = path.resolve(repoPath);
    this.worktreesDir = worktreesDir ?? '.loopy/worktrees';
    this.git = simpleGit(this.repoPath);
  }

  async create(issueNumber: number, slug: string): Promise<Worktree> {
    const branchName = `loopy/${issueNumber}-${slug}`;
    const relativePath = `${this.worktreesDir}/${issueNumber}-${slug}`;
    const absolutePath = path.resolve(this.repoPath, relativePath);

    this.validatePath(absolutePath);

    if (fs.existsSync(absolutePath)) {
      throw new WorktreeError(
        'ALREADY_EXISTS',
        `Worktree path already exists: ${relativePath}`,
      );
    }

    try {
      await this.git.raw([
        'worktree',
        'add',
        '-b',
        branchName,
        absolutePath,
      ]);
    } catch (err) {
      throw new WorktreeError(
        'GIT_ERROR',
        `Failed to create worktree for issue ${issueNumber}`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    await this.symlinkNodeModules(absolutePath);

    const worktree: Worktree = {
      path: absolutePath,
      branch: branchName,
      issueNumber,
      slug,
      createdAt: new Date().toISOString(),
    };

    logger.info({ worktree }, 'Worktree created');
    return worktree;
  }

  private async symlinkNodeModules(worktreePath: string): Promise<void> {
    const mainNodeModules = path.join(this.repoPath, 'node_modules');
    const worktreeNodeModules = path.join(worktreePath, 'node_modules');

    if (!fs.existsSync(mainNodeModules)) {
      logger.warn('No node_modules found in main repo, skipping symlink');
      return;
    }

    const pnpmStorePath = path.join(mainNodeModules, '.pnpm');

    if (!fs.existsSync(pnpmStorePath)) {
      logger.warn('No .pnpm store found, skipping symlink');
      return;
    }

    try {
      fs.mkdirSync(worktreeNodeModules, { recursive: true });
      const symlinkPath = path.join(worktreeNodeModules, '.pnpm');
      const target = path.relative(worktreePath, pnpmStorePath);

      if (fs.existsSync(symlinkPath)) {
        fs.unlinkSync(symlinkPath);
      }

      fs.symlinkSync(target, symlinkPath);
      logger.info({ symlinkPath, target }, 'Symlinked node_modules/.pnpm into worktree');
    } catch (err) {
      logger.warn({ err: String(err) }, 'Failed to symlink node_modules/.pnpm, verifier may fail');
    }
  }

  async remove(worktreePath: string): Promise<void> {
    const absolutePath = path.resolve(worktreePath);

    try {
      await this.git.raw(['worktree', 'remove', absolutePath]);
    } catch (err) {
      throw new WorktreeError(
        'GIT_ERROR',
        `Failed to remove worktree at ${absolutePath}`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    try {
      await this.git.raw(['worktree', 'prune']);
    } catch {
      logger.warn('Failed to prune worktrees after removal');
    }

    logger.info({ path: absolutePath }, 'Worktree removed');
  }

  async list(): Promise<Worktree[]> {
    let output: string;
    try {
      output = await this.git.raw(['worktree', 'list', '--porcelain']);
    } catch (err) {
      throw new WorktreeError(
        'GIT_ERROR',
        'Failed to list worktrees',
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    return this.parseWorktreeList(output);
  }

  async recover(): Promise<void> {
    const isDirty = await this.hasUncommittedChanges();

    if (isDirty) {
      try {
        await this.git.stash();
        logger.info('Stashed dirty changes during recovery');
      } catch (err) {
        throw new WorktreeError(
          'GIT_ERROR',
          'Failed to stash changes during recovery',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    try {
      await this.git.raw(['worktree', 'prune']);
    } catch {
      logger.warn('Failed to prune stale worktrees during recovery');
    }

    try {
      await this.git.fetch();
      const branch = await this.getCurrentBranch(this.repoPath);
      await this.git.raw(['merge', '--ff-only', `origin/${branch}`]);
      logger.info({ branch }, 'Fast-forwarded main branch');
    } catch (err) {
      throw new WorktreeError(
        'GIT_ERROR',
        'Failed to fast-forward main branch during recovery',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  async hasChanges(worktreePath: string, baseBranch: string): Promise<boolean> {
    const worktreeGit = simpleGit(worktreePath);
    const summary = await worktreeGit.diffSummary([baseBranch]);
    return summary.changed > 0;
  }

  async commit(worktreePath: string, message: string): Promise<void> {
    const worktreeGit = simpleGit(worktreePath);
    try {
      await worktreeGit.add('-A');
      await worktreeGit.commit(message);
    } catch (err) {
      throw new WorktreeError(
        'GIT_ERROR',
        `Failed to commit in worktree at ${worktreePath}`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  async push(worktreePath: string): Promise<void> {
    const worktreeGit = simpleGit(worktreePath);
    const branch = await this.getCurrentBranch(worktreePath);
    try {
      await worktreeGit.push(['-u', 'origin', branch]);
    } catch (err) {
      throw new WorktreeError(
        'GIT_ERROR',
        `Failed to push branch ${branch}`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  async getCurrentBranch(worktreePath: string): Promise<string> {
    const worktreeGit = simpleGit(worktreePath);
    try {
      const branch = await worktreeGit.revparse(['--abbrev-ref', 'HEAD']);
      return branch.trim();
    } catch (err) {
      throw new WorktreeError(
        'GIT_ERROR',
        `Failed to get current branch at ${worktreePath}`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  getNodeModulesBin(): string {
    return path.join(this.repoPath, 'node_modules', '.bin');
  }

  private validatePath(absolutePath: string): void {
    const relative = path.relative(this.repoPath, absolutePath);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new WorktreeError(
        'INVALID_PATH',
        `Path escapes repository root: ${absolutePath}`,
      );
    }
  }

  private parseWorktreeList(output: string): Worktree[] {
    const worktrees: Worktree[] = [];
    const entries = output.trim().split('\n\n');

    for (const entry of entries) {
      if (!entry.trim()) continue;

      const lines = entry.split('\n');
      let wtPath = '';
      let branch = '';

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wtPath = line.slice('worktree '.length);
        } else if (line.startsWith('branch ')) {
          branch = line.slice('branch '.length);
          if (branch.startsWith('refs/heads/')) {
            branch = branch.slice('refs/heads/'.length);
          }
        }
      }

      if (!wtPath || !branch.startsWith('loopy/')) continue;

      const match = branch.match(/^loopy\/(\d+)-(.+)$/);
      if (!match) continue;

      worktrees.push({
        path: wtPath,
        branch,
        issueNumber: Number(match[1]),
        slug: match[2],
        createdAt: '',
      });
    }

    return worktrees;
  }

  private async hasUncommittedChanges(): Promise<boolean> {
    try {
      const status = await this.git.status();
      return !status.isClean();
    } catch {
      return false;
    }
  }
}
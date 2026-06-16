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

    try {
      if (fs.existsSync(worktreeNodeModules)) {
        fs.rmSync(worktreeNodeModules, { recursive: true, force: true });
      }
      fs.mkdirSync(worktreeNodeModules, { recursive: true });

      const pnpmPath = path.join(worktreeNodeModules, '.pnpm');
      const pnpmTarget = path.relative(worktreeNodeModules, path.join(mainNodeModules, '.pnpm'));
      fs.symlinkSync(pnpmTarget, pnpmPath);

      const binPath = path.join(worktreeNodeModules, '.bin');
      const binTarget = path.relative(worktreeNodeModules, path.join(mainNodeModules, '.bin'));
      fs.symlinkSync(binTarget, binPath);

      const loopyWorktree = path.join(worktreeNodeModules, '@loopy');
      if (fs.existsSync(loopyWorktree)) {
        fs.rmSync(loopyWorktree, { recursive: true, force: true });
      }
      fs.mkdirSync(loopyWorktree, { recursive: true });

      const loopyPackagesMain = path.join(mainNodeModules, '.pnpm', 'node_modules', '@loopy');
      if (fs.existsSync(loopyPackagesMain)) {
        for (const entry of fs.readdirSync(loopyPackagesMain)) {
          const src = path.join(loopyPackagesMain, entry);
          const dst = path.join(loopyWorktree, entry);
          fs.symlinkSync(path.relative(loopyWorktree, src), dst);
        }
      }

      for (const entry of fs.readdirSync(mainNodeModules)) {
        if (entry.startsWith('.') || entry === '@loopy') continue;
        const src = path.join(mainNodeModules, entry);
        const dst = path.join(worktreeNodeModules, entry);
        const stat = fs.lstatSync(src);
        if (!stat.isSymbolicLink()) continue;
        if (fs.existsSync(dst)) fs.unlinkSync(dst);
        fs.symlinkSync(path.relative(worktreeNodeModules, src), dst);
      }

      logger.info({}, 'Setup worktree node_modules with symlinks');
    } catch (err) {
      logger.warn({ err: String(err) }, 'Failed to setup node_modules symlinks');
    }

    this.copyDistIntoWorktree(worktreePath);
  }

  private copyDistIntoWorktree(worktreePath: string): void {
    try {
      const dirs = ['packages', 'apps'];
      for (const dir of dirs) {
        const mainDir = path.join(this.repoPath, dir);
        if (!fs.existsSync(mainDir)) continue;

        for (const entry of fs.readdirSync(mainDir)) {
          const mainDist = path.join(mainDir, entry, 'dist');
          const worktreeDist = path.join(worktreePath, dir, entry, 'dist');

          if (fs.existsSync(mainDist)) {
            fs.mkdirSync(path.dirname(worktreeDist), { recursive: true });
            this.copyRecursiveSync(mainDist, worktreeDist);
            logger.info({ src: mainDist, dst: worktreeDist }, 'Copied dist into worktree');
          }
        }
      }
    } catch (err) {
      logger.warn({ err: String(err) }, 'Failed to copy dist directories into worktree');
    }
  }

  private copyRecursiveSync(src: string, dst: string): void {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      for (const entry of fs.readdirSync(src)) {
        this.copyRecursiveSync(path.join(src, entry), path.join(dst, entry));
      }
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
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
import type { Worktree } from '../types/index.js';

export interface WorktreeManager {
  create(issueNumber: number, slug: string): Promise<Worktree>;
  remove(path: string): Promise<void>;
  list(): Promise<Worktree[]>;
  recover(): Promise<void>;
  hasChanges(path: string, baseBranch: string): Promise<boolean>;
  commit(path: string, message: string): Promise<void>;
  push(path: string): Promise<void>;
  getCurrentBranch(path: string): Promise<string>;
}
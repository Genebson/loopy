import { LoopyError } from './base.js';

export class WorktreeError extends LoopyError {
  constructor(userMessage: string, cause?: Error) {
    super('WORKTREE_ERROR', userMessage, cause);
    this.name = 'WorktreeError';
  }
}
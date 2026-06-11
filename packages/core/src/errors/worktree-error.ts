import { LoopyError } from './base.js';

export type WorktreeErrorCode =
  | 'ALREADY_EXISTS'
  | 'INVALID_PATH'
  | 'GIT_ERROR'
  | 'NOT_FOUND';

export class WorktreeError extends LoopyError {
  constructor(code: WorktreeErrorCode, userMessage: string, cause?: Error) {
    super(code, userMessage, cause);
    this.name = 'WorktreeError';
  }
}
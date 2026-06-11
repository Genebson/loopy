import { LoopyError } from './base.js';

export type VerifierErrorCode =
  | 'COMMAND_NOT_FOUND'
  | 'SPAWN_ERROR'
  | 'TIMEOUT';

export class VerifierError extends LoopyError {
  constructor(code: VerifierErrorCode, userMessage: string, cause?: Error) {
    super(code, userMessage, cause);
    this.name = 'VerifierError';
  }
}
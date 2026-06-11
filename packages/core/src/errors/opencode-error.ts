import { LoopyError } from './base.js';

export class OpenCodeError extends LoopyError {
  constructor(userMessage: string, cause?: Error) {
    super('OPENCODE_ERROR', userMessage, cause);
    this.name = 'OpenCodeError';
  }
}
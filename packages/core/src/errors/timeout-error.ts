import { LoopyError } from './base.js';

export class TimeoutError extends LoopyError {
  constructor(userMessage: string, cause?: Error) {
    super('TIMEOUT', userMessage, cause);
    this.name = 'TimeoutError';
  }
}
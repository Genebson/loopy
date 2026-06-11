import { LoopyError } from './base.js';

export class GHAPIError extends LoopyError {
  constructor(userMessage: string, cause?: Error) {
    super('GH_API_ERROR', userMessage, cause);
    this.name = 'GHAPIError';
  }
}
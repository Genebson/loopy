import { LoopyError } from './base.js';

export class VerifierError extends LoopyError {
  constructor(userMessage: string, cause?: Error) {
    super('VERIFIER_ERROR', userMessage, cause);
    this.name = 'VerifierError';
  }
}
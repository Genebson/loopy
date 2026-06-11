import { LoopyError } from './base.js';

export class ConfigError extends LoopyError {
  constructor(userMessage: string, cause?: Error) {
    super('CONFIG_ERROR', userMessage, cause);
    this.name = 'ConfigError';
  }
}
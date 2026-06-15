import { LoopyError } from './base.js';

export type OpenCodeErrorCode =
  | 'CONNECTION_REFUSED'
  | 'SESSION_TIMEOUT'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ERROR'
  | 'PERMISSION_DENIED'
  | 'SERVER_ERROR'
  | 'UNKNOWN'
  | 'OPENCODE_ERROR';

export class OpenCodeError extends LoopyError {
  constructor(code: OpenCodeErrorCode, userMessage: string, cause?: Error) {
    super(code, userMessage, cause);
    this.name = 'OpenCodeError';
  }
}
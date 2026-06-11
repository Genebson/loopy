import { describe, it, expect } from 'vitest';
import { LoopyError, ConfigError, GHAPIError, OpenCodeError, WorktreeError, VerifierError, TimeoutError } from './index.js';
import type { WorktreeErrorCode } from './worktree-error.js';

describe('LoopyError hierarchy', () => {
  it('LoopyError has code and userMessage', () => {
    const err = new LoopyError('TEST', 'test message');
    expect(err.code).toBe('TEST');
    expect(err.userMessage).toBe('test message');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LoopyError);
  });

  it('LoopyError toJSON returns structured data', () => {
    const err = new LoopyError('TEST', 'test message');
    expect(err.toJSON()).toEqual({
      name: 'LoopyError',
      code: 'TEST',
      message: 'test message',
      cause: null,
    });
  });

  it('LoopyError toJSON includes cause message', () => {
    const cause = new Error('root cause');
    const err = new LoopyError('TEST', 'test message', cause);
    expect(err.toJSON().cause).toBe('root cause');
  });

  it('ConfigError extends LoopyError', () => {
    const err = new ConfigError('bad config');
    expect(err.code).toBe('CONFIG_ERROR');
    expect(err.userMessage).toBe('bad config');
    expect(err).toBeInstanceOf(LoopyError);
    expect(err).toBeInstanceOf(ConfigError);
  });

  it('GHAPIError extends LoopyError', () => {
    const err = new GHAPIError('gh failed');
    expect(err.code).toBe('GH_API_ERROR');
    expect(err).toBeInstanceOf(LoopyError);
  });

  it('OpenCodeError extends LoopyError with code', () => {
    const err = new OpenCodeError('CONNECTION_REFUSED', 'opencode failed');
    expect(err.code).toBe('CONNECTION_REFUSED');
    expect(err.userMessage).toBe('opencode failed');
    expect(err).toBeInstanceOf(LoopyError);
  });

  it('OpenCodeError defaults to OPENCODE_ERROR code', () => {
    const err = new OpenCodeError('OPENCODE_ERROR', 'generic error');
    expect(err.code).toBe('OPENCODE_ERROR');
  });

  it('WorktreeError extends LoopyError with code', () => {
    const err = new WorktreeError('ALREADY_EXISTS', 'worktree exists');
    expect(err.code).toBe('ALREADY_EXISTS');
    expect(err.userMessage).toBe('worktree exists');
    expect(err).toBeInstanceOf(LoopyError);
    expect(err).toBeInstanceOf(WorktreeError);
  });

  it('WorktreeError accepts all error codes', () => {
    const codes: WorktreeErrorCode[] = ['ALREADY_EXISTS', 'INVALID_PATH', 'GIT_ERROR', 'NOT_FOUND'];
    for (const code of codes) {
      const err = new WorktreeError(code, `test ${code}`);
      expect(err.code).toBe(code);
    }
  });

  it('VerifierError extends LoopyError', () => {
    const err = new VerifierError('verify failed');
    expect(err.code).toBe('VERIFIER_ERROR');
    expect(err).toBeInstanceOf(LoopyError);
  });

  it('TimeoutError extends LoopyError', () => {
    const err = new TimeoutError('timed out');
    expect(err.code).toBe('TIMEOUT');
    expect(err).toBeInstanceOf(LoopyError);
  });
});
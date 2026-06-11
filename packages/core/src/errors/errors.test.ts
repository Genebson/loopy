import { describe, it, expect } from 'vitest';
import { LoopyError, ConfigError, GHAPIError, OpenCodeError, WorktreeError, VerifierError, TimeoutError } from './index.js';

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

  it('OpenCodeError extends LoopyError', () => {
    const err = new OpenCodeError('opencode failed');
    expect(err.code).toBe('OPENCODE_ERROR');
    expect(err).toBeInstanceOf(LoopyError);
  });

  it('WorktreeError extends LoopyError', () => {
    const err = new WorktreeError('wt failed');
    expect(err.code).toBe('WORKTREE_ERROR');
    expect(err).toBeInstanceOf(LoopyError);
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
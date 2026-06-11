import { describe, it, expect } from 'vitest';
import { loopyConfigSchema } from './schema.js';

describe('loopyConfigSchema', () => {
  const validConfig = {
    project: { owner: 'test-org', number: 1 },
    columns: {
      ready: 'Ready',
      inProgress: 'In Progress',
      inReview: 'In Review',
      done: 'Done',
      blocked: 'Blocked',
    },
    verifier: { command: 'pnpm test' },
  };

  it('validates a valid config with defaults', () => {
    const result = loopyConfigSchema.parse(validConfig);
    expect(result.project).toEqual({ owner: 'test-org', number: 1 });
    expect(result.retries).toBe(3);
    expect(result.concurrency).toBe(1);
    expect(result.pollInterval).toBe(60_000);
    expect(result.opencode.url).toBe('http://localhost:4096');
    expect(result.opencode.autoApprove).toBe(true);
    expect(result.opencode.spawn).toBe(false);
    expect(result.worktree.cleanup).toBe(false);
    expect(result.verifier.timeout).toBe(600_000);
  });

  it('validates a valid config with project ID', () => {
    const result = loopyConfigSchema.parse({
      ...validConfig,
      project: { id: 'PVT_abc123' },
    });
    expect(result.project).toEqual({ id: 'PVT_abc123' });
  });

  it('rejects config missing required verifier.command', () => {
    const { command: _, ...noCommand } = validConfig.verifier;
    expect(() =>
      loopyConfigSchema.parse({ ...validConfig, verifier: noCommand })
    ).toThrow();
  });

  it('rejects config with negative retries', () => {
    expect(() =>
      loopyConfigSchema.parse({ ...validConfig, retries: -1 })
    ).toThrow();
  });

  it('rejects config with invalid opencode URL', () => {
    expect(() =>
      loopyConfigSchema.parse({ ...validConfig, opencode: { url: 'not-a-url' } })
    ).toThrow();
  });
});
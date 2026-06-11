import { describe, it, expect } from 'vitest';
import { loopyConfigSchema, defineConfig } from './config/schema.js';
import { LoopyError, ConfigError, GHAPIError, OpenCodeError, WorktreeError, VerifierError, TimeoutError } from './errors/index.js';

describe('@loopy/core', () => {
  it('exports config schema and defineConfig', () => {
    expect(loopyConfigSchema).toBeDefined();
    expect(defineConfig).toBeTypeOf('function');
  });

  it('exports all error classes', () => {
    expect(LoopyError).toBeDefined();
    expect(ConfigError).toBeDefined();
    expect(GHAPIError).toBeDefined();
    expect(OpenCodeError).toBeDefined();
    expect(WorktreeError).toBeDefined();
    expect(VerifierError).toBeDefined();
    expect(TimeoutError).toBeDefined();
  });
});
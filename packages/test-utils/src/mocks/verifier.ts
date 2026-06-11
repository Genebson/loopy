import { vi } from 'vitest';
import type { VerifierRunner } from '@loopy/core';

type VerifierRunnerMethod = keyof VerifierRunner;

export function createMockVerifierRunner(
  overrides?: Partial<Record<VerifierRunnerMethod, ReturnType<typeof vi.fn>>>,
): Record<VerifierRunnerMethod, ReturnType<typeof vi.fn>> {
  const mock: Record<VerifierRunnerMethod, ReturnType<typeof vi.fn>> = {
    run: vi.fn().mockResolvedValue({
      passed: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 100,
    }),
  };

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (key in mock) {
        mock[key as VerifierRunnerMethod] = value as ReturnType<typeof vi.fn>;
      }
    }
  }

  return mock;
}
import type { VerifierResult } from '../types/index.js';

export interface VerifierRunner {
  run(command: string, cwd: string, env: Record<string, string>, timeoutMs: number): Promise<VerifierResult>;
}
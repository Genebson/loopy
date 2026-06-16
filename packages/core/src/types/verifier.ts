export interface VerifierResult {
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  phase?: 'build' | 'test';
}
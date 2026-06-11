import { describe, it, expect } from 'vitest';
import { VerifierRunnerImpl } from './runner.js';
import { VerifierError } from '../errors/verifier-error.js';

describe('VerifierRunnerImpl', () => {
  const runner = new VerifierRunnerImpl();

  it('returns passed=true for exit code 0', async () => {
    const result = await runner.run('node -e process.exit(0)', process.cwd(), {}, 10_000);
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns passed=false for non-zero exit code', async () => {
    const result = await runner.run('node -e process.exit(1)', process.cwd(), {}, 10_000);
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('captures stdout', async () => {
    const result = await runner.run('node -e process.stdout.write(Buffer.from("hello"))', process.cwd(), {}, 10_000);
    expect(result.stdout).toBe('hello');
  });

  it('captures stderr', async () => {
    const result = await runner.run('node -e process.stderr.write(Buffer.from("err"))', process.cwd(), {}, 10_000);
    expect(result.stderr).toBe('err');
  });

  it('merges provided env over process.env', async () => {
    const result = await runner.run(
      'node -e process.stdout.write(process.env.LOOPY_TEST_VAR)',
      process.cwd(),
      { LOOPY_TEST_VAR: 'fromenv' },
      10_000,
    );
    expect(result.stdout).toBe('fromenv');
  });

  it('throws VerifierError with COMMAND_NOT_FOUND for missing command', async () => {
    try {
      await runner.run('nonexistent_command_12345', process.cwd(), {}, 10_000);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VerifierError);
      expect((err as VerifierError).code).toBe('COMMAND_NOT_FOUND');
    }
  });

  it('returns exitCode -1 on timeout', async () => {
    const result = await runner.run('sleep 10', process.cwd(), {}, 100);
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(-1);
  });

  it('captures partial output before timeout', async () => {
    const result = await runner.run(
      'node -e console.log("partial");setTimeout(function(){},30000)',
      process.cwd(),
      {},
      500,
    );
    expect(result.stdout).toContain('partial');
    expect(result.exitCode).toBe(-1);
  });
});
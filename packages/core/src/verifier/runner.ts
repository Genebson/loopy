import { spawn } from 'node:child_process';
import type { VerifierRunner } from '../interfaces/verifier-runner.js';
import type { VerifierResult } from '../types/verifier.js';
import { VerifierError } from '../errors/verifier-error.js';
import { logger } from '../logger.js';

function parseCommand(command: string): { shell: true; command: string } | { shell: false; binary: string; args: string[] } {
  const hasShellOperators = /[&|;]/.test(command);
  if (hasShellOperators) {
    return { shell: true, command };
  }
  const idx = command.indexOf(' ');
  if (idx === -1) return { shell: false, binary: command, args: [] };
  const binary = command.slice(0, idx);
  const argsStr = command.slice(idx + 1);
  return { shell: false, binary, args: argsStr.split(' ').filter(Boolean) };
}

const MAX_OUTPUT_BYTES = 1_048_576;

function truncateOutput(buffer: Buffer): string {
  if (buffer.length <= MAX_OUTPUT_BYTES) return buffer.toString('utf-8');
  return buffer.toString('utf-8', buffer.length - MAX_OUTPUT_BYTES);
}

export class VerifierRunnerImpl implements VerifierRunner {
  async run(command: string, cwd: string, env: Record<string, string>, timeoutMs: number): Promise<VerifierResult> {
    const parsed = parseCommand(command);
    const mergedEnv = { ...process.env, ...env } as Record<string, string>;

    let binary: string;
    let args: string[];
    let spawnOpts: { cwd: string; env: Record<string, string>; shell?: boolean };

    if (parsed.shell) {
      binary = process.platform === 'win32' ? 'cmd.exe' : 'sh';
      args = process.platform === 'win32' ? ['/c', parsed.command] : ['-c', parsed.command];
      spawnOpts = { cwd, env: mergedEnv };
    } else {
      binary = parsed.binary;
      args = parsed.args;
      spawnOpts = { cwd, env: mergedEnv };
    }

    logger.info({ command, cwd, timeoutMs }, 'verifier.run.start');

    const startTime = Date.now();

    return new Promise<VerifierResult>((resolve, reject) => {
      const child = spawn(binary, args, spawnOpts);

      let stdoutBuf = Buffer.alloc(0);
      let stderrBuf = Buffer.alloc(0);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf = Buffer.concat([stdoutBuf, chunk]);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf = Buffer.concat([stderrBuf, chunk]);
      });

      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
      };

      const settle = (result: VerifierResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        logger.info({ command, exitCode: result.exitCode, passed: result.passed, durationMs: result.durationMs }, 'verifier.run.end');
        resolve(result);
      };

      const settleError = (err: VerifierError) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, 5000);

        const durationMs = Date.now() - startTime;
        settle({
          passed: false,
          exitCode: -1,
          stdout: truncateOutput(stdoutBuf),
          stderr: truncateOutput(stderrBuf),
          durationMs,
        });
      }, timeoutMs);

      child.on('error', (err: Error & { code?: string }) => {
        if (err.code === 'ENOENT') {
          settleError(new VerifierError('COMMAND_NOT_FOUND', `Command not found: ${binary}`, err));
        } else {
          settleError(new VerifierError('SPAWN_ERROR', `Failed to spawn command: ${binary}`, err));
        }
      });

      child.on('close', (exitCode: number | null) => {
        const durationMs = Date.now() - startTime;
        settle({
          passed: exitCode === 0,
          exitCode: exitCode ?? -1,
          stdout: truncateOutput(stdoutBuf),
          stderr: truncateOutput(stderrBuf),
          durationMs,
        });
      });
    });
  }
}

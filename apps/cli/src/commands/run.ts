import { Command } from 'commander';
import chalk from 'chalk';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import { LoopEngine, WorktreeManagerImpl, VerifierRunnerImpl, loopyConfigSchema, ConfigError } from '@loopy/core';
import type { LoopyConfig } from '@loopy/core';
import { GHProjectClient } from '@loopy/gh';
import { OpenCodeHTTPClient } from '@loopy/opencode';
import { createLogger } from '../lib/logger.js';
import { ensureLoopyDirs } from '../lib/setup.js';

const PID_FILE = '.loopy/loopy.pid';

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function checkExistingProcess(): void {
  const pidPath = resolve(PID_FILE);
  if (!existsSync(pidPath)) return;

  const pid = Number.parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
  if (!Number.isNaN(pid) && isProcessRunning(pid)) {
    console.error(chalk.red(`Error: loopy is already running (PID ${pid}). Stop it with \`loopy stop\` or remove ${PID_FILE}.`));
    process.exit(1);
  }

  unlinkSync(pidPath);
}

function writePidFile(): void {
  const pidPath = resolve(PID_FILE);
  const dir = resolve('.loopy');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(pidPath, String(process.pid), 'utf-8');
}

function removePidFile(): void {
  const pidPath = resolve(PID_FILE);
  if (existsSync(pidPath)) {
    unlinkSync(pidPath);
  }
}

function checkGhAuth(): void {
  try {
    execSync('gh auth status', { stdio: 'pipe' });
  } catch {
    console.error(chalk.red('Error: gh CLI not authenticated. Run `gh auth login` first.'));
    process.exit(1);
  }
}

async function loadConfig(configPath: string): Promise<LoopyConfig> {
  const absolutePath = resolve(configPath);
  if (!existsSync(absolutePath)) {
    throw new ConfigError(`loopy.config.ts not found at ${absolutePath}. Run \`loopy init\` first.`);
  }

  const jiti = createJiti(pathToFileURL(resolve('.')).href, { interopDefault: true });
  const configModule = await jiti.import(absolutePath);
  const raw = (configModule as Record<string, unknown>).default ?? configModule;
  return loopyConfigSchema.parse(raw);
}

export const runCommand = new Command('run')
  .description('Start the loop engine')
  .option('--spawn', 'Auto-start opencode serve if not running')
  .option('--config-path <path>', 'Path to loopy.config.ts', 'loopy.config.ts')
  .option('--once', 'Run a single iteration and exit')
  .option('--verbose', 'Enable debug logging')
  .option('--card <number>', 'Process a specific card by issue number', (val) => Number.parseInt(val, 10))
  .option('--cards <numbers...>', 'Process specific cards by issue numbers', (value: string, previous: number[] = []) => [...previous, Number.parseInt(value, 10)])
  .option('--retry <number>', 'Retry a blocked card by issue number', (val) => Number.parseInt(val, 10))
  .addHelpText(
    'after',
    `
Examples:
  $ loopy run
  $ loopy run --once --verbose
  $ loopy run --spawn
  $ loopy run --card 42
  $ loopy run --cards 42 41 40
  $ loopy run --retry 35`,
  )
  .action(async (options: {
    spawn?: boolean;
    configPath: string;
    once?: boolean;
    verbose?: boolean;
    card?: number;
    cards?: number[];
    retry?: number;
  }) => {
    console.log(chalk.cyan('loopy v0.1.0 — Loop Engineering, locally'));

    ensureLoopyDirs();
    createLogger({ verbose: options.verbose, logDir: '.loopy/logs' });

    checkExistingProcess();
    writePidFile();

    try {
      checkGhAuth();

      const config = await loadConfig(options.configPath);

      if (options.verbose) {
        process.env.LOOPY_LOG_LEVEL = 'debug';
      }

      if (options.spawn) {
        const child = spawn('opencode', ['serve'], { detached: true, stdio: 'ignore' });
        child.unref();
        console.log(chalk.gray('Started opencode serve'));
      }

      const ghClient = new GHProjectClient();
      const opencodeClient = new OpenCodeHTTPClient(config.opencode.url, { autoApprove: config.opencode.autoApprove });
      const worktreeManager = new WorktreeManagerImpl(process.cwd());
      const verifierRunner = new VerifierRunnerImpl();

      const engine = new LoopEngine(
        ghClient,
        opencodeClient,
        worktreeManager,
        verifierRunner,
        config,
        '.loopy/state',
      );

      if (options.retry !== undefined) {
        await engine.retryBlockedCard(options.retry);
        console.log(chalk.green(`Card #${options.retry} has been retried`));
        return;
      }

      const controller = new AbortController();

      const onSignal = () => {
        console.log(chalk.yellow('\nReceived stop signal, aborting...'));
        controller.abort();
      };

      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);

      if (options.once) {
        const onceController = new AbortController();

        const targetIssueNumbers = options.cards ?? (options.card !== undefined ? [options.card] : undefined);
        const runPromise = engine.run(onceController.signal, targetIssueNumbers);

        const timeout = setTimeout(() => {
          onceController.abort();
        }, 300_000);

        await runPromise.catch(() => { void 0; });
        clearTimeout(timeout);

        controller.abort();
      } else {
        const targetIssueNumbers = options.cards ?? (options.card !== undefined ? [options.card] : undefined);
        await engine.run(controller.signal, targetIssueNumbers);
      }

      console.log(chalk.green('Loop stopped gracefully'));
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error(chalk.red(`Error: ${err.userMessage}`));
      } else if (err instanceof Error) {
        console.error(chalk.red(`Error: ${err.message}. Run \`loopy doctor\` to diagnose setup issues.`));
      } else {
        console.error(chalk.red('An unexpected error occurred. Run `loopy doctor` to check your setup.'));
      }
      process.exitCode = 1;
    } finally {
      removePidFile();
    }
  });
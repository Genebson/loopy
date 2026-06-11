import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import { loopyConfigSchema } from '@loopy/core';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

async function check(
  name: string,
  fn: () => Promise<boolean> | boolean,
  errorMsg: string,
): Promise<CheckResult> {
  try {
    const ok = await fn();
    return { name, status: ok ? 'pass' : 'fail', message: ok ? 'OK' : errorMsg };
  } catch (err) {
    return {
      name,
      status: 'fail',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export const doctorCommand = new Command('doctor')
  .description('Diagnose loopy setup and dependencies')
  .option('--config-path <path>', 'Path to loopy.config.ts', 'loopy.config.ts')
  .addHelpText(
    'after',
    `
Examples:
  $ loopy doctor
  $ loopy doctor --config-path ./my-config.ts`,
  )
  .action(async (options: { configPath: string }) => {
    const results: CheckResult[] = [];

    results.push(
      await check('gh CLI installed', () => {
        try {
          execSync('gh --version', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      }, 'gh CLI not found. Install from https://cli.github.com'),
    );

    results.push(
      await check('gh authenticated', () => {
        try {
          execSync('gh auth status', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      }, 'gh not authenticated. Run: gh auth login'),
    );

    results.push(
      await check('git installed', () => {
        try {
          execSync('git --version', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      }, 'git not found. Install from https://git-scm.com'),
    );

    const configPath = resolve(options.configPath);
    const configExists = existsSync(configPath);
    results.push({
      name: 'loopy.config.ts exists',
      status: configExists ? 'pass' : 'fail',
      message: configExists
        ? `Found at ${configPath}`
        : `Not found at ${configPath}. Run: loopy init`,
    });

    if (configExists) {
      results.push(
        await check('Config valid', async () => {
          try {
            const jiti = createJiti(pathToFileURL(resolve('.')).href, {
              interopDefault: true,
            });
            const configModule = await jiti.import(configPath);
            const raw =
              (configModule as Record<string, unknown>).default ?? configModule;
            loopyConfigSchema.parse(raw);
            return true;
          } catch {
            return false;
          }
        }, 'Config has validation errors. Check your loopy.config.ts against the schema.'),
      );
    }

    const loopyDir = resolve('.loopy');
    let writable = false;
    try {
      if (!existsSync(loopyDir)) {
        mkdirSync(loopyDir, { recursive: true });
      }
      const testFile = resolve(loopyDir, '.write-test');
      writeFileSync(testFile, 'test');
      unlinkSync(testFile);
      writable = true;
    } catch {
      writable = false;
    }
    results.push({
      name: '.loopy/ writable',
      status: writable ? 'pass' : 'fail',
      message: writable
        ? 'OK'
        : `Cannot write to ${loopyDir}. Check permissions or run: chmod 755 .loopy`,
    });

    if (configExists) {
      results.push(
        await check('opencode reachable', async () => {
          try {
            const jiti = createJiti(pathToFileURL(resolve('.')).href, {
              interopDefault: true,
            });
            const configModule = await jiti.import(configPath);
            const raw =
              (configModule as Record<string, unknown>).default ?? configModule;
            const config = loopyConfigSchema.parse(raw);
            const response = await fetch(`${config.opencode.url}/api/session`, {
              method: 'GET',
              signal: AbortSignal.timeout(3000),
            });
            return response.status < 500;
          } catch {
            return false;
          }
        }, 'opencode server unreachable. Start it with: opencode serve'),
      );
    }

    console.log(chalk.bold('\nloopy doctor\n'));
    for (const r of results) {
      const icon = r.status === 'pass' ? chalk.green('\u2713') : chalk.red('\u2717');
      console.log(`  ${icon} ${chalk.bold(r.name)} ${chalk.gray(r.status.toUpperCase())}`);
      if (r.status !== 'pass') {
        console.log(`    ${chalk.gray(r.message)}`);
      }
    }

    const failed = results.filter((r) => r.status === 'fail');
    if (failed.length > 0) {
      console.log(
        chalk.red(`\n${failed.length} check(s) failed. See messages above for fixes.`),
      );
      process.exitCode = 1;
    } else {
      console.log(chalk.green('\nAll checks passed.'));
    }
  });
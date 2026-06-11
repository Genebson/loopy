import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import { resolve } from 'node:path';

const PID_FILE = '.loopy/loopy.pid';

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

export const stopCommand = new Command('stop')
  .description('Stop a running loopy process')
  .addHelpText(
    'after',
    `
Examples:
  $ loopy stop`,
  )
  .action(async () => {
    const pidPath = resolve(PID_FILE);

    if (!fs.existsSync(pidPath)) {
      console.log(chalk.yellow('No running loopy process found.'));
      return;
    }

    const pidStr = fs.readFileSync(pidPath, 'utf-8').trim();
    const pid = Number.parseInt(pidStr, 10);

    if (Number.isNaN(pid)) {
      console.log(chalk.yellow('Stale PID file. Removing.'));
      fs.unlinkSync(pidPath);
      return;
    }

    if (!isProcessRunning(pid)) {
      console.log(chalk.yellow('Stale PID file. Removing.'));
      fs.unlinkSync(pidPath);
      return;
    }

    process.kill(pid, 'SIGTERM');
    console.log(chalk.green(`Sent stop signal to PID ${pid}`));

    const exited = await waitForExit(pid, 10_000);

    if (!exited) {
      console.log(chalk.yellow(`Process ${pid} did not exit within 10s. You may need to kill it manually.`));
    }
  });
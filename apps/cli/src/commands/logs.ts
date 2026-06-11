import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import { resolve } from 'node:path';

interface LogEntry {
  level?: number;
  time?: number;
  msg?: string;
  [key: string]: unknown;
}

function formatLevel(level: number | undefined): string {
  if (level === undefined) return chalk.gray('UNKNOWN');
  if (level === 20) return chalk.gray('DEBUG');
  if (level === 30) return chalk.cyan('INFO');
  if (level === 40) return chalk.yellow('WARN');
  if (level === 50) return chalk.red('ERROR');
  if (level === 60) return chalk.red('FATAL');
  return chalk.gray(`L${level}`);
}

function formatLine(line: string): string {
  try {
    const entry: LogEntry = JSON.parse(line);
    const time = entry.time
      ? new Date(entry.time).toLocaleString()
      : '';
    const level = formatLevel(entry.level);
    const msg = entry.msg ?? '';
    const extra = Object.entries(entry)
      .filter(
        ([k]) =>
          !['level', 'time', 'msg', 'pid', 'hostname', 'name'].includes(k),
      )
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    return `${chalk.gray(time)} ${level} ${msg}${extra ? chalk.gray(' ' + extra) : ''}`;
  } catch {
    return line;
  }
}

export const logsCommand = new Command('logs')
  .description('View loopy event logs')
  .option('--follow', 'Follow new log entries as they are written')
  .option('--lines <n>', 'Number of lines to show (default 50)', '50')
  .addHelpText(
    'after',
    `
Examples:
  $ loopy logs
  $ loopy logs --lines 100
  $ loopy logs --follow`,
  )
  .action((options: { follow?: boolean; lines?: string }) => {
    const logFile = resolve('.loopy/logs/events.log');
    const lines = Number.parseInt(options.lines ?? '50', 10);

    if (!fs.existsSync(logFile)) {
      console.error(
        chalk.yellow(
          `No log file found at ${logFile}. Run \`loopy run\` first to generate logs.`,
        ),
      );
      process.exit(1);
    }

    const content = fs.readFileSync(logFile, 'utf-8');
    const allLines = content
      .trim()
      .split('\n')
      .filter(Boolean);
    const tail = allLines.slice(-lines);

    for (const line of tail) {
      console.log(formatLine(line));
    }

    if (options.follow) {
      console.log(chalk.gray('\nFollowing (Ctrl+C to stop)...\n'));
      let lastSize = fs.statSync(logFile).size;
      const interval = setInterval(() => {
        try {
          const currentSize = fs.statSync(logFile).size;
          if (currentSize > lastSize) {
            const fd = fs.openSync(logFile, 'r');
            const buffer = Buffer.alloc(currentSize - lastSize);
            fs.readSync(fd, buffer, 0, buffer.length, lastSize);
            fs.closeSync(fd);
            const newContent = buffer.toString('utf-8');
            for (const newLine of newContent
              .trim()
              .split('\n')
              .filter(Boolean)) {
              console.log(formatLine(newLine));
            }
            lastSize = currentSize;
          }
        } catch {
          void 0;
        }
      }, 1000);

      process.on('SIGINT', () => {
        clearInterval(interval);
        console.log(chalk.gray('\nStopped following.'));
        process.exit(0);
      });
    }
  });
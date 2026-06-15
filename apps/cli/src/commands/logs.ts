import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import { resolve } from 'node:path';

interface LogEntry {
  level?: number;
  time?: number;
  msg?: string;
  card?: number;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<string, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

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

function filterEntries(
  entries: LogEntry[],
  opts: {
    level?: string;
    card?: number;
    since?: number;
    search?: string;
  },
): LogEntry[] {
  return entries.filter((entry) => {
    if (opts.level !== undefined) {
      const targetLevel = LOG_LEVELS[opts.level];
      if (entry.level !== targetLevel) return false;
    }

    if (opts.card !== undefined) {
      if (entry.card !== opts.card) return false;
    }

    if (opts.since !== undefined) {
      if (!entry.time || entry.time < opts.since) return false;
    }

    if (opts.search !== undefined) {
      const msg = entry.msg ?? '';
      if (!msg.toLowerCase().includes(opts.search.toLowerCase())) return false;
    }

    return true;
  });
}

export const logsCommand = new Command('logs')
  .description('View loopy event logs')
  .option('--follow', 'Follow new log entries as they are written')
  .option('--lines <n>', 'Number of lines to show (default 50)', '50')
  .option('--level <info|warn|debug|error>', 'Filter by log level')
  .option('--card <number>', 'Filter by card issue number', (n) => Number.parseInt(n, 10))
  .option('--since <timestamp>', 'Filter entries after timestamp (ISO 8601 or Unix ms)', (s) => {
    const parsed = Date.parse(s);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid timestamp: ${s}. Use ISO 8601 or Unix milliseconds.`);
    }
    return parsed;
  })
  .option('--search <query>', 'Search for text in log messages')
  .option('--json', 'Output raw JSON for piping to jq')
  .addHelpText(
    'after',
    `
Examples:
  $ loopy logs
  $ loopy logs --lines 100
  $ loopy logs --follow
  $ loopy logs --level error
  $ loopy logs --card 42
  $ loopy logs --since "2024-01-01T00:00:00Z"
  $ loopy logs --search "verification failed"
  $ loopy logs --json | jq '.level == 50'`,
  )
  .action(async (options: {
    follow?: boolean;
    lines?: string;
    level?: string;
    card?: number;
    since?: number;
    search?: string;
    json?: boolean;
  }) => {
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
    const allLines = content.trim().split('\n').filter(Boolean);

    const entries: LogEntry[] = [];
    for (const line of allLines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        void 0;
      }
    }

    const filtered = filterEntries(entries, {
      level: options.level,
      card: options.card,
      since: options.since,
      search: options.search,
    });

    const tail = filtered.slice(-lines);

    for (const entry of tail) {
      if (options.json) {
        console.log(JSON.stringify(entry));
      } else {
        console.log(formatLine(JSON.stringify(entry)));
      }
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
            for (const line of newContent.trim().split('\n').filter(Boolean)) {
              let entry: LogEntry;
              try {
                entry = JSON.parse(line);
              } catch {
                continue;
              }

              const matches = filterEntries([entry], {
                level: options.level,
                card: options.card,
                since: options.since,
                search: options.search,
              });

              if (matches.length > 0) {
                if (options.json) {
                  console.log(JSON.stringify(entry));
                } else {
                  console.log(formatLine(line));
                }
              }
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
import pino from 'pino';
import fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { TransportTargetOptions } from 'pino';

let currentLogger: pino.Logger | null = null;

export function createLogger(opts: { verbose?: boolean; logDir?: string }): pino.Logger {
  const level = opts.verbose ? 'debug' : 'info';

  const targets: TransportTargetOptions[] = [];

  targets.push({
    target: 'pino-pretty',
    level,
    options: { colorize: true },
  });

  if (opts.logDir) {
    const logFile = resolve(opts.logDir, 'events.log');
    const dir = dirname(logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    targets.push({
      target: 'pino/file',
      level,
      options: { destination: logFile, mkdir: true },
    });
  }

  currentLogger = pino({
    level,
    name: 'loopy',
  }, pino.transport({ targets }));

  return currentLogger;
}

export function getLogger(): pino.Logger {
  if (!currentLogger) {
    currentLogger = pino({ level: 'info', name: 'loopy' });
  }
  return currentLogger;
}
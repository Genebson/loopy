import pino from 'pino';

export const logger = pino({
  name: 'loopy',
  level: process.env.LOOPY_LOG_LEVEL ?? 'info',
});
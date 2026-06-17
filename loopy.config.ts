import { defineConfig } from '@loopy/core';

export default defineConfig({
  project: { owner: 'Genebson', number: 1 },
  columns: {
    ready: 'Ready',
    inProgress: 'In progress',
    inReview: 'In review',
    done: 'Done',
    blocked: 'Backlog',
  },
  verifier: {
    command: 'pnpm test && pnpm lint',
    timeout: 600000,
    build: {
      command: 'pnpm build',
      timeout: 300000,
      skipIfUnchanged: false,
    },
  },
  retries: 3,
});

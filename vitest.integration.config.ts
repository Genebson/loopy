import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@loopy/core': path.resolve(__dirname, 'packages/core/dist/esm/index.js'),
      '@loopy/test-utils': path.resolve(__dirname, 'packages/test-utils/dist/esm/index.js'),
    },
  },
  server: {
    deps: {
      inline: ['@loopy/core', 'pino'],
    },
  },
});
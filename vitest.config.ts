import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'].map(glob => ({
      extends: true,
      test: {
        include: [`${glob}/src/**/*.test.ts`],
      },
    })),
  },
});
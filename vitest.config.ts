import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/index.ts',
        '**/types/**',
        '**/dist/**',
        '**/node_modules/**',
        '**/tests/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/vitest.config.ts',
        '**/tsup.config.ts',
        'coverage/**',
      ],
    },
  },
});

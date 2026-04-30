import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@reaatech/session-continuity': path.resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['src/types/**', 'src/index.ts', 'src/*/index.ts'],
      thresholds: {
        lines: 90,
        functions: 85,
        branches: 85,
        statements: 90,
      },
    },
  },
});

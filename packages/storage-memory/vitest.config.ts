import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@reaatech/session-continuity': path.resolve(__dirname, '../core/src/index.ts'),
    },
  },
  test: {
    globals: true,
  },
});

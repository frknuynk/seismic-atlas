import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    name: 'node',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/browser/**', 'tests/worker/**', 'tests/e2e/**'],
  },
});

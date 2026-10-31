import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      './vitest.node.config.ts',
      './vitest.worker.config.ts',
      './vitest.browser.config.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: [
        'app/api/**/*.{ts,tsx}',
        'components/atlas/**/*.{ts,tsx}',
        'hooks/**/*.{ts,tsx}',
        'lib/**/*.ts',
        'worker/**/*.ts',
        'db/index.ts',
      ],
      exclude: ['**/*.d.ts', 'db/schema.ts'],
      reportOnFailure: true,
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 65,
        branches: 60,
      },
    },
  },
});

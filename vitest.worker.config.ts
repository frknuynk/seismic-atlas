import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
process.env.WRANGLER_WRITE_LOGS = 'false';
process.env.WRANGLER_LOG_PATH = path.join(root, '.wrangler', 'logs');
process.env.MINIFLARE_REGISTRY_PATH = path.join(root, '.wrangler', 'registry');

export default defineConfig({
  resolve: {
    alias: {
      '@': root,
      'vinext/server/fetch-handler': path.join(
        root,
        'tests/worker/vinext-handler-stub.ts',
      ),
    },
  },
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: path.join(root, 'wrangler.test.jsonc') },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(root, 'migrations'),
          ),
        },
      },
    })),
  ],
  test: {
    name: 'worker',
    include: ['tests/worker/**/*.worker.test.ts'],
    setupFiles: ['./tests/worker/setup.worker.ts'],
  },
});

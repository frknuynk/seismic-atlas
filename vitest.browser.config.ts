import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  plugins: [react()],
  test: {
    name: 'browser',
    include: ['tests/browser/**/*.browser.test.tsx'],
    setupFiles: ['./tests/browser/setup.browser.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [
        { browser: 'chromium', viewport: { width: 390, height: 844 } },
      ],
    },
  },
});

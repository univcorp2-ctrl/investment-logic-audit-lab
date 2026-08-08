import { defineConfig } from '@playwright/test';

const production = process.env.E2E_SUITE === 'production';
export default defineConfig({
  testDir: './e2e',
  testMatch: production
    ? ['**/production-parameter-control.spec.mjs']
    : ['**/parameter-control.spec.mjs', '**/parameter-center.spec.mjs', '**/security-detail-mobile-flow.spec.mjs', '**/security-detail-news.spec.mjs'],
  testIgnore: ['**/production-parameter-control.spec.mjs'],
  timeout: production ? 60_000 : 45_000,
  expect: { timeout: production ? 15_000 : 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { outputFolder: production ? 'playwright-report-production' : 'playwright-report', open:'never' }]],
  use: {
    baseURL: production ? 'https://valuescope-japan.pages.dev' : 'http://127.0.0.1:4173',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: production ? undefined : { command:'node e2e-server.mjs', url:'http://127.0.0.1:4173', reuseExistingServer:!process.env.CI, timeout:120_000 },
  outputDir: production ? 'test-results-production' : 'test-results',
});

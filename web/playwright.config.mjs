import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:'./e2e',
  timeout:60_000,
  expect:{timeout:12_000},
  fullyParallel:false,
  workers:1,
  reporter:[['list'],['html',{outputFolder:'playwright-report',open:'never'}]],
  use:{
    baseURL:'http://127.0.0.1:4173',
    browserName:'chromium',
    screenshot:'only-on-failure',
    video:'retain-on-failure',
    trace:'retain-on-failure',
  },
  webServer:{
    command:'npm run build && node scripts/serve.mjs',
    url:'http://127.0.0.1:4173',
    reuseExistingServer:true,
    timeout:120_000,
  },
});

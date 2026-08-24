import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'https://inventrak-admin.onrender.com',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  // No webServer — we're testing the live site
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});

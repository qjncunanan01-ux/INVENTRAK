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
  //
  // The visual-regression spec is excluded on purpose. It replays recorded API
  // responses and compares against committed baselines, neither of which says
  // anything about the deployed site; and because this config has no
  // snapshotPathTemplate, running it here wrote the captures into Playwright's
  // DEFAULT directory (e2e/visual-regression.spec.js-snapshots/*-chromium-win32.png)
  // instead of the tracked e2e/__snapshots__/ — which is where a second,
  // permanently stale set of "baselines" came from. Functional specs only.
  testIgnore: ['**/visual-regression.spec.js'],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});

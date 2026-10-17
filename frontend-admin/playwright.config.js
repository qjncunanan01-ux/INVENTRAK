import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    // Visual regression: consistent viewport for screenshot comparisons
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    // Rendering pins for the screenshot comparisons in
    // e2e/visual-regression.spec.js. The spec itself pins the context options
    // (locale, timezone, reduced motion); these are the Chromium-side knobs and
    // have to be set at launch:
    //   · srgb colour profile — otherwise the compositor tints the capture
    //   · no font hinting / no LCD subpixel text — glyph rasterisation is
    //     per-machine and per-font otherwise
    //   · --disable-gpu — the login page's ShaderGradient background then paints
    //     on the software rasterizer (SwiftShader) everywhere instead of
    //     whatever GPU the machine has
    //   · --hide-scrollbars — a scrollbar is a rendering difference too
    launchOptions: {
      args: [
        '--force-color-profile=srgb',
        '--font-render-hinting=none',
        '--disable-lcd-text',
        '--disable-gpu',
        '--hide-scrollbars',
      ],
    },
  },
  webServer: {
    command: 'npx vite preview --port 4173',
    port: 4173,
    reuseExistingServer: true,
    timeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  // Snapshot directory for visual regression baselines
  snapshotDir: './e2e/__snapshots__',
  snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}',
});

// @ts-check
import { test, expect } from '@playwright/test';
import {
  PINNED_NOW,
  attachApiRecorder,
  installApiStub,
  loadFixtures,
  saveFixtures,
} from './visual-fixtures';

// VISUAL REGRESSION — why this file is built the way it is
//
// These tests compare pixels against e2e/__snapshots__/. A pixel comparison is
// only meaningful if everything except the code is held still, and this suite
// was not doing that. The baselines were committed on 2026-08-24 and had been
// failing ever since, for two unrelated reasons:
//
// 1. THEY WERE STALE. The admin app grew between then and now (the dashboard is
//    2432px tall in the baseline and 2994px today: new KPI cards, the Activity
//    row, the formula banners, the section-folder refactor). No rendering trick
//    fixes that — the baselines simply had to be regenerated.
//
// 2. THEY COULD NEVER HAVE STAYED GREEN. Every input the page renders was free
//    to change between two runs:
//
//    · Fonts — the theme asks for `Inter, sans-serif` and nothing ever loaded
//      Inter, so text rendered in whatever the OS supplied (Arial here, real
//      Inter on a machine that happened to have it, DejaVu on Linux). Different
//      metrics, different line breaks, different pixels. Fixed by self-hosting
//      Inter (src/index.css + public/fonts/), which also makes the intended
//      typeface real.
//    · The login background — a WebGL shader animating forever, so two captures
//      of the same page seconds apart already differed. Under
//      `prefers-reduced-motion` it now renders the static gradient and never
//      starts a canvas at all. Pausing it was not enough: a frozen WebGL frame
//      is still a frame of WHATEVER MOMENT the scene initialised in, and two
//      page loads were measured settling ~55% of pixels apart. With the canvas
//      gone the capture is a CSS gradient, which is identical everywhere.
//    · Motion in general — anime.js KPI counters, framer-motion entrance
//      effects and recharts chart animations all paint different frames
//      depending on timing, so a baseline could even be captured mid-animation.
//      `page.emulateMedia({ reducedMotion: 'reduce' })` (in beforeEach) plus
//      MotionConfig in App.jsx and the counter's own check make those static;
//      the helpers here additionally wait for the region's text to stop
//      changing before capturing. The `reducedMotion` option in test.use()
//      below is NOT what did it — see the note in beforeEach.
//    · The clock — the dashboard prints "Updated <time>" and the range presets
//      build their date range from today, so the page changed every second and
//      every month. `page.clock.setFixedTime` freezes both.
//    · The data — the suite used to run against a live, mutable backend, so one
//      sale booked in the demo console rewrote "Total Sales" and failed the
//      dashboard snapshots with nothing wrong in the code. The API is now
//      REPLAYED from e2e/fixtures/visual-api.json (recorded from a seeded
//      backend; see visual-fixtures.js). The suite no longer needs a backend at
//      all, and a request with no recorded answer fails the test loudly.
//    · Locale/timezone — number and date formatting came from the machine.
//      Pinned below.
//    · Chrome rendering — colour profile, font hinting and LCD text differ per
//      machine; the launch flags in playwright.config.js pin them. (There is no
//      WebGL frame left to pin: the only shader is the login background, and
//      the suite always runs with reduced motion.)
//
// Regenerate the baselines after an intentional UI change (always against a
// fresh build — `vite preview` serves build/, so a stale bundle would encode
// the old UI):
//
//   npm run build
//   npx playwright test visual-regression --update-snapshots
//   npm run test:visual            # then prove the regenerated set is green
//
// These baselines were generated on Windows. Font rasterisation still differs
// per OS even with the launch flags above, so a Linux/macOS runner should
// regenerate its own set (`--update-snapshots` there) rather than expect these
// pixels to match; snapshotPathTemplate deliberately omits {platform}, so a
// second OS would otherwise overwrite this set in place.
//
// Re-record the API fixtures (needs the backend running with its demo data):
//
//   cd ../backend && npm run seed && npm start
//   npm run test:visual:record
//
// The build stamp in the sidebar is masked rather than compared: its date comes
// from the build, and a baseline that depends on which day someone ran `vite
// build` fails every midnight. Its presence and shape are asserted instead.

const RECORD = process.env.VISUAL_RECORD === '1';

// Deterministic run environment. Context-level options live here; the browser
// launch flags (colour profile, hinting, software GL) are in playwright.config.js
// because launchOptions is a browser-level setting.
test.use({
  locale: 'en-US',
  timezoneId: 'Asia/Manila',
  colorScheme: 'light',
  reducedMotion: 'reduce',
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});

// Small on purpose: with the clock, fonts, motion and API pinned this run is
// byte-identical between executions, so any real change should fail. 200 pixels
// of slack absorbs stray anti-aliasing on a rounded corner.
const THRESHOLD = { maxDiffPixels: 200 };

let responses = {};
/** API calls the replay had no answer for — asserted empty after each test. */
const missing = [];
/** In record mode, the in-flight response reads (awaited before saving). */
const pending = [];
/** In record mode, the recorder for this test (drained in afterEach). */
let recorder = null;

test.beforeAll(() => {
  // Load on BOTH paths, and in record mode that is load-bearing: Playwright runs
  // afterAll once per worker PROCESS, and a retry after a failure starts a new
  // one. Each process only knows the responses IT saw, so starting empty and
  // saving at the end made the last worker overwrite the recording with its own
  // subset — observed as "Recorded 13", then "Recorded 12", then "Recorded 14"
  // in one run, with `GET /api/stock-lots` and the wrong-password 401 missing
  // from the file the suite then replayed. Starting from disk makes each save a
  // merge of everything recorded so far.
  responses = loadFixtures({ allowMissing: RECORD });
});

test.beforeEach(async ({ page }) => {
  missing.length = 0;
  // Apply `prefers-reduced-motion` EXPLICITLY, before the app boots.
  //
  // The `reducedMotion: 'reduce'` in test.use() above is NOT enough on
  // Playwright 1.62.1: with it set, a page in this suite still reported
  // `matchMedia('(prefers-reduced-motion: reduce)').matches === false`, and the
  // login page rendered its WebGL shader instead of the static gradient — the
  // single biggest source of baseline drift (a shader frame depends on when the
  // scene initialised, so two loads settled ~55% of pixels apart).
  // `page.emulateMedia` is verified to take effect; the option above stays so
  // the intent is documented and starts working again if the context option is
  // fixed. Do not remove this call because the option "already" covers it.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Freeze Date.now()/new Date() before the app boots: the dashboard's "Updated
  // <time>" caption and the range presets' ?from/?to both derive from it.
  await page.clock.setFixedTime(PINNED_NOW);
  if (RECORD) recorder = attachApiRecorder(page, responses, pending);
  else await installApiStub(page, responses, missing);
});

test.afterEach(async () => {
  // Let requests that outlived the assertions finish while the page is still
  // open, or the recording silently loses endpoints (see visual-fixtures.js).
  if (RECORD && recorder) await recorder.idle();
  recorder = null;
  expect(
    missing,
    'No recorded API response for the call(s) above.\nRe-record the fixtures against a seeded backend: npm run test:visual:record',
  ).toEqual([]);
});

test.afterAll(async () => {
  if (!RECORD) return;
  await Promise.all(pending);
  const saved = saveFixtures(responses);
  // eslint-disable-next-line no-console
  console.log(`Recorded ${Object.keys(responses).length} API responses into ${saved}`);
});

/**
 * Compare against the baseline — except in record mode, where the page is
 * showing live data rather than the recording, so there is nothing meaningful
 * to compare and the run's only job is to collect responses.
 */
async function snap(target, name, options = {}) {
  if (RECORD) return;
  // `target` is either a Page or a Locator; only a Locator exposes .page().
  const page = typeof target.page === 'function' ? target.page() : target;
  // The capture contains glyphs, so it must contain the SAME glyphs every run.
  // `toHaveScreenshot` retries until two frames match, which does not help if
  // both were painted before the woff2 finished loading — the swap lands after
  // the capture and the baseline encodes the fallback metrics. Waiting on
  // document.fonts is the one signal that actually means "the typeface is on
  // screen", and it is cheap once a page has loaded.
  await page.evaluate(() => (document.fonts ? document.fonts.ready : undefined));
  await expect(target).toHaveScreenshot(name, options);
}

/** The sidebar's build stamp is a build artifact, not a design decision. */
function masks(page) {
  return [page.getByTestId('build-stamp')];
}

/**
 * Wait until a region stops changing. The screenshot itself retries until two
 * frames match, but that can still catch the first frame of a slow animation —
 * this waits for the chart/counter text to be identical twice in a row first.
 */
async function waitForStableText(page, locator) {
  let previous = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const text = await locator.innerText().catch(() => null);
    if (text != null && text === previous) return;
    previous = text;
    await page.waitForTimeout(120);
  }
  throw new Error('region never stopped changing — something on it animates forever');
}

async function gotoLogin(page) {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/');
  await expect(page.getByText('INVENTRAK Admin')).toBeVisible({ timeout: 15_000 });
}

async function loginAsOwner(page) {
  await gotoLogin(page);
  await page.getByRole('button', { name: /fill owner/i }).click();
  await page.getByRole('button', { name: /login/i }).click();
  await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible({ timeout: 15_000 });
}

/**
 * The dashboard has rendered its data when no card is still showing the loading
 * placeholder — StatCard publishes "<label>: loading." in its aria-label until
 * the numbers arrive, which is a precise signal (a missing fixture leaves them
 * loading and this fails rather than snapping a skeleton).
 */
async function dashboardReady(page) {
  await expect(page.getByTestId('overview-kpis')).toBeVisible();
  await expect(page.locator('[aria-label$="loading."]')).toHaveCount(0, { timeout: 20_000 });
  await waitForStableText(page, page.getByTestId('overview-kpis'));
}

test.describe('Visual Regression — Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLogin(page);
  });

  // NOTE on `fullPage: false` for every login snapshot: the page's decorative
  // background is `position: fixed; inset: 0`, and a full-page capture has to
  // scroll/expand the viewport to reach below the fold. Whether the fixed
  // gradient is then painted over the viewport or over the whole expanded
  // document depends on how Chromium performs that expansion — measured: one
  // capture produced a gradient across all 1106px, another stopped it at the
  // 667px viewport and showed the body colour below, 43% of pixels apart. A
  // viewport capture has no such ambiguity, and the whole sign-in card fits in
  // the viewport at both sizes, so nothing under test is lost.
  test('login page — full view', async ({ page }) => {
    await snap(page, 'login-page.png', { fullPage: false, ...THRESHOLD });
  });

  test('login page — credentials expanded', async ({ page }) => {
    await page.getByText('Show demo credentials').click();
    // Wait for the list itself rather than a fixed delay.
    await expect(page.getByText(/owner \/ owner123/)).toBeVisible();
    await snap(page, 'login-page-credentials.png', { fullPage: false, ...THRESHOLD });
  });

  test('login page — error state', async ({ page }) => {
    await page.getByRole('button', { name: /fill owner/i }).click();
    await page.getByRole('textbox', { name: 'Password' }).fill('wrongpassword');
    await page.getByRole('button', { name: /login/i }).click();
    await expect(page.getByText(/invalid username or password/i)).toBeVisible({ timeout: 10_000 });
    await snap(page, 'login-page-error.png', { fullPage: false, ...THRESHOLD });
  });
});

test.describe('Visual Regression — Dashboard', () => {
  test('dashboard — full view with KPI cards', async ({ page }) => {
    await loginAsOwner(page);
    await dashboardReady(page);
    await snap(page, 'dashboard-full.png', { fullPage: true, mask: masks(page), ...THRESHOLD });
  });

  test('dashboard — KPI cards row', async ({ page }) => {
    await loginAsOwner(page);
    await dashboardReady(page);
    await snap(page.getByTestId('overview-kpis'), 'dashboard-kpi-cards.png', THRESHOLD);
  });

  test('dashboard — charts section', async ({ page }) => {
    await loginAsOwner(page);
    await dashboardReady(page);
    const section = page.getByTestId('inventory-analytics');
    await expect(section).toBeVisible({ timeout: 15_000 });
    // recharts animates its bars in; wait for the section to hold still.
    await waitForStableText(page, section);
    await snap(section, 'dashboard-charts.png', THRESHOLD);
  });

  test('dashboard — modal detail view', async ({ page }) => {
    await loginAsOwner(page);
    await dashboardReady(page);
    await page.getByRole('button', { name: /total products/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await waitForStableText(page, dialog);
    await snap(dialog, 'dashboard-modal.png', THRESHOLD);
  });
});

test.describe('Visual Regression — Navigation', () => {
  test('sidebar — expanded state', async ({ page }) => {
    await loginAsOwner(page);
    // No `if (isVisible())` guard: a sidebar that has gone missing has to fail
    // this test, not silently pass it.
    const sidebar = page.getByTestId('admin-sidebar');
    await expect(sidebar).toBeVisible();
    await snap(sidebar, 'sidebar-expanded.png', { mask: masks(page), ...THRESHOLD });
  });

  test('sidebar — collapsed state', async ({ page }) => {
    await loginAsOwner(page);
    await page.getByRole('button', { name: /collapse sidebar/i }).click();
    const sidebar = page.getByTestId('admin-sidebar');
    // The rail is 76px wide instead of 280px; wait for the width transition to
    // land rather than guessing a delay.
    await expect(sidebar).toHaveCSS('width', '76px');
    await snap(sidebar, 'sidebar-collapsed.png', { mask: masks(page), ...THRESHOLD });
  });

  test('sidebar — build stamps name the bundle and the API', async ({ page }) => {
    await loginAsOwner(page);
    const stamp = page.getByTestId('build-stamp');
    await expect(stamp).toBeVisible();
    // "UI <date> (<commit>)" from the bundle, "API <commit>" from GET /api/meta.
    // Asserted as text because the baseline masks this block (see the file
    // header) — the value is a build artifact, its content is still covered.
    await expect(stamp).toContainText(/UI \d{4}-\d{2}-\d{2}/);
    await expect(stamp).not.toContainText(/API (…|offline)/);
  });

  test('top bar — badge names the signed-in role', async ({ page }) => {
    await loginAsOwner(page);
    const badge = page.getByTestId('role-badge');
    await expect(badge).toBeVisible();
    // The old version of this test looked for the literal text "ADMIN" while
    // logging in as OWNER, so it asserted the wrong role. Assert the role that
    // actually signed in.
    await expect(badge).toHaveText('OWNER');
    await snap(badge, 'owner-role-badge.png', THRESHOLD);
  });
});

test.describe('Visual Regression — Products Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
    await page.getByRole('link', { name: /products/i }).click();
    await page.waitForURL('**/products', { timeout: 10_000 });
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[aria-label$="loading."]')).toHaveCount(0, { timeout: 20_000 });
  });

  test('products page — table view', async ({ page }) => {
    await snap(page, 'products-page.png', { fullPage: false, mask: masks(page), ...THRESHOLD });
  });

  test('products page — edit form', async ({ page }) => {
    const editBtn = page.getByRole('button', { name: /edit/i }).first();
    // Asserted, not skipped: the API is replayed, so "the edit button is not
    // there today" is a result, not an excuse.
    await expect(editBtn).toBeVisible({ timeout: 15_000 });
    await editBtn.click();
    await snap(page, 'products-edit-form.png', { fullPage: false, mask: masks(page), ...THRESHOLD });
  });
});

test.describe('Visual Regression — Inventory Page', () => {
  test('inventory page — table view', async ({ page }) => {
    await loginAsOwner(page);
    await page.getByRole('link', { name: /inventory levels/i }).click();
    await page.waitForURL('**/inventory', { timeout: 10_000 });
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[aria-label$="loading."]')).toHaveCount(0, { timeout: 20_000 });
    await snap(page, 'inventory-page.png', { fullPage: false, mask: masks(page), ...THRESHOLD });
  });
});

test.describe('Visual Regression — Responsive', () => {
  test('login page — mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoLogin(page);
    await snap(page, 'login-page-mobile.png', { fullPage: false, ...THRESHOLD });
  });

  test('dashboard — tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginAsOwner(page);
    await dashboardReady(page);
    // At 768px the sidebar is hidden (MUI md is 900px), so no build-stamp mask.
    await snap(page, 'dashboard-tablet.png', THRESHOLD);
  });
});

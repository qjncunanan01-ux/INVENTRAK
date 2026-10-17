// @ts-check
import fs from 'node:fs';
import path from 'node:path';

// Record/replay helpers for the visual-regression suite.
//
// WHY THIS EXISTS
// The screenshots in e2e/__snapshots__/ are pixel comparisons, so everything on
// the page has to be reproducible: the code (that is what we want to test) plus
// every input the code renders — the API answers, the clock, the fonts. Running
// against a live backend meant the baselines drifted with demo data: one sale
// recorded in the admin console changed "Total Sales" and broke the dashboard
// snapshots, with nothing wrong in the code. So the visual specs replay a
// RECORDED set of API responses instead. Same reasoning as the note in
// admin-ledgers.spec.js ("assertions stay structural … they do not depend on
// demo rows"), applied to pixels.
//
// Recording is a deliberate, occasional act: start the backend with its demo
// data, then `npm run test:visual:record` (see e2e/visual-record.mjs). That run
// drives the same flows as the normal suite but saves every /api/ response into
// e2e/fixtures/visual-api.json instead of comparing screenshots.

// Resolved against the Playwright working directory, which is the package root
// when the suite is run through `npx playwright test` or an npm script — the
// same assumption the config's testDir/snapshotDir make.
export const FIXTURE_PATH = path.resolve('e2e/fixtures/visual-api.json');

// The frozen "now" for every visual test (`page.clock.setFixedTime`). Two
// reasons: the dashboard prints a live "Updated <time>" caption (it would differ
// between two runs seconds apart), and the page's range presets derive ?from=/
// ?to= query strings from the current date — which decides which recorded
// response is requested. Pin the clock and both are constant forever.
export const PINNED_NOW = new Date('2026-10-16T09:30:00+08:00');

// A 1x1 PNG for /images/**: product photos are data, not code. Letting them
// load from the API makes the products snapshot depend on whether the API
// happens to be up (photo vs broken-image icon), so every image resolves to the
// same blank pixel in every run instead. The baselines then cover the layout
// around the photo, not the photo.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function loadFixtureFile() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

export function loadFixtures({ allowMissing = false } = {}) {
  if (!fs.existsSync(FIXTURE_PATH)) {
    if (allowMissing) return {};
    throw new Error(
      `No API fixtures at ${FIXTURE_PATH}.\n`
      + 'Record them against a seeded backend first: npm run test:visual:record',
    );
  }
  const file = loadFixtureFile();
  return file.responses;
}

export function saveFixtures(responses, meta = {}) {
  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  const file = {
    note: 'Recorded API responses for e2e/visual-regression.spec.js — generated, do not hand-edit.',
    recorded_at: new Date().toISOString(),
    pinned_now: PINNED_NOW.toISOString(),
    ...meta,
    responses,
  };
  // Compact on purpose: some bodies are whole product catalogues, and a
  // pretty-printed file of them is tens of thousands of lines.
  fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(file)}\n`);
  return FIXTURE_PATH;
}

// One key per request. The body is part of it because the login endpoint
// answers differently for the same URL depending on the password sent (the
// error-state snapshot needs the 401), and query parameters are sorted so the
// key does not depend on the order the app happened to build them in.
export function fixtureKey(request) {
  const url = new URL(request.url());
  const query = [...url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const body = request.postData() || '';
  return `${request.method()} ${url.pathname}${query ? `?${query}` : ''}${body ? ` ${body}` : ''}`;
}

// Headers that would corrupt a replayed body: the recorded text is already
// decoded, so re-announcing gzip (or a stale length) breaks the response.
const UNREPLAYABLE = ['content-encoding', 'content-length', 'transfer-encoding'];

function replayHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (!UNREPLAYABLE.includes(key.toLowerCase())) out[key] = value;
  }
  return out;
}

/**
 * Serve every /api/ request from the recording. A request with no recorded
 * answer is pushed to `missing` (the spec fails the test on it) and answered
 * with a 503, so a new endpoint shows up as an explicit "re-record" error
 * instead of a silently half-empty page.
 */
export async function installApiStub(page, responses, missing) {
  await page.route('**/api/**', async (route) => {
    const key = fixtureKey(route.request());
    const hit = responses[key];
    if (!hit) {
      missing.push(key);
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'no recorded response', key }),
      });
      return;
    }
    await route.fulfill({ status: hit.status, headers: replayHeaders(hit.headers), body: hit.body });
  });

  await page.route('**/images/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: PLACEHOLDER_PNG,
  }));
}

/**
 * Record mode: keep every /api/ response the page receives.
 *
 * Existing entries are OVERWRITTEN on purpose. A re-recording exists to move the
 * data on (new demo catalogue, changed payload shape), so keeping the old body
 * for a key the run just saw would silently pin stale data — the opposite of
 * what `npm run test:visual:record` is for.
 */
export function attachApiRecorder(page, responses, pending) {
  // In-flight /api/ requests. A test's assertions can all pass while a request
  // is still on the wire (the Inventory page fires /api/stock-lots for its
  // Best-before column and renders the table without waiting for it), and the
  // page is closed at the end of the test — so the response never arrives and
  // the endpoint is silently absent from the recording. Recipes recorded that
  // way replay as "no recorded response" failures later. The spec drains this
  // before its worker saves; `idle()` is the handle it waits on.
  const inflight = new Set();
  const isApi = (request) => {
    try {
      return new URL(request.url()).pathname.startsWith('/api/');
    } catch {
      return false;
    }
  };
  page.on('request', (request) => {
    if (isApi(request)) inflight.add(request);
  });
  const settle = (request) => inflight.delete(request);
  page.on('requestfinished', settle);
  page.on('requestfailed', settle);

  page.on('response', (res) => {
    let url;
    try {
      url = new URL(res.url());
    } catch {
      return;
    }
    if (!url.pathname.startsWith('/api/')) return;

    const key = fixtureKey(res.request());

    // res.text() is async and the test can finish first, so the spec awaits
    // `pending` before saving.
    pending.push(
      res.text().then((body) => {
        responses[key] = { status: res.status(), headers: res.headers(), body };
      }).catch(() => {}),
    );
  });

  return {
    /** Wait (bounded) until no /api/ request is still in flight. */
    async idle(timeoutMs = 15_000) {
      const started = Date.now();
      while (inflight.size > 0 && Date.now() - started < timeoutMs) {
        await new Promise((resolve) => { setTimeout(resolve, 50); });
      }
      if (inflight.size > 0) {
        throw new Error(
          `${inflight.size} API request(s) still in flight after ${timeoutMs}ms: `
          + [...inflight].map((r) => `${r.method()} ${r.url()}`).join(', '),
        );
      }
    },
  };
}

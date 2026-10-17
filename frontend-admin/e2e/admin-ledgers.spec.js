// @ts-check
import { test, expect } from '@playwright/test';

// The admin ledgers added for the checklist gaps — Notifications, Unit
// Conversions, Back Orders, Backup & Restore — plus the correction-request
// controls in the Approvals queue.
//
// Why a browser test and not only the vitest suite: the unit tests read the
// source and assert structure, so they pass for a page that is wired into the
// sidebar but throws the moment it renders, or that calls an endpoint the
// backend does not serve. This drives the real app bundle against the real API
// (npm run start in backend/), which is the only way to see that the page
// actually loads its data.
//
// Assertions stay structural (headings, controls, table presence) rather than
// value-based, so they do not depend on demo rows that other suites or real use
// may have changed.

// The API the preview bundle talks to (vite.config.js falls back to :4001).
// page.request resolves relative URLs against the PREVIEW server, so API
// calls made from the test itself have to be absolute.
const API = process.env.E2E_API_URL || 'http://localhost:4001';

async function adminAuth(page) {
  const token = await page.evaluate(() => sessionStorage.getItem('inventrak_token'));
  return { Authorization: `Bearer ${token}` };
}

async function loginAsAdmin(page) {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/');
  await page.waitForSelector('text=INVENTRAK Admin', { timeout: 15_000 });
  await page.getByRole('button', { name: /fill admin/i }).click();
  await page.getByRole('button', { name: /login/i }).click();
  await page.waitForURL('**/', { timeout: 15_000 });
  await expect(page.getByText('Admin Dashboard')).toBeVisible();
}

// The sidebar entry must exist AND must navigate: a nav item whose route is
// missing renders a page the router does not know, which is exactly the
// regression the app's structural tests cannot see.
async function openLedger(page, label, heading) {
  await page.getByRole('link', { name: new RegExp(label, 'i') }).first().click();
  await expect(page.getByRole('heading', { level: 6, name: heading })).toBeVisible({ timeout: 10_000 });
}

test.describe('Admin ledgers', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('notifications ledger loads its records from the API', async ({ page }) => {
    await openLedger(page, 'Notifications', 'Notification ledger');
    // The table is driven by GET /api/notifications; a failed request would
    // leave the loading row in place forever.
    await expect(page.getByRole('cell', { name: 'Loading…' })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/^Records \(\d+\)$/)).toBeVisible();
  });

  test('unit conversions page offers the catalog form', async ({ page }) => {
    await openLedger(page, 'Unit Conversions', 'Add or update a conversion');
    await expect(page.getByLabel(/from unit/i)).toBeVisible();
    await expect(page.getByLabel(/to unit/i)).toBeVisible();
  });

  test('back orders page loads the ledger', async ({ page }) => {
    await openLedger(page, 'Back Orders', 'Back orders');
    await expect(page.getByRole('cell', { name: 'Loading…' })).toHaveCount(0, { timeout: 15_000 });
  });

  test('a rejection with a note becomes an open correction request', async ({ page }) => {
    // This drives the whole feedback loop through the browser, which needs a
    // pending submission to reject. The queue is legitimately empty on a quiet
    // database, so the test submits one through the API first (as the admin
    // itself, so no extra account is needed) rather than skipping when there
    // happens to be nothing pending.
    const auth = await adminAuth(page);
    const created = await page.request.post(`${API}/api/stock-adjustments`, {
      headers: auth,
      data: { product_id: 1, location_id: 1, new_qty: 5, reason: 'e2e correction loop' },
    });
    expect(created.ok()).toBeTruthy();

    await openLedger(page, 'Approvals', /important transactions/i);

    // The correction note is what turns a rejection into a correction request.
    const note = `E2E recount shelf B ${Date.now()}`;
    const noteField = page.getByLabel(/correction note/i).first();
    await expect(noteField).toBeVisible({ timeout: 15_000 });
    await noteField.fill(note);
    await page.getByRole('button', { name: /reject/i }).first().click();

    // …and the loop closes in the panel below: the instruction is now an open
    // correction request naming what the submitter must fix.
    await expect(page.getByRole('heading', { level: 6, name: /open correction requests/i })).toBeVisible();
    await expect(page.getByText(note)).toBeVisible({ timeout: 15_000 });

    // Close it so the run leaves the ledger as it found it (a rejected
    // adjustment row remains — the ledger is append-only by design).
    const open = await (await page.request.get(`${API}/api/correction-requests?status=open`, { headers: auth })).json();
    const mine = open.find((c) => c.comment === note);
    expect(mine).toBeTruthy();
    const resolved = await page.request.post(`${API}/api/correction-requests/${mine.id}/resolve`, {
      headers: auth,
      data: { status: 'closed' },
    });
    expect(resolved.ok()).toBeTruthy();
  });

  test('backup page reports the live driver and can download a snapshot', async ({ page }) => {
    await openLedger(page, 'Backup & Restore', /database backup and recovery/i);

    // The driver chip comes from GET /api/meta, so it proves the page reached
    // the API rather than rendering its fallback.
    await expect(page.getByText(/this server: sqlite driver/i)).toBeVisible({ timeout: 10_000 });

    // Downloading a snapshot is the whole point of the page: assert the browser
    // really receives a file, and that it is the snapshot envelope.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.getByRole('button', { name: /download snapshot/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^inventrak-backup-.*\.json$/);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const snapshot = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    expect(snapshot.format).toBe('inventrak-backup');
    expect(snapshot.version).toBe(1);
    expect(snapshot.driver).toBe('sqlite');
    expect(Object.keys(snapshot.tables).length).toBeGreaterThan(5);
    expect(snapshot.tables.products.length).toBeGreaterThan(0);
    await expect(page.getByText(/snapshot downloaded/i)).toBeVisible({ timeout: 10_000 });
  });

  test('the restore control refuses a file that is not a snapshot', async ({ page }) => {
    await openLedger(page, 'Backup & Restore', /database backup and recovery/i);

    // A non-snapshot file must be rejected in the browser before any upload, so
    // the destructive path is never reachable with the wrong content.
    await page.setInputFiles('input[type="file"]', {
      name: 'not-a-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ hello: 'world' })),
    });
    await expect(page.getByText(/not an INVENTRAK snapshot/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /restore now/i })).toHaveCount(0);
  });
});

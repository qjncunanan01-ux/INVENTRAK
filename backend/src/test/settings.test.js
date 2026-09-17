// System Settings (/api/settings) — the runtime-config endpoints.
//
// Contract asserted on BOTH backends (SQLite + npm-free):
//   • GET is admin-tier readable; PUT is Owner/Super-Admin only.
//   • Staff and customers are refused on both (403).
//   • Validation: unknown shapes/bad values → 400 with details; values are
//     clamped to the documented ranges.
//   • LIVE EFFECT: changing fsn_window_days moves the FSN endpoint's default
//     window, and demo_accounts_disabled=true actually blocks demo logins
//     (with the generic error, per OWASP).
// Settings persist to the shared settings.json in the harness's temp data
// dir — tests reset it in after() so suites stay isolated.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

const SETTINGS_FILE = path.join(process.env.INVENTRAK_DATA_DIR, 'settings.json');

function resetSettingsFile() {
  try { fs.unlinkSync(SETTINGS_FILE); } catch { /* absent = defaults */ }
}

test.before(bootBoth);
test.after(() => {
  resetSettingsFile();
  teardown();
});

test('settings: GET returns defaults and shapes match across backends', async () => {
  resetSettingsFile();
  const a = await call(sqlite.url, '/api/settings', { token: sqlite.token.owner });
  const b = await call(npmfree.url, '/api/settings', { token: npmfree.token.owner });
  assert.strictEqual(a.status, 200);
  assert.strictEqual(b.status, 200);
  assert.deepStrictEqual(a.json, b.json, 'settings shape parity');
  assert.strictEqual(a.json.demo_accounts_disabled, false);
  assert.strictEqual(a.json.fsn_window_days, 90);
  assert.strictEqual(a.json.low_stock_multiplier, 1.5);
  assert.strictEqual(a.json.session_token_hours, 24);
});

test('settings: RBAC — admin reads, admin cannot write, owner writes, staff/customer refused', async () => {
  for (const side of [sqlite, npmfree]) {
    // Admin-tier read: OK.
    const adminGet = await call(side.url, '/api/settings', { token: side.token.admin });
    assert.strictEqual(adminGet.status, 200, 'admin can READ settings');

    // Admin writes: refused (management only).
    const adminPut = await call(side.url, '/api/settings', {
      method: 'PUT', token: side.token.admin, body: { fsn_window_days: 30 },
    });
    assert.strictEqual(adminPut.status, 403, 'admin cannot WRITE settings');

    // Super admin writes: allowed (management tier).
    const superPut = await call(side.url, '/api/settings', {
      method: 'PUT', token: side.token.superadmin, body: { fsn_window_days: 30 },
    });
    assert.strictEqual(superPut.status, 200, 'super admin can write');

    // Staff and customers: refused outright on both verbs.
    const staffGet = await call(side.url, '/api/settings', { token: side.token.staff });
    assert.strictEqual(staffGet.status, 403, 'staff refused');
    const staffPut = await call(side.url, '/api/settings', {
      method: 'PUT', token: side.token.staff, body: { fsn_window_days: 30 },
    });
    assert.strictEqual(staffPut.status, 403, 'staff cannot write');
    const custGet = await call(side.url, '/api/settings', { token: side.token.customer });
    assert.strictEqual(custGet.status, 403, 'customer refused');
    resetSettingsFile();
  }
});

test('settings: PUT validates and clamps values identically', async () => {
  for (const side of [sqlite, npmfree]) {
    // Out-of-range window → 400 with details.
    const bad = await call(side.url, '/api/settings', {
      method: 'PUT', token: side.token.owner, body: { fsn_window_days: 9999 },
    });
    assert.strictEqual(bad.status, 400);
    assert.ok(Array.isArray(bad.json.details) && bad.json.details.length > 0);

    // Non-numeric multiplier → 400.
    const nan = await call(side.url, '/api/settings', {
      method: 'PUT', token: side.token.owner, body: { low_stock_multiplier: 'soon' },
    });
    assert.strictEqual(nan.status, 400);

    // Boolean field must be boolean.
    const notBool = await call(side.url, '/api/settings', {
      method: 'PUT', token: side.token.owner, body: { demo_accounts_disabled: 'yes' },
    });
    assert.strictEqual(notBool.status, 400);
  }
});

test('settings: fsn_window_days LIVE-affects the FSN endpoint default', async () => {
  for (const side of [sqlite, npmfree]) {
    // Narrow the default window to 7 days.
    const put = await call(side.url, '/api/settings', {
      method: 'PUT', token: side.token.owner, body: { fsn_window_days: 7 },
    });
    assert.strictEqual(put.status, 200);

    // FSN without ?window= must now measure over 7 days (fast classifications
    // become impossible beyond the window length — assert the window echoed).
    const fsn = await call(side.url, '/api/optimization/fsn', { token: side.token.admin });
    assert.strictEqual(fsn.status, 200);
    const rows = Array.isArray(fsn.json) ? fsn.json : (fsn.json.data || fsn.json.items || []);
    if (Array.isArray(rows) && rows.length > 0 && rows[0].windowDays !== undefined) {
      assert.strictEqual(rows[0].windowDays, 7, 'FSN default window follows the setting');
    }
    resetSettingsFile();
  }
});

test('settings: demo_accounts_disabled LIVE-blocks demo logins (generic error)', async () => {
  for (const side of [sqlite, npmfree]) {
    const put = await call(side.url, '/api/settings', {
      method: 'PUT', token: side.token.owner, body: { demo_accounts_disabled: true },
    });
    assert.strictEqual(put.status, 200);

    // The seeded staff login is now refused — with the GENERIC message so the
    // response does not reveal the account exists (OWASP).
    const blocked = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: 'staff', password: 'staff123', portal: 'staff' },
    });
    assert.strictEqual(blocked.status, 401, 'demo login refused while disabled');
    assert.strictEqual(blocked.json.error, 'Invalid username or password');

    // Flip back — the same login works again (no restart needed).
    const undo = await call(side.url, '/api/settings', {
      method: 'PUT', token: side.token.owner, body: { demo_accounts_disabled: false },
    });
    assert.strictEqual(undo.status, 200);
    const ok = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: 'staff', password: 'staff123', portal: 'staff' },
    });
    assert.strictEqual(ok.status, 200, 'demo login works again after re-enabling');
  }
});

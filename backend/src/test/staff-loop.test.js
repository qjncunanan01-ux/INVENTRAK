// The staff → admin adjustment loop, end to end: a staff member submits a
// physical count from the app, the pending request carries WHO submitted it
// (created_by / created_by_id), the admin approval queue surfaces the
// requester, and the eventual decision records both sides of the loop —
// created_by (who counted) and decided_by (who approved/rejected). Locked on
// BOTH backends (SQLite + npm-free/Supabase) so the deployed driver behaves
// identically to the dev one.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

before(async () => {
  await bootBoth();
});

after(() => {
  teardown();
});

describe('staff → admin adjustment loop (submitter identity)', () => {
  test('submission stamps the submitter on the pending request', async () => {
    for (const side of [sqlite, npmfree]) {
      const created = await call(side.url, '/api/stock-adjustments', {
        method: 'POST',
        token: side.token.staff,
        body: { product_id: 1, location_id: 1, new_qty: 321, reason: 'staff-loop: counted by app' },
      });
      assert.strictEqual(created.status, 201, `create on ${side.url}`);

      const list = await call(side.url, '/api/stock-adjustments', { token: side.token.staff });
      assert.strictEqual(list.status, 200);
      const row = (list.json || []).find((r) => r.id === created.json.id);
      assert.ok(row, 'created row is returned by the list endpoint');
      assert.strictEqual(row.created_by, 'staff', 'submitter username stamped');
      assert.ok(row.created_by_id != null, 'submitter id stamped');
    }
  });

  test('the admin approval queue surfaces the requester', async () => {
    for (const side of [sqlite, npmfree]) {
      const appr = await call(side.url, '/api/approvals', { token: side.token.admin });
      assert.strictEqual(appr.status, 200);
      const row = (appr.json.adjustments || []).find((a) => a.reason === 'staff-loop: counted by app');
      assert.ok(row, 'pending adjustment visible in the admin queue');
      assert.strictEqual(row.created_by, 'staff', 'queue shows who counted');
    }
  });

  test('the decision records both sides: who counted, who decided', async () => {
    for (const side of [sqlite, npmfree]) {
      const created = await call(side.url, '/api/stock-adjustments', {
        method: 'POST',
        token: side.token.staff,
        body: { product_id: 1, location_id: 1, new_qty: 322, reason: 'staff-loop: approve path' },
      });
      assert.strictEqual(created.status, 201);

      const decision = await call(side.url, `/api/stock-adjustments/${created.json.id}/approve`, {
        method: 'POST',
        token: side.token.admin,
        body: {},
      });
      assert.strictEqual(decision.status, 200, `approve on ${side.url}`);

      const list = await call(side.url, '/api/stock-adjustments', { token: side.token.admin });
      const row = (list.json || []).find((r) => r.id === created.json.id);
      assert.ok(row, 'decided row still listed');
      assert.strictEqual(row.status, 'approved');
      assert.strictEqual(row.created_by, 'staff', 'submitter preserved through approval');
      assert.strictEqual(row.decided_by, 'admin', 'approver recorded');
    }
  });

  test('customer tokens cannot create adjustments (role wall intact)', async () => {
    for (const side of [sqlite, npmfree]) {
      const denied = await call(side.url, '/api/stock-adjustments', {
        method: 'POST',
        token: side.token.customer,
        body: { product_id: 1, location_id: 1, new_qty: 1 },
      });
      assert.strictEqual(denied.status, 403, `customer blocked on ${side.url}`);
    }
  });
});

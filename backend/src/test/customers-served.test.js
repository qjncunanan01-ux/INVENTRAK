// "Customers served" must count REAL customers — registered customer accounts
// that placed at least one order — not the seeded sales ledger's
// customer_name strings (Juan, Maria, Paolo…), which are walk-in payers who
// do not exist anywhere in the system (the bug the dashboard showed).
//
// Also locks the companion `customers_paid` (distinct payer names, walk-ins
// included) that the Reports page surfaces, and the audit-trail status/limit
// filters shipped alongside it.
//
// Asserted on BOTH backends (SQLite + npm-free JSON driver) per the standard
// dual-backend contract bar.

const assert = require('node:assert');
const test = require('node:test');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

test.before(bootBoth);
test.after(teardown);

async function registerCustomer(side, name) {
  const uname = `csv_${name}_${Math.random().toString(36).slice(2, 8)}`;
  const reg = await call(side.url, '/api/auth/register', {
    method: 'POST',
    body: {
      username: uname,
      password: 'Sup3rSecure!',
      email: `${uname}@example.com`,
      full_name: name,
      phone: '09171234567',
    },
  });
  assert.strictEqual(reg.status, 200, `register must be 200, got ${reg.status}: ${JSON.stringify(reg.json)}`);
  return { token: reg.json.token, user: reg.json.user, uname };
}

// /api/reports carries the snake_case rollup; /api/analytics/summary the flat
// camelCase mirror. Assert both stay in lockstep on every read.
async function summaryOf(side) {
  const reports = await call(side.url, '/api/reports', { token: side.token.admin });
  assert.strictEqual(reports.status, 200);
  const flat = await call(side.url, '/api/analytics/summary', { token: side.token.admin });
  assert.strictEqual(flat.status, 200);
  assert.strictEqual(flat.json.customersServed, reports.json.summary.customers_served, 'flat mirror matches');
  assert.strictEqual(flat.json.customersPaid, reports.json.summary.customers_paid, 'paid mirror matches');
  return reports.json.summary;
}

test('customers_served counts registered customers with orders, never seeded payer names', async () => {
  for (const side of [sqlite, npmfree]) {
    // 0. Seeded names like "Juan" are walk-in payers — they must NOT be
    //    counted even though they appear on sales rows.
    const before = await summaryOf(side);
    const beforeCustomers = before.customers_served;
    assert.ok(Number.isFinite(beforeCustomers));
    assert.ok(before.customers_paid > 0, 'customers_paid should count seeded payer names (sanity)');

    // 1. A fresh registered customer with NO order must NOT raise the count.
    const ghost = await registerCustomer(side, 'Ghost');
    const afterGhost = await summaryOf(side);
    assert.strictEqual(
      afterGhost.customers_served,
      beforeCustomers,
      'registered customer without orders must not be counted'
    );

    // 2. The same customer places an order → count +1.
    const order = await call(side.url, '/api/order-inquiries', {
      method: 'POST',
      token: ghost.token,
      body: {
        customer_name: 'Ghost Customer',
        customer_email: ghost.user.email,
        products: ['Milk x2'],
        estimated_cost: 100,
        notes: 'first order',
      },
    });
    assert.strictEqual(order.status === 200 || order.status === 201, true, 'order create must succeed');
    const afterOrder = await summaryOf(side);
    assert.strictEqual(
      afterOrder.customers_served,
      beforeCustomers + 1,
      'a registered customer with an order counts exactly once'
    );

    // 3. More orders from the SAME account must NOT double-count.
    await call(side.url, '/api/order-inquiries', {
      method: 'POST',
      token: ghost.token,
      body: {
        customer_name: 'Ghost Customer',
        customer_email: ghost.user.email,
        products: ['Milk x1'],
        estimated_cost: 50,
      },
    });
    const afterSecond = await summaryOf(side);
    assert.strictEqual(
      afterSecond.customers_served,
      beforeCustomers + 1,
      'repeat orders must not double-count the customer'
    );

    // 4. Both key names present for every consumer.
    assert.ok(afterSecond.customers_paid >= 1, 'customers_paid counts distinct payer names');
  }
});

test('analytics summary: customersServed follows the same real-customer rule', async () => {
  for (const side of [sqlite, npmfree]) {
    const res = await call(side.url, '/api/analytics/summary', { token: side.token.admin });
    assert.strictEqual(res.status, 200);
    assert.ok(Number.isFinite(res.json.customersServed), `customersServed finite`);
    assert.ok(Number.isFinite(res.json.customersPaid), 'customersPaid exposed for the Reports page');
    // The reports payload carries the snake_case mirrors of the same rule.
    const reports = await call(side.url, '/api/reports', { token: side.token.admin });
    assert.strictEqual(reports.status, 200);
    assert.strictEqual(reports.json.summary.customers_served, res.json.customersServed, 'reports mirror matches');
    assert.strictEqual(reports.json.summary.customers_paid, res.json.customersPaid, 'paid mirror matches');
  }
});

test('audit-trail: status filter, limit and offset work on both backends', async () => {
  for (const side of [sqlite, npmfree]) {
    const base = await call(side.url, '/api/audit-trail', { token: side.token.admin });
    assert.strictEqual(base.status, 200);
    const all = base.json.data;
    assert.ok(Array.isArray(all));

    // limit + offset paginate without losing total.
    const page = await call(side.url, '/api/audit-trail?limit=2&offset=2', { token: side.token.admin });
    assert.strictEqual(page.status, 200);
    assert.ok(page.json.data.length <= 2, 'limit respected');
    assert.strictEqual(page.json.pagination.total, all.length, 'total reflects the unfiltered trail');
    if (all.length > 4) {
      assert.deepStrictEqual(page.json.data[0], all[2], 'offset slices the newest-first list');
    }

    // status filter: the seeded/app events include status details; filter to
    // a lifecycle status and every hit must match.
    const pending = await call(side.url, '/api/audit-trail?status=pending', { token: side.token.admin });
    assert.strictEqual(pending.status, 200);
    for (const e of pending.json.data) {
      const hit =
        (e.details && String(e.details.status).toLowerCase() === 'pending') ||
        (e.event || '').toLowerCase() === 'order.status.pending';
      assert.ok(hit, `status filter must only return pending entries, got ${e.event}`);
    }

    // Invalid params fall back to defaults instead of erroring.
    const weird = await call(side.url, '/api/audit-trail?limit=-5&offset=abc&status=', { token: side.token.admin });
    assert.strictEqual(weird.status, 200);
    assert.ok(Array.isArray(weird.json.data));

    // RBAC: customers can never read the trail.
    const ghost = await registerCustomer(side, 'NoTrail');
    const denied = await call(side.url, '/api/audit-trail', { token: ghost.token });
    assert.strictEqual(denied.status, 403);
  }
});

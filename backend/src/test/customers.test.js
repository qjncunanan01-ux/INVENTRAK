// Customer Records: the business entity behind orders and sales.
//
// The problem this fixes: customer_name was free text repeated on every
// sales row, and name/email/phone were smeared across order_inquiries once per
// order. "This customer's history" was therefore unanswerable — two orders from
// the same person, typed slightly differently, looked like two unrelated people.
//
// These lock the identity rule (customers.js), the resolve-or-create linkage on
// both order submission and sale recording, and the admin-only surface. Locked
// on BOTH backends so the deployed driver behaves identically.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { resolveCustomer, findCustomer, summarize } = require('../customers');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

before(async () => {
  await bootBoth();
});

after(() => {
  teardown();
});

const stamp = () => `customers-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe('customer identity rule (pure)', () => {
  test('one row per real person: the same email reuses the customer', () => {
    const rows = [];
    const a = resolveCustomer(rows, { name: 'Maria Santos', email: 'Maria@Cafe.PH', now: 'T1' });
    assert.ok(a.created);
    const b = resolveCustomer(rows, { name: 'M. Santos', email: 'maria@cafe.ph', now: 'T2' });
    assert.strictEqual(b.created, false, 'case-insensitive email match, no duplicate');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(a.customer, b.customer);
  });

  test('falls back to the name when there is no email', () => {
    const rows = [];
    resolveCustomer(rows, { name: 'Juan Dela Cruz' });
    const again = resolveCustomer(rows, { name: 'juan   dela cruz' });
    assert.strictEqual(rows.length, 1, 'whitespace and case are normalised');
    assert.strictEqual(again.created, false);
  });

  test('a known user_id wins over a conflicting email', () => {
    const rows = [];
    const a = resolveCustomer(rows, { name: 'A', email: 'a@x.com' });
    a.customer.user_id = 7;
    const b = resolveCustomer(rows, { user_id: 7, name: 'B', email: 'b@x.com' });
    assert.strictEqual(rows.length, 1, 'the account identifies the customer regardless of email');
    assert.strictEqual(b.customer, a.customer);
  });

  test('a later order ENRICHES an existing customer without overwriting what is on record', () => {
    const rows = [];
    resolveCustomer(rows, { name: 'Pedro', email: 'pedro@x.com', now: 'T1' });
    const second = resolveCustomer(rows, { name: 'Pedro', contact_number: '0917', address: 'Somewhere', now: 'T2' });
    assert.strictEqual(second.created, false);
    assert.strictEqual(rows[0].contact_number, '0917', 'the missing phone is filled in');
    assert.strictEqual(rows[0].address, 'Somewhere');
    assert.strictEqual(rows[0].updated_at, 'T2', 'touched');
    // A value already on record is the one the business actually took down.
    const third = resolveCustomer(rows, { name: 'Pedro', contact_number: '0999', now: 'T3' });
    assert.strictEqual(third.customer.contact_number, '0917', 'the earliest recorded value wins');
  });

  test('no usable identity creates nothing rather than inventing a customer', () => {
    const rows = [];
    const r = resolveCustomer(rows, {});
    assert.strictEqual(r.customer, null);
    assert.strictEqual(rows.length, 0, 'an unattributable sale must not corrupt customer aggregates');
  });

  test('a malformed email is not stored as an identity', () => {
    const rows = [];
    const r = resolveCustomer(rows, { name: 'Someone', email: 'not-an-email' });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(r.customer.email, null, 'a junk email must not become a unique identity');
  });

  test('summarize aggregates per customer and ignores unlinked rows', () => {
    const rows = [];
    resolveCustomer(rows, { name: 'Buyer A' });
    resolveCustomer(rows, { name: 'Buyer B' });
    rows[0].id = 1;
    rows[1].id = 2;
    const out = summarize(rows, {
      inquiries: [{ customer_id: 1, created_at: '2026-01-02' }, { customer_id: 1, created_at: '2026-03-04' }],
      sales: [{ customer_id: 1, total_amount: 100.5 }, { customer_id: 99, total_amount: 999 }],
    });
    const a = out.find((c) => c.id === 1);
    const b = out.find((c) => c.id === 2);
    assert.strictEqual(a.inquiry_count, 2);
    assert.strictEqual(a.total_spend, 100.5);
    assert.strictEqual(a.last_activity, '2026-03-04');
    assert.strictEqual(b.inquiry_count, 0);
    assert.strictEqual(b.total_spend, 0);
  });

  test('findCustomer is a pure lookup that never creates', () => {
    const rows = [{ id: 3, name: 'Solo', email: 'solo@x.com' }];
    assert.ok(findCustomer(rows, { email: 'SOLO@x.com' }));
    assert.strictEqual(findCustomer(rows, { email: 'nobody@x.com' }), null);
    assert.strictEqual(rows.length, 1);
  });
});

describe('customer linkage end to end (both backends)', () => {
  test('two orders from the same person resolve to ONE customer', async () => {
    for (const side of [sqlite, npmfree]) {
      const tag = stamp();
      const email = `${tag}@cafe.ph`;
      const first = await call(side.url, '/api/order-inquiries', {
        method: 'POST',
        body: {
          customer_name: 'Maria Santos',
          customer_email: email,
          products: [{ name: 'Widget', qty: 1, price: 50 }],
        },
      });
      assert.strictEqual(first.status, 201, `first order on ${side.url}`);

      const second = await call(side.url, '/api/order-inquiries', {
        method: 'POST',
        body: {
          customer_name: 'M. Santos',
          customer_email: email.toUpperCase(),
          products: [{ name: 'Widget', qty: 2, price: 50 }],
        },
      });
      assert.strictEqual(second.status, 201, `second order on ${side.url}`);

      const list = await call(side.url, '/api/customers', { token: side.token.admin });
      assert.strictEqual(list.status, 200);
      const mine = list.json.filter((c) => c.email && c.email.toLowerCase() === email);
      assert.strictEqual(mine.length, 1, `one Customer Record for one person on ${side.url}`);
      assert.strictEqual(mine[0].inquiry_count, 2, 'both orders are attributed to them');
    }
  });

  test('a recorded sale links to the same customer as their orders', async () => {
    for (const side of [sqlite, npmfree]) {
      const tag = stamp();
      const name = `Sale Buyer ${tag}`;
      const sale = await call(side.url, '/api/sales', {
        method: 'POST',
        token: side.token.admin,
        body: { product_id: 1, qty: 2, location_id: 1, customer_name: name },
      });
      assert.strictEqual(sale.status, 201, `sale recorded on ${side.url}`);

      const list = await call(side.url, '/api/customers', { token: side.token.admin });
      const mine = list.json.find((c) => c.name === name);
      assert.ok(mine, `a Customer Record was created for the sale on ${side.url}`);
      assert.ok(Number.isInteger(mine.id), 'the customer has a real id');
      assert.strictEqual(mine.total_spend > 0, true, 'the sale is counted against them');
    }
  });

  test('customer detail returns that person\'s orders and purchases', async () => {
    for (const side of [sqlite, npmfree]) {
      const tag = stamp();
      const name = `History Buyer ${tag}`;
      await call(side.url, '/api/sales', {
        method: 'POST', token: side.token.admin,
        body: { product_id: 1, qty: 1, location_id: 1, customer_name: name },
      });
      const list = await call(side.url, '/api/customers', { token: side.token.admin });
      const mine = list.json.find((c) => c.name === name);
      const detail = await call(side.url, `/api/customers/${mine.id}`, { token: side.token.admin });
      assert.strictEqual(detail.status, 200, `detail on ${side.url}`);
      assert.ok(Array.isArray(detail.json.sales), 'purchase history present');
      assert.ok(detail.json.sales.length >= 1);
      assert.ok(Array.isArray(detail.json.inquiries), 'order history present');
    }
  });

  test('the customer surface is admin-only', async () => {
    for (const side of [sqlite, npmfree]) {
      const asCustomer = await call(side.url, '/api/customers', { token: side.token.customer });
      assert.strictEqual(asCustomer.status, 403, `customer blocked on ${side.url}`);
      const asStaff = await call(side.url, '/api/customers', { token: side.token.staff });
      assert.strictEqual(asStaff.status, 403, `staff blocked on ${side.url}`);
      const anon = await call(side.url, '/api/customers', {});
      assert.ok(anon.status === 401 || anon.status === 403, `anonymous blocked on ${side.url}`);
    }
  });

  test('a guest order (no account) still gets a Customer Record', async () => {
    for (const side of [sqlite, npmfree]) {
      const tag = stamp();
      const created = await call(side.url, '/api/order-inquiries', {
        method: 'POST',
        body: {
          customer_name: `Walk-in ${tag}`,
          customer_email: `walkin-${tag}@cafe.ph`,
          products: [{ name: 'Widget', qty: 1, price: 25 }],
        },
      });
      assert.strictEqual(created.status, 201);
      const list = await call(side.url, '/api/customers', { token: side.token.admin });
      const mine = list.json.find((c) => c.name === `Walk-in ${tag}`);
      assert.ok(mine, `guest order produced a customer on ${side.url}`);
      // A customer record is NOT an account.
      assert.strictEqual(mine.user_id, null, 'no account is implied');
      const asCustomer = await call(side.url, '/api/customers', { token: side.token.customer });
      assert.strictEqual(asCustomer.status, 403, 'and it is not readable by customers');
    }
  });
});
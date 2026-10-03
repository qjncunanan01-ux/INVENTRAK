// Costing Records: the economics of an order inquiry, frozen at submission.
//
// The bug this locks down: an inquiry's estimated_cost is the total the CUSTOMER
// PAYS and it is recomputed from line subtotals, which makes it a function of
// today's catalog. Reprice a product and every past order silently reports a
// different profit. The costing_records row is written once and never rewritten,
// so the figures a customer was quoted stay true forever.
//
// Unit coverage for the math, integration coverage for the snapshot, and — the
// point of the whole feature — an immutability test that reprices the catalog
// and asserts the stored snapshot does not move. Locked on BOTH backends
// (SQLite + npm-free) so the deployed driver behaves identically.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { computeCostingSnapshot } = require('../costing');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

before(async () => {
  await bootBoth();
});

after(() => {
  teardown();
});

describe('costing math', () => {
  const catalog = [
    { id: 1, name: 'Syrup A', cost: 60 },
    { id: 2, name: 'Syrup B', cost: 40 },
  ];

  test('exact basis when every line has a known cost', () => {
    const s = computeCostingSnapshot({
      lines: [
        { id: 1, name: 'Syrup A', qty: 2, price: 100 },
        { id: 2, name: 'Syrup B', qty: 1, price: 80 },
      ],
      products: catalog,
      revenue: 280,
    });
    assert.strictEqual(s.cost_basis, 'exact');
    assert.strictEqual(s.total_cost, 160); // 60*2 + 40*1
    assert.strictEqual(s.total_revenue, 280);
    assert.strictEqual(s.target_quantity, 3);
    assert.strictEqual(s.estimated_profit, 120); // 280 - 160
    assert.strictEqual(s.lines_priced, 2);
    assert.strictEqual(s.lines_total, 2);
  });

  test('cost per cup is total_cost over the summed line quantities', () => {
    const s = computeCostingSnapshot({
      lines: [{ id: 1, name: 'Syrup A', qty: 4, price: 100 }],
      products: catalog,
      revenue: 400,
    });
    assert.strictEqual(s.cost_per_cup, 60); // 240 / 4
    assert.strictEqual(s.target_quantity, 4);
  });

  test('suggested selling price is the revenue needed to hit the target margin', () => {
    const prev = process.env.COSTING_TARGET_MARGIN;
    process.env.COSTING_TARGET_MARGIN = '25';
    try {
      const s = computeCostingSnapshot({
        lines: [{ id: 1, name: 'Syrup A', qty: 1, price: 100 }],
        products: catalog,
        revenue: 100,
      });
      assert.strictEqual(s.margin_percent, 25);
      // 60 / (1 - 0.25) = 80
      assert.strictEqual(s.suggested_selling_price, 80);
      assert.strictEqual(s.estimated_profit, 40); // 100 - 60
    } finally {
      if (prev === undefined) delete process.env.COSTING_TARGET_MARGIN;
      else process.env.COSTING_TARGET_MARGIN = prev;
    }
  });

  test('imputed basis when some lines have no cost, with lines_priced kept honest', () => {
    const s = computeCostingSnapshot({
      lines: [
        { id: 1, name: 'Syrup A', qty: 1, price: 100 },
        { id: 9, name: 'Uncosted Thing', qty: 1, price: 100 },
      ],
      products: catalog,
      revenue: 200,
    });
    assert.strictEqual(s.cost_basis, 'imputed');
    assert.strictEqual(s.lines_priced, 1);
    assert.strictEqual(s.lines_total, 2);
    // Known: 60 cost on 100 revenue. Uncosted revenue 100 charged that same
    // ratio -> 60 + 60 = 120.
    assert.strictEqual(s.total_cost, 120);
  });

  test('no invented numbers when nothing can be costed', () => {
    const s = computeCostingSnapshot({
      lines: [{ id: 42, name: 'Unknown', qty: 2, price: 50 }],
      products: catalog,
      revenue: 100,
    });
    assert.strictEqual(s.cost_basis, 'none');
    assert.strictEqual(s.total_cost, null);
    assert.strictEqual(s.cost_per_cup, null);
    assert.strictEqual(s.estimated_profit, null);
    // Revenue and quantity are always known — they were on the order.
    assert.strictEqual(s.total_revenue, 100);
    assert.strictEqual(s.target_quantity, 2);
  });

  test('reads both the SQLite and the npm-free catalog shape', () => {
    const sqliteShape = computeCostingSnapshot({
      lines: [{ id: 1, name: 'Syrup A', qty: 1, price: 100 }],
      products: [{ id: 1, name: 'Syrup A', cost: 60 }],
      revenue: 100,
    });
    const jsonShape = computeCostingSnapshot({
      lines: [{ id: 1, name: 'Syrup A', qty: 1, price: 100 }],
      products: [{ 'Product Name': 'Syrup A', Cost: 60 }],
      revenue: 100,
    });
    assert.strictEqual(sqliteShape.total_cost, 60);
    assert.strictEqual(jsonShape.total_cost, 60);
  });

  test('a zero cost is a real cost, not a missing one', () => {
    const s = computeCostingSnapshot({
      lines: [{ id: 1, name: 'Syrup A', qty: 2, price: 100 }],
      products: [{ id: 1, name: 'Syrup A', cost: 0 }],
      revenue: 200,
    });
    assert.strictEqual(s.cost_basis, 'exact');
    assert.strictEqual(s.total_cost, 0);
    assert.strictEqual(s.estimated_profit, 200);
  });

  // Regression: Number(null) is 0 and Number('') is 0. Reading an explicitly
  // NULL cost as 0 priced every uncosted product at zero and reported a fake
  // 100% margin. null / undefined / '' must all mean "not costed".
  test('an explicit null cost means not-costed, never zero', () => {
    for (const raw of [null, undefined, '']) {
      const s = computeCostingSnapshot({
        lines: [{ id: 1, name: 'Syrup A', qty: 1, price: 100 }],
        products: [{ id: 1, name: 'Syrup A', cost: raw }],
        revenue: 100,
      });
      assert.strictEqual(s.cost_basis, 'none', `cost ${JSON.stringify(raw)} is not costed`);
      assert.strictEqual(s.total_cost, null);
      assert.strictEqual(s.estimated_profit, null);
    }
    // Same trap in the npm-free JSON shape, where the column is `Cost`.
    const json = computeCostingSnapshot({
      lines: [{ id: 1, name: 'Syrup A', qty: 1, price: 100 }],
      products: [{ 'Product Name': 'Syrup A', Cost: null }],
      revenue: 100,
    });
    assert.strictEqual(json.cost_basis, 'none');
  });
});

describe('costing snapshot on order submission (both backends)', () => {
  const which = (side) => side.label || side.url;
  // Create a costed product, order it, then reprice/re-cost it and prove the
  // stored snapshot does not move.
  async function seedCostedOrder(side) {
    const made = await call(side.url, '/api/products', {
      method: 'POST',
      token: side.token.admin,
      body: { name: `Costing Widget ${Date.now()}`, category: 'Test', price: 100, cost: 60 },
    });
    assert.strictEqual(made.status, 201, `product created on ${side.url}`);
    const productId = made.json.id;

    const ordered = await call(side.url, '/api/order-inquiries', {
      method: 'POST',
      body: {
        customer_name: 'Costing Tester',
        customer_email: 'costing@test.local',
        products: [{ id: productId, name: `Costing Widget ${productId}`, qty: 2, price: 100 }],
      },
    });
    assert.strictEqual(ordered.status, 201, `order submitted on ${side.url}`);
    return { productId, inquiryId: ordered.json.id };
  }

  test('submitting an order freezes its costing snapshot', async () => {
    for (const side of [sqlite, npmfree]) {
      const { inquiryId } = await seedCostedOrder(side);
      const res = await call(side.url, `/api/order-inquiries/${inquiryId}/costing`, {
        token: side.token.admin,
      });
      assert.strictEqual(res.status, 200, `costing readable on ${side.url}`);
      const c = res.json;
      assert.strictEqual(c.inquiry_id, inquiryId);
      assert.strictEqual(c.total_cost, 120); // 60 * 2
      assert.strictEqual(c.total_revenue, 200); // 100 * 2
      assert.strictEqual(c.cost_per_cup, 60); // 120 / 2 units
      assert.strictEqual(c.estimated_profit, 80); // 200 - 120
      assert.strictEqual(c.cost_basis, 'exact', `exact basis on ${which(side)}`);
      assert.strictEqual(c.target_quantity, 2);
      assert.ok(c.computed_at, 'snapshot is timestamped');
    }
  });

  test('repricing the catalog does NOT rewrite history (the point of the table)', async () => {
    for (const side of [sqlite, npmfree]) {
      const { productId, inquiryId } = await seedCostedOrder(side);
      const before = await call(side.url, `/api/order-inquiries/${inquiryId}/costing`, { token: side.token.admin });

      // Change BOTH the selling price and the cost of goods.
      const put = await call(side.url, `/api/products/${productId}`, {
        method: 'PUT',
        token: side.token.admin,
        body: { name: `Costing Widget ${productId}`, category: 'Test', price: 500, cost: 450, status: 'active' },
      });
      assert.strictEqual(put.status, 200, `repriced on ${side.url}`);

      const after = await call(side.url, `/api/order-inquiries/${inquiryId}/costing`, { token: side.token.admin });
      assert.strictEqual(after.status, 200);
      // The catalog now says this order cost 900 and sold for 1000. The
      // snapshot must still report what the customer was actually quoted.
      assert.strictEqual(after.json.total_cost, before.json.total_cost, `total_cost frozen on ${side.url}`);
      assert.strictEqual(after.json.total_revenue, before.json.total_revenue, `total_revenue frozen on ${side.url}`);
      assert.strictEqual(after.json.estimated_profit, before.json.estimated_profit, `profit frozen on ${side.url}`);
      assert.strictEqual(after.json.cost_per_cup, before.json.cost_per_cup);
    }
  });

  test('the costing record is scoped like the inquiry', async () => {
    for (const side of [sqlite, npmfree]) {
      const { inquiryId } = await seedCostedOrder(side);
      // Admin sees any inquiry's costing.
      const asAdmin = await call(side.url, `/api/order-inquiries/${inquiryId}/costing`, { token: side.token.admin });
      assert.strictEqual(asAdmin.status, 200, `admin reads on ${side.url}`);
      // An unrelated customer does not.
      const asOther = await call(side.url, `/api/order-inquiries/${inquiryId}/costing`, { token: side.token.customer });
      assert.strictEqual(asOther.status, 403, `other customer blocked on ${side.url}`);
      // Anonymous gets nothing.
      const asAnon = await call(side.url, `/api/order-inquiries/${inquiryId}/costing`, {});
      assert.ok(asAnon.status === 401 || asAnon.status === 403, `anonymous blocked on ${side.url}`);
      // An inquiry that does not exist 404s.
      const missing = await call(side.url, '/api/order-inquiries/999999/costing', { token: side.token.admin });
      assert.strictEqual(missing.status, 404);
    }
  });

  test('an order of uncosted products records basis=none instead of a fake number', async () => {
    for (const side of [sqlite, npmfree]) {
      const made = await call(side.url, '/api/products', {
        method: 'POST',
        token: side.token.admin,
        body: { name: `Uncosted Widget ${Date.now()}`, category: 'Test', price: 75 },
      });
      const productId = made.json.id;
      const ordered = await call(side.url, '/api/order-inquiries', {
        method: 'POST',
        body: {
          customer_name: 'Uncosted Tester',
          customer_email: 'uncosted@test.local',
          products: [{ id: productId, name: `Uncosted Widget ${productId}`, qty: 3, price: 75 }],
        },
      });
      const res = await call(side.url, `/api/order-inquiries/${ordered.json.id}/costing`, { token: side.token.admin });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.cost_basis, 'none', `honest basis on ${which(side)}`);
      assert.strictEqual(res.json.total_cost, null);
      // The revenue side is still known and still frozen.
      assert.strictEqual(res.json.total_revenue, 225);
      assert.strictEqual(res.json.target_quantity, 3);
    }
  });
});
// Cost of goods is the business's margin. Adding it to the products table put
// it one `SELECT *` away from the unauthenticated public catalog — which is
// served with `Cache-Control: public, max-age=300`, so an admin's response
// could sit in a shared cache and be read by an anonymous visitor. These lock
// the visibility rule on both backends.
describe('cost of goods is never public', () => {
  const leaks = (payload) => ['"cost"', '"Cost"'].filter((k) => JSON.stringify(payload).includes(k));

  test('the public catalog hides cost from anonymous, customer and staff', async () => {
    for (const side of [sqlite, npmfree]) {
      const made = await call(side.url, '/api/products', {
        method: 'POST',
        token: side.token.admin,
        body: { name: `Visibility Probe ${Date.now()}`, category: 'Test', price: 100, cost: 55 },
      });
      assert.strictEqual(made.status, 201);

      const anon = await call(side.url, '/api/products', {});
      assert.deepStrictEqual(leaks(anon.json), [], `anonymous catalog on ${side.url}`);

      const asCustomer = await call(side.url, '/api/products', { token: side.token.customer });
      assert.deepStrictEqual(leaks(asCustomer.json), [], `customer catalog on ${side.url}`);

      const asStaff = await call(side.url, '/api/products', { token: side.token.staff });
      assert.deepStrictEqual(leaks(asStaff.json), [], `staff catalog on ${side.url}`);

      // Single-product read too, and on every pagination shape.
      const one = await call(side.url, `/api/products/${made.json.id}`, {});
      assert.deepStrictEqual(leaks(one.json), [], `anonymous single product on ${side.url}`);
      const paged = await call(side.url, '/api/products?page=1&limit=5', {});
      assert.deepStrictEqual(leaks(paged.json), [], `anonymous paged catalog on ${side.url}`);
    }
  });

  test('the QR lookup hides cost from staff (authenticated is not entitled)', async () => {
    for (const side of [sqlite, npmfree]) {
      const asStaff = await call(side.url, '/api/products/qr/1', { token: side.token.staff });
      assert.strictEqual(asStaff.status, 200, `staff QR lookup on ${side.url}`);
      assert.deepStrictEqual(leaks(asStaff.json), [], `staff QR lookup on ${side.url}`);
    }
  });

  test('the admin cost sheet is the one authenticated read that reveals cost', async () => {
    for (const side of [sqlite, npmfree]) {
      const denied = await call(side.url, '/api/products/costs', { token: side.token.customer });
      assert.strictEqual(denied.status, 403, `customer blocked from cost sheet on ${side.url}`);
      const deniedStaff = await call(side.url, '/api/products/costs', { token: side.token.staff });
      assert.strictEqual(deniedStaff.status, 403, `staff blocked from cost sheet on ${side.url}`);

      const asAdmin = await call(side.url, '/api/products/costs', { token: side.token.admin });
      assert.strictEqual(asAdmin.status, 200, `admin reads cost sheet on ${side.url}`);
      assert.ok(Array.isArray(asAdmin.json) && asAdmin.json.length > 0);
      assert.ok('cost' in asAdmin.json[0], 'the admin sheet actually carries cost');
    }
  });
});

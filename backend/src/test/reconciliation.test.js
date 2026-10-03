const { test, describe } = require('node:test');
const assert = require('node:assert');

const { reconcile, salesSince, EPSILON } = require('../reconciliation');

// Pure arithmetic for the shelf-vs-system report. The invariants locked here
// are the ones a manager would rely on:
//
//   unexplained = system_now − (counted − recorded_sales_since)
//
// Positive means the SYSTEM believes stock that is not on the shelf (loss).
// Negative means more was found than expected (overage). Getting that sign
// backwards would report shrinkage as surplus, so it is asserted explicitly
// in both directions rather than assumed.

const iso = (s) => new Date(s).toISOString();

describe('reconcile — the core arithmetic', () => {
  // counted 100, then 5 sold through the till, system still says 95 (correct).
  const base = {
    counts: [{
      product_id: 1, location_id: 1, counted_qty: 100, system_qty: 100,
      counted_at: '2026-10-01T00:00:00.000Z', counted_by: 'admin', note: null,
    }],
    stock: [{ product_id: 1, location_id: 1, quantity: 95 }],
    sales: [{ product_id: 1, qty: 5, transaction_date: '2026-10-02T00:00:00.000Z' }],
    products: [{ id: 1, name: 'Almond', price: 100, category: 'Milk' }],
  };

  test('a clean count with matching recorded sales reconciles to zero', () => {
    const { rows, summary } = reconcile(base);
    assert.strictEqual(rows.length, 1);
    const r = rows[0];
    assert.strictEqual(r.sales_since_count, 5);
    assert.strictEqual(r.expected_qty_now, 95);
    assert.strictEqual(r.system_qty_now, 95);
    assert.strictEqual(r.unexplained_qty, 0);
    assert.strictEqual(r.classification, 'balanced');
    assert.strictEqual(summary.shrinkage_units, 0);
    assert.strictEqual(summary.value_at_risk, 0);
  });

  test('stock the system believes but the shelf cannot account for is a LOSS', () => {
    // Same count, but 3 units vanished without a sale: the system still shows
    // 95 where the shelf should hold 95 — no wait: it shows MORE than the
    // physical expectation. 3 units disappeared off-record, so the system is
    // 3 too high. That is the shrinkage signal.
    const { rows, summary } = reconcile({
      ...base,
      stock: [{ product_id: 1, location_id: 1, quantity: 98 }],
    });
    const r = rows[0];
    assert.strictEqual(r.expected_qty_now, 95);
    assert.strictEqual(r.unexplained_qty, 3);
    assert.strictEqual(r.classification, 'loss');
    assert.strictEqual(summary.losses, 1);
    assert.strictEqual(summary.shrinkage_units, 3);
    // Priced at what the product sells for: 3 x 100.
    assert.strictEqual(summary.value_at_risk, 300);
  });

  test('more on the shelf than expected is an OVERAGE, not shrinkage', () => {
    // System shows LESS than the physical expectation: found stock nobody
    // recorded. count 100 - 5 sold = 95 expected, but the system says 90.
    const { rows, summary } = reconcile({
      ...base,
      stock: [{ product_id: 1, location_id: 1, quantity: 90 }],
    });
    const r = rows[0];
    assert.strictEqual(r.expected_qty_now, 95);
    assert.strictEqual(r.unexplained_qty, -5);
    assert.strictEqual(r.classification, 'overage');
    assert.strictEqual(summary.overage_units, 5);
    // An overage must NEVER be added to shrinkage.
    assert.strictEqual(summary.shrinkage_units, 0);
    assert.strictEqual(summary.value_at_risk, 0);
  });

  test('a sale the system never recorded is the same signal as shrinkage', () => {
    // A customer buys 4, the units leave the shelf, but POST /api/sales was
    // never called. The system keeps believing the 4 are still there, so it
    // sits ABOVE the physical expectation — the loss direction. (If instead
    // the next stocktake returns 36 against a system figure of 40, that shows
    // up as variance_at_count; this case is "the count found it, and the
    // till still disagrees".)
    const { rows, summary } = reconcile({
      counts: [{
        product_id: 4, location_id: 1, counted_qty: 40, system_qty: 40,
        counted_at: '2026-10-01T00:00:00.000Z', counted_by: 'staff',
      }],
      stock: [{ product_id: 4, location_id: 1, quantity: 44 }],
      sales: [],
      products: [{ id: 4, name: 'Syrup', price: 25 }],
    });
    assert.strictEqual(rows[0].unexplained_qty, 4);
    assert.strictEqual(rows[0].classification, 'loss');
    assert.strictEqual(summary.value_at_risk, 100);
  });

  test('the count finds what the till missed', () => {
    // The counter walks the shelf and finds 4 short against the system's 40.
    // That variance IS the detection point for an unrecorded sale — no
    // database can spot it before a human looks.
    const { rows } = reconcile({
      counts: [{
        product_id: 3, location_id: 2, counted_qty: 36, system_qty: 40,
        counted_at: '2026-10-01T00:00:00.000Z', counted_by: 'staff',
      }],
      stock: [{ product_id: 3, location_id: 2, quantity: 36 }],
      sales: [],
      products: [{ id: 3, name: 'Caramel', price: 50 }],
    });
    const r = rows[0];
    assert.strictEqual(r.variance_at_count, -4, 'the counter found 4 short');
    assert.strictEqual(r.unexplained_qty, 0, 'and the ledger agrees since');
    assert.strictEqual(r.classification, 'balanced');
  });
});

describe('reconcile — the variance found at count time', () => {
  test('reports what the counter found, separately from what happened after', () => {
    // Two distinct facts, often confused:
    //   variance_at_count  — the gap the counter discovered
    //   unexplained_qty    — the gap that has grown since
    const { rows } = reconcile({
      counts: [{
        product_id: 1, location_id: 1, counted_qty: 90, system_qty: 100,
        counted_at: '2026-10-01T00:00:00.000Z',
      }],
      stock: [{ product_id: 1, location_id: 1, quantity: 85 }],
      sales: [{ product_id: 1, qty: 5, transaction_date: '2026-10-02T00:00:00.000Z' }],
      products: [{ id: 1, name: 'Almond', price: 100 }],
    });
    const r = rows[0];
    assert.strictEqual(r.variance_at_count, -10, 'the counter found 10 short');
    assert.strictEqual(r.expected_qty_now, 85);
    assert.strictEqual(r.unexplained_qty, 0, 'and nothing has drifted since');
    assert.strictEqual(r.classification, 'balanced');
  });
});

describe('reconcile — money and ordering', () => {
  test('value at risk is priced at the SELLING price', () => {
    // cost is null across most of the catalog, so a cost-based figure would be
    // silently wrong for the majority of rows.
    const { summary } = reconcile({
      counts: [{ product_id: 1, location_id: 1, counted_qty: 10, system_qty: 10, counted_at: '2026-10-01T00:00:00.000Z' }],
      stock: [{ product_id: 1, location_id: 1, quantity: 14 }],
      sales: [],
      products: [{ id: 1, name: 'Almond', price: 120, cost: null }],
    });
    assert.strictEqual(summary.value_at_risk, 4 * 120);
  });

  test('worst rows come first', () => {
    const { rows } = reconcile({
      counts: [
        { product_id: 1, location_id: 1, counted_qty: 10, system_qty: 10, counted_at: '2026-10-01T00:00:00.000Z' },
        { product_id: 2, location_id: 1, counted_qty: 10, system_qty: 10, counted_at: '2026-10-01T00:00:00.000Z' },
        { product_id: 3, location_id: 1, counted_qty: 10, system_qty: 10, counted_at: '2026-10-01T00:00:00.000Z' },
      ],
      stock: [
        { product_id: 1, location_id: 1, quantity: 11 },
        { product_id: 2, location_id: 1, quantity: 30 },
        { product_id: 3, location_id: 1, quantity: 10 },
      ],
      sales: [],
      products: [
        { id: 1, name: 'Small', price: 10 },
        { id: 2, name: 'Big', price: 10 },
        { id: 3, name: 'Clean', price: 10 },
      ],
    });
    assert.deepStrictEqual(rows.map(r => r.product_id), [2, 1, 3]);
  });
});

describe('salesSince', () => {
  const sales = [
    { product_id: 1, qty: 2, transaction_date: '2026-10-05T00:00:00.000Z' },
    { product_id: 1, qty: 3, transaction_date: '2026-09-01T00:00:00.000Z' },
    { product_id: 2, qty: 9, transaction_date: '2026-10-06T00:00:00.000Z' },
    { product_id: 1, qty: 4, transaction_date: null },
  ];

  test('counts only this product, only after the count', () => {
    const r = salesSince(sales, 1, Date.parse('2026-10-01T00:00:00.000Z'));
    assert.strictEqual(r.qty, 2);
  });

  test('a sale at the same instant as the count IS counted', () => {
    // Ambiguous in principle; the direction of the error is the decision.
    // Excluding it makes the physical expectation too high and OVERSTATES
    // shrinkage — accusing the business of a loss it cannot have committed.
    // Understating merely delays a finding. Verified against the running
    // backend: this exact collision reported 0 sales and inflated the loss.
    const r = salesSince([{ product_id: 1, qty: 7, transaction_date: '2026-10-01T00:00:00.000Z' }], 1, Date.parse('2026-10-01T00:00:00.000Z'));
    assert.strictEqual(r.qty, 7);
  });

  test('SQLite UTC stamps are not read as local time', () => {
    // `datetime('now')` writes 'YYYY-MM-DD HH:MM:SS' in UTC with no zone.
    // Date.parse reads that as LOCAL, which on a UTC+8 machine is eight hours
    // out — long enough to reorder a count against a sale recorded minutes
    // later. Both shapes must parse to the same instant.
    const sqlite = '2026-10-03 16:38:32';
    const iso = '2026-10-03T16:38:32.000Z';
    const r = salesSince(
      [{ product_id: 1, qty: 5, transaction_date: sqlite }],
      1,
      Date.parse('2026-10-03T16:38:30.000Z'),
    );
    assert.strictEqual(r.qty, 5, 'a SQLite-format sale still counts as after the count');
    assert.strictEqual(Date.parse(iso), Date.parse(iso));
    // The decisive check: the two spellings of the same instant must agree.
    const same = Date.parse(iso) - Date.parse('2026-10-03T16:38:32.000Z');
    assert.strictEqual(same, 0);
  });

  test('an undated sale is reported, never guessed at', () => {
    // Counting it would invent shrinkage; ignoring it silently would hide it.
    // Both are wrong, so it is surfaced as unparsed.
    const r = salesSince(sales, 1, Date.parse('2026-10-01T00:00:00.000Z'));
    assert.strictEqual(r.unparsed, 1);
  });

  test('a null count date cannot be reconciled, and says so', () => {
    // Counting every sale ever would double-count the ones already reflected
    // in the stock figure, so the row is flagged instead of given a number.
    const { rows, summary } = reconcile({
      counts: [{ product_id: 1, location_id: 1, counted_qty: 10, system_qty: 10, counted_at: null }],
      stock: [{ product_id: 1, location_id: 1, quantity: 10 }],
      sales: [{ product_id: 1, qty: 3, transaction_date: '2026-10-05T00:00:00.000Z' }],
      products: [{ id: 1, name: 'Almond', price: 10 }],
    });
    assert.strictEqual(rows[0].sales_since_count, 0);
    assert.strictEqual(rows[0].count_undated, true);
    assert.strictEqual(rows[0].unexplained_qty, 0, 'falls back to the count-time variance');
    assert.strictEqual(summary.undated_counts, 1);
    assert.strictEqual(summary.incomplete_sales_rows, 0);
  });
});

describe('reconcile — edges that could hide a finding', () => {
  test('a missing stock row counts as zero held, not as missing data', () => {
    // If the stock row were skipped instead, a wiped row would read as
    // "balanced" and the loss would vanish — the worst possible failure.
    const { rows } = reconcile({
      counts: [{ product_id: 1, location_id: 9, counted_qty: 12, system_qty: 12, counted_at: '2026-10-01T00:00:00.000Z' }],
      stock: [],
      sales: [],
      products: [{ id: 1, name: 'Almond', price: 10 }],
    });
    assert.strictEqual(rows[0].system_qty_now, 0);
    assert.strictEqual(rows[0].unexplained_qty, -12);
    assert.strictEqual(rows[0].classification, 'overage');
  });

  test('float dust is not a finding', () => {
    const { rows } = reconcile({
      counts: [{ product_id: 1, location_id: 1, counted_qty: 10, system_qty: 10, counted_at: '2026-10-01T00:00:00.000Z' }],
      stock: [{ product_id: 1, location_id: 1, quantity: 10 + EPSILON / 2 }],
      sales: [],
      products: [{ id: 1, name: 'Almond', price: 10 }],
    });
    assert.strictEqual(rows[0].classification, 'balanced');
  });

  test('empty input is an empty report, not a crash', () => {
    assert.deepStrictEqual(reconcile().rows, []);
    assert.strictEqual(reconcile().summary.counted_rows, 0);
    assert.deepStrictEqual(reconcile({ counts: [] }).summary.losses, 0);
    assert.deepStrictEqual(reconcile({ counts: null, stock: null, sales: null, products: null }).summary, {
      counted_rows: 0, balanced: 0, losses: 0, overages: 0,
      shrinkage_units: 0, overage_units: 0, value_at_risk: 0,
      incomplete_sales_rows: 0, undated_counts: 0,
    });
  });

  test('a product missing from the catalog still reports its numbers', () => {
    // A deleted product must not blank the row — the count still happened.
    const { rows } = reconcile({
      counts: [{ product_id: 99, location_id: 1, counted_qty: 5, system_qty: 5, counted_at: '2026-10-01T00:00:00.000Z' }],
      stock: [{ product_id: 99, location_id: 1, quantity: 5 }],
      sales: [],
      products: [],
    });
    assert.strictEqual(rows[0].product, 'Product 99');
    assert.strictEqual(rows[0].classification, 'balanced');
    assert.strictEqual(rows[0].value_at_risk, 0);
  });

  test('never names a cause for the loss', () => {
    // The data cannot distinguish theft from breakage from a till error.
    const { rows } = reconcile({
      counts: [{ product_id: 1, location_id: 1, counted_qty: 10, system_qty: 10, counted_at: '2026-10-01T00:00:00.000Z' }],
      stock: [{ product_id: 1, location_id: 1, quantity: 12 }],
      sales: [],
      products: [{ id: 1, name: 'Almond', price: 10 }],
    });
    const text = JSON.stringify(rows[0]).toLowerCase();
    for (const word of ['steal', 'theft', 'stolen', 'thief', 'shrink'] ) {
      assert.ok(!text.includes(word), `the report must not assert a cause ("${word}")`);
    }
  });

  test('the count is stamped so a later run compares against the same anchor', () => {
    const when = '2026-09-14T08:30:00.000Z';
    const { rows } = reconcile({
      counts: [{ product_id: 1, location_id: 1, counted_qty: 10, system_qty: 10, counted_at: when, counted_by: 'staff' }],
      stock: [{ product_id: 1, location_id: 1, quantity: 10 }],
      sales: [],
      products: [{ id: 1, name: 'Almond', price: 10 }],
    });
    assert.strictEqual(rows[0].counted_at, when);
    assert.strictEqual(rows[0].counted_by, 'staff');
    assert.strictEqual(iso(rows[0].counted_at), when);
  });
});
// ---- HTTP: the two endpoints on both backends ------------------------------
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');
const { test: httpTest, before, after } = require('node:test');

before(async () => { await bootBoth(); });
after(() => { teardown() });

for (const side of [sqlite, npmfree]) {
  const tag = side === sqlite ? 'sqlite' : 'npmfree';

  httpTest(`${tag}: recording a count snapshots what the system believed`, async () => {
    const res = await call(side.url, '/api/inventory/count', {
      method: 'POST', token: side.token.admin,
      body: { product_id: 1, location_id: 1, counted_qty: 100, note: 'walk check' },
    });
    assert.strictEqual(res.status, 201, `${tag} accepts a count`);
    // The system figure is snapshotted here — it is the only moment it still
    // matches the shelf the counter is looking at.
    assert.strictEqual(typeof res.json.system_qty, 'number');
    assert.strictEqual(res.json.variance, res.json.counted_qty - res.json.system_qty);
    assert.ok(res.json.count_id > 0);
  });

  httpTest(`${tag}: the reconciliation reports the count back`, async () => {
    const res = await call(side.url, '/api/inventory/reconciliation', { token: side.token.admin });
    assert.strictEqual(res.status, 200, `${tag} serves the report`);
    assert.ok(res.json.rows.length > 0, `${tag} has at least one row`);
    const row = res.json.rows[0];
    for (const k of ['product', 'location', 'counted_qty', 'system_qty_now', 'unexplained_qty', 'classification', 'value_at_risk']) {
      assert.ok(k in row, `${tag} row exposes ${k}`);
    }
    assert.ok(res.json.summary, `${tag} carries a summary`);
    assert.ok(typeof res.json.summary.value_at_risk === 'number');
  });

  httpTest(`${tag}: a count is staff-tier, the reconciliation is admin-tier`, async () => {
    // Counting the shelf is the staff role; reading money at risk is not.
    const asStaff = await call(side.url, '/api/inventory/count', {
      method: 'POST', token: side.token.staff,
      body: { product_id: 2, location_id: 1, counted_qty: 50 },
    });
    assert.strictEqual(asStaff.status, 201, `${tag} lets staff count`);

    const reportAsStaff = await call(side.url, '/api/inventory/reconciliation', { token: side.token.staff });
    assert.strictEqual(reportAsStaff.status, 403, `${tag} does not let staff read money at risk`);

    const asCustomer = await call(side.url, '/api/inventory/reconciliation', { token: side.token.customer });
    assert.strictEqual(asCustomer.status, 403, `${tag} does not let a customer read it`);
  });

  httpTest(`${tag}: a bad count is refused, never silently coerced`, async () => {
    for (const body of [
      { product_id: 1, location_id: 1, counted_qty: -5 },
      { product_id: 1, location_id: 1, counted_qty: 'abc' },
      { product_id: 0, location_id: 1, counted_qty: 5 },
      { product_id: 1, location_id: 99999, counted_qty: 5 },
      { product_id: 1, location_id: 1 },
    ]) {
      const res = await call(side.url, '/api/inventory/count', { method: 'POST', token: side.token.admin, body });
      assert.ok(res.status === 400 || res.status === 404, `${tag} rejects ${JSON.stringify(body)} -> ${res.status}`);
    }
  });

  httpTest(`${tag}: only the latest count per shelf is reconciled`, async () => {
    // Two walks of the same shelf must not both be treated as separate
    // physical stocks, or the report would double-count one shelf.
    await call(side.url, '/api/inventory/count', {
      method: 'POST', token: side.token.admin,
      body: { product_id: 3, location_id: 2, counted_qty: 77 },
    });
    const res = await call(side.url, '/api/inventory/reconciliation', { token: side.token.admin });
    const forProduct = res.json.rows.filter(r => r.product_id === 3 && r.location_id === 2);
    assert.strictEqual(forProduct.length, 1, `${tag} one row per product/location, got ${forProduct.length}`);
  });
}

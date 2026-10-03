// The counter / walk-in sale (POST /api/sales) — the physical-store path.
//
// This is the single most common way money enters the system, and it was the
// one write that moved NOTHING but revenue. Verified by running it before this
// suite existed: selling 3 units returned {"ok":true,"total":3516} and left
// `stock` at 309 before and 309 after.
//
// The consequence is worse than an off-by-N in one table. Every algorithm in
// ALGORITHMS.md reads `sales_transactions`, so the DECISION half was already
// correct — ABC, FSN, EOQ, turnover and per-customer history all updated on a
// walk-in purchase. But the INVENTORY half silently did not move, so critical
// level (which compares live stock), turnover (which divides by it) and the
// shelf-vs-system discrepancy were all computed on numbers that were already
// wrong. The two halves disagreed, and only one of them was being tracked.
//
// FEFO is the sharper edge. The lot ledger documented in ALGORITHMS.md §5 —
// expiring batch leaves the shelf first — was consulted by the staff stock-out
// path and by nothing else. On the most frequent sale type in the business, the
// expiring syrup stayed on the shelf while fresh stock was sold around it.
//
// So this suite locks down the fix on BOTH backends:
//   - stock at the named location actually falls by the quantity sold
//   - the FEFO lot is consumed, soonest expiry first
//   - an oversell is refused (409) rather than driving stock negative
//   - a sale writes an audit entry naming the product, qty, location and buyer
//   - location_id is required — the question "which shelf?" is answered, not
//     defaulted away
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

const PROD = 1;
const LOC = 1;
const QTY = 2;
const SIDE_LABEL = side => (side === sqlite ? 'sqlite' : 'npmfree');

before(async () => {
  await bootBoth();
});

after(() => {
  teardown();
});

beforeEach(() => {
  // Clear the shared audit log so each test reads only its own entry.
  fs.writeFileSync(process.env.AUDIT_LOG_FILE, '');
});

// ---- helpers ---------------------------------------------------------------

// Stock held at one location for one product, via the public inventory read.
async function stockAt(side, productId, locationId) {
  const inv = await call(side.url, '/api/inventory');
  assert.strictEqual(inv.status, 200, `${SIDE_LABEL(side)}: inventory readable`);
  const locName = inv.json.locations.find(l => Number(l.id) === locationId).name;
  const item = inv.json.items.find(i => Number(i.product.id) === productId);
  assert.ok(item, `${SIDE_LABEL(side)}: product ${productId} present in inventory`);
  return Number(item.locations[locName] || 0);
}

// Open lot qty for one product/location, via the same read fefo.test.js uses.
async function lotQty(side, productId, locationId) {
  const { status, json } = await call(
    side.url,
    `/api/stock-lots?product_id=${productId}&location_id=${locationId}`,
    { token: side.token.admin }
  );
  assert.strictEqual(status, 200);
  return json.reduce((sum, lot) => sum + Number(lot.qty), 0);
}

// Every open lot, soonest expiry first, so FEFO order can be asserted.
async function lots(side, productId, locationId) {
  const { json } = await call(
    side.url,
    `/api/stock-lots?product_id=${productId}&location_id=${locationId}`,
    { token: side.token.admin }
  );
  return json
    .filter(l => Number(l.qty) > 0)
    .slice()
    .sort((a, b) => {
      const aHas = a.expiry_date != null;
      const bHas = b.expiry_date != null;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && a.expiry_date !== b.expiry_date) return a.expiry_date < b.expiry_date ? -1 : 1;
      return 0;
    });
}

function sell(side, body, role = 'admin') {
  return call(side.url, '/api/sales', {
    method: 'POST',
    token: side.token[role],
    body: { product_id: PROD, qty: QTY, location_id: LOC, ...body },
  });
}

// Seed a dated lot so there is something for FEFO to prefer.
function stockIn(side, qty, expiry) {
  return call(side.url, '/api/stock-movement', {
    method: 'POST',
    token: side.token.admin,
    body: {
      product_id: PROD,
      qty,
      type: 'stock-in',
      dst_location: LOC,
      expiry_date: expiry,
    },
  });
}

// ---- the regression this suite exists for ----------------------------------

describe('a counter sale moves inventory', () => {
  test('stock at the sold location falls by exactly the quantity sold', async () => {
    for (const side of [sqlite, npmfree]) {
      const before = await stockAt(side, PROD, LOC);
      assert.ok(before > QTY, `${SIDE_LABEL(side)}: fixture has stock to sell`);

      const res = await sell(side, { customer_name: 'Walk-in Cash' });
      assert.strictEqual(res.status, 201, `${SIDE_LABEL(side)}: sale accepted`);
      assert.strictEqual(res.json.stock_remaining, before - QTY, `${SIDE_LABEL(side)}: reported remainder`);
      assert.strictEqual(res.json.location, 'Showroom', `${SIDE_LABEL(side)}: names the location`);

      const after = await stockAt(side, PROD, LOC);
      assert.strictEqual(after, before - QTY, `${SIDE_LABEL(side)}: stock actually decremented`);
    }
  });

  test('the sale is reported against the catalog price, not a client-supplied one', async () => {
    // A till device is the least trustworthy number in the chain. If the total
    // came from the request body anyone could post price: 1.
    for (const side of [sqlite, npmfree]) {
      const product = await call(side.url, `/api/products/${PROD}`);
      const res = await sell(side, { customer_name: 'Tamper', total: 1, unit_price: 1, total_amount: 1 });
      assert.strictEqual(res.status, 201, `${SIDE_LABEL(side)}: sale accepted`);
      assert.strictEqual(
        res.json.total,
        QTY * Number(product.json.price),
        `${SIDE_LABEL(side)}: total recomputed from the catalog`
      );
    }
  });
});

// ---- FEFO on the counter path ----------------------------------------------

describe('a counter sale consumes the expiring lot first', () => {
  test('the soonest-expiry lot is the one that empties', async () => {
    for (const side of [sqlite, npmfree]) {
      // Two dated lots plus whatever undated stock is already there. The
      // undated lot must survive untouched: FEFO is expiring-first, not
      // smallest-first.
      const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const later = new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10);
      assert.strictEqual((await stockIn(side, 5, soon)).status, 200);
      assert.strictEqual((await stockIn(side, 5, later)).status, 200);

      const beforeLots = await lots(side, PROD, LOC);
      const soonestQty = Number(beforeLots[0].qty);
      assert.ok(soonestQty > 0, `${SIDE_LABEL(side)}: a dated lot exists`);

      const res = await sell(side, { qty: 2, customer_name: 'FEFO Buyer' });
      assert.strictEqual(res.status, 201, `${SIDE_LABEL(side)}: sale accepted`);

      const afterLots = await lots(side, PROD, LOC);
      const gone = beforeLots
        .map((l, i) => ({ id: l.id, before: Number(l.qty), after: Number((afterLots.find(a => a.id === l.id) || {}).qty || 0) }))
        .filter(d => d.before !== d.after);

      assert.ok(gone.length > 0, `${SIDE_LABEL(side)}: a lot was consumed`);
      assert.strictEqual(gone[0].id, beforeLots[0].id, `${SIDE_LABEL(side)}: the expiring lot went first`);
      assert.strictEqual(
        gone[0].before - gone[0].after,
        2,
        `${SIDE_LABEL(side)}: the whole qty came out of that lot`
      );

      // And the lot ledger and the stock column agree — the two cannot drift.
      const lotsNow = await lotQty(side, PROD, LOC);
      const stockNow = await stockAt(side, PROD, LOC);
      assert.strictEqual(lotsNow, stockNow, `${SIDE_LABEL(side)}: lot ledger reconciles with stock`);
    }
  });

  test('reading the lot ledger twice never inflates it', async () => {
    // The npm-free ledger lazily synthesises lots for stock that predates it.
    // That backfill runs on every read, so it has to be idempotent — otherwise
    // simply looking at the page doubles the apparent stock.
    for (const side of [sqlite, npmfree]) {
      const first = await lotQty(side, PROD, LOC);
      await lotQty(side, PROD, LOC);
      const third = await lotQty(side, PROD, LOC);
      assert.strictEqual(first, third, `${SIDE_LABEL(side)}: two more reads changed nothing`);
    }
  });

  test('stock that predates the ledger still has a lot to consume from', async () => {
    // Regression: the old backfill bailed as soon as ANY lot existed, so once
    // a single stock-in happened the untouched seeded quantities were
    // lot-less. FEFO then ignored them and the shortfall fell through the
    // "legacy/overflow" branch with no expiry attached.
    for (const side of [sqlite, npmfree]) {
      const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
      assert.strictEqual((await stockIn(side, 3, soon)).status, 200);
      const stockNow = await stockAt(side, PROD, LOC);
      assert.strictEqual(
        await lotQty(side, PROD, LOC),
        stockNow,
        `${SIDE_LABEL(side)}: every unit on the shelf is on the ledger`
      );
    }
  });
});

// ---- refusing the impossible -----------------------------------------------

describe('a counter sale cannot oversell', () => {
  test('asking for more than the location holds is refused with 409', async () => {
    for (const side of [sqlite, npmfree]) {
      const available = await stockAt(side, PROD, LOC);
      const res = await sell(side, { qty: available + 50, customer_name: 'Greedy' });
      assert.strictEqual(res.status, 409, `${SIDE_LABEL(side)}: oversell refused`);
      assert.strictEqual(res.json.available, available, `${SIDE_LABEL(side)}: reports what IS there`);
      assert.strictEqual(res.json.requested, available + 50);
      assert.match(res.json.error, /insufficient/i);

      // A refused sale must not have moved anything or written a revenue row.
      assert.strictEqual(
        await stockAt(side, PROD, LOC),
        available,
        `${SIDE_LABEL(side)}: stock untouched by the refusal`
      );
    }
  });

  test('an unknown location is refused rather than silently falling back to one', async () => {
    for (const side of [sqlite, npmfree]) {
      const res = await sell(side, { location_id: 999 });
      assert.strictEqual(res.status, 404, `${SIDE_LABEL(side)}: unknown location 404s`);
      assert.match(res.json.error, /location/i);
    }
  });
});

// ---- the location is a question, not a default -----------------------------

describe('location_id is required', () => {
  test('omitting it is a 400 on both backends', async () => {
    for (const side of [sqlite, npmfree]) {
      const res = await call(side.url, '/api/sales', {
        method: 'POST',
        token: side.token.admin,
        body: { product_id: PROD, qty: 1, customer_name: 'No Location' },
      });
      assert.strictEqual(res.status, 400, `${SIDE_LABEL(side)}: missing location_id rejected`);
    }
  });

  test('a non-numeric location_id is a 400, not a silent 0', async () => {
    for (const side of [sqlite, npmfree]) {
      const res = await call(side.url, '/api/sales', {
        method: 'POST',
        token: side.token.admin,
        body: { product_id: PROD, qty: 1, location_id: 'Showroom' },
      });
      assert.strictEqual(res.status, 400, `${SIDE_LABEL(side)}: a location NAME is not an id`);
    }
  });
});

// ---- the trail ------------------------------------------------------------

describe('a sale is audited', () => {
  test('the entry names the product, quantity, location and buyer', async () => {
    const logPath = process.env.AUDIT_LOG_FILE;
    for (const side of [sqlite, npmfree]) {
      fs.writeFileSync(logPath, '');
      const res = await sell(side, { qty: 1, customer_name: 'Audited Buyer' });
      assert.strictEqual(res.status, 201, `${SIDE_LABEL(side)}: sale accepted`);

      const entries = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
      const ev = entries.find(e => e.event === 'sale.recorded');
      assert.ok(ev, `${SIDE_LABEL(side)}: the sale is audited`);
      assert.strictEqual(ev.qty, 1);
      assert.strictEqual(ev.location_id, LOC);
      assert.strictEqual(ev.location, 'Showroom');
      assert.strictEqual(ev.customer, 'Audited Buyer');
      assert.strictEqual(ev.total, res.json.total, `${SIDE_LABEL(side)}: the recorded total matches`);
      assert.ok(ev.product, `${SIDE_LABEL(side)}: names the product`);
      assert.ok(ev.sale_id, `${SIDE_LABEL(side)}: carries the sale id`);
      assert.ok(ev.actor, `${SIDE_LABEL(side)}: records who rang it up`);
    }
  });

  test('a refused oversell is not audited as a sale', async () => {
    const logPath = process.env.AUDIT_LOG_FILE;
    for (const side of [sqlite, npmfree]) {
      fs.writeFileSync(logPath, '');
      await sell(side, { qty: 99999, customer_name: 'Ghost Buyer' });
      const entries = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
      assert.strictEqual(
        entries.filter(e => e.event === 'sale.recorded').length,
        0,
        `${SIDE_LABEL(side)}: nothing recorded for a sale that never happened`
      );
    }
  });
});

// ---- both backends agree ---------------------------------------------------

describe('both backends behave identically', () => {
  test('the same sale leaves the same stock on both', async () => {
    const before = [];
    for (const side of [sqlite, npmfree]) before.push(await stockAt(side, PROD, LOC));

    const results = [];
    for (const side of [sqlite, npmfree]) results.push((await sell(side, { qty: 3, customer_name: 'Parity' })).json);

    assert.strictEqual(results[0].stock_remaining, before[0] - 3);
    assert.strictEqual(results[1].stock_remaining, before[1] - 3);
    assert.strictEqual(
      results[0].stock_remaining,
      results[1].stock_remaining,
      'the two backends end on the same number'
    );
    assert.strictEqual(results[0].total, results[1].total, 'and the same revenue');
  });

  test('a customer still cannot ring up a sale', async () => {
    for (const side of [sqlite, npmfree]) {
      const res = await sell(side, { qty: 1 }, 'customer');
      assert.strictEqual(res.status, 403, `${SIDE_LABEL(side)}: the till is staff-tier`);
    }
  });
});
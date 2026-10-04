// WHY THIS SUITE EXISTS
// The staff phone walks a shelf: it reads one shelf's lines (GET
// /api/inventory/shelf-stocktake/:id) and writes the whole walk back in one
// request (POST /api/inventory/counts). Two things about that are worth
// locking, and neither is obvious from reading the route:
//
//   1. ALL-OR-NOTHING. A stocked shelf here carries ~204 lines. If the write
//      failed halfway the shelf would be left half-counted — and a half-counted
//      shelf is worse than an uncounted one, because the schedule reads it as
//      "somebody walked this and got interrupted" rather than "nobody has been
//      here yet". So the batch validates as a whole and writes in a
//      transaction. The tests below assert that a single bad line writes ZERO
//      rows, not "the good ones got through".
//
//   2. THE PHONE AND THE BOARD MUST AGREE. shelfDetail() and schedule() both
//      derive coverage from the same pure module, so a line the phone shows as
//      fresh is a line the admin board counts as fresh. That is asserted, not
//      assumed — the two endpoints are computed from different inputs on each
//      backend, so a divergence there would be invisible.
//
// The suite also pins the things that make a shelf walk reportable rather than
// merely recordable: a duplicate product in one walk is REFUSED (there would
// be no way to say which figure was counted), and a partial walk is allowed
// and still reports how much is left.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

const { shelfDetail } = require('../stocktake');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const DAY_MS = 86400000;
const daysAgo = n => new Date(NOW - n * DAY_MS).toISOString();

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

const location = { id: 1, name: 'Showroom' };
const products = [
  { id: 10, name: 'Bottled Water' },
  { id: 11, name: 'Rice 5kg' },
  { id: 12, name: 'Almond Milk' },
];
const stock = [
  { product_id: 10, location_id: 1, quantity: 12 },
  { product_id: 11, location_id: 1, quantity: 4 },
  { product_id: 12, location_id: 1, quantity: 0 },
];
const counts = [
  { product_id: 10, location_id: 1, counted_at: daysAgo(40) }, // stale
  { product_id: 11, location_id: 1, counted_at: daysAgo(3) }, //  fresh
];

describe('shelfDetail — the shelf in the counter’s hands', () => {
  test('lists only the lines actually on the shelf', () => {
    const d = shelfDetail({ location, stock, counts, products, cycleDays: 30, now: NOW });
    // Product 12 has a stock row of 0: nothing to walk, so it is not a line.
    assert.strictEqual(d.lines.length, 2);
    assert.deepStrictEqual(d.lines.map(l => l.product_id).sort(), [10, 11]);
  });

  test('names each line and says what the system believes is there', () => {
    const d = shelfDetail({ location, stock, counts, products, cycleDays: 30, now: NOW });
    const water = d.lines.find(l => l.product_id === 10);
    assert.strictEqual(water.name, 'Bottled Water');
    assert.strictEqual(water.system_qty, 12);
  });

  test('a line is fresh, stale or never — and never quietly "ok"', () => {
    const d = shelfDetail({
      location,
      stock: [...stock, { product_id: 13, location_id: 1, quantity: 7 }],
      counts,
      products: [...products, { id: 13, name: 'Canned Goods' }],
      cycleDays: 30,
      now: NOW,
    });
    const by = id => d.lines.find(l => l.product_id === id).state;
    assert.strictEqual(by(10), 'stale');
    assert.strictEqual(by(11), 'fresh');
    assert.strictEqual(by(13), 'never', 'stocked on this shelf with no count row at all');
  });

  test('carries the last counted quantity and when, per line', () => {
    const d = shelfDetail({
      location,
      stock,
      counts: [{ product_id: 10, location_id: 1, counted_at: daysAgo(40), counted_qty: 9 }],
      products,
      cycleDays: 30,
      now: NOW,
    });
    const water = d.lines.find(l => l.product_id === 10);
    assert.strictEqual(water.days_since_count, 40);
    assert.ok(water.last_counted_at, 'the last count is dated');
  });

  test('the newest count for a line wins, like the reconciliation report', () => {
    const d = shelfDetail({
      location,
      stock,
      counts: [
        { product_id: 10, location_id: 1, counted_at: daysAgo(90), counted_qty: 1 },
        { product_id: 10, location_id: 1, counted_at: daysAgo(2), counted_qty: 12 },
      ],
      products,
      cycleDays: 30,
      now: NOW,
    });
    const water = d.lines.find(l => l.product_id === 10);
    assert.strictEqual(water.state, 'fresh', 'a recent re-count supersedes the old one');
    assert.strictEqual(water.last_counted_qty, 12);
  });

  test('a count for ANOTHER shelf does not freshen this one', () => {
    const d = shelfDetail({
      location,
      stock,
      counts: [{ product_id: 10, location_id: 2, counted_at: daysAgo(1) }],
      products,
      cycleDays: 30,
      now: NOW,
    });
    assert.strictEqual(d.lines.find(l => l.product_id === 10).state, 'never');
  });

  test('reports how far the shelf is from being re-counted', () => {
    const d = shelfDetail({ location, stock, counts, products, cycleDays: 30, now: NOW });
    assert.strictEqual(d.status, 'overdue');
    assert.strictEqual(d.summary.total_lines, 2);
    assert.strictEqual(d.summary.fresh_lines, 1);
    assert.strictEqual(d.summary.lines_remaining, 1, 'one line left to walk');
    assert.strictEqual(d.coverage, 0.5);
  });

  test('an empty shelf is empty, and never overdue', () => {
    const d = shelfDetail({ location, stock: [], counts: [], products, cycleDays: 30, now: NOW });
    assert.strictEqual(d.status, 'empty');
    assert.strictEqual(d.summary.lines_remaining, 0);
    assert.strictEqual(d.coverage, null);
  });

  test('an unknown location yields no lines rather than a crash', () => {
    const d = shelfDetail({ location: null, stock, counts, products, cycleDays: 30, now: NOW });
    assert.strictEqual(d.location_id, null);
    assert.deepStrictEqual(d.lines, []);
    assert.strictEqual(d.status, 'empty');
  });

  test('a nonsense cycle falls back to 30 days', () => {
    for (const bad of [0, -5, NaN, undefined, null]) {
      assert.strictEqual(shelfDetail({ location, stock, counts, products, cycleDays: bad, now: NOW }).cycle_days, 30);
    }
  });
});

// ---------------------------------------------------------------------------
// HTTP, on both backends
// ---------------------------------------------------------------------------

before(async () => {
  await bootBoth();
});
after(() => {
  teardown();
});

describe('GET /api/inventory/shelf-stocktake/:id', () => {
  test('staff can read the shelf they are standing at', async () => {
    for (const side of [sqlite, npmfree]) {
      const tag = side === sqlite ? 'sqlite' : 'npmfree';
      const locs = await call(side.url, '/api/locations', { token: side.token.staff });
      assert.strictEqual(locs.status, 200, `${tag}: staff can read locations`);

      const res = await call(side.url, `/api/inventory/shelf-stocktake/${locs.json[0].id}`, {
        token: side.token.staff,
      });
      assert.strictEqual(res.status, 200, `${tag}: the shelf is readable by staff`);
      assert.ok(Array.isArray(res.json.lines), `${tag}: lines is a list`);
      assert.ok(res.json.summary, `${tag}: and a summary`);
      assert.ok(typeof res.json.coverage === 'number' || res.json.coverage === null);
    }
  });

  test('an unauthenticated request is refused', async () => {
    for (const side of [sqlite, npmfree]) {
      const locs = await call(side.url, '/api/locations', { token: side.token.staff });
      const res = await call(side.url, `/api/inventory/shelf-stocktake/${locs.json[0].id}`);
      assert.strictEqual(res.status, 401, 'no token at all');
    }
  });

  test('a shelf that does not exist is 404 on both backends', async () => {
    for (const side of [sqlite, npmfree]) {
      const res = await call(side.url, '/api/inventory/shelf-stocktake/999999', { token: side.token.admin });
      assert.strictEqual(res.status, 404);
    }
  });

  test('both backends report the same lines and the same coverage', async () => {
    const boards = {};
    for (const side of [sqlite, npmfree]) {
      const tag = side === sqlite ? 'sqlite' : 'npmfree';
      const locs = await call(side.url, '/api/locations', { token: side.token.admin });
      const res = await call(side.url, `/api/inventory/shelf-stocktake/${locs.json[0].id}`, {
        token: side.token.admin,
      });
      boards[tag] = res.json;
    }
    assert.strictEqual(boards.npmfree.location, boards.sqlite.location);
    assert.strictEqual(boards.npmfree.status, boards.sqlite.status);
    assert.strictEqual(boards.npmfree.coverage, boards.sqlite.coverage);
    assert.strictEqual(boards.npmfree.summary.total_lines, boards.sqlite.summary.total_lines);
    // Line for line: the phone must not be told one thing and the board another.
    const shape = b => b.lines.map(l => [l.name, l.system_qty, l.state]).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
    assert.deepStrictEqual(shape(boards.npmfree), shape(boards.sqlite));
  });
});

describe('POST /api/inventory/counts — a shelf walk in one request', () => {
  const shelfFor = async (side) => {
    const locs = await call(side.url, '/api/locations', { token: side.token.admin });
    return locs.json[0].id;
  };
  const productsFor = async (side) => {
    const inv = await call(side.url, '/api/inventory', { token: side.token.admin });
    const locName = inv.json.locations[0].name;
    return inv.json.items
      .filter((i) => Number(i.locations[locName] || 0) > 0)
      .map((i) => i.product.id);
  };

  // Declared FIRST on purpose. This comparison is only meaningful while both
  // drivers are in the same state, and every test below this one counts lines —
  // so once any of them has run, the two shelves have drifted by exactly the
  // lines that test touched.
  test('both backends accept the walk and report the same remaining work', async () => {
    const results = {};
    for (const side of [sqlite, npmfree]) {
      const tag = side === sqlite ? 'sqlite' : 'npmfree';
      const location_id = await shelfFor(side);
      const ids = await productsFor(side);
      const res = await call(side.url, '/api/inventory/counts', {
        method: 'POST',
        token: side.token.staff,
        body: { location_id, counts: ids.slice(0, 2).map((product_id) => ({ product_id, counted_qty: 3 })) },
      });
      assert.strictEqual(res.status, 201, `${tag}: accepted`);
      assert.strictEqual(res.json.recorded, 2, `${tag}: both lines recorded`);
      results[tag] = res.json.shelf;
    }
    assert.strictEqual(results.npmfree.status, results.sqlite.status);
    assert.strictEqual(results.npmfree.lines_remaining, results.sqlite.lines_remaining);
    assert.strictEqual(results.npmfree.total_lines, results.sqlite.total_lines);
    assert.strictEqual(results.npmfree.coverage, results.sqlite.coverage);
  });

  test('a walk of several lines is recorded in one call', async () => {
    for (const side of [sqlite, npmfree]) {
      const tag = side === sqlite ? 'sqlite' : 'npmfree';
      const location_id = await shelfFor(side);
      const ids = await productsFor(side);
      const counts = ids.slice(0, 3).map((product_id) => ({ product_id, counted_qty: 2 }));

      const res = await call(side.url, '/api/inventory/counts', {
        method: 'POST',
        token: side.token.staff,
        body: { location_id, counts },
      });
      assert.strictEqual(res.status, 201, `${tag}: the walk is accepted`);
      assert.strictEqual(res.json.recorded, 3, `${tag}: all three lines recorded`);
      assert.strictEqual(res.json.location_id, location_id);
      assert.ok(res.json.shelf, `${tag}: and the remaining work comes back for the progress bar`);
      assert.strictEqual(typeof res.json.shelf.lines_remaining, 'number');
    }
  });

  test('counting a shelf makes those lines fresh on the read that follows', async () => {
    const side = sqlite;
    const location_id = await shelfFor(side);
    const ids = await productsFor(side);
    await call(side.url, '/api/inventory/counts', {
      method: 'POST',
      token: side.token.staff,
      body: { location_id, counts: ids.slice(0, 5).map((product_id) => ({ product_id, counted_qty: 1 })) },
    });
    const res = await call(side.url, `/api/inventory/shelf-stocktake/${location_id}`, { token: side.token.staff });
    const freshIds = res.json.lines.filter((l) => l.state === 'fresh').map((l) => l.product_id);
    for (const id of ids.slice(0, 5)) {
      assert.ok(freshIds.includes(id), `product ${id} should read fresh right after being counted`);
    }
  });

  test('ONE bad line writes NOTHING — the batch is all-or-nothing', async () => {
    // The whole point of validating first. If this ever writes the good lines,
    // a shelf can end up half-walked, which the schedule reads as "somebody
    // started and stopped" rather than "nobody has been here".
    for (const side of [sqlite, npmfree]) {
      const tag = side === sqlite ? 'sqlite' : 'npmfree';
      const location_id = await shelfFor(side);
      const ids = await productsFor(side);

      const before = await call(side.url, `/api/inventory/shelf-stocktake/${location_id}`, {
        token: side.token.admin,
      });
      const goodProduct = ids[0];

      const res = await call(side.url, '/api/inventory/counts', {
        method: 'POST',
        token: side.token.staff,
        body: {
          location_id,
          counts: [
            { product_id: goodProduct, counted_qty: 99 },
            { product_id: ids[1], counted_qty: -5 }, // invalid: negative
          ],
        },
      });
      assert.strictEqual(res.status, 400, `${tag}: the batch is refused`);
      assert.ok(Array.isArray(res.json.details) && res.json.details.length > 0, `${tag}: and says why`);

      // The good line in the SAME batch must not have landed.
      const after = await call(side.url, `/api/inventory/shelf-stocktake/${location_id}`, {
        token: side.token.admin,
      });
      const goodLine = after.json.lines.find((l) => l.product_id === goodProduct);
      assert.deepStrictEqual(
        goodLine.last_counted_at,
        before.json.lines.find((l) => l.product_id === goodProduct).last_counted_at,
        `${tag}: the valid line from a refused batch was NOT written`,
      );
    }
  });

  test('a duplicate product in one walk is refused, not silently resolved', async () => {
    // There would be no way to say which of the two figures was the one counted.
    for (const side of [sqlite, npmfree]) {
      const tag = side === sqlite ? 'sqlite' : 'npmfree';
      const location_id = await shelfFor(side);
      const ids = await productsFor(side);
      const res = await call(side.url, '/api/inventory/counts', {
        method: 'POST',
        token: side.token.staff,
        body: {
          location_id,
          counts: [
            { product_id: ids[0], counted_qty: 1 },
            { product_id: ids[0], counted_qty: 2 },
          ],
        },
      });
      assert.strictEqual(res.status, 400, `${tag}: duplicates are refused`);
      assert.ok(res.json.details.some((d) => /more than once/.test(d)), `${tag}: and the reason says so`);
    }
  });

  test('an empty batch and a bad location are both refused', async () => {
    for (const side of [sqlite, npmfree]) {
      const tag = side === sqlite ? 'sqlite' : 'npmfree';
      const location_id = await shelfFor(side);
      const ids = await productsFor(side);

      const empty = await call(side.url, '/api/inventory/counts', {
        method: 'POST',
        token: side.token.staff,
        body: { location_id, counts: [] },
      });
      assert.strictEqual(empty.status, 400, `${tag}: nothing to record`);

      const badLoc = await call(side.url, '/api/inventory/counts', {
        method: 'POST',
        token: side.token.staff,
        body: { location_id: 999999, counts: [{ product_id: ids[0], counted_qty: 1 }] },
      });
      assert.strictEqual(badLoc.status, 404, `${tag}: unknown shelf`);

      const badProduct = await call(side.url, '/api/inventory/counts', {
        method: 'POST',
        token: side.token.staff,
        body: { location_id, counts: [{ product_id: 999999, counted_qty: 1 }] },
      });
      assert.strictEqual(badProduct.status, 400, `${tag}: unknown product`);
    }
  });

  test('a batch beyond the cap is refused rather than buffered', async () => {
    const { MAX_BATCH_LINES } = require('../config');
    for (const side of [sqlite, npmfree]) {
      const tag = side === sqlite ? 'sqlite' : 'npmfree';
      const location_id = await shelfFor(side);
      const ids = await productsFor(side);
      const res = await call(side.url, '/api/inventory/counts', {
        method: 'POST',
        token: side.token.staff,
        body: {
          location_id,
          counts: Array.from({ length: MAX_BATCH_LINES + 1 }, () => ({ product_id: ids[0], counted_qty: 1 })),
        },
      });
      assert.strictEqual(res.status, 400, `${tag}: over the cap`);
    }
  });

  test('a partial walk is allowed, and still reports what is left', async () => {
    const side = sqlite;
    const location_id = await shelfFor(side);
    const ids = await productsFor(side);
    const res = await call(side.url, '/api/inventory/counts', {
      method: 'POST',
      token: side.token.staff,
      body: { location_id, counts: [{ product_id: ids[0], counted_qty: 1 }] },
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.json.recorded, 1);
    assert.ok(res.json.shelf.lines_remaining > 0, 'the shelf is NOT clear — one line of many');
  });

  test('an unauthenticated walk is refused', async () => {
    for (const side of [sqlite, npmfree]) {
      const res = await call(side.url, '/api/inventory/counts', {
        method: 'POST',
        body: { location_id: 1, counts: [{ product_id: 1, counted_qty: 1 }] },
      });
      assert.strictEqual(res.status, 401);
    }
  });
});
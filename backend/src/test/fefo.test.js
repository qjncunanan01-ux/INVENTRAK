// FEFO (First-Expired, First-Out) lot-consumption tests.
//
// The system consumes stock FIFO by default (oldest received_at first), but
// lots carrying an expiry_date are consumed even earlier — soonest expiry
// wins — while non-expiring lots keep classic FIFO behavior. These tests
// drive BOTH backends through HTTP (same requests, same assertions) so the
// SQLite backend and the npm-free fallback provably agree.
const assert = require('node:assert');
const { test, before, after } = require('node:test');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

const PROD = 2; // any seeded product
const LOC_A = 1;
const LOC_B = 2;
const LOC_C = 3;

const day = (offset) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

// Sum of open-lot qty for one product/location on one backend.
async function lotQty(side, productId, locationId) {
  const { status, json } = await call(
    side.url,
    `/api/stock-lots?product_id=${productId}&location_id=${locationId}`,
    { token: side.token.admin }
  );
  assert.strictEqual(status, 200);
  return json.reduce((sum, lot) => sum + Number(lot.qty), 0);
}

// Move a lot and assert the movement succeeded.
async function move(side, body) {
  const { status, json } = await call(side.url, '/api/stock-movement', {
    method: 'POST',
    token: side.token.admin,
    body,
  });
  assert.strictEqual(status, 200, `movement should succeed: ${JSON.stringify(body)} -> ${JSON.stringify(json)}`);
  return json;
}

test.before(bootBoth);
test.after(teardown);

test('POST stock-movement validates expiry_date format on both backends', async () => {
  for (const side of [sqlite, npmfree]) {
    const cases = ['not-a-date', '2030-13-01', '2030-1-1', '2030/01/01'];
    for (const bad of cases) {
      const { status, json } = await call(side.url, '/api/stock-movement', {
        method: 'POST',
        token: side.token.admin,
        body: {
          product_id: PROD,
          qty: 1,
          type: 'stock-in',
          dst_location: LOC_A,
          expiry_date: bad,
        },
      });
      assert.strictEqual(status, 400, `${side === sqlite ? 'sqlite' : 'npmfree'} should reject ${JSON.stringify(bad)}`);
      assert.match(json.error, /expiry_date/);
    }
  }
});

test('stock-in with expiry_date records a lot carrying that expiry on both backends', async () => {
  const longLife = day(365);
  for (const side of [sqlite, npmfree]) {
    await move(side, {
      product_id: PROD,
      qty: 10,
      type: 'stock-in',
      dst_location: LOC_A,
      expiry_date: longLife,
      notes: 'fefo test lot A',
    });
    const { status, json } = await call(
      side.url,
      `/api/stock-lots?product_id=${PROD}&location_id=${LOC_A}`,
      { token: side.token.admin }
    );
    assert.strictEqual(status, 200);
    const lot = json.find((l) => l.expiry_date === longLife);
    assert.ok(lot, 'lot with the supplied expiry_date should exist');
    assert.strictEqual(Number(lot.qty), 10);
    // Schema parity: every lot exposes expiry_date (nullable).
    for (const l of json) assert.ok('expiry_date' in l, 'expiry_date key present on every lot');
  }
});

test('FEFO: soonest-expiry lot is consumed first, FIFO lots untouched', async () => {
  const soon = day(1);
  for (const side of [sqlite, npmfree]) {
    const before = await lotQty(side, PROD, LOC_A);
    // Arrives AFTER the long-life lot but expires much sooner.
    await move(side, {
      product_id: PROD,
      qty: 6,
      type: 'stock-in',
      dst_location: LOC_A,
      expiry_date: soon,
      notes: 'fefo soon-expiring lot',
    });
    const withSoon = before + 6;
    assert.strictEqual(await lotQty(side, PROD, LOC_A), withSoon);

    // Consume exactly the soon lot's qty — pure FIFO would eat the older
    // long-life/seeded lots; FEFO must eat the soon-expiring one.
    await move(side, { product_id: PROD, qty: 6, type: 'stock-out', src_location: LOC_A });
    assert.strictEqual(await lotQty(side, PROD, LOC_A), before, 'only the soon lot should be consumed');

    // The soon lot must be gone; the long-life lot must remain.
    const { json: lots } = await call(
      side.url,
      `/api/stock-lots?product_id=${PROD}&location_id=${LOC_A}`,
      { token: side.token.admin }
    );
    assert.ok(!lots.some((l) => l.expiry_date === soon), 'soon-expiring lot fully consumed');
    assert.ok(lots.some((l) => l.qty > 0), 'remaining lots still open');
  }
});

test('FEFO: non-expiring lots are consumed last (after every expiring lot)', async () => {
  // Drain everything at LOC_B, then build a controlled mix:
  //   lot 1: no expiry, arrived first (classic FIFO would pick this)
  //   lot 2: expires in 3 days
  // A stock-out must consume lot 2, leaving lot 1 intact.
  for (const side of [sqlite, npmfree]) {
    const initial = await lotQty(side, PROD, LOC_B);
    if (initial > 0) {
      await move(side, { product_id: PROD, qty: initial, type: 'stock-out', src_location: LOC_B });
    }
    assert.strictEqual(await lotQty(side, PROD, LOC_B), 0, 'location drained for a clean mix');

    await move(side, { product_id: PROD, qty: 5, type: 'stock-in', dst_location: LOC_B, notes: 'no expiry, first' });
    await move(side, {
      product_id: PROD,
      qty: 4,
      type: 'stock-in',
      dst_location: LOC_B,
      expiry_date: day(3),
      notes: 'expires soon, second',
    });

    await move(side, { product_id: PROD, qty: 4, type: 'stock-out', src_location: LOC_B });

    const { json: lots } = await call(
      side.url,
      `/api/stock-lots?product_id=${PROD}&location_id=${LOC_B}`,
      { token: side.token.admin }
    );
    const noExpiry = lots.find((l) => l.expiry_date == null);
    assert.ok(noExpiry && Number(noExpiry.qty) === 5, 'non-expiring lot must NOT be consumed while an expiring lot exists');
    assert.ok(!lots.some((l) => l.expiry_date === day(3)), 'expiring lot consumed first despite arriving later');
  }
});

test('transfer carries the expiry_date to the destination lot', async () => {
  const exp = day(60);
  for (const side of [sqlite, npmfree]) {
    await move(side, {
      product_id: PROD,
      qty: 8,
      type: 'stock-in',
      dst_location: LOC_C,
      expiry_date: exp,
      notes: 'transfer source lot',
    });
    await move(side, { product_id: PROD, qty: 3, type: 'transfer', src_location: LOC_C, dst_location: LOC_A });

    const { json: destLots } = await call(
      side.url,
      `/api/stock-lots?product_id=${PROD}&location_id=${LOC_A}`,
      { token: side.token.admin }
    );
    const moved = destLots.find((l) => l.expiry_date === exp && Number(l.qty) === 3);
    assert.ok(moved, 'destination lot keeps the source expiry_date and remaining qty');
  }
});

test('GET /api/stock-lots?expiring_within filters to lots expiring in the window', async () => {
  for (const side of [sqlite, npmfree]) {
    const { status, json } = await call(side.url, '/api/stock-lots?expiring_within=30', {
      token: side.token.admin,
    });
    assert.strictEqual(status, 200);
    // Every returned lot has an expiry within the next 30 days (or expired).
    const cutoff = day(30);
    for (const lot of json) {
      assert.ok(lot.expiry_date != null, 'filtered view only contains dated lots');
      assert.ok(lot.expiry_date <= cutoff, `lot expiry ${lot.expiry_date} within cutoff ${cutoff}`);
    }
    // The 365-day lot from the earlier test must not appear here.
    assert.ok(!json.some((l) => l.expiry_date === day(365)), 'long-life lot excluded from the 30-day view');
  }
});

test('GET /api/stock-lots orders FEFO: dated lots first, then FIFO', async () => {
  for (const side of [sqlite, npmfree]) {
    const { status, json } = await call(side.url, `/api/stock-lots?product_id=${PROD}`, {
      token: side.token.admin,
    });
    assert.strictEqual(status, 200);
    assert.ok(json.length >= 2, 'seeded + test lots present');
    let seenNull = false;
    for (const lot of json) {
      if (lot.expiry_date == null) seenNull = true;
      else assert.ok(!seenNull, 'all dated lots sort before non-dated lots');
    }
  }
});

test('invalid expiring_within is rejected identically on both backends', async () => {
  for (const side of [sqlite, npmfree]) {
    for (const bad of ['nope', '-1', '99999']) {
      const { status } = await call(side.url, `/api/stock-lots?expiring_within=${encodeURIComponent(bad)}`, {
        token: side.token.admin,
      });
      assert.strictEqual(status, 400, `expiring_within=${bad} should 400`);
    }
  }
});

// Best-before capture on physical counts.
//
// Staff record the expiry date printed on a product label while counting
// (the staff app's CountCard). The date rides on the PENDING adjustment row;
// when the owner approves it, the location's reset stock lot is stamped with
// that expiry — so FEFO consumption (fefo.test.js) and best-before alerts
// (the derived alert pass in app.js / server_npmfree.js) track the counted
// stock automatically.
//
// Asserted on BOTH backends (SQLite + npm-free JSON driver) per the standard
// dual-backend contract bar.

const assert = require('node:assert');
const test = require('node:test');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

test.before(bootBoth);
test.after(teardown);

// createStockLots reads /api/stock-lots filtered to product+location.
async function lotSum(side, productId, locationId) {
  const res = await call(
    side.url,
    `/api/stock-lots?product_id=${productId}&location_id=${locationId}`,
    { token: side.token.staff }
  );
  assert.strictEqual(res.status, 200, `stock-lots list must be 200 (${res.status})`);
  const lots = res.json;
  const sum = (Array.isArray(lots) ? lots : []).reduce((acc, l) => acc + Number(l.qty || 0), 0);
  return { sum, lots };
}

test('best-before: adjustment carries expiry_date through create → row → approval → lot', async () => {
  for (const side of [sqlite, npmfree]) {
    const auth = { token: side.token.staff };

    // 1. Staff submits a count with the best-before date from the label.
    const create = await call(side.url, '/api/stock-adjustments', {
      method: 'POST',
      token: side.token.staff,
      body: {
        product_id: 2,
        location_id: 1,
        new_qty: 12,
        reason: 'physical count with best-before',
        expiry_date: '2027-06-30',
      },
    });
    assert.strictEqual(create.status, 201, `create must be 201, got ${create.status}: ${JSON.stringify(create.json)}`);
    const adjId = create.json.id;

    // 2. The pending row exposes the recorded expiry (staff can read their
    //    own submission back; the owner sees it on the approvals queue).
    const list = await call(side.url, '/api/stock-adjustments', auth);
    assert.strictEqual(list.status, 200);
    const rows = Array.isArray(list.json) ? list.json : [];
    const row = rows.find((r) => Number(r.id) === Number(adjId));
    assert.ok(row, 'the submitted adjustment is in the list');
    assert.strictEqual(row.expiry_date, '2027-06-30', 'row carries the recorded best-before');

    // 3. Approve as admin — the reset lot must inherit the expiry.
    const approve = await call(side.url, `/api/stock-adjustments/${adjId}/approve`, {
      method: 'POST',
      token: side.token.admin,
    });
    assert.strictEqual(approve.status, 200, `approve must be 200, got ${approve.status}`);

    // 4. The location's stock was reset to 12 and its single lot carries
    //    the best-before date — FEFO/best-before alerts can now act on it.
    const { sum, lots } = await lotSum(side, 2, 1);
    assert.strictEqual(sum, 12, 'approved count resets the location stock to 12');
    const dated = lots.filter((l) => l.expiry_date === '2027-06-30');
    assert.ok(dated.length >= 1, 'a lot with the recorded expiry exists after approval');
    assert.strictEqual(
      dated.reduce((acc, l) => acc + Number(l.qty || 0), 0),
      12,
      'the dated lot holds the whole approved quantity'
    );
  }
});

test('best-before: rejected/absent expiry never reaches a lot', async () => {
  for (const side of [sqlite, npmfree]) {
    // No expiry_date supplied → row stores null (shape parity with rows that
    // carry a date), and approval leaves the lot undated (pure FIFO).
    const create = await call(side.url, '/api/stock-adjustments', {
      method: 'POST',
      token: side.token.staff,
      body: { product_id: 3, location_id: 2, new_qty: 7, reason: 'no date on label' },
    });
    assert.strictEqual(create.status, 201);
    const list = await call(side.url, '/api/stock-adjustments', { token: side.token.staff });
    const rows = Array.isArray(list.json) ? list.json : [];
    const row = rows.find((r) => Number(r.id) === Number(create.json.id));
    assert.strictEqual(row.expiry_date, null, 'absent expiry is stored as null, not omitted');

    const approve = await call(side.url, `/api/stock-adjustments/${create.json.id}/approve`, {
      method: 'POST',
      token: side.token.admin,
    });
    assert.strictEqual(approve.status, 200);

    const { lots } = await lotSum(side, 3, 2);
    assert.ok(
      lots.every((l) => l.expiry_date == null),
      'approval without a best-before leaves lots undated'
    );
  }
});

test('best-before: invalid dates are refused with 400 on both backends', async () => {
  for (const side of [sqlite, npmfree]) {
    // Malformed (not YYYY-MM-DD).
    const bad = await call(side.url, '/api/stock-adjustments', {
      method: 'POST',
      token: side.token.staff,
      body: { product_id: 2, location_id: 1, new_qty: 5, expiry_date: '30/06/2027' },
    });
    assert.strictEqual(bad.status, 400, 'non-ISO date must be 400');

    // Impossible calendar date (2027-02-31 does not exist).
    const impossible = await call(side.url, '/api/stock-adjustments', {
      method: 'POST',
      token: side.token.staff,
      body: { product_id: 2, location_id: 1, new_qty: 5, expiry_date: '2027-02-31' },
    });
    assert.strictEqual(impossible.status, 400, 'impossible calendar date must be 400');

    // Empty string = "no date", accepted (row stores null).
    const empty = await call(side.url, '/api/stock-adjustments', {
      method: 'POST',
      token: side.token.staff,
      body: { product_id: 2, location_id: 1, new_qty: 5, expiry_date: '' },
    });
    assert.strictEqual(empty.status, 201, 'empty expiry_date is treated as absent');
  }
});

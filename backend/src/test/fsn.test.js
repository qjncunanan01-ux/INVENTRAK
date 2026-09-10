// FSN (Fast/Slow/Non-moving) classification tests.
//
// Part 1 is pure unit tests of the shared classifier (backend/src/fsn.js)
// with an injected clock so results are deterministic.
// Part 2 boots BOTH backends through the shared harness and asserts the
// /api/optimization/fsn endpoint behaves identically on the SQLite backend
// and the npm-free fallback (the same parity bar every other endpoint meets).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  FSN_WINDOW_DAYS,
  parseFsnWindow,
  classifyFsn,
  classifyFsnCatalog,
  summarizeFsn,
} = require('../fsn');
const { sqlite, npmfree, bootBoth, teardown, call, both, shapeOf } = require('./harness');

// Fixed clock: 2026-09-10T12:00:00Z. All relative dates below are computed
// from this instant so the classifier's output never drifts with real time.
const NOW = new Date('2026-09-10T12:00:00Z');

const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

// ===== Part 1: unit tests (injected clock, deterministic) =====

test('fsn: no sales in the window classifies Non-moving (N)', () => {
  const r = classifyFsn([], { id: 1, name: 'Dead Item', price: 100 }, 90, { now: NOW });
  assert.strictEqual(r.classification, 'N');
  assert.strictEqual(r.transactions, 0);
  assert.strictEqual(r.frequencyDays, null);
  assert.strictEqual(r.recencyDays, null);
  assert.strictEqual(r.totalQty, 0);
  assert.strictEqual(r.valueSold, 0);
  assert.strictEqual(r.windowDays, 90);
});

test('fsn: out-of-window sales do not count (treated as non-moving)', () => {
  const r = classifyFsn(
    [{ transaction_date: daysAgo(120), qty: 5 }],
    { id: 1, name: 'Old Stock', price: 50 },
    90,
    { now: NOW }
  );
  assert.strictEqual(r.classification, 'N');
});

test('fsn: sale within the recency grace period is Fast even with a sparse history', () => {
  // One sale 3 days ago: frequency (90) is above the threshold but recency
  // rescues it — a genuinely active product must not be labelled Slow.
  const r = classifyFsn(
    [{ transaction_date: daysAgo(3), qty: 2 }],
    { id: 2, name: 'Recent Seller', price: 10 },
    90,
    { now: NOW }
  );
  assert.strictEqual(r.classification, 'F');
  assert.strictEqual(r.recencyDays, 3);
  assert.strictEqual(r.transactions, 1);
});

test('fsn: weekly seller classifies Fast by frequency', () => {
  // 13 sales in 90 days => frequency floor(90/13)=6 days <= 7 => Fast.
  const txns = Array.from({ length: 13 }, (_, i) => ({ transaction_date: daysAgo(i * 6 + 1), qty: 4 }));
  const r = classifyFsn(txns, { id: 3, name: 'Weekly', price: 20 }, 90, { now: NOW });
  assert.strictEqual(r.classification, 'F');
  assert.strictEqual(r.frequencyDays, 6);
  assert.strictEqual(r.recencyDays, 1);
});

test('fsn: sporadic seller with old last sale classifies Slow (S)', () => {
  // 3 sales at ~day 40-60: frequency 30 > 7, recency 40 > 7 => Slow.
  const txns = [daysAgo(40), daysAgo(50), daysAgo(60)].map((d) => ({ transaction_date: d, qty: 1 }));
  const r = classifyFsn(txns, { id: 4, name: 'Trickler', price: 5 }, 90, { now: NOW });
  assert.strictEqual(r.classification, 'S');
  assert.strictEqual(r.frequencyDays, 30);
  assert.strictEqual(r.recencyDays, 40);
});

test('fsn: daily+ sellers cap frequency at 1', () => {
  const txns = Array.from({ length: 100 }, (_, i) => ({ transaction_date: daysAgo(i % 80), qty: 1 }));
  const r = classifyFsn(txns, { id: 5, name: 'Flyer', price: 1 }, 90, { now: NOW });
  assert.strictEqual(r.classification, 'F');
  assert.strictEqual(r.frequencyDays, 1);
});

test('fsn: monetary + rate stats are computed over the window only', () => {
  const r = classifyFsn(
    [{ transaction_date: daysAgo(1), qty: 4 }, { transaction_date: daysAgo(2), qty: 1 }],
    { id: 6, name: 'Priced', price: 2.5 },
    90,
    { now: NOW }
  );
  // (4+1) * 2.5 = 12.5 revenue; 5 units / 90 days ~= 0.06/day.
  assert.strictEqual(r.valueSold, 12.5);
  assert.strictEqual(r.totalQty, 5);
  assert.strictEqual(r.ratePerDay, 0.06);
});

test('fsn: parseFsnWindow clamps and defaults', () => {
  assert.strictEqual(parseFsnWindow(undefined), FSN_WINDOW_DAYS);
  assert.strictEqual(parseFsnWindow(''), FSN_WINDOW_DAYS);
  assert.strictEqual(parseFsnWindow('garbage'), FSN_WINDOW_DAYS);
  assert.strictEqual(parseFsnWindow('30'), 30);
  assert.strictEqual(parseFsnWindow('3'), 7, 'below minimum clamps up to 7');
  assert.strictEqual(parseFsnWindow('99999'), 730, 'above maximum clamps down to 730');
  assert.strictEqual(parseFsnWindow('30.6'), 31, 'rounds fractional days');
});

test('fsn: catalog sort puts Non-moving first, then Slow, then Fast', () => {
  const products = [
    { id: 1, name: 'Fast Product', price: 10 },
    { id: 2, name: 'Dead Product', price: 10 },
    { id: 3, name: 'Slow Product', price: 10 },
  ];
  const sales = [
    { product_id: 1, transaction_date: daysAgo(1), qty: 5 },
    { product_id: 3, transaction_date: daysAgo(45), qty: 1 },
    // product 2 never sold.
  ];
  const result = classifyFsnCatalog(products, sales, { now: NOW });
  assert.deepStrictEqual(result.map((r) => r.classification), ['N', 'S', 'F']);
  assert.deepStrictEqual(result.map((r) => r.name), ['Dead Product', 'Slow Product', 'Fast Product']);
});

test('fsn: summarizeFsn reports counts and percentage mix', () => {
  const items = [
    { classification: 'F' }, { classification: 'F' },
    { classification: 'S' },
    { classification: 'N' }, { classification: 'N' }, { classification: 'N' },
  ];
  const s = summarizeFsn(items);
  assert.deepStrictEqual(s.counts, { F: 2, S: 1, N: 3 });
  assert.strictEqual(s.total, 6);
  assert.strictEqual(s.percentages.F, 33.3);
  assert.strictEqual(s.percentages.S, 16.7);
  assert.strictEqual(s.percentages.N, 50);
});

// ===== Part 2: dual-backend endpoint parity =====

before(async () => {
  await bootBoth();
});

after(() => {
  teardown();
});

test('contract: GET /api/optimization/fsn returns identical shape on both backends', async () => {
  await both('GET /api/optimization/fsn', '/api/optimization/fsn');
});

test('contract: FSN endpoint returns all three classes on seeded data', async () => {
  for (const side of [sqlite, npmfree]) {
    const res = await call(side.url, '/api/optimization/fsn');
    assert.strictEqual(res.status, 200, `${side.url} should answer 200`);
    assert.ok(Array.isArray(res.json), 'expected an array');
    assert.ok(res.json.length > 0, 'expected classifications for the seeded catalog');

    const shape = shapeOf(res.json);
    assert.ok(shape.includes('classification:string'), 'unexpected row shape: ' + shape);
    const required = ['id', 'name', 'classification', 'transactions', 'ratePerDay', 'totalQty', 'valueSold', 'windowDays'];
    for (const key of required) {
      assert.ok(res.json.every((r) => key in r), `missing FsnItem key: ${key}`);
    }

    const classes = new Set(res.json.map((r) => r.classification));
    assert.deepStrictEqual(
      [...classes].sort(),
      ['F', 'N', 'S'],
      'seeded catalog should exercise all three FSN classes'
    );
    assert.ok(res.json.every((r) => typeof r.name === 'string' && r.name.length > 0));
    assert.ok(res.json.every((r) => r.windowDays === 90));
    // Sorted Non-moving first (the actionable dead stock surfaces on top).
    const firstIdx = res.json.findIndex((r) => r.classification !== 'N');
    assert.ok(
      firstIdx === -1 || res.json.slice(0, firstIdx).every((r) => r.classification === 'N'),
      'Non-moving items must sort first'
    );
  }
});

test('contract: FSN window query param is honored identically (7-day window isolates recent sellers)', async () => {
  await both('GET /api/optimization/fsn?window=7', '/api/optimization/fsn?window=7');
  for (const side of [sqlite, npmfree]) {
    const res = await call(side.url, '/api/optimization/fsn?window=7');
    assert.strictEqual(res.status, 200);
    assert.ok(res.json.every((r) => r.windowDays === 7), 'windowDays must echo the clamped param');
  }
});

test('contract: FSN window clamping is identical on both backends', async () => {
  // 3 clamps up to 7; 99999 clamps down to 730.
  for (const w of ['3', '99999', 'abc']) {
    for (const side of [sqlite, npmfree]) {
      const res = await call(side.url, `/api/optimization/fsn?window=${w}`);
      assert.strictEqual(res.status, 200, `${side.url} window=${w} should still answer 200`);
      assert.ok(Array.isArray(res.json));
    }
  }
  const tiny = await call(sqlite.url, '/api/optimization/fsn?window=3');
  const huge = await call(npmfree.url, '/api/optimization/fsn?window=99999');
  assert.ok(tiny.json.every((r) => r.windowDays === 7));
  assert.ok(huge.json.every((r) => r.windowDays === 730));
});

test('contract: FSN classifications agree with ABC on the same catalog (same ids, both backends)', async () => {
  // Cross-check consistency: every FSN row must reference a real catalog id
  // that also appears in the ABC output — the two analyses observe the same
  // active-product universe.
  for (const side of [sqlite, npmfree]) {
    const fsnRes = await call(side.url, '/api/optimization/fsn');
    const abcRes = await call(side.url, '/api/optimization/abc');
    assert.strictEqual(fsnRes.status, 200);
    assert.strictEqual(abcRes.status, 200);
    const abcIds = new Set(abcRes.json.map((r) => r.id));
    for (const row of fsnRes.json) {
      assert.ok(abcIds.has(row.id), `fsn row ${row.id} (${row.name}) missing from ABC output`);
    }
  }
});

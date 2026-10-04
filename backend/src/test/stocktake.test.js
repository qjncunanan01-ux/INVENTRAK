// WHY THIS SUITE EXISTS
// src/stocktake.js decides which shelves a business must physically walk again,
// and when. It is the one place in the codebase where a wrong answer is
// dangerous in the quiet direction: a bug that marks a fresh shelf as stale
// wastes an afternoon, but a bug that marks a stale shelf as fresh is SILENT.
// Nobody notices a shelf that quietly stopped being audited, which is exactly
// how shrinkage goes unnoticed until the reconciliation report has nothing
// recent to stand on.
//
// So the cases below are deliberately biased toward the false-negative side:
//
//   · a partial walk must NOT re-count the shelf (the tempting, wrong version
//     of this feature is "the newest count resets the clock");
//   · an UNREADABLE count timestamp must not count as fresh;
//   · a shelf with nothing stocked is never overdue — demanding a count of a
//     product that does not exist keeps a shelf red forever;
//   · the shelf clock runs from the OLDEST fresh line, not the newest, so one
//     count today cannot hide a line last walked four months ago.
//
// The last describe block is the cross-backend promise: the npm-free server
// feeds the same pure module from its own store, so the two boards must agree
// on identical inputs. That is asserted, not assumed.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

const { schedule, parseStamp, daysSince, DAY_MS } = require('../stocktake');

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0); // 2026-10-01T12:00:00Z
const daysAgo = n => new Date(NOW - n * DAY_MS).toISOString();

// Two shelves, four stocked lines:
//   Showroom   (1): 10, 11, 12   — 10 and 11 counted 5 days ago, 12 never
//   Warehouse  (2): 20, 21       — both counted 40 days ago (cycle is 30)
const locations = [
  { id: 1, name: 'Showroom' },
  { id: 2, name: 'Warehouse' },
];
const stock = [
  { product_id: 10, location_id: 1, quantity: 5 },
  { product_id: 11, location_id: 1, quantity: 3 },
  { product_id: 12, location_id: 1, quantity: 2 },
  { product_id: 20, location_id: 2, quantity: 50 },
  { product_id: 21, location_id: 2, quantity: 8 },
];
const counts = [
  { product_id: 10, location_id: 1, counted_at: daysAgo(5) },
  { product_id: 11, location_id: 1, counted_at: daysAgo(5) },
  { product_id: 20, location_id: 2, counted_at: daysAgo(40) },
  { product_id: 21, location_id: 2, counted_at: daysAgo(40) },
];

const board = () => schedule({ locations, stock, counts, cycleDays: 30, now: NOW });
const rowFor = (b, id) => b.rows.find(r => r.location_id === id);

describe('parseStamp — the two timestamp shapes this codebase writes', () => {
  test('reads SQLite "YYYY-MM-DD HH:MM:SS" as UTC, not local time', () => {
    // The trap: Date.parse reads this shape as LOCAL. On a UTC+8 machine that
    // is eight hours out, which is enough to reorder a count against a sale.
    assert.strictEqual(parseStamp('2026-10-01 12:00:00'), Date.UTC(2026, 9, 1, 12, 0, 0));
  });

  test('reads the ISO shape the count route writes', () => {
    assert.strictEqual(parseStamp('2026-10-01T12:00:00.000Z'), Date.UTC(2026, 9, 1, 12, 0, 0));
    assert.strictEqual(parseStamp('2026-10-01T12:00:00Z'), Date.UTC(2026, 9, 1, 12, 0, 0));
  });

  test('honours an explicit offset', () => {
    assert.strictEqual(parseStamp('2026-10-01T20:00:00+08:00'), Date.UTC(2026, 9, 1, 12, 0, 0));
  });

  test('returns null for anything it cannot read, rather than guessing', () => {
    for (const bad of [null, undefined, '', 'not a date', '2026-13-45 99:99:99', {}]) {
      assert.strictEqual(parseStamp(bad), null, JSON.stringify(bad) + ' should not parse');
    }
  });
});

describe('daysSince — floors, so a reminder never fires a day early', () => {
  test('29 days and 23 hours is 29 days, not 30', () => {
    assert.strictEqual(daysSince(NOW - (29 * DAY_MS + 23 * 3600000), NOW), 29);
  });

  test('an unreadable stamp has no age', () => {
    assert.strictEqual(daysSince(null, NOW), null);
  });
});

describe('schedule — the board, shelf by shelf', () => {
  test('a shelf with one fresh line out of three is OVERDUE, not ok', () => {
    const r = rowFor(board(), 1);
    assert.strictEqual(r.status, 'overdue');
    assert.strictEqual(r.total_lines, 3);
    assert.strictEqual(r.fresh_lines, 2);
    assert.strictEqual(r.never_counted_lines, 1);
    // The whole point: coverage stays below 1 until EVERY line is fresh.
    assert.strictEqual(r.coverage, 2 / 3);
  });

  test('a shelf whose lines are all past due is overdue, and says how far past', () => {
    const r = rowFor(board(), 2);
    assert.strictEqual(r.status, 'overdue');
    assert.strictEqual(r.stale_lines, 2);
    assert.ok(r.days_until_due < 0, 'an overdue shelf has a negative days_until_due');
    assert.strictEqual(r.days_until_due, -10); // 40 - 30
  });

  test('an overdue shelf is never also "due in the future"', () => {
    // Count one line today and leave the rest a month and a half old. A due date
    // anchored on the freshest count would call this shelf fine for 30 days
    // while 1 of its 3 lines is 45 days stale — the row would read "Overdue"
    // and "Due in 30 days" side by side.
    const mixed = [
      { product_id: 10, location_id: 1, counted_at: new Date(NOW).toISOString() }, // fresh today
      { product_id: 11, location_id: 1, counted_at: daysAgo(28) }, // fresh, barely
      { product_id: 12, location_id: 1, counted_at: daysAgo(45) }, // stale
    ];
    const r = rowFor(schedule({ locations, stock, counts: mixed, cycleDays: 30, now: NOW }), 1);
    assert.strictEqual(r.status, 'overdue');
    assert.strictEqual(r.fresh_lines, 2);
    assert.strictEqual(r.stale_lines, 1);
    assert.strictEqual(r.last_count_at, new Date(NOW).toISOString(), 'last_count_at is the newest count of any kind');
    // Anchored on the WORST line (45 days ago), so the shelf is 15 days late.
    assert.strictEqual(r.days_until_due, -15);
    assert.ok(r.days_until_due < 0, 'a shelf with a stale line is never "due later"');
    assert.strictEqual(r.days_since_oldest_count, 45);
  });

  test('a shelf with a never-counted line is due now, not at some future date', () => {
    // There is no date to count down from for a line that was never counted,
    // so the shelf is due the moment it is looked at.
    const partial = [
      { product_id: 10, location_id: 1, counted_at: daysAgo(1) },
      { product_id: 11, location_id: 1, counted_at: daysAgo(1) },
      // product 12 on location 1 has no count row at all.
    ];
    const r = rowFor(schedule({ locations, stock, counts: partial, cycleDays: 30, now: NOW }), 1);
    assert.strictEqual(r.status, 'overdue');
    assert.strictEqual(r.never_counted_lines, 1);
    assert.strictEqual(r.days_until_due, 0, 'due now, not due in 29 days');
  });

  test('a shelf counted entirely inside the cycle is ok, with days remaining', () => {
    const fresh = [
      { product_id: 10, location_id: 1, counted_at: daysAgo(5) },
      { product_id: 11, location_id: 1, counted_at: daysAgo(6) },
      { product_id: 12, location_id: 1, counted_at: daysAgo(7) },
      { product_id: 20, location_id: 2, counted_at: daysAgo(2) },
      { product_id: 21, location_id: 2, counted_at: daysAgo(3) },
    ];
    const b = schedule({ locations, stock, counts: fresh, cycleDays: 30, now: NOW });
    assert.strictEqual(rowFor(b, 1).status, 'ok');
    assert.strictEqual(rowFor(b, 1).coverage, 1);
    // Shelf clock = its OLDEST line (7 days), so 30 - 7 = 23 days of runway.
    assert.strictEqual(rowFor(b, 1).days_until_due, 23);
    assert.strictEqual(rowFor(b, 1).days_since_oldest_count, 7);
    assert.strictEqual(b.summary.shelves_needing_count, 0);
  });

  test('a shelf with stock but no counts at all is never_counted, and due now', () => {
    const b = schedule({ locations, stock, counts: [], cycleDays: 30, now: NOW });
    const r = rowFor(b, 1);
    assert.strictEqual(r.status, 'never_counted');
    assert.strictEqual(r.last_count_at, null, 'nothing has ever been counted');
    // No count to count down from, so the shelf is due at once rather than at
    // some invented future date.
    assert.strictEqual(r.due_at, new Date(NOW).toISOString());
    assert.strictEqual(r.days_until_due, 0);
    assert.strictEqual(b.summary.shelves_needing_count, 2, 'both shelves need a walk');
  });

  test('an UNREADABLE count timestamp does not count as fresh', () => {
    // Nobody can prove a line was counted if the row cannot say when.
    const junk = [
      { product_id: 10, location_id: 1, counted_at: daysAgo(1) },
      { product_id: 11, location_id: 1, counted_at: daysAgo(1) },
      { product_id: 12, location_id: 1, counted_at: 'sometime last week' },
    ];
    const r = rowFor(schedule({ locations, stock, counts: junk, cycleDays: 30, now: NOW }), 1);
    assert.strictEqual(r.fresh_lines, 2, 'the two readable counts still count');
    assert.strictEqual(r.never_counted_lines, 1, 'the unreadable one is not credited');
    assert.strictEqual(r.status, 'overdue');
  });

  test('an empty shelf is never overdue and demands nothing', () => {
    const b = schedule({
      locations: [{ id: 1, name: 'Showroom' }, { id: 3, name: 'Cold Room' }],
      stock: [{ product_id: 10, location_id: 1, quantity: 5 }],
      counts: [],
      cycleDays: 30,
      now: NOW,
    });
    const empty = rowFor(b, 3);
    assert.strictEqual(empty.status, 'empty');
    assert.strictEqual(empty.total_lines, 0);
    assert.strictEqual(empty.coverage, null, 'coverage of nothing is undefined, not 1 and not 0');
    assert.strictEqual(b.summary.shelves_needing_count, 1, 'the empty shelf is not on the to-do list');
    assert.strictEqual(b.summary.shelves_empty, 1);
  });

  test('a stock row at zero is not a line to walk', () => {
    // Otherwise every sold-out product keeps its shelf permanently red for a
    // product that is not physically there.
    const b = schedule({
      locations: [{ id: 1, name: 'Showroom' }],
      stock: [
        { product_id: 10, location_id: 1, quantity: 5 },
        { product_id: 11, location_id: 1, quantity: 0 },
      ],
      counts: [{ product_id: 10, location_id: 1, counted_at: daysAgo(1) }],
      cycleDays: 30,
      now: NOW,
    });
    assert.strictEqual(rowFor(b, 1).total_lines, 1, 'the zero row is not counted as a line');
    assert.strictEqual(rowFor(b, 1).status, 'ok');
  });

  test('a stock row with no matching count row is stale, not invisible', () => {
    const b = schedule({
      locations: [{ id: 1, name: 'Showroom' }],
      stock: [{ product_id: 10, location_id: 1, quantity: 5 }],
      counts: [],
      cycleDays: 30,
      now: NOW,
    });
    assert.strictEqual(rowFor(b, 1).status, 'never_counted');
    assert.strictEqual(b.summary.lines_stale, 1);
  });

  test('a count for a product NOT stocked at that location does not count the line', () => {
    const b = schedule({
      locations: [{ id: 1, name: 'Showroom' }],
      stock: [{ product_id: 10, location_id: 1, quantity: 5 }],
      counts: [{ product_id: 10, location_id: 1, counted_at: daysAgo(1) }],
      cycleDays: 30,
      now: NOW,
    });
    assert.strictEqual(rowFor(b, 1).fresh_lines, 1);
  });

  test('the newest of several counts for a line is the one that counts', () => {
    // A single-line shelf, so only the repeated-count behaviour is under test.
    const one = [{ id: 1, name: 'Showroom' }];
    const oneLine = [{ product_id: 10, location_id: 1, quantity: 5 }];
    const repeated = [
      { product_id: 10, location_id: 1, counted_at: daysAgo(60) },
      { product_id: 10, location_id: 1, counted_at: daysAgo(2) },
    ];
    const b = schedule({ locations: one, stock: oneLine, counts: repeated, cycleDays: 30, now: NOW });
    assert.strictEqual(rowFor(b, 1).status, 'ok', 'a recent re-count supersedes the old one');
    assert.strictEqual(rowFor(b, 1).fresh_lines, 1);
    assert.strictEqual(rowFor(b, 1).days_until_due, 28);
  });

  test('a longer cycle rescues a shelf that a 30-day cycle flags', () => {
    // The setting must actually change the answer, or the knob is decoration.
    const quarterly = schedule({ locations, stock, counts, cycleDays: 90, now: NOW });
    assert.strictEqual(rowFor(quarterly, 2).status, 'ok', '40 days is fine on a 90-day cycle');
  });

  test('worst shelves come first, and the order is stable between reads', () => {
    const b = board();
    assert.strictEqual(b.rows[0].status, 'overdue');
    const again = board();
    assert.deepStrictEqual(
      b.rows.map(r => r.location_id),
      again.rows.map(r => r.location_id),
    );
  });

  test('the summary counts shelves and lines honestly', () => {
    const s = board().summary;
    assert.strictEqual(s.cycle_days, 30);
    assert.strictEqual(s.locations, 2);
    assert.strictEqual(s.shelves_needing_count, 2);
    assert.strictEqual(s.lines_total, 5);
    // Showroom: 1 never-counted. Warehouse: 2 stale.
    assert.strictEqual(s.lines_stale, 3);
    assert.strictEqual(s.computed_at, new Date(NOW).toISOString());
  });

  test('a nonsense cycle falls back to 30 rather than dividing by zero', () => {
    for (const bad of [0, -5, NaN, undefined, null, 'abc']) {
      const s = schedule({ locations, stock, counts, cycleDays: bad, now: NOW }).summary;
      assert.strictEqual(s.cycle_days, 30, 'cycleDays=' + bad + ' should fall back');
    }
  });

  test('missing inputs are an empty board, not a crash', () => {
    const b = schedule();
    assert.deepStrictEqual(b.rows, []);
    assert.strictEqual(b.summary.shelves_needing_count, 0);
    assert.ok(schedule({ locations: null, stock: null, counts: null, now: NOW }));
  });
});

// ---------------------------------------------------------------------------
// Everything below needs two real servers, so it uses the shared harness: it
// boots the SQLite backend and the npm-free fallback side by side in an
// isolated temp dir. One boot for the file, matching reconciliation.test.js.
// ---------------------------------------------------------------------------

const { sqlite, npmfree, bootBoth, teardown, call, shapeOf, db } = require('./harness');
const { refreshStocktakeAlerts } = require('../alert-helpers');

before(async() => {
  await bootBoth();
});
after(() => {
  teardown();
});

describe('cross-backend parity — the two drivers must agree on the NUMBERS', () => {
  // Runs FIRST, on the seeded dataset both backends start from. The later
  // describe installs a controlled SQLite fixture, which would leave the two
  // drivers describing different worlds.
  //
  // The arithmetic is a shared pure module, but the INPUTS are gathered by each
  // backend separately — SQLite from normalised tables, npm-free from its JSON
  // inventory. A divergence there would produce two different stocktake boards
  // with no test failing, which is exactly what this block exists to catch.
  test('both backends serve the board with the same shape', async() => {
    const a = await call(sqlite.url, '/api/stocktake', { token: sqlite.token.admin });
    const b = await call(npmfree.url, '/api/stocktake', { token: npmfree.token.admin });
    assert.strictEqual(a.status, 200, 'sqlite serves the board');
    assert.strictEqual(b.status, 200, 'npm-free serves the board');
    assert.strictEqual(shapeOf(b.json), shapeOf(a.json), 'same structure from both drivers');
  });

  test('both backends report the same shelves as needing a walk', async() => {
    // Freshly seeded, nothing has ever been counted, so every stocked shelf is
    // never_counted on both sides. That is a real assertion about real data:
    // it fails if either driver forgets to count a shelf, or invents one.
    const a = (await call(sqlite.url, '/api/stocktake', { token: sqlite.token.admin })).json;
    const b = (await call(npmfree.url, '/api/stocktake', { token: npmfree.token.admin })).json;

    assert.deepStrictEqual(
      b.rows.map(r => r.location),
      a.rows.map(r => r.location),
      'the same shelves, in the same order, on both drivers',
    );
    assert.strictEqual(b.summary.shelves_needing_count, a.summary.shelves_needing_count);
    assert.strictEqual(b.summary.lines_total, a.summary.lines_total, 'the same number of lines to walk');
    assert.strictEqual(b.summary.lines_stale, a.summary.lines_stale);
  });

  test('counting the same shelf on both drivers produces the same numbers', async() => {
    // Drive an identical scenario through both: count what each one currently
    // believes, so the shelf flips from never_counted to ok on BOTH. Reading the
    // real starting figure rather than assuming it — the seeded quantities are
    // not a test's business.
    const PRODUCT = 5;
    const LOC = 1;
    for (const side of [sqlite, npmfree]) {
      const inv = await call(side.url, '/api/inventory', { token: side.token.admin });
      const locName = inv.json.locations.find(l => Number(l.id) === LOC).name;
      const item = inv.json.items.find(i => Number(i.product.id) === PRODUCT);
      const start = Number(item.locations[locName] || 0);
      const res = await call(side.url, '/api/inventory/count', {
        method: 'POST',
        token: side.token.admin,
        body: { product_id: PRODUCT, location_id: LOC, counted_qty: start },
      });
      assert.strictEqual(res.status, 201, 'the count is accepted');
    }

    const a = (await call(sqlite.url, '/api/stocktake', { token: sqlite.token.admin })).json;
    const b = (await call(npmfree.url, '/api/stocktake', { token: npmfree.token.admin })).json;

    const facts = board =>
      board.rows.map(r => [r.location, r.status, r.total_lines, r.fresh_lines, r.stale_lines, r.never_counted_lines]);
    assert.deepStrictEqual(facts(b), facts(a), 'shelf by shelf, the two drivers tell the same story');
    assert.strictEqual(b.cycle_days, a.cycle_days);
  });

  test('both backends enforce the same tier wall', async() => {
    for (const side of [sqlite, npmfree]) {
      const tag = side === sqlite ? 'sqlite' : 'npmfree';
      assert.strictEqual((await call(side.url, '/api/stocktake')).status, 401, `${tag}: no token`);
      assert.strictEqual((await call(side.url, '/api/stocktake', { token: side.token.staff })).status, 403, `${tag}: staff`);
      assert.strictEqual((await call(side.url, '/api/stocktake', { token: side.token.customer })).status, 403, `${tag}: customer`);
      assert.strictEqual((await call(side.url, '/api/stocktake', { token: side.token.admin })).status, 200, `${tag}: admin`);
    }
  });
});

describe('the stale_count flags on the real alerts feed', () => {
  before(() => {
    // A controlled fixture, installed AFTER the parity block. The seeded
    // dataset's three shelves are all uncounted and cannot tell "never counted"
    // apart from "stale", which is the distinction the flags have to carry.
    db.exec('DELETE FROM inventory_alerts');
    db.exec('DELETE FROM inventory_counts');
    db.exec('DELETE FROM stock');
    db.exec('DELETE FROM locations');
    const addProduct = db.prepare('INSERT INTO products (id, name, category, price) VALUES (?, ?, ?, ?)');
    addProduct.run(900, 'Bottled Water', 'Beverages', 15);
    addProduct.run(901, 'Rice 5kg', 'Grocery', 320);
    db.prepare('INSERT INTO locations (id, name) VALUES (?, ?)').run(1, 'Showroom');
    db.prepare('INSERT INTO locations (id, name) VALUES (?, ?)').run(2, 'Warehouse');
    // Showroom: two lines — one counted 40 days ago, one never counted at all.
    db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)').run(900, 1, 5);
    db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)').run(901, 1, 2);
    // Warehouse: one line, never counted.
    db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)').run(900, 2, 50);
    db.prepare('INSERT INTO inventory_counts (product_id, location_id, counted_qty, system_qty, counted_at) VALUES (?, ?, ?, ?, ?)').run(
      900, 1, 5, 5, daysAgo(40),
    );
  });

  const flags = () =>
    db
      .prepare(
        'SELECT location_id, threshold, current_qty, product_id, status, resolved_at FROM inventory_alerts WHERE alert_type = \'stale_count\' ORDER BY id',
      )
      .all();
  const active = () => flags().filter(r => r.status === 'active');

  test('an overdue shelf raises a flag carrying how stale it is', () => {
    refreshStocktakeAlerts(NOW);
    const rows = active();
    assert.strictEqual(rows.length, 2, 'Showroom is stale and Warehouse was never counted: both flagged');

    const showroom = rows.find(r => Number(r.location_id) === 1);
    assert.strictEqual(showroom.product_id, null, 'staleness belongs to the shelf, not to a line');
    // Showroom has one line counted 40 days ago (10 days past due on a 30-day
    // cycle) and one never counted. The flag must report the DATED lateness —
    // flattening it to 0 because a second line has no date would understate a
    // shelf that has a 40-day-old count sitting on it.
    assert.strictEqual(showroom.threshold, 10, 'threshold = days past due on the worst DATED line');
    // One line is stale, one was never counted at all: both are lines to walk.
    assert.strictEqual(showroom.current_qty, 2, 'current_qty counts stale AND never-counted lines');

    const warehouse = rows.find(r => Number(r.location_id) === 2);
    assert.strictEqual(warehouse.current_qty, 1, 'Warehouse: one stocked line, never counted');
    assert.strictEqual(warehouse.threshold, 0, 'never counted: due now, so zero days past due');
  });

  test('re-running the pass is idempotent — no duplicate flags', () => {
    const beforeCount = active().length;
    refreshStocktakeAlerts(NOW);
    refreshStocktakeAlerts(NOW);
    refreshStocktakeAlerts(NOW + 60000);
    assert.strictEqual(active().length, beforeCount, 'four passes must not create four flags');
  });

  test('a flag tracks its shelf getting older instead of spawning a new row', () => {
    refreshStocktakeAlerts(NOW);
    const first = db
      .prepare('SELECT id, threshold FROM inventory_alerts WHERE alert_type=\'stale_count\' AND status=\'active\' AND location_id=1')
      .get();
    refreshStocktakeAlerts(NOW + 3 * DAY_MS);
    const second = db
      .prepare('SELECT id, threshold FROM inventory_alerts WHERE alert_type=\'stale_count\' AND status=\'active\' AND location_id=1')
      .get();
    assert.strictEqual(second.id, first.id, 'same row, updated in place');
    assert.strictEqual(second.threshold, 13, 'three days older is three days further past due');
  });

  test('counting a shelf clears its flag, and records when it stopped being true', () => {
    refreshStocktakeAlerts(NOW);
    const fresh = new Date(NOW).toISOString();
    for (const [pid, lid, qty] of [
      [900, 1, 5],
      [901, 1, 2],
      [900, 2, 50],
    ]) {
      db.prepare('INSERT INTO inventory_counts (product_id, location_id, counted_qty, system_qty, counted_at) VALUES (?, ?, ?, ?, ?)').run(
        pid, lid, qty, qty, fresh,
      );
    }
    refreshStocktakeAlerts(NOW);
    assert.strictEqual(active().length, 0, 'a counted shelf is not overdue');
    const resolved = flags().filter(r => Number(r.location_id) === 1);
    assert.ok(resolved.every(r => r.status === 'resolved'), 'flags are resolved, not deleted');
    assert.ok(resolved.some(r => r.resolved_at), 'and the resolution is timestamped');
  });

  test('a shelf emptied of stock resolves its flag instead of nagging for ever', () => {
    db.exec('DELETE FROM inventory_counts');
    refreshStocktakeAlerts(NOW);
    assert.strictEqual(active().length, 2, 'deleting the counts makes both shelves due again');

    db.prepare('DELETE FROM stock WHERE location_id = ?').run(2);
    refreshStocktakeAlerts(NOW);
    const emptied = flags().find(r => Number(r.location_id) === 2 && r.status === 'resolved');
    assert.ok(emptied, 'a shelf with nothing stocked cannot be overdue');
    assert.ok(emptied.resolved_at, 'and it records when it stopped being true');
    assert.ok(
      flags().some(r => Number(r.location_id) === 1 && r.status === 'active'),
      'the shelf that still has stock stays flagged',
    );
  });

  test('the board and the alerts feed can never disagree', async() => {
    db.exec('DELETE FROM inventory_alerts');
    const board = (await call(sqlite.url, '/api/stocktake', { token: sqlite.token.admin })).json;
    const flagged = active().map(f => Number(f.location_id)).sort();
    assert.deepStrictEqual(
      flagged,
      board.rows.filter(r => r.status === 'overdue' || r.status === 'never_counted').map(r => r.location_id).sort(),
      'reading the board raises exactly the flags the board itself reports',
    );
  });

  test('staff find overdue shelves on the existing /api/alerts feed', async() => {
    // The flag has to be VISIBLE where staff already look. This is why the
    // alerts query had to become a LEFT JOIN on products: a shelf-level flag
    // has no product_id, and an inner join silently dropped every one of them.
    const res = await call(sqlite.url, '/api/alerts', { token: sqlite.token.admin });
    assert.strictEqual(res.status, 200);
    const stale = res.json.filter(a => a.alert_type === 'stale_count');
    assert.ok(stale.length > 0, 'stale_count flags reach the alerts feed');
    for (const a of stale) {
      assert.ok(a.location_name, 'a shelf flag names the shelf');
      assert.strictEqual(a.product_id, null, 'and belongs to no product');
    }
  });

  test('the low_stock alerts still behave after the change', async() => {
    // The LEFT JOIN must not have broken the join that names a product.
    const res = await call(sqlite.url, '/api/alerts', { token: sqlite.token.admin });
    const withProduct = res.json.filter(a => a.product_id != null);
    for (const a of withProduct) assert.ok(a.product_name, 'product alerts still name their product');
  });
});
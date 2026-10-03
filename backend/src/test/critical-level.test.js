// Critical level + stock status (backend/src/critical-level.js).
//
// WHY THIS SUITE EXISTS
// The Critical Level is what every low-stock badge in the product reads off,
// and it replaced a flat 80-unit threshold that was wrong in both directions —
// a fast mover hits empty long before an 80-unit alert fires, while a display
// piece raises a false alarm forever. It was an algorithm with ZERO test
// coverage: no suite in the repo mentioned "critical". ALGORITHMS.md §4 cites
// this file, and a defense claim that cannot be re-run is not a defense.
//
// The properties locked here are the ones that would make a threshold quietly
// wrong: the per-class floor (a brand-new product must still be orderable), the
// absolute clamps (a data spike must not produce an absurd threshold), and the
// badge boundaries (the same number that feeds the threshold also feeds the
// "Low Stock" cut-off).
const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  LEAD_TIME_DAYS,
  SERVICE_FACTOR,
  CLASS_FLOOR,
  MIN_LEVEL,
  MAX_LEVEL,
  CLASS_LABEL,
  criticalLevelFor,
  criticalLevelFromMap,
  criticalLevelMap,
  stockStatus,
  stockStatusLabel,
} = require('../critical-level');

describe('criticalLevelFor — the formula', () => {
  test('cycle demand is rate x lead time, with the service factor as buffer', () => {
    // A fast mover selling 5/day with a 7-day lead: 35 units of cycle demand,
    // safety stock = ceil(35 x 0.65) = 23, demand level = 35 + 23 = 58.
    const r = criticalLevelFor({ classification: 'F', ratePerDay: 5 });
    assert.strictEqual(r.leadTimeDays, 7);
    assert.strictEqual(r.safetyStock, 23);
    // The class floor (120) exceeds the demand term, so the floor wins here.
    assert.strictEqual(r.criticalLevel, 120);
  });

  test('once demand exceeds the class floor, the demand term governs', () => {
    // 40/day is the motivating case from the module header: a fast-moving milk
    // that empties long before the old flat 80-unit threshold would have fired.
    const r = criticalLevelFor({ classification: 'F', ratePerDay: 40 });
    // cycle = 40 x 7 = 280; safety = ceil(280 x 0.65) = 182; level = 462
    assert.strictEqual(r.safetyStock, 182);
    assert.strictEqual(r.criticalLevel, 462);
    assert.ok(r.criticalLevel > 80, 'must clear the old flat threshold it replaced');
  });

  test('each class carries its own lead time, service factor and floor', () => {
    const fast = criticalLevelFor({ classification: 'F', ratePerDay: 0 });
    const slow = criticalLevelFor({ classification: 'S', ratePerDay: 0 });
    const none = criticalLevelFor({ classification: 'N', ratePerDay: 0 });
    // With no demand the floor decides, and the floors are ordered
    // F > S > N: the faster it moves, the sooner you must reorder.
    assert.strictEqual(fast.criticalLevel, CLASS_FLOOR.F);
    assert.strictEqual(slow.criticalLevel, CLASS_FLOOR.S);
    assert.strictEqual(none.criticalLevel, CLASS_FLOOR.N);
    assert.ok(CLASS_FLOOR.F > CLASS_FLOOR.S && CLASS_FLOOR.S > CLASS_FLOOR.N);
    assert.strictEqual(fast.leadTimeDays, LEAD_TIME_DAYS.F);
    assert.strictEqual(none.leadTimeDays, LEAD_TIME_DAYS.N);
    assert.ok(SERVICE_FACTOR.F > SERVICE_FACTOR.S && SERVICE_FACTOR.S > SERVICE_FACTOR.N);
  });

  test('labels match the movement class', () => {
    assert.strictEqual(criticalLevelFor({ classification: 'F' }).movementLabel, CLASS_LABEL.F);
    assert.strictEqual(criticalLevelFor({ classification: 'N' }).movementLabel, 'Non-moving');
  });
});

describe('criticalLevelFor — defensive handling', () => {
  test('a brand-new product with no history is treated as Non-moving', () => {
    // criticalLevelFromMap routes unknown products through criticalLevelFor(null).
    // A new SKU must still get an orderable threshold, not 0 or NaN.
    for (const input of [null, undefined, {}]) {
      const r = criticalLevelFor(input);
      assert.strictEqual(r.classification, 'N');
      assert.strictEqual(r.criticalLevel, CLASS_FLOOR.N);
    }
  });

  test('an unrecognised classification falls back to the safest class', () => {
    const r = criticalLevelFor({ classification: 'Z', ratePerDay: 1 });
    assert.strictEqual(r.classification, 'N');
  });

  test('a non-numeric rate reads as zero rather than NaN', () => {
    // Number('abc') is NaN, and a NaN threshold would poison every comparison
    // downstream — every badge would silently fall through.
    for (const rate of ['abc', undefined, null, {}]) {
      const r = criticalLevelFor({ classification: 'F', ratePerDay: rate });
      assert.strictEqual(r.ratePerDay, 0);
      assert.ok(Number.isFinite(r.criticalLevel));
    }
  });

  test('negative demand cannot produce a negative threshold', () => {
    const r = criticalLevelFor({ classification: 'F', ratePerDay: -50 });
    assert.ok(r.criticalLevel >= MIN_LEVEL, 'clamped up to the floor');
  });

  test('a demand spike is clamped at MAX_LEVEL', () => {
    // A bulk import or a data error must not produce a 4-million-unit alert.
    const r = criticalLevelFor({ classification: 'F', ratePerDay: 1000000 });
    assert.strictEqual(r.criticalLevel, MAX_LEVEL);
  });

  test('the level is always an integer', () => {
    for (const rate of [0, 1, 2.5, 3.33, 7.77, 40]) {
      const r = criticalLevelFor({ classification: 'F', ratePerDay: rate });
      assert.strictEqual(Number.isInteger(r.criticalLevel), true, `rate ${rate}`);
    }
  });
});

describe('criticalLevelMap / criticalLevelFromMap', () => {
  const products = [
    { id: 1, name: 'Fast', price: 100 },
    { id: 2, name: 'Dead', price: 100 },
  ];
  // One sale today for product 1 only => it classifies Fast; product 2 has no
  // movement at all => Non-moving.
  const sales = [{ product_id: 1, qty: 10, transaction_date: new Date().toISOString() }];

  test('builds one entry per product, keyed by id', () => {
    const map = criticalLevelMap(products, sales, { windowDays: 90, now: new Date() });
    assert.ok(map instanceof Map);
    assert.strictEqual(map.size, 2);
    assert.ok(map.has(1) && map.has(2));
    assert.ok(Number.isFinite(map.get(1).criticalLevel));
  });

  test('the fast mover outranks the dead one', () => {
    const map = criticalLevelMap(products, sales, { windowDays: 90, now: new Date() });
    assert.strictEqual(map.get(1).classification, 'F');
    assert.strictEqual(map.get(2).classification, 'N');
    assert.ok(map.get(1).criticalLevel > map.get(2).criticalLevel);
  });

  test('an unknown product id still returns an orderable threshold', () => {
    const map = criticalLevelMap(products, sales, { windowDays: 90, now: new Date() });
    // A freshly created product is not in the map; it must not read as 0.
    assert.strictEqual(criticalLevelFromMap(map, 9999), CLASS_FLOOR.N);
    assert.ok(criticalLevelFromMap(map, 9999) >= MIN_LEVEL);
  });

  test('a missing or malformed map degrades to the Non-moving floor', () => {
    assert.strictEqual(criticalLevelFromMap(null, 1), CLASS_FLOOR.N);
    assert.strictEqual(criticalLevelFromMap(new Map(), 1), CLASS_FLOOR.N);
  });

  test('ids are coerced consistently', () => {
    const map = criticalLevelMap(products, sales, { windowDays: 90, now: new Date() });
    assert.strictEqual(criticalLevelFromMap(map, '1'), criticalLevelFromMap(map, 1));
  });
});

describe('stockStatus — the badges', () => {
  const level = 100;

  test('the four bands, and their boundaries', () => {
    assert.strictEqual(stockStatus(0, level), 'out_of_stock');
    assert.strictEqual(stockStatus(-5, level), 'out_of_stock');
    assert.strictEqual(stockStatus(1, level), 'critical');
    assert.strictEqual(stockStatus(100, level), 'critical', 'exactly at the level is critical');
    assert.strictEqual(stockStatus(101, level), 'low_stock');
    assert.strictEqual(stockStatus(150, level), 'low_stock', 'the default 1.5x band is inclusive');
    assert.strictEqual(stockStatus(151, level), 'in_stock');
  });

  test('the low-stock widening factor is owner-tunable and must be sane', () => {
    // A factor <= 1 is REJECTED, not honoured: at exactly 1 the "low" band
    // would collapse onto the critical level and the badge would be
    // unreachable. Invalid factors fall back to 1.5.
    assert.strictEqual(stockStatus(120, level, 1), 'low_stock', 'a factor of 1 is refused -> 1.5');
    assert.strictEqual(stockStatus(120, level, 2), 'low_stock', 'a wider band still covers 120');
    assert.strictEqual(stockStatus(320, level, 3), 'in_stock', 'a wider band pushes the cut-off out');
    assert.strictEqual(stockStatus(200, level, 1.5), 'in_stock', 'default band cuts off at 150');
    assert.strictEqual(stockStatus(120, level, 0), 'low_stock', 'invalid factors fall back to 1.5');
    assert.strictEqual(stockStatus(120, level, 'abc'), 'low_stock');
  });

  test('zero and garbage quantities are out of stock, not in stock', () => {
    // Number('') is 0 — the trap that has produced three real bugs in this repo.
    for (const qty of ['', ' ', null, undefined, 'abc', NaN]) {
      assert.strictEqual(stockStatus(qty, level), 'out_of_stock', `qty ${JSON.stringify(qty)}`);
    }
  });

  test('a zero critical level degenerates to in-stock, not a false alarm', () => {
    // Degenerate but SAFE: with a level of 0 the low band is ceil(0 x 1.5) = 0,
    // so nothing positive can ever read as low. The alternative — treating 0
    // as "no threshold configured" — would flag the entire catalog as critical.
    assert.strictEqual(stockStatus(1, 0), 'in_stock');
    assert.strictEqual(stockStatus(5, 0), 'in_stock');
    assert.strictEqual(stockStatus(0, 0), 'out_of_stock');
  });

  test('every status has a human label', () => {
    for (const s of ['out_of_stock', 'critical', 'low_stock', 'in_stock']) {
      assert.ok(stockStatusLabel(s), `${s} needs a label`);
    }
  });
});
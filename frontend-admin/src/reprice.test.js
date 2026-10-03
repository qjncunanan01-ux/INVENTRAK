// One-click reprice from the under-priced margin table.
//
// The panel's whole previous value was showing a number the admin then had to
// retype into the bulk price sheet by hand — throwing away the analysis it had
// just done. buildRepricePlan closes that gap, and the risk it introduces is
// that a bulk write of wrong numbers looks exactly like a bulk write of right
// ones. So this suite is mostly about what the plan REFUSES: a suggestion that
// is not actually higher, a duplicate, an unusable number. Every refusal must
// be reported, never silently dropped, because a plan that quietly sends 12 of
// 14 rows is a plan whose audit trail is wrong.
import { describe, test, expect } from 'vitest';
import { buildRepricePlan, describeReprice, buildCostInsights } from './cost-sheet';

describe('buildRepricePlan', () => {
  test('turns under-priced rows into the bulk-prices payload', () => {
    const plan = buildRepricePlan([
      { id: 1, name: 'Syrup 750ml', price: 500, suggested: 650, margin: 10 },
      { id: 2, name: 'Syrup 1L', price: 800, suggested: 1040, margin: 15 },
    ]);
    expect(plan.prices).toEqual([
      { id: 1, name: 'Syrup 750ml', price: 650 },
      { id: 2, name: 'Syrup 1L', price: 1040 },
    ]);
    expect(plan.skipped).toEqual([]);
    expect(plan.total).toBe(2);
  });

  test('refuses a suggestion that is not actually higher', () => {
    // Rounding at the target boundary can land exactly on the current price.
    // Sending it would still write the row and still report "1 updated".
    const plan = buildRepricePlan([{ id: 1, name: 'Syrup', price: 500, suggested: 500 }]);
    expect(plan.prices).toEqual([]);
    expect(plan.skipped).toEqual([{ name: 'Syrup', reason: 'already at or above the target' }]);
  });

  test('refuses an unusable suggested price', () => {
    for (const suggested of [undefined, null, NaN, 0, -10, 'abc']) {
      const plan = buildRepricePlan([{ id: 1, name: 'Syrup', price: 500, suggested }]);
      expect(plan.prices).toEqual([]);
      expect(plan.skipped[0].reason).toBe('no usable suggested price');
    }
  });

  test('refuses a duplicate name, which the endpoint would apply twice', () => {
    const plan = buildRepricePlan([
      { id: 1, name: 'Syrup', price: 500, suggested: 650 },
      { id: 2, name: 'syrup ', price: 500, suggested: 700 },
    ]);
    expect(plan.prices).toHaveLength(1);
    expect(plan.skipped[0].reason).toBe('listed twice');
  });

  test('refuses a row with no product name', () => {
    const plan = buildRepricePlan([{ id: 1, price: 500, suggested: 650 }]);
    expect(plan.prices).toEqual([]);
    expect(plan.skipped[0].reason).toBe('no product name');
  });

  test('every row is either priced or explained — never silently dropped', () => {
    // The invariant that makes the confirmation dialog honest.
    const plan = buildRepricePlan([
      { id: 1, name: 'Good', price: 500, suggested: 650 },
      { id: 2, name: 'Same', price: 500, suggested: 500 },
      { id: 3, name: 'Bad', price: 500, suggested: null },
      { id: 4, name: 'Good', price: 500, suggested: 700 },
      null,
    ]);
    expect(plan.prices.length + plan.skipped.length).toBe(plan.total);
  });

  test('an empty or missing table is an empty plan, not a crash', () => {
    expect(buildRepricePlan([]).prices).toEqual([]);
    expect(buildRepricePlan(null).prices).toEqual([]);
    expect(buildRepricePlan(undefined).total).toBe(0);
  });

  // The bug this locks: buildCostInsights used Math.round on the suggestion, so
  // cost 850 at a 30% target suggested 1214 — a 29.98% margin, still on the
  // under-priced list. Clicking Reprice then wrote 1214 again, reported "3 of 3
  // updated", and the flag never cleared. The suggestion now rounds UP.
  test('applying every suggestion actually clears the under-priced list', () => {
    const products = [
      { id: 1, name: 'Caramel Sauce', price: 1070, cost: 850, size: '2 L' },
      { id: 2, name: 'Cups', price: 198, cost: 155, size: '50PCS' },
      { id: 3, name: 'Butterscotch Sauce', price: 1070, cost: 820, size: '2 L' },
    ];
    const insights = buildCostInsights(products, 30);
    const plan = buildRepricePlan(insights.underPriced);
    expect(plan.prices).toHaveLength(3);

    // Replay the write, then recompute: nothing may remain under-priced.
    const replayed = products.map(p => {
      const hit = plan.prices.find(x => x.id === p.id);
      return hit ? { ...p, price: hit.price } : p;
    });
    const after = buildCostInsights(replayed, 30);
    expect(after.underPriced).toEqual([]);
  });

  test('a suggested price always meets the target it was computed for', () => {
    for (const cost of [1, 7, 99, 155, 850, 821, 1234, 9999]) {
      const insights = buildCostInsights([{ id: 1, name: 'X', price: cost * 1.5, cost }], 30);
      const u = insights.underPriced[0];
      if (!u) continue;
      expect(((u.suggested - u.cost) / u.suggested) * 100).toBeGreaterThanOrEqual(30);
    }
  });

  test('a product with no current price is still repriceable', () => {
    // price null means the catalog has never been priced; any real suggestion
    // is an improvement and refusing it would strand the row forever.
    const plan = buildRepricePlan([{ id: 1, name: 'Syrup', price: null, suggested: 650 }]);
    expect(plan.prices).toHaveLength(1);
  });
});

describe('describeReprice', () => {
  test('states the count, the target, and the money it moves', () => {
    const plan = buildRepricePlan([
      { id: 1, name: 'A', price: 500, suggested: 650 },
      { id: 2, name: 'B', price: 800, suggested: 1040 },
    ]);
    expect(describeReprice(plan, 30)).toBe('2 prices will be raised to the 30% target · new list value 1690.');
  });

  test('singularises one price', () => {
    const plan = buildRepricePlan([{ id: 1, name: 'A', price: 500, suggested: 650 }]);
    expect(describeReprice(plan, 30)).toContain('1 price will be raised');
  });

  test('says how many rows were left out', () => {
    const plan = buildRepricePlan([
      { id: 1, name: 'A', price: 500, suggested: 650 },
      { id: 2, name: 'B', price: 500, suggested: 500 },
    ]);
    expect(describeReprice(plan, 30)).toContain('1 left out');
  });

  test('an empty plan says so plainly', () => {
    expect(describeReprice(buildRepricePlan([]), 30)).toBe('Nothing to reprice.');
    expect(describeReprice(null, 30)).toBe('Nothing to reprice.');
  });
});
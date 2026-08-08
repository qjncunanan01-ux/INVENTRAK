// Parity test: the admin "Today's Flash Deals" card MUST show exactly what
// the customer app features, so the admin copy of the flash-sale algorithm
// (frontend-admin/src/flash-sale.js) is locked against drift from the mobile
// original (mobile-client/src/flash-sale.js). This test feeds the SAME inputs
// (a synthetic catalog, ABC ranking, stock map and a fixed clock) to both
// implementations and asserts byte-identical picks and deal pricing.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Load an ES-module-exported source file as CJS so it can be required
// headlessly (no babel/rollup needed — the modules are pure functions).
function loadAsCjs(filePath) {
  let src = fs.readFileSync(filePath, 'utf8');
  src = src.replace(/export function (\w+)/g, 'function $1');
  src = src.replace(/^export const /gm, 'const ');
  src += '\n;module.exports = { msUntilDailyRefresh, daySeed, dailyPicks, stockMapFromInventory, buildFlashPicks, dealPricing };';
  const m = { exports: {} };
  new Function('module', 'exports', 'require', src)(m, m.exports, require);
  return m.exports;
}

const adminFs = loadAsCjs(path.join(__dirname, 'flash-sale.js'));
const mobileFs = loadAsCjs(path.join(__dirname, '..', '..', 'mobile-client', 'src', 'flash-sale.js'));

// Deterministic synthetic inputs — same shape as the real API payloads
// (ABC ranking from /api/optimization/abc, catalog from /api/products,
// stock from /api/inventory) so a regression in the ALGORITHM (not the data)
// is what this catches.
const now = new Date(2026, 7, 8, 15, 30, 0).getTime(); // Aug 8 2026, 3:30pm local
const catalog = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1,
  name: `Product ${i + 1}`,
  category: i % 2 ? 'Syrups' : 'Milks',
  price: 100 + i * 25,
  image: `/images/p${i + 1}.jpg`,
}));
// A photo-less product (must be excluded from eligible picks).
catalog[5].image = null;
// An out-of-stock product (must be excluded via the stock map).
catalog[10].image = `/images/p11.jpg`;
const abc = catalog
  .map((p) => ({ id: p.id, name: p.name, value: (40 - p.id) * 1000, annualQty: 1 }))
  .sort((a, b) => b.value - a.value);
const stock = {};
catalog.forEach((p) => { stock[p.id] = 50; });
stock[11] = 0; // product id 11 is out of stock

describe('flash-sale parity (admin mirrors mobile)', () => {
  it('computes identical today picks and deal prices for identical inputs', () => {
    const adminPicks = adminFs.buildFlashPicks(abc, catalog, stock, now);
    const mobilePicks = mobileFs.buildFlashPicks(abc, catalog, stock, now);
    assert.deepStrictEqual(adminPicks, mobilePicks, 'buildFlashPicks outputs differ');
    assert.ok(adminPicks.length > 0, 'expected a non-empty pick list');

    // Both pick lists must contain only in-stock, photo-bearing products.
    for (const p of adminPicks) {
      assert.ok(p.image, `pick ${p.id} has no photo`);
      assert.ok(stock[p.id] > 0, `pick ${p.id} is out of stock`);
    }

    // Identical deal pricing for every pick.
    for (const pick of adminPicks) {
      assert.deepStrictEqual(
        adminFs.dealPricing(pick, now),
        mobileFs.dealPricing(pick, now),
        `dealPricing diverged for product ${pick.id}`
      );
    }
  });

  it('shares the same day seed and countdown horizon', () => {
    assert.strictEqual(adminFs.daySeed(now), mobileFs.daySeed(now));
    assert.strictEqual(
      adminFs.msUntilDailyRefresh(now),
      mobileFs.msUntilDailyRefresh(now)
    );
  });

  it('tolerates a failed ABC ranking (tops up from the pool, like mobile)', () => {
    const adminPicks = adminFs.buildFlashPicks([], catalog, stock, now);
    const mobilePicks = mobileFs.buildFlashPicks([], catalog, stock, now);
    assert.deepStrictEqual(adminPicks, mobilePicks);
    assert.ok(adminPicks.length > 0, 'expected pool top-up to fill the carousel');
  });

  it('produces a deterministic day-to-day rotation with no stuck subset', () => {
    const seeds = [new Date(2026, 7, 8).getTime(), new Date(2026, 7, 9).getTime(), new Date(2026, 7, 10).getTime()];
    const daySets = seeds.map((s) => {
      const picks = adminFs.buildFlashPicks(abc, catalog, stock, s);
      assert.deepStrictEqual(picks, mobileFs.buildFlashPicks(abc, catalog, stock, s));
      return new Set(picks.map((p) => Number(p.id)));
    });
    // Three consecutive days should NOT all feature the identical subset.
    const allSame = daySets[0].size === daySets[1].size
      && daySets[1].size === daySets[2].size
      && [...daySets[0]].every((id) => daySets[1].has(id) && daySets[2].has(id));
    assert.strictEqual(allSame, false, 'rotation should change across days');
  });
});

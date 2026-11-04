// These helpers power the admin "Today's Flash Deals" card. Keep the tests
// focused on the behavior the admin module actually owns: eligibility,
// deterministic daily rotation, safe fallback picks, and bounded pricing.
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
catalog[10].image = '/images/p11.jpg';
const abc = catalog
  .map((p) => ({ id: p.id, name: p.name, value: (40 - p.id) * 1000, annualQty: 1 }))
  .sort((a, b) => b.value - a.value);
const stock = {};
catalog.forEach((p) => { stock[p.id] = 50; });
stock[11] = 0; // product id 11 is out of stock

describe('admin flash-sale helpers', () => {
  it('returns only stocked, photo-bearing picks with bounded deal pricing', () => {
    const picks = adminFs.buildFlashPicks(abc, catalog, stock, now);
    assert.equal(picks.length, 6);

    for (const p of picks) {
      assert.ok(p.image, `pick ${p.id} has no photo`);
      assert.ok(stock[p.id] > 0, `pick ${p.id} is out of stock`);
      assert.notEqual(p.id, 6, 'photo-less product must be excluded');
      const pricing = adminFs.dealPricing(p, now);
      assert.ok(pricing.pct >= 10 && pricing.pct <= 25);
      assert.ok(pricing.deal > 0 && pricing.deal < pricing.original);
      assert.deepStrictEqual(adminFs.dealPricing(p, now), pricing, 'pricing must be deterministic');
    }
  });

  it('keeps the day seed stable within a day and refreshes at the next local midnight', () => {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const nextMidnight = new Date(now);
    nextMidnight.setDate(nextMidnight.getDate() + 1);
    nextMidnight.setHours(0, 0, 0, 0);

    assert.equal(adminFs.daySeed(now), adminFs.daySeed(endOfDay.getTime()));
    assert.notEqual(adminFs.daySeed(now), adminFs.daySeed(nextMidnight.getTime()));
    assert.equal(adminFs.msUntilDailyRefresh(now), nextMidnight.getTime() - now);
  });

  it('fills from the catalog when ABC ranking is empty and excludes unavailable items', () => {
    const picks = adminFs.buildFlashPicks([], catalog, stock, now);
    assert.equal(picks.length, 6);
    assert.equal(new Set(picks.map((p) => Number(p.id))).size, picks.length);
    assert.ok(picks.every((p) => p.image && stock[p.id] > 0));
  });

  it('keeps picks stable within a day and rotates the featured window across days', () => {
    const seeds = [new Date(2026, 7, 8).getTime(), new Date(2026, 7, 9).getTime(), new Date(2026, 7, 10).getTime()];
    const daySets = seeds.map((s) => {
      const picks = adminFs.buildFlashPicks(abc, catalog, stock, s);
      const sameDay = new Date(s);
      sameDay.setHours(12, 0, 0, 0);
      assert.deepStrictEqual(picks, adminFs.buildFlashPicks(abc, catalog, stock, sameDay.getTime()));
      return new Set(picks.map((p) => Number(p.id)));
    });
    // Three consecutive days should NOT all feature the identical subset.
    const allSame = daySets[0].size === daySets[1].size
      && daySets[1].size === daySets[2].size
      && [...daySets[0]].every((id) => daySets[1].has(id) && daySets[2].has(id));
    assert.strictEqual(allSame, false, 'rotation should change across days');
  });
});

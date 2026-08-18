// Deterministic PRNG (mulberry32) shared by the SQLite seeder and the npm-free
// fallback so a fresh boot of either backend produces IDENTICAL stock and
// sales data. Both seeder paths must draw from the same stream in the same
// order: per product, 3 location-stock draws followed by 6 sales draws
// (2 per customer). This is what makes cross-backend VALUE parity possible.
'use strict';

const DEMO_SEED = 20240805;

// Anchor for seeded sales dates, pinned to the current UTC day at module
// load. Both seeder paths use this constant instead of live `Date.now()`, so
// identical draws produce byte-identical transaction_date values across the
// two backends (a live clock differs by milliseconds between boots, and two
// backends booting on the same UTC day compute the same anchor). Sales are
// drawn as (epoch - 0..89 days), so anchoring at today keeps the demo sales
// inside the last 90 days and the dashboard's "this month" / "last 7 days"
// charts populated. Bump + re-seed if the demo data ever looks stale.
const SEED_EPOCH = (() => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
})();

// mulberry32: tiny, fast, deterministic 32-bit PRNG. Returns a function that
// yields floats in [0, 1).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Demo catalog used by every seeder (must match app.js seedDatabase and
// seed.js so the streams line up product-for-product).
const DEMO_LOCATIONS = ['Showroom', 'Stockroom 1', 'Stockroom 2'];
const DEMO_CUSTOMERS = ['Juan Dela Cruz', 'Maria Santos', 'Jose Rizal'];

module.exports = { DEMO_SEED, SEED_EPOCH, mulberry32, DEMO_LOCATIONS, DEMO_CUSTOMERS };

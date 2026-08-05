// Deterministic PRNG (mulberry32) shared by the SQLite seeder and the npm-free
// fallback so a fresh boot of either backend produces IDENTICAL stock and
// sales data. Both seeder paths must draw from the same stream in the same
// order: per product, 3 location-stock draws followed by 6 sales draws
// (2 per customer). This is what makes cross-backend VALUE parity possible.
'use strict';

const DEMO_SEED = 20240805;

// Fixed anchor for seeded sales dates. Both seeder paths use this constant
// instead of live `Date.now()`, so identical draws produce byte-identical
// transaction_date values across the two backends (a live clock differs by
// milliseconds between boots).
const SEED_EPOCH = Date.UTC(2024, 0, 1);

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

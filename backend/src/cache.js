// In-memory TTL cache for API responses.
//
// Provides sub-millisecond cached reads for the most frequently hit endpoints
// (products, categories, inventory) while automatically expiring stale data.
// Each cached entry has a configurable TTL and is invalidated on any write to
// the same resource.
//
// Usage:
//   const cache = require('./cache');
//   // Cache a GET response for 5 minutes
//   cache.set('products:all', products, 5 * 60 * 1000);
//   // Read from cache
//   const data = cache.get('products:all');
//   // Invalidate on write
//   cache.invalidate('products');
//   cache.invalidate(); // invalidate everything

'use strict';

// ---- Configuration ----
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 200;              // LRU cap to prevent memory leaks
const PRUNE_INTERVAL_MS = 60 * 1000; // Check for expired entries every minute

// ---- Storage ----
const store = new Map(); // key -> { value, expiresAt, hits }
let totalHits = 0;
let totalMisses = 0;
let totalSets = 0;
let totalEvictions = 0;

// ---- Core API ----

/**
 * Store a value in the cache.
 * @param {string} key - Cache key (e.g. 'products:all', 'inventory:loc1')
 * @param {*} value - The value to cache (must be serializable)
 * @param {number} [ttlMs] - Time-to-live in milliseconds (default: 5 min)
 */
function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  // If we're at capacity, evict the least-recently-used entry
  if (store.size >= MAX_ENTRIES && !store.has(key)) {
    evictLRU();
  }

  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    hits: 0,
    createdAt: Date.now(),
  });
  totalSets++;
}

/**
 * Retrieve a value from the cache. Returns null on miss or expiry.
 * @param {string} key
 * @returns {*|null}
 */
function get(key) {
  const entry = store.get(key);
  if (!entry) {
    totalMisses++;
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    totalMisses++;
    return null;
  }
  entry.hits++;
  totalHits++;
  return entry.value;
}

/**
 * Get or set: if the key exists and is fresh, return it. Otherwise call the
 * factory, cache the result, and return it. Perfect for request handlers.
 *
 *   const products = await cache.getOrSet('products:all', () => fetchProducts(), 5 * 60 * 1000);
 *
 * @param {string} key
 * @param {function} factory - Async or sync function that produces the value
 * @param {number} [ttlMs]
 * @returns {Promise<*>}
 */
async function getOrSet(key, factory, ttlMs = DEFAULT_TTL_MS) {
  const cached = get(key);
  if (cached !== null) return cached;
  const value = await factory();
  set(key, value, ttlMs);
  return value;
}

/**
 * Invalidate all entries whose key starts with the given prefix.
 * Pass no arguments to invalidate the entire cache.
 * @param {string} [prefix] - Key prefix (e.g. 'products', 'inventory')
 */
function invalidate(prefix) {
  if (!prefix) {
    const count = store.size;
    store.clear();
    return count;
  }
  let count = 0;
  for (const key of store.keys()) {
    if (key === prefix || key.startsWith(prefix + ':')) {
      store.delete(key);
      count++;
    }
  }
  return count;
}

/**
 * Check if a key exists and is fresh (without incrementing hit counters).
 * @param {string} key
 * @returns {boolean}
 */
function has(key) {
  const entry = store.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return false;
  }
  return true;
}

/**
 * Return cache statistics for the /api/cache/stats endpoint.
 */
function stats() {
  // Prune expired entries first so the count is accurate
  pruneExpired();
  const entries = [];
  for (const [key, entry] of store) {
    entries.push({
      key,
      age: Date.now() - entry.createdAt,
      ttl: entry.expiresAt - Date.now(),
      hits: entry.hits,
    });
  }
  entries.sort((a, b) => b.hits - a.hits);

  return {
    size: store.size,
    maxEntries: MAX_ENTRIES,
    totalHits,
    totalMisses,
    totalSets,
    totalEvictions,
    hitRate: totalHits + totalMisses > 0
      ? ((totalHits / (totalHits + totalMisses)) * 100).toFixed(1) + '%'
      : '0%',
    topEntries: entries.slice(0, 10),
  };
}

// ---- Internal helpers ----

function evictLRU() {
  let minHits = Infinity;
  let minKey = null;
  for (const [key, entry] of store) {
    if (entry.hits < minHits) {
      minHits = entry.hits;
      minKey = key;
    }
  }
  if (minKey) {
    store.delete(minKey);
    totalEvictions++;
  }
}

function pruneExpired() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
}

// Periodic prune to free memory from expired entries
const _pruneTimer = setInterval(pruneExpired, PRUNE_INTERVAL_MS);
// Allow the process to exit even if the timer is running
if (_pruneTimer.unref) _pruneTimer.unref();

module.exports = { set, get, getOrSet, invalidate, has, stats, DEFAULT_TTL_MS };

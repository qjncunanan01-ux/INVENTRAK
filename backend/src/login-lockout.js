// Brute-force login lockout shared by BOTH backends (SQLite app.js and the
// npm-free fallback), so the two servers behave identically under attack.
//
// Model: per account (username, source-IP) we count failed attempts within a
// sliding window. When the count crosses the threshold, the account is locked
// for a duration that DOUBLES on each successive breach (exponential backoff,
// capped) — so a sustained attack is throttled harder over time while a single
// typo costs nothing.
//
//   - Success clears the counter immediately.
//   - Failures for NONEXISTENT usernames count too (no username oracle — an
//     attacker cannot probe which accounts exist by checking who gets locked).
//   - The window is sliding: an old failure older than windowMs stops
//     counting, so sustained slow attacks still lock out eventually.
//   - The escalation is per window: if a full window passes with no logins
//     for that (user, IP), the bucket (and its breach count) is pruned and
//     the next breach starts at the base lockout again. While the attacker
//     keeps coming back within the window, the delay doubles each breach.
//   - State is in-memory (per process); on a multi-instance deploy each
//     replica tracks its own counters, which is still a strong per-instance
//     throttle. Tunable via env vars (LOGIN_LOCKOUT_MAX_FAILURES, _WINDOW_MS,
//     _BASE_MS, _MAX_MS) and overridable in tests via the factory options +
//     injectable clock.
const DEFAULTS = {
  maxFailures: 5,
  windowMs: 15 * 60 * 1000,
  baseLockoutMs: 5 * 1000,
  maxLockoutMs: 30 * 60 * 1000,
};

function num(envValue, fallback) {
  const n = Number(envValue);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function createLoginLockout(opts = {}) {
  const maxFailures = opts.maxFailures ?? num(process.env.LOGIN_LOCKOUT_MAX_FAILURES, DEFAULTS.maxFailures);
  const windowMs = opts.windowMs ?? num(process.env.LOGIN_LOCKOUT_WINDOW_MS, DEFAULTS.windowMs);
  const baseLockoutMs = opts.baseLockoutMs ?? num(process.env.LOGIN_LOCKOUT_BASE_MS, DEFAULTS.baseLockoutMs);
  const maxLockoutMs = opts.maxLockoutMs ?? num(process.env.LOGIN_LOCKOUT_MAX_MS, DEFAULTS.maxLockoutMs);
  const now = opts.now || (() => Date.now());

  // key -> { failures, windowStart, lockedUntil, breachCount }
  const buckets = new Map();

  function keyFor(username, ip) {
    // Lowercase username so 'Admin' and 'admin' share a bucket (login is
    // case-sensitive in the DB, but the attacker targeting one account will
    // try both casings).
    return `${String(username || '').toLowerCase()}|${ip || ''}`;
  }

  function prune(nowMs) {
    for (const [k, b] of buckets) {
      // Keep buckets that are still locked.
      if (nowMs < b.lockedUntil) continue;
      // Keep buckets inside the counting window, even with a zeroed counter:
      // the zero-failure bucket right after a lockout expiry carries the
      // breachCount that drives the exponential backoff — deleting it early
      // would reset the escalation to square one. Within the window the memory
      // is bounded (one bucket per (user, IP)); outside it the bucket dies and
      // the map cannot grow unboundedly.
      if (nowMs - b.windowStart <= windowMs) continue;
      buckets.delete(k);
    }
  }

  // Returns { locked, retryAfterMs }. Called BEFORE credential validation.
  function check(username, ip) {
    const t = now();
    prune(t);
    const b = buckets.get(keyFor(username, ip));
    if (!b) return { locked: false };
    if (t < b.lockedUntil) {
      return { locked: true, retryAfterMs: b.lockedUntil - t };
    }
    return { locked: false };
  }

  // Record a failed attempt; returns the post-record check result.
  function recordFailure(username, ip) {
    const t = now();
    prune(t);
    const key = keyFor(username, ip);
    let b = buckets.get(key);
    if (!b) {
      b = { failures: 0, windowStart: t, lockedUntil: 0, breachCount: 0 };
      buckets.set(key, b);
    }
    // Sliding window: a stale bucket resets its count but keeps breachCount so
    // the backoff keeps escalating across breaches.
    if (t - b.windowStart > windowMs && t >= b.lockedUntil) {
      b.failures = 0;
      b.windowStart = t;
    }
    b.failures += 1;
    if (b.failures > maxFailures) {
      const delay = Math.min(baseLockoutMs * 2 ** b.breachCount, maxLockoutMs);
      b.lockedUntil = t + delay;
      b.breachCount += 1;
      b.failures = 0; // lockout starts fresh count for the next window
    }
    return check(username, ip);
  }

  // Clear the counter on a successful login.
  function recordSuccess(username, ip) {
    buckets.delete(keyFor(username, ip));
  }

  return { check, recordFailure, recordSuccess, _buckets: buckets, _defaults: { maxFailures, windowMs, baseLockoutMs, maxLockoutMs } };
}

module.exports = { createLoginLockout, DEFAULTS };

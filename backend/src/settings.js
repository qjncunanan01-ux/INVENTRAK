'use strict';

// Runtime system settings — the operator-facing knobs that used to be baked
// into env vars or code, now readable/writable live by the owner/super admin
// from the web admin (Governance → System Settings).
//
// Design:
//   • Persisted as a JSON document so both backends (SQLite server and the
//     npm-free server) read/write the SAME file — one source of truth per
//     deployment.
//   • Defaults come from the same constants that used to be hardcoded
//     (config.js TOKEN_TTL_MS, the 1.5 badge multiplier, FSN 90d window),
//     so a deployment with no settings file behaves exactly as before.
//   • Every update is validated and clamped here — callers cannot store a
//     bad shape or an out-of-range value (defense at the store, not the UI).
//   • Getters are cheap (fs read with a 1s memo) so hot paths can consult
//     live values without caching pain.

const fs = require('node:fs');
const path = require('node:path');

// Lives beside the other data files (INVENTRAK_DATA_DIR-aware, same rule as
// audit.js), overridable via SETTINGS_FILE for tests.
const SETTINGS_FILE =
  process.env.SETTINGS_FILE ||
  path.join(process.env.INVENTRAK_DATA_DIR || path.join(__dirname, '..', 'data'), 'settings.json');

// ---- The setting catalogue (defaults = previous hardcoded behavior) ----

const TOKEN_TTL_MS_DEFAULT = Number(process.env.TOKEN_TTL_MS) || 24 * 60 * 60 * 1000;

const DEFAULTS = Object.freeze({
  // OWASP: no default/test accounts in a live system. true = seeded demo
  // logins are refused with the generic error (same as DISABLE_DEMO_ACCOUNTS).
  demo_accounts_disabled: false,
  // FSN / Optimization analysis window in days (7–730, default a quarter).
  fsn_window_days: 90,
  // Low-stock badge widening factor: "low" when qty ≤ criticalLevel × factor.
  low_stock_multiplier: 1.5,
  // Session token lifetime in hours (1–168; default 24h).
  session_token_hours: Math.round(TOKEN_TTL_MS_DEFAULT / 3600000),
});

const LIMITS = Object.freeze({
  fsn_window_days: { min: 7, max: 730 },
  low_stock_multiplier: { min: 1.0, max: 3.0 },
  session_token_hours: { min: 1, max: 168 },
});

let memo = { at: 0, value: null };

function readAll() {
  const now = Date.now();
  if (memo.value && now - memo.at < 1000) return memo.value;
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {};
  } catch {
    stored = {};
  }
  // Merge defaults → stored, clamping stored values back into range (self-
  // healing if a file was hand-edited).
  const merged = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (stored[key] === undefined || stored[key] === null) continue;
    merged[key] = clamp(key, stored[key]);
  }
  memo = { at: now, value: merged };
  return merged;
}

function clamp(key, value) {
  if (typeof DEFAULTS[key] === 'boolean') return Boolean(value);
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULTS[key];
  const [min, max] = [LIMITS[key].min, LIMITS[key].max];
  return Math.min(max, Math.max(min, num));
}

function writeAll(next) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  memo = { at: Date.now(), value: next };
}

// ---- Public API ----

function getSettings() {
  return { ...readAll() };
}

/**
 * Validate + apply a partial update. Returns { ok, settings, errors } — the
 * caller turns `errors` into a 400 with details, mirroring the API's other
 * validation errors.
 */
function updateSettings(patch) {
  const current = readAll();
  const errors = [];
  const next = { ...current };

  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, errors: ['body must be a JSON object'], settings: current };
  }

  if (patch.demo_accounts_disabled !== undefined) {
    if (typeof patch.demo_accounts_disabled !== 'boolean') {
      errors.push('demo_accounts_disabled must be a boolean');
    } else {
      next.demo_accounts_disabled = patch.demo_accounts_disabled;
    }
  }

  for (const key of ['fsn_window_days', 'low_stock_multiplier', 'session_token_hours']) {
    if (patch[key] === undefined) continue;
    const num = Number(patch[key]);
    if (!Number.isFinite(num)) {
      errors.push(`${key} must be a number`);
      continue;
    }
    const { min, max } = LIMITS[key];
    if (num < min || num > max) {
      errors.push(`${key} must be between ${min} and ${max}`);
      continue;
    }
    next[key] = key === 'fsn_window_days' ? Math.round(num) : num;
  }

  if (errors.length > 0) return { ok: false, errors, settings: current };

  writeAll(next);
  return { ok: true, settings: next, errors: [] };
}

// ---- Typed getters for the hot paths ----

function getDemoAccountsDisabled() {
  return Boolean(readAll().demo_accounts_disabled);
}

function getFsnWindowDays() {
  return Number(readAll().fsn_window_days);
}

function getLowStockMultiplier() {
  return Number(readAll().low_stock_multiplier);
}

function getSessionTokenTtlMs() {
  return Math.round(Number(readAll().session_token_hours) * 3600000);
}

module.exports = {
  DEFAULTS,
  LIMITS,
  SETTINGS_FILE,
  getSettings,
  updateSettings,
  getDemoAccountsDisabled,
  getFsnWindowDays,
  getLowStockMultiplier,
  getSessionTokenTtlMs,
};

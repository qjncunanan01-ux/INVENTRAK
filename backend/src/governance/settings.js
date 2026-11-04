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
  // How long a shelf count stays fresh before that shelf is due to be walked
  // again (1–365; default 30 days — a monthly stocktake, the cadence most
  // small retail operations actually run). Read by src/stocktake.js.
  stocktake_cycle_days: 30,
  // Demonstration defaults for replenishment planning. Sylver should replace
  // these with its purchasing costs and supplier lead times before relying on
  // the recommendations operationally.
  eoq_ordering_cost: 50,
  eoq_annual_holding_rate: 0.2,
  reorder_lead_time_days: 7,
  safety_stock_z_score: 1.65,
  abc_a_threshold_percent: 70,
  abc_b_threshold_percent: 90,
  lot_allocation_policy: 'FEFO',
});

const LIMITS = Object.freeze({
  fsn_window_days: { min: 7, max: 730 },
  low_stock_multiplier: { min: 1.0, max: 3.0 },
  session_token_hours: { min: 1, max: 168 },
  stocktake_cycle_days: { min: 1, max: 365 },
  eoq_ordering_cost: { min: 0.01, max: 1000000 },
  eoq_annual_holding_rate: { min: 0.01, max: 5 },
  reorder_lead_time_days: { min: 1, max: 365 },
  safety_stock_z_score: { min: 0.01, max: 4 },
  abc_a_threshold_percent: { min: 1, max: 99 },
  abc_b_threshold_percent: { min: 2, max: 100 },
});

const LOT_ALLOCATION_POLICIES = Object.freeze(['FEFO', 'FIFO']);

let memo = { at: 0, value: null };
let persistence = null;

function readAll() {
  const now = Date.now();
  if (memo.value && now - memo.at < 1000) return memo.value;
  let stored = {};
  try {
    const raw = persistence
      ? persistence.read()
      : JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    stored = raw;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {};
  } catch {
    stored = {};
  }
  // Merge defaults → stored, clamping stored values back into range (self-
  // healing if a file was hand-edited).
  const merged = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (stored[key] === undefined || stored[key] === null) continue;
    if (key === 'lot_allocation_policy') {
      const policy = String(stored[key]).toUpperCase();
      merged[key] = LOT_ALLOCATION_POLICIES.includes(policy) ? policy : DEFAULTS[key];
      continue;
    }
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
  if (persistence) {
    persistence.write(next);
  } else {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  }
  memo = { at: Date.now(), value: next };
}

// Cloud drivers can bind settings to their durable store after initialization.
// Keep the JSON file as the local/test fallback, and seed a new durable store
// from the current values so switching backends does not silently reset them.
function configurePersistence(adapter) {
  const current = getSettings();
  if (adapter == null) {
    persistence = null;
    memo = { at: Date.now(), value: current };
    return getSettings();
  }
  if (typeof adapter.read !== 'function' || typeof adapter.write !== 'function') {
    throw new TypeError('settings persistence adapter requires read() and write()');
  }

  persistence = adapter;
  memo = { at: 0, value: null };
  let stored;
  try {
    stored = adapter.read();
  } catch (error) {
    persistence = null;
    memo = { at: Date.now(), value: current };
    throw error;
  }
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    memo = { at: Date.now(), value: readAll() };
  } else {
    writeAll(current);
  }
  return getSettings();
}

function getPersistenceStatus() {
  return { durable: Boolean(persistence), backend: persistence && persistence.name || 'file' };
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
function validateSettingsPatch(patch) {
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

  for (const key of Object.keys(LIMITS)) {
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
    // Day counts are whole days; a multiplier is not.
    next[key] = key.endsWith('_days') || key === 'session_token_hours' ? Math.round(num) : num;
  }

  if (patch.lot_allocation_policy !== undefined) {
    const policy = String(patch.lot_allocation_policy).toUpperCase();
    if (!LOT_ALLOCATION_POLICIES.includes(policy)) errors.push('lot_allocation_policy must be FEFO or FIFO');
    else next.lot_allocation_policy = policy;
  }
  if (next.abc_a_threshold_percent >= next.abc_b_threshold_percent) {
    errors.push('abc_b_threshold_percent must be greater than abc_a_threshold_percent');
  }

  if (errors.length > 0) return { ok: false, errors, settings: current };

  return { ok: true, settings: next, errors: [] };
}

function updateSettings(patch) {
  const result = validateSettingsPatch(patch);
  if (!result.ok) return result;
  writeAll(result.settings);
  return result;
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

// How long a count stays fresh before its shelf is due again. Always >= 1: a
// zero-day cycle would make every shelf permanently overdue and say nothing.
function getStocktakeCycleDays() {
  const n = Math.round(Number(readAll().stocktake_cycle_days));
  return n > 0 ? n : DEFAULTS.stocktake_cycle_days;
}

function getInventoryAlgorithmSettings() {
  const value = readAll();
  return {
    eoq_ordering_cost: Number(value.eoq_ordering_cost),
    eoq_annual_holding_rate: Number(value.eoq_annual_holding_rate),
    reorder_lead_time_days: Number(value.reorder_lead_time_days),
    safety_stock_z_score: Number(value.safety_stock_z_score),
    abc_a_threshold_percent: Number(value.abc_a_threshold_percent),
    abc_b_threshold_percent: Number(value.abc_b_threshold_percent),
    lot_allocation_policy: value.lot_allocation_policy,
  };
}

module.exports = {
  DEFAULTS,
  LIMITS,
  SETTINGS_FILE,
  getSettings,
  validateSettingsPatch,
  configurePersistence,
  getPersistenceStatus,
  updateSettings,
  getDemoAccountsDisabled,
  getFsnWindowDays,
  getLowStockMultiplier,
  getSessionTokenTtlMs,
  getStocktakeCycleDays,
  getInventoryAlgorithmSettings,
};

'use strict';

// Shared date-window resolver for the admin Days / Weeks / Months / Quarterly /
// Annually filter. Both backends import this so a window resolves identically
// no matter which driver is serving the request.
//
// Accepts either an explicit inclusive range
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD
// or the legacy trailing window
//   ?days=N
//
// Invalid input is ignored rather than trusted, and the window is capped so a
// hostile `from` cannot force an unbounded table scan.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDay(value) {
  return typeof value === 'string' && ISO_DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function toIsoDay(date) {
  return date.toISOString().slice(0, 10);
}

function parseDateRange(query = {}, { defaultDays = 30, maxDays = 1826 } = {}) {
  const to = isIsoDay(query.to) ? query.to : toIsoDay(new Date());

  if (isIsoDay(query.from)) {
    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86400000);
    if (span >= 0 && span <= maxDays) return { from: query.from, to };
  }

  const days = Math.min(maxDays, Math.max(1, parseInt(query.days, 10) || defaultDays));
  const from = toIsoDay(new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86400000));
  return { from, to };
}

/** Inclusive day-count label for a resolved window (never below 1). */
function rangeDays({ from, to }) {
  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
  return Math.max(1, span + 1);
}

/** Preset windows behind the admin filter — mirrors the frontend labels. */
const RANGE_PRESETS = Object.freeze({
  day: 1,
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
});

/** Resolve a named preset ('week') or a trailing day count into a window. */
function presetRange(preset, now = new Date()) {
  const days = RANGE_PRESETS[preset];
  if (!days) return null;
  const to = toIsoDay(now);
  const from = toIsoDay(new Date(now.getTime() - (days - 1) * 86400000));
  return { from, to, preset, days };
}

module.exports = { parseDateRange, rangeDays, presetRange, isIsoDay, RANGE_PRESETS };

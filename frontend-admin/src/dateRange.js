// Shared date-range presets behind the admin Days / Weeks / Months / Quarterly
// / Annually filter. One definition drives the dashboard, reports and the
// optimization (algorithm) screens so every analytical surface speaks the same
// range vocabulary.
export const RANGE_PRESETS = [
  { id: 'day', label: 'Day', caption: 'Today', days: 1 },
  { id: 'week', label: 'Week', caption: 'Last 7 days', days: 7 },
  { id: 'month', label: 'Month', caption: 'Last 30 days', days: 30 },
  { id: 'quarter', label: 'Quarter', caption: 'Last 90 days', days: 90 },
  { id: 'year', label: 'Year', caption: 'Last 365 days', days: 365 },
  { id: 'all', label: 'All', caption: 'All time', days: null },
];

export const DEFAULT_RANGE = 'month';

const isoDay = (d) => d.toISOString().slice(0, 10);

/**
 * Resolve a preset id into an inclusive { from, to, days } window as
 * YYYY-MM-DD strings (or nulls for "all time"). Mirrors the backend's
 * parseDateRange so a filtered request means the same thing on both sides.
 */
export function resolveRange(presetId, now = new Date()) {
  const preset = RANGE_PRESETS.find((p) => p.id === presetId) || RANGE_PRESETS.find((p) => p.id === DEFAULT_RANGE);
  const to = isoDay(now);
  if (preset.days === null) return { preset: preset.id, from: null, to: null, days: null };
  const from = isoDay(new Date(now.getTime() - (preset.days - 1) * 86400000));
  return { preset: preset.id, from, to, days: preset.days };
}

/** Build the query string for a resolved range ('' for all time). */
export function rangeQuery(range) {
  if (!range || !range.from || !range.to) return '';
  return `?from=${range.from}&to=${range.to}`;
}

/**
 * True when a timestamp falls inside the range. `all` accepts everything;
 * unparseable timestamps are rejected rather than silently counted.
 */
export function isWithinRange(value, range) {
  if (!range || !range.from || !range.to) return true;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return false;
  return t >= Date.parse(`${range.from}T00:00:00Z`) && t <= Date.parse(`${range.to}T23:59:59.999Z`);
}

/** Human label for a resolved range, e.g. "Last 30 days (Aug 14 – Sep 12)". */
export function rangeLabel(range) {
  const preset = RANGE_PRESETS.find((p) => p.id === range?.preset);
  if (!preset || preset.days === null) return 'All time';
  return `${preset.caption} (${range.from} → ${range.to})`;
}

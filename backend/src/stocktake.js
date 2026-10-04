// Stocktake scheduling — "when is each shelf next due to be walked?"
//
// The reconciliation report (reconciliation.js) tells a manager what a count
// FOUND. This module answers the question that has to be answered BEFORE the
// count exists: which shelves are overdue, and how far behind are they.
//
// The one design decision worth stating up front, because the obvious version
// is wrong:
//
//   A shelf is re-counted when EVERY LINE STOCKED ON IT has a fresh count.
//
// The cheap alternative — "the shelf's clock resets on its newest count" —
// lets someone count one bottle out of forty and mark the whole shelf fresh
// for thirty days. That is worse than no scheduling at all: it manufactures
// the exact false confidence this feature exists to remove, and it would do so
// silently. So coverage is counted per LINE, and a shelf with one fresh line
// out of forty is reported as "1 of 40 re-counted", which is the truth and is
// also the actionable number.
//
// What a line is measured against:
//
//   products stocked at the location   what the system believes is on THAT shelf
//   inventory_counts rows              physical observations, per product+location
//
// Only products with a stock row at the location are counted. A product that
// was sold out everywhere has nothing to walk for, so demanding a count of it
// would report a shelf as perpetually overdue for lines that do not exist.
//
// Dates: the codebase writes two timestamp shapes (see reconciliation.js —
// SQLite's space-separated UTC 'YYYY-MM-DD HH:MM:SS' and the seeder's ISO
// 'Z'), so parsing is explicit and reads as UTC. An UNREADABLE timestamp is not
// silently treated as fresh: it is counted as stale, because a line whose last
// count cannot be dated is a line nobody can prove was counted.

const DAY_MS = 86400000;

// 'YYYY-MM-DD HH:MM:SS' (SQLite, UTC, no zone marker), 'YYYY-MM-DDTHH:MM:SS(.sss)?Z'
// (ISO from the count route and the seeder), or a full ISO string with an
// offset. Returns epoch ms, or null when the value cannot be read.
export function parseStamp(value) {
  if (!value) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    const [, Y, Mo, D, H, Mi, S, frac, zone] = m;
    const year = +Y;
    const month = +Mo;
    const day = +D;
    const hour = +H;
    const min = +Mi;
    const sec = +S;

    // Out-of-range components are REJECTED, not normalised.
    //
    // Date.UTC happily rolls them over — month 13 becomes next January, day 45
    // becomes next month, hour 99 becomes four days later — and returns a
    // perfectly finite timestamp. That is the dangerous failure here: a corrupt
    // counted_at would be read as a real date decades away, so a line somebody
    // counted last week would be reported as never counted. Garbage in has to
    // stay garbage, so the caller treats null as "cannot prove it was counted".
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hour > 23 || min > 59 || sec > 59) return null;

    const ms = frac ? +frac.padEnd(3, '0').slice(0, 3) : 0;
    let t = Date.UTC(year, month - 1, day, hour, min, sec, ms);

    // Round-trip the calendar fields: this is what catches day 30 of February,
    // which passes the range check above but still rolls into March.
    const asDate = new Date(t);
    if (
      asDate.getUTCFullYear() !== year ||
      asDate.getUTCMonth() !== month - 1 ||
      asDate.getUTCDate() !== day
    ) {
      return null;
    }

    // An explicit offset moves the instant. No marker means UTC, which is what
    // both shapes this codebase actually writes mean (see reconciliation.js).
    if (zone && zone !== 'Z') {
      const sign = zone[0] === '-' ? -1 : 1;
      const digits = zone.slice(1).replace(':', '');
      const offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
      t -= offsetMinutes * 60000;
    }
    return Number.isNaN(t) ? null : t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// Days between two epoch stamps, rounded DOWN, so a line counted 29.9 days ago
// is 29 days old and not yet due on a 30-day cycle. Flooring is deliberate: a
// reminder that fires a day early is an annoyance, one that fires a day late
// is a missed stocktake.
export function daysSince(then, now) {
  if (then === null || then === undefined) return null;
  return Math.floor((now - then) / DAY_MS);
}

// The whole schedule, pure over arrays so the SQLite backend, the npm-free
// backend and the tests all compute identical numbers from identical inputs.
//
//   locations [{ id, name }]
//   stock     [{ product_id, location_id, quantity }]  — only qty != 0 lines
//   counts    [{ product_id, location_id, counted_at }]
//   cycleDays how long a count stays fresh
//   now       epoch ms (injected, never Date.now() inside, so tests are stable)
export function schedule({ locations, stock, counts, cycleDays = 30, now = Date.now() } = {}) {
  const cycle = Number(cycleDays) > 0 ? Number(cycleDays) : 30;

  // Lines that actually need walking: stocked on the shelf right now.
  const linesByLocation = new Map();
  for (const s of Array.isArray(stock) ? stock : []) {
    if (!s) continue;
    const qty = Number(s.quantity);
    // A zero or negative row has nothing on the shelf to count. Demanding a
    // count for it would keep a shelf permanently "overdue" for a phantom.
    if (!(qty > 0)) continue;
    const lid = Number(s.location_id);
    if (!linesByLocation.has(lid)) linesByLocation.set(lid, new Set());
    linesByLocation.get(lid).add(Number(s.product_id));
  }

  // Newest count per product+location. A line with NO row here is never counted.
  const newestCount = new Map();
  for (const c of Array.isArray(counts) ? counts : []) {
    if (!c) continue;
    const key = `${Number(c.product_id)}@${Number(c.location_id)}`;
    const at = parseStamp(c.counted_at);
    if (at === null) continue; // undated: cannot prove freshness, treated as never
    const seen = newestCount.get(key);
    if (seen === undefined || at > seen) newestCount.set(key, at);
  }

  const rows = [];
  for (const loc of Array.isArray(locations) ? locations : []) {
    if (!loc || loc.id == null) continue;
    const lid = Number(loc.id);
    const lines = [...(linesByLocation.get(lid) || [])].sort((a, b) => a - b);

    let fresh = 0;
    let stale = 0;
    let never = 0;
    let oldestCountAt = null; // oldest count of ANY kind, fresh or stale
    let newestAnyAt = null; // most recent count of any kind
    let maxLateDays = 0; // how far PAST due the worst dated line is

    for (const pid of lines) {
      const at = newestCount.get(`${pid}@${lid}`);
      if (at === undefined) {
        // Never counted: there is no date, so it contributes no lateness — it
        // is simply due now. It is NOT treated as infinitely overdue, because
        // that would flatten a shelf with one 40-day-old line and one
        // never-counted line into the same alarm.
        never += 1;
        continue;
      }
      if (newestAnyAt === null || at > newestAnyAt) newestAnyAt = at;
      if (oldestCountAt === null || at < oldestCountAt) oldestCountAt = at;
      const age = daysSince(at, now);
      if (age <= cycle) fresh += 1;
      else {
        stale += 1;
        const late = age - cycle;
        if (late > maxLateDays) maxLateDays = late;
      }
    }

    const total = lines.length;
    // Status is driven by coverage, not by the newest stamp:
    //   no lines        → nothing to walk (a shelf with no stock is not overdue)
    //   stale lines     → OVERDUE. Even one stale line means the shelf is not
    //                     fully counted, which is the definition we committed to.
    //   never counted   → NEVER_COUNTED, ranked with overdue
    //   all fresh       → OK, with the days left before it comes round again
    let status;
    if (total === 0) status = 'empty';
    else if (never > 0 && fresh === 0) status = 'never_counted';
    else if (stale > 0 || never > 0) status = 'overdue';
    else status = 'ok';

    // The due date is anchored on the OLDEST line, not the newest.
    //
    // Anchoring on the newest count is what produces a row that says "Overdue"
    // and "Due in 29 days" at the same time: count one line today, and the
    // freshest timestamp says the shelf is fine for a month while 203 lines
    // have never been walked. A manager reading that row has been told the
    // shelf is fine.
    //
    // So the shelf is due when its WORST line is due:
    //   · a stale line is already past due, so the shelf is past due;
    //   · a never-counted line has no date at all, so the shelf is due NOW;
    //   · only a fully-fresh shelf gets a future date, and it runs from the
    //     oldest of those fresh counts — the shelf is as current as its
    //     stalest line, never its freshest.
    const neverCountedNow = never > 0;
    const dueAt =
      total === 0
        ? null
        : status === 'ok' && oldestCountAt !== null
          ? oldestCountAt + cycle * DAY_MS
          : neverCountedNow || maxLateDays > 0
            ? now - maxLateDays * DAY_MS
            : null;

    rows.push({
      location_id: lid,
      location: loc.name || `Location ${lid}`,
      status,
      total_lines: total,
      fresh_lines: fresh,
      stale_lines: stale,
      never_counted_lines: never,
      // A shelf is only re-counted once EVERY line is fresh. Until then this
      // stays below 1 even if most of the shelf was walked today.
      coverage: total === 0 ? null : fresh / total,
      last_count_at: newestAnyAt !== null ? new Date(newestAnyAt).toISOString() : null,
      due_at: dueAt !== null ? new Date(dueAt).toISOString() : null,
      // Negative once the shelf is past due; 0 when part of it was never
      // counted at all, because there is nothing to count down from.
      days_until_due: dueAt === null ? null : Math.floor((dueAt - now) / DAY_MS),
      days_since_oldest_count: oldestCountAt === null ? null : daysSince(oldestCountAt, now),
      cycle_days: cycle,
    });
  }

  // Worst first, so the top of the board is the shelf to walk today. Ties break
  // on the oldest due date, then by id, so the order is stable between reads.
  const rank = { never_counted: 0, overdue: 1, ok: 2, empty: 3 };
  rows.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.due_at || '').localeCompare(b.due_at || '') ||
      a.location_id - b.location_id,
  );

  const overdue = rows.filter(r => r.status === 'overdue' || r.status === 'never_counted');
  return {
    rows,
    summary: {
      cycle_days: cycle,
      locations: rows.length,
      // A shelf needing a walk today: overdue OR never counted. Empty shelves
      // are excluded — there is nothing on them to find.
      shelves_needing_count: overdue.length,
      shelves_ok: rows.filter(r => r.status === 'ok').length,
      shelves_empty: rows.filter(r => r.status === 'empty').length,
      lines_total: rows.reduce((n, r) => n + r.total_lines, 0),
      lines_stale: rows.reduce((n, r) => n + r.stale_lines + r.never_counted_lines, 0),
      // Generated so the UI can say "as of" without inventing a time of its own.
      computed_at: new Date(now).toISOString(),
    },
  };
}

// One shelf, in enough detail to walk it with a phone.
//
// This is the staff-facing half of the feature. The board above is deliberately
// admin-tier — it reports how far behind the WHOLE operation is, which is an
// oversight concern — but the person holding the phone is standing in front of
// one shelf and needs THAT shelf: every line on it, what the system thinks is
// there, when each line was last counted, and whether the shelf is due. They get
// exactly that and no cross-shelf picture.
//
// `counts` rows are matched per product+location and the NEWEST wins, the same
// rule the reconciliation report uses, so the phone and the board can never
// disagree about whether a line is fresh.
//
// A line's `state` is the honest label for a person to act on:
//   'fresh'   counted inside the cycle
//   'stale'   counted, but longer ago than the cycle
//   'never'   stocked on this shelf, never counted
export function shelfDetail({ location, stock, counts, cycleDays = 30, now = Date.now(), products } = {}) {
  const cycle = Number(cycleDays) > 0 ? Number(cycleDays) : 30;
  const lid = location && location.id != null ? Number(location.id) : null;

  const nameById = new Map();
  for (const p of Array.isArray(products) ? products : []) {
    if (p && p.id != null) nameById.set(Number(p.id), p.name || `Product ${p.id}`);
  }

  // Newest count per product for THIS location.
  const newest = new Map();
  for (const c of Array.isArray(counts) ? counts : []) {
    if (!c || Number(c.location_id) !== lid) continue;
    const at = parseStamp(c.counted_at);
    if (at === null) continue; // undated: not provably fresh
    const pid = Number(c.product_id);
    const seen = newest.get(pid);
    if (!seen || at > seen.at) newest.set(pid, { at, qty: Number(c.counted_qty) || 0 });
  }

  const lines = [];
  for (const s of Array.isArray(stock) ? stock : []) {
    if (!s || Number(s.location_id) !== lid) continue;
    const qty = Number(s.quantity);
    if (!(qty > 0)) continue; // nothing on the shelf to walk
    const pid = Number(s.product_id);
    const seen = newest.get(pid);
    const age = seen ? daysSince(seen.at, now) : null;
    const state = !seen ? 'never' : age <= cycle ? 'fresh' : 'stale';
    lines.push({
      product_id: pid,
      name: nameById.get(pid) || `Product ${pid}`,
      system_qty: qty,
      last_counted_qty: seen ? seen.qty : null,
      last_counted_at: seen ? new Date(seen.at).toISOString() : null,
      days_since_count: age,
      state,
    });
  }
  lines.sort((a, b) => a.name.localeCompare(b.name));

  // Same coverage arithmetic as the board, recomputed from these lines so the
  // phone and the board cannot drift: one function owns the rule.
  const fresh = lines.filter((l) => l.state === 'fresh').length;
  const stale = lines.filter((l) => l.state === 'stale').length;
  const never = lines.filter((l) => l.state === 'never').length;
  const total = lines.length;

  let status;
  if (total === 0) status = 'empty';
  else if (never > 0 && fresh === 0) status = 'never_counted';
  else if (stale > 0 || never > 0) status = 'overdue';
  else status = 'ok';

  // The whole-shelf view the staff screen shows at the top. Derived from
  // schedule() on the same inputs, so one rule decides "is this shelf due".
  const board = schedule({
    locations: location && location.id != null ? [location] : [],
    stock,
    counts,
    cycleDays,
    now,
  });
  const row = board.rows[0] || null;

  return {
    location_id: lid,
    location: (location && location.name) || (lid != null ? `Location ${lid}` : null),
    status,
    cycle_days: cycle,
    coverage: total === 0 ? null : fresh / total,
    lines,
    summary: {
      total_lines: total,
      fresh_lines: fresh,
      stale_lines: stale,
      never_counted_lines: never,
      // How far the shelf still is from being re-counted — the number that
      // tells someone standing there whether they are done.
      lines_remaining: total - fresh,
      last_count_at: row ? row.last_count_at : null,
      due_at: row ? row.due_at : null,
      days_until_due: row ? row.days_until_due : null,
      computed_at: new Date(now).toISOString(),
    },
  };
}

export { DAY_MS };
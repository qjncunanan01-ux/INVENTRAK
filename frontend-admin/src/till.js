// Pure helpers for the till (counter-sale) screen.
//
// Deliberately kept out of the component so the parts that decide WHAT the
// staff member is told can be tested without a browser. The important one is
// fefoOrder: the till shows which batch is about to leave, so it has to sort
// exactly the way the backend does. If these two ever disagree the screen
// promises a batch and the server consumes a different one — a UI that lies
// about FEFO is worse than no FEFO display at all.

// The backend's consumption order (consumeStockLots):
//   1. lots WITH an expiry date, soonest first
//   2. lots WITHOUT an expiry date
//   3. within each group, earlier arrival first (FIFO tiebreak)
// Ties fall back to lot id so the order is total and stable.
export function fefoOrder(lots) {
  return [...(Array.isArray(lots) ? lots : [])]
    .filter(l => l && Number(l.qty) > 0)
    .sort((a, b) => {
      const aHas = a.expiry_date != null;
      const bHas = b.expiry_date != null;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && a.expiry_date !== b.expiry_date) return a.expiry_date < b.expiry_date ? -1 : 1;
      const aAt = a.received_at || '';
      const bAt = b.received_at || '';
      if (aAt !== bAt) return aAt < bAt ? -1 : 1;
      return Number(a.id || 0) - Number(b.id || 0);
    });
}

// Which lot would go first if `qty` were sold right now, and how much of it.
// Returns null when there is nothing on the shelf to take.
export function nextLotToConsume(lots, qty) {
  const wanted = Number(qty);
  if (!Number.isFinite(wanted) || wanted <= 0) return null;
  const ordered = fefoOrder(lots);
  if (ordered.length === 0) return null;
  const first = ordered[0];
  const take = Math.min(Number(first.qty), wanted);
  if (take <= 0) return null;
  // `spillsOver` is true when the sale is bigger than that one lot, so the
  // receipt will list more than one batch.
  return { lot: first, qty: take, spillsOver: wanted > Number(first.qty) };
}

// Calendar days from today to a YYYY-MM-DD date (negative = already past).
// Compared as local date parts, NOT via toISOString, which shifts a day in
// UTC+8 and would show a lot as expiring "in 0 days" the evening before.
export function daysToExpiry(date, now = new Date()) {
  if (date == null) return null;
  const [y, m, d] = String(date).split('-').map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

// Urgency band for an expiry date. Boundaries match the badge ladder the
// Inventory page already uses: expired, then inside 30 days.
export function expiryTone(date, now = new Date()) {
  if (date == null) return 'none';
  const days = daysToExpiry(date, now);
  if (days == null) return 'none';
  if (days <= 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'later';
}

// Human label for one entry of the backend's `lots_consumed` manifest.
//
// lot_id null means the units came off stock that had no covering lot — the
// backend's "legacy/overflow" remainder. It is labelled as such rather than
// given an invented batch number.
export function describeConsumedLot(entry, now = new Date()) {
  if (!entry) return null;
  const days = daysToExpiry(entry.expiry_date, now);
  const batch = entry.lot_id != null ? `Lot #${entry.lot_id}` : 'Unbatched stock';
  let expiry;
  if (days == null) expiry = 'no expiry date';
  else if (days <= 0) expiry = `expired ${Math.abs(days)}d ago`;
  else expiry = `expires in ${days}d`;
  return {
    batch,
    lot_id: entry.lot_id ?? null,
    qty: Number(entry.qty) || 0,
    expiry_date: entry.expiry_date ?? null,
    received_at: entry.received_at ?? null,
    expiryLabel: expiry,
    tone: expiryTone(entry.expiry_date, now),
    unbatched: entry.lot_id == null,
  };
}

// The whole manifest, described. Kept separate from the component so the
// "which batch left" panel has one testable definition. `now` is forwarded to
// every entry — accepting it and not passing it on would make the countdown
// labels depend on the real clock and untestable.
export function describeConsumedLots(manifest, now = new Date()) {
  return (Array.isArray(manifest) ? manifest : []).map(e => describeConsumedLot(e, now)).filter(Boolean);
}

// Total units a manifest accounts for — must equal the quantity sold, and the
// panel says so out loud when it does not.
export function consumedTotal(manifest) {
  return (Array.isArray(manifest) ? manifest : []).reduce((sum, e) => sum + (Number(e && e.qty) || 0), 0);
}

// Server-side total. The price comes from the catalog, so this is a preview
// only — the number the backend returns is the one that is recorded.
export function previewTotal(qty, price) {
  const q = Number(qty);
  const p = Number(price);
  if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(p)) return 0;
  return Math.round(q * p * 100) / 100;
}

// One line explaining a low-stock alert, or null when there is none.
export function describeLowStock(alert) {
  if (!alert) return null;
  const current = Number(alert.current_qty);
  const threshold = Number(alert.threshold);
  if (!Number.isFinite(current) || !Number.isFinite(threshold)) return null;
  return `Below the critical level: ${current} left, reorder at ${threshold}.`;
}
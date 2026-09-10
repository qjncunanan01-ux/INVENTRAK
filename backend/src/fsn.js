'use strict';

// FSN (Fast / Slow / Non-moving) inventory classification.
//
// Where ABC ranks products by SALES VALUE (what matters most), FSN classifies
// by MOVEMENT: how often a product sells and how recently it last sold. The
// two are complements: ABC tells you what to prioritize, FSN tells you what is
// actually flowing through the business. Together they are the classic
// inventory-analysis pair (e.g. "A+F" = high-value AND fast-moving).
//
// Metrics per product over the analysis window (default 90 days):
//   transactions — number of sales transactions in the window
//   frequency    — average days between sales (window / transactions)
//                  (when transactions >= window days, capped at 1)
//   recency      — days since the most recent sale
//   rate         — average units sold per day (qty / window)
//
// Classification (window-length aware):
//   N (Non-moving) — zero transactions in the window → dead stock:
//                    clear, discount, or stop reordering.
//   F (Fast)       — frequency <= FAST_FREQUENCY_DAYS (7) OR recency <=
//                    FAST_RECENCY_DAYS (7): sells at least weekly or sold
//                    this week → keep well-stocked, replenish first.
//   S (Slow)       — everything else: moves, but neither frequently nor
//                    recently → order conservatively, watch for dead stock.
//
// All inputs are plain data so the SQLite backend, the npm-free fallback,
// and any document driver (Firestore/Supabase) run the SAME algorithm —
// this is what the dual-backend contract tests assert.

// Default analysis window in days (a quarter — the conventional FSN window).
const FSN_WINDOW_DAYS = 90;

// A product selling at least every 7 days is "frequent".
const FAST_FREQUENCY_DAYS = 7;

// A product sold within the last 7 days is "recent" (rescues genuinely
// popular items whose average interval is skewed by one early sale).
const FAST_RECENCY_DAYS = 7;

/**
 * Parse and clamp the `window` parameter for the FSN endpoint.
 * @param {unknown} raw Raw query-string value (string | undefined).
 * @param {{ defaultWindow?: number, minWindow?: number, maxWindow?: number }} [opts]
 * @returns {number} A valid window in days.
 */
function parseFsnWindow(raw, opts = {}) {
  const { defaultWindow = FSN_WINDOW_DAYS, minWindow = 7, maxWindow = 730 } = opts;
  const n = Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(n)) {
    return defaultWindow;
  }
  return Math.min(maxWindow, Math.max(minWindow, Math.round(n)));
}

/**
 * Calculate a product's FSN metrics + classification from its sales rows.
 * @param {Array<{transaction_date?: string, qty?: number|string}>} txns Sales rows for ONE product inside the window (or not — out-of-window rows are ignored).
 * @param {{ id?: number|string, name?: string, price?: number|string }} product Catalog row used for identity + monetary stats.
 * @param {number} windowDays Analysis window in days.
 * @param {{ now?: Date }} [opts] Injectable clock (defaults to Date.now()) — makes the classifier deterministic in tests.
 */
function classifyFsn(txns, product, windowDays = FSN_WINDOW_DAYS, opts = {}) {
  const now = opts.now ? opts.now.getTime() : Date.now();
  const windowMs = windowDays * 86400000;
  const rows = (Array.isArray(txns) ? txns : []).filter((t) => {
    const d = new Date(t && t.transaction_date).getTime();
    return Number.isFinite(d) && d >= now - windowMs;
  }).map((t) => ({ d: new Date(t.transaction_date).getTime(), qty: Number(t.qty) || 0 }));

  const id = product && product.id !== undefined && product.id !== null ? Number(product.id) : null;
  const name = product && product.name !== undefined ? product.name : '';
  const price = product && product.price !== undefined && product.price !== null ? Number(product.price) : 0;

  // No (in-window) movement → Non-moving.
  if (rows.length === 0) {
    return {
      id,
      name,
      classification: 'N',
      transactions: 0,
      frequencyDays: null,
      recencyDays: null,
      ratePerDay: 0,
      totalQty: 0,
      valueSold: 0,
      windowDays,
    };
  }

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const valueSold = rows.reduce((s, r) => s + r.qty * price, 0);
  const recencyMs = now - Math.max(...rows.map((r) => r.d));
  const recencyDays = Math.floor(recencyMs / 86400000);
  // Average interval between sales: window divided by txn count, capped at 1
  // when sales are at least daily (can't be faster than one per day).
  const frequencyDays = Math.max(1, Math.min(windowDays, Math.floor(windowDays / rows.length)));

  const isFast = frequencyDays <= FAST_FREQUENCY_DAYS || recencyDays <= FAST_RECENCY_DAYS;

  return {
    id,
    name,
    classification: isFast ? 'F' : 'S',
    transactions: rows.length,
    frequencyDays,
    recencyDays,
    ratePerDay: Math.round((totalQty / windowDays) * 100) / 100,
    totalQty,
    valueSold: Math.round(valueSold * 100) / 100,
    windowDays,
  };
}

/**
 * Classify a whole catalog: rank N → S → F (movement-health order) so the
 * dead stock the owner must act on sorts to the top.
 * @param {Array<{ id?: number|string, name?: string, price?: number|string }>} products Catalog rows.
 * @param {Array<{product_id?: number|string, transaction_date?: string, qty?: number|string}>} sales All sales rows (filtering to active products + window happens here).
 * @param {{ windowDays?: number, now?: Date }} [opts]
 */
function classifyFsnCatalog(products, sales, opts = {}) {
  const windowDays = opts.windowDays !== undefined ? opts.windowDays : FSN_WINDOW_DAYS;
  const now = opts.now ? opts.now.getTime() : Date.now();
  const byProduct = new Map();
  for (const s of Array.isArray(sales) ? sales : []) {
    const d = new Date(s && s.transaction_date).getTime();
    if (!Number.isFinite(d) || d < now - windowDays * 86400000) continue;
    const pid = Number(s && s.product_id);
    if (!Number.isFinite(pid)) continue;
    if (!byProduct.has(pid)) byProduct.set(pid, []);
    byProduct.get(pid).push(s);
  }

  const rank = { N: 0, S: 1, F: 2 };
  return (Array.isArray(products) ? products : [])
    .map((p) => classifyFsn(byProduct.get(Number(p.id)) || [], p, windowDays, opts))
    .sort((a, b) =>
      (rank[a.classification] - rank[b.classification]) ||
      ((a.recencyDays === null ? Infinity : a.recencyDays) - (b.recencyDays === null ? Infinity : b.recencyDays))
    );
}

/**
 * Bundle-friendly summary for dashboards: counts per class + percentage mix.
 * @param {Array<{classification: string}>} items Output of classifyFsnCatalog.
 */
function summarizeFsn(items) {
  const list = Array.isArray(items) ? items : [];
  const counts = { F: 0, S: 0, N: 0 };
  for (const it of list) {
    if (counts[it.classification] !== undefined) counts[it.classification] += 1;
  }
  const total = list.length;
  return {
    total,
    counts,
    percentages: {
      F: total ? Math.round((counts.F / total) * 1000) / 10 : 0,
      S: total ? Math.round((counts.S / total) * 1000) / 10 : 0,
      N: total ? Math.round((counts.N / total) * 1000) / 10 : 0,
    },
  };
}

module.exports = {
  FSN_WINDOW_DAYS,
  FAST_FREQUENCY_DAYS,
  FAST_RECENCY_DAYS,
  parseFsnWindow,
  classifyFsn,
  classifyFsnCatalog,
  summarizeFsn,
};

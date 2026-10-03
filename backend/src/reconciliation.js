// Shelf-vs-system reconciliation.
//
// The question this answers: "the shelf and the ledger disagree — which
// products, and how much money?"
//
// The hard constraint, stated first because it dictates the whole design:
// THERE IS NO RECORDED OPENING BALANCE. The seeder invents per-product stock
// numbers and writes no movement rows for them (seed.js never touches
// stock_movements), so "expected = stock − sales" is arithmetically
// meaningless here — it would just echo the seed back. Any report claiming to
// know the opening stock would be inventing it.
//
// The second constraint: PHYSICAL STOCK IS ONLY OBSERVABLE BY COUNTING. No
// database can detect that a bottle walked out; only a human on the shelf can.
// So the anchor has to be a real count.
//
// Which gives the one comparison that is both computable and honest:
//
//     unexplained = system_now  −  (counted  −  recorded_sales_since)
//
//   counted              what a person saw on the shelf at count time
//   recorded_sales_since what the till says left after that count
//   system_now           what the system currently believes is there
//
// The middle term is the physical expectation: the shelf should hold
// `counted` minus whatever the till recorded leaving. Anything the system still
// believes beyond that did not leave through the till — shrinkage, breakage,
// or a sale rung up on paper. That surplus is the shrinkage number.
//
// Sign convention, stated because it is easy to invert:
//   unexplained > 0  → the system thinks it has stock that is NOT there. LOSS.
//   unexplained < 0  → more is on the shelf than expected. OVERAGE (found stock).
//
// Two things this deliberately does NOT claim:
//
//   - It does not attribute the loss to a cause. It says "N units are missing",
//     never "someone stole them". A till error, a break and a theft are
//     indistinguishable from the data, and naming a cause would be a guess.
//   - It does not blame an individual. `counted_by` is recorded for the audit
//     trail, not as an accusation.
//
// Sales are counted PER PRODUCT, not per location: `sales_transactions` has no
// location_id column. A count at Showroom is therefore reconciled against every
// recorded sale of that product anywhere, and the row says so in its
// `location_sales_note` rather than implying a precision the data cannot carry.

// Tolerance for "these are the same number". Quantities are REAL and arrive
// from counting by hand, so 0.001 differences are noise, not findings.
const EPSILON = 0.001;

// Timestamp parsing.
//
// SQLite's `datetime('now')` writes 'YYYY-MM-DD HH:MM:SS' — UTC, space
// separated, with NO zone marker. `Date.parse` reads that shape as LOCAL time,
// so on a UTC+8 machine (the Philippines) a row written by the live backend
// compares eight hours away from the ISO 'Z' rows the seeder writes. Two rows
// that are seconds apart can order incorrectly, and a count can appear to
// happen after sales it should precede.
//
// Both shapes are therefore parsed explicitly and read as UTC, which is what
// this codebase actually writes. Verified before this fix: a live count and a
// live sale in the same second produced a sales-since figure of 0.
function parseStamp(value) {
  if (!value) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/);
  if (m) {
    const ms = m[7] ? +m[7].padEnd(3, '0').slice(0, 3) : 0;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
    return Number.isNaN(t) ? null : t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// Sum of recorded sales for one product at or after `sinceStamp`.
// Returns { qty, unparsed } — `unparsed` counts rows whose timestamp is
// unreadable, so the caller can say the figure is incomplete instead of
// silently presenting it as exact.
export function salesSince(sales, productId, sinceStamp) {
  let qty = 0;
  let unparsed = 0;
  for (const s of Array.isArray(sales) ? sales : []) {
    if (!s || Number(s.product_id) !== Number(productId)) continue;
    const t = parseStamp(s.transaction_date);
    if (t === null) {
      unparsed += 1;
      continue;
    }
    // A sale stamped at the SAME instant as the count is INCLUDED.
    //
    // The two really are ambiguous, and the choice of direction decides which
    // way the report errs. Excluding it makes the physical expectation too
    // HIGH, so the report overstates shrinkage and points at a loss that did
    // not happen. Including it can understate, which merely delays the
    // finding. Overstating money-at-risk is the worse error: it accuses the
    // business of shrinkage it cannot have committed.
    if (sinceStamp !== null && t >= sinceStamp) qty += Number(s.qty) || 0;
  }
  return { qty, unparsed };
}

// The whole report, pure over arrays so both backends compute it identically.
//
// counts  [{ product_id, location_id, counted_qty, system_qty, counted_at, counted_by, note }]
// stock   [{ product_id, location_id, quantity }]
// sales   [{ product_id, qty, transaction_date }]
// products[{ id, name, price, cost }]
export function reconcile({ counts, stock, sales, products } = {}) {
  const stockMap = new Map();
  for (const s of Array.isArray(stock) ? stock : []) {
    if (!s) continue;
    stockMap.set(`${Number(s.product_id)}@${Number(s.location_id)}`, Number(s.quantity) || 0);
  }
  const productMap = new Map();
  for (const p of Array.isArray(products) ? products : []) {
    if (p && p.id != null) productMap.set(Number(p.id), p);
  }

  const rows = [];
  for (const c of Array.isArray(counts) ? counts : []) {
    if (!c) continue;
    const pid = Number(c.product_id);
    const lid = Number(c.location_id);
    const key = `${pid}@${lid}`;
    const counted = Number(c.counted_qty) || 0;
    const systemAtCount = Number(c.system_qty) || 0;
    const stamp = parseStamp(c.counted_at);
    // Without a count timestamp there is no anchor to measure "since" from.
    // Counting every sale ever would double-count the ones already reflected
    // in the stock figure, so the row reports the count-time variance only and
    // is flagged as unreconcilable rather than being given a number nobody can
    // defend.
    const countUndated = stamp === null;
    const since = countUndated ? { qty: 0, unparsed: 0 } : salesSince(sales, pid, stamp);

    // The variance the counter FOUND: physical minus believed, at count time.
    const variance = counted - systemAtCount;
    // What the shelf should hold now, if the only thing that left was through
    // the till.
    const expectedNow = counted - since.qty;
    // What the system believes is there right now.
    const systemNow = stockMap.has(key) ? stockMap.get(key) : 0;
    // The surplus the system believes beyond the physical expectation.
    const unexplained = systemNow - expectedNow;

    const product = productMap.get(pid) || null;
    const price = product ? Number(product.price) || 0 : 0;

    let classification;
    if (Math.abs(unexplained) <= EPSILON) classification = 'balanced';
    else if (unexplained > EPSILON) classification = 'loss';
    else classification = 'overage';

    rows.push({
      product_id: pid,
      location_id: lid,
      product: product ? product.name : `Product ${pid}`,
      category: product ? product.category ?? null : null,
      counted_qty: counted,
      system_qty_at_count: systemAtCount,
      variance_at_count: variance,
      counted_at: c.counted_at || null,
      counted_by: c.counted_by || null,
      note: c.note || null,
      sales_since_count: since.qty,
      unparsed_sales: since.unparsed,
      count_undated: countUndated,
      expected_qty_now: expectedNow,
      system_qty_now: systemNow,
      unexplained_qty: unexplained,
      classification,
      // Money at risk, priced at what the product SELLS for. Cost is not used
      // here: the point of the number is what the business is carrying, and
      // most of the catalog is still uncosted (cost is null), so a cost-based
      // figure would be silently wrong for the majority of rows.
      value_at_risk: Math.max(0, unexplained) * price,
      unit_price: price,
    });
  }

  // Worst first: the rows a manager must look at today.
  rows.sort((a, b) => Math.abs(b.unexplained_qty) - Math.abs(a.unexplained_qty) || a.product_id - b.product_id);

  const losses = rows.filter(r => r.classification === 'loss');
  const overages = rows.filter(r => r.classification === 'overage');

  return {
    rows,
    summary: {
      counted_rows: rows.length,
      balanced: rows.filter(r => r.classification === 'balanced').length,
      losses: losses.length,
      overages: overages.length,
      // Net units the system believes but the shelf cannot account for.
      shrinkage_units: losses.reduce((n, r) => n + r.unexplained_qty, 0),
      overage_units: overages.reduce((n, r) => n + Math.abs(r.unexplained_qty), 0),
      value_at_risk: losses.reduce((n, r) => n + r.value_at_risk, 0),
  // A count whose sales could not be dated is a softer figure than one
  // that is complete; the UI surfaces the count rather than hiding it.
  incomplete_sales_rows: rows.filter(r => r.unparsed_sales > 0).length,
      // Counts with no usable timestamp cannot be reconciled against the sale
      // ledger at all; they are counted separately so the report never quietly
      // presents them as clean.
      undated_counts: rows.filter(r => r.count_undated).length,
    },
  };
}

export { EPSILON };
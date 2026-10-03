// Costing snapshot — freezes the economics of an order inquiry at submission.
//
// WHY THIS EXISTS
// The inquiry's stored `estimated_cost` is the total the CUSTOMER PAYS (revenue),
// recomputed from line subtotals — despite the name, it is not a cost. Because it
// is derived, a past inquiry's economics silently change when the catalog
// changes: reprice a product today and last month's order now reports a
// different (and wrong) profit. This module writes an immutable snapshot so the
// numbers a customer was quoted stay true forever.
//
// COST BASIS
// There was no cost anywhere in INVENTRAK before this — products carried only a
// selling Price. Costing therefore requires a per-product COGS field (`cost` in
// SQLite, `Cost` in the npm-free JSON rows). It is NULLABLE and optional: a
// product with no cost is simply not costed, and the snapshot records that
// honestly via `cost_basis` rather than inventing a number.
//
//   cost_basis = 'exact'   every priced line had a known unit cost
//               'imputed' some lines had none; their cost was estimated from the
//                          blended cost-to-revenue ratio of the lines that did
//               'none'    nothing could be costed — the money fields are null
//
// Imputation, not fabrication: when some lines are missing a cost, the known
// lines give a cost/revenue ratio, and the unpriced lines' revenue is charged
// that ratio. It is an estimate, which is why `lines_priced`/`lines_total` are
// stored alongside so a reader can see how much was real.
const { normalizeLines } = require('./product-lines');

// Target margin used for `suggested_selling_price`. Configurable because the
// café sets it by policy, not by code: COSTING_TARGET_MARGIN=30 means 30%.
const DEFAULT_TARGET_MARGIN = 30;

function targetMarginPercent() {
  const raw = Number(process.env.COSTING_TARGET_MARGIN);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TARGET_MARGIN;
  return raw;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// A catalog row is either the SQLite shape ({ name, price, cost }) or the
// npm-free JSON shape ({ 'Product Name', Price, Cost }). Read both, tolerantly,
// so this module never needs to know which backend called it.
function pickName(p) {
  if (!p) return '';
  return String(p.name !== undefined ? p.name : (p['Product Name'] !== undefined ? p['Product Name'] : '')).trim();
}

function pickUnitCost(p) {
  if (!p) return null;
  const raw = p.cost !== undefined ? p.cost : p.Cost;
  // null/undefined/'' mean "not costed" and MUST NOT become 0 — Number(null) is
  // 0, and Number('') is 0, which would silently price every uncosted product
  // at zero cost and report a fake 100% margin. A real zero cost is still 0.
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const normKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Build id → cost and name → cost lookups once per snapshot.
function indexProducts(products) {
  const byId = new Map();
  const byName = new Map();
  for (const p of Array.isArray(products) ? products : []) {
    const id = p && p.id !== undefined && p.id !== null ? Number(p.id) : NaN;
    const cost = pickUnitCost(p);
    if (Number.isFinite(id)) byId.set(id, cost);
    const key = normKey(pickName(p));
    if (key) byName.set(key, cost);
  }
  return { byId, byName };
}

// Resolve one line to its unit cost: by product id when the client sent one,
// else by name. Returns null when the product is unknown or uncosted.
function lineCost(line, idx) {
  if (line.id !== null && line.id !== undefined) {
    const byId = idx.byId.get(Number(line.id));
    if (byId !== undefined) return byId;
  }
  const byName = idx.byName.get(normKey(line.name));
  return byName === undefined ? null : byName;
}

// Compute the immutable snapshot for one inquiry.
//
//   lines    — canonical lines from normalizeLines() (may be raw; normalized here)
//   products — the catalog, in whatever shape the backend holds
//   revenue  — what the customer is charged (the stored estimated_cost)
//
// Every money field is null when it cannot be computed honestly. Never guess.
function computeCostingSnapshot({ lines, products, revenue } = {}) {
  const { lines: canonical } = normalizeLines(lines);
  const idx = indexProducts(products);
  const totalRevenue = round2(Number(revenue) || 0);
  // "A cup" is one ordered unit: the sum of the line quantities.
  const targetQuantity = canonical.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  const marginPercent = targetMarginPercent();
  const marginFraction = marginPercent / 100;

  let knownCost = 0;
  let knownRevenue = 0;
  let unpricedRevenue = 0;
  let linesPriced = 0;

  for (const line of canonical) {
    const lineRevenue = line.subtotal !== null ? line.subtotal : 0;
    const unitCost = lineCost(line, idx);
    if (unitCost !== null) {
      knownCost += unitCost * (Number(line.qty) || 0);
      knownRevenue += lineRevenue;
      linesPriced += 1;
    } else {
      unpricedRevenue += lineRevenue;
    }
  }

  knownCost = round2(knownCost);
  knownRevenue = round2(knownRevenue);
  unpricedRevenue = round2(unpricedRevenue);

  const linesTotal = canonical.length;
  let totalCost = null;
  let costBasis = 'none';

  if (linesTotal > 0 && linesPriced > 0) {
    if (linesPriced === linesTotal) {
      totalCost = knownCost;
      costBasis = 'exact';
    } else if (knownRevenue > 0) {
      // Charge the unpriced revenue the same cost ratio the priced lines show.
      const ratio = knownCost / knownRevenue;
      totalCost = round2(knownCost + unpricedRevenue * ratio);
      costBasis = 'imputed';
    } else {
      // Priced lines carry quantities but no revenue (legacy rows): the ratio is
      // undefined, so cost the unpriced lines at the priced lines' unit average.
      const pricedUnits = canonical
        .filter((l) => lineCost(l, idx) !== null)
        .reduce((s, l) => s + (Number(l.qty) || 0), 0);
      const avgUnitCost = pricedUnits > 0 ? knownCost / pricedUnits : 0;
      const unpricedUnits = canonical
        .filter((l) => lineCost(l, idx) === null)
        .reduce((s, l) => s + (Number(l.qty) || 0), 0);
      totalCost = round2(knownCost + unpricedUnits * avgUnitCost);
      costBasis = 'imputed';
    }
  }

  const costPerCup =
    totalCost !== null && targetQuantity > 0 ? round2(totalCost / targetQuantity) : null;

  // What the customer SHOULD have paid to hit the target margin on this cost.
  const suggestedSellingPrice =
    totalCost !== null && marginFraction > 0 && marginFraction < 1
      ? round2(totalCost / (1 - marginFraction))
      : null;

  const estimatedProfit = totalCost !== null ? round2(totalRevenue - totalCost) : null;

  return {
    total_cost: totalCost,
    total_revenue: totalRevenue,
    target_quantity: targetQuantity,
    cost_per_cup: costPerCup,
    suggested_selling_price: suggestedSellingPrice,
    estimated_profit: estimatedProfit,
    cost_basis: costBasis,
    lines_priced: linesPriced,
    lines_total: linesTotal,
    margin_percent: marginPercent,
  };
}

// Row shape stored in costing_records. One snapshot per inquiry, keyed by
// inquiry_id, so a re-submitted or repriced order can never rewrite history.
function snapshotRow(inquiryId, snapshot, computedAt) {
  return {
    inquiry_id: Number(inquiryId),
    total_cost: snapshot.total_cost,
    total_revenue: snapshot.total_revenue,
    target_quantity: snapshot.target_quantity,
    cost_per_cup: snapshot.cost_per_cup,
    suggested_selling_price: snapshot.suggested_selling_price,
    estimated_profit: snapshot.estimated_profit,
    cost_basis: snapshot.cost_basis,
    lines_priced: snapshot.lines_priced,
    lines_total: snapshot.lines_total,
    margin_percent: snapshot.margin_percent,
    computed_at: computedAt,
  };
}

// Public shape (what the API returns and OpenAPI documents). Kept separate from
// the storage row so internal bookkeeping never leaks into the contract.
function toPublic(row) {
  if (!row) return null;
  return {
    inquiry_id: row.inquiry_id,
    total_cost: row.total_cost,
    total_revenue: row.total_revenue,
    target_quantity: row.target_quantity,
    cost_per_cup: row.cost_per_cup,
    suggested_selling_price: row.suggested_selling_price,
    estimated_profit: row.estimated_profit,
    cost_basis: row.cost_basis,
    lines_priced: row.lines_priced,
    lines_total: row.lines_total,
    margin_percent: row.margin_percent,
    computed_at: row.computed_at,
  };
}

module.exports = {
  computeCostingSnapshot,
  snapshotRow,
  toPublic,
  targetMarginPercent,
  DEFAULT_TARGET_MARGIN,
};
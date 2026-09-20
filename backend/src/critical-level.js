'use strict';

// Critical level — the per-product stock threshold at which a product must be
// reordered.
//
// Before this module every product shared one flat 80-unit threshold, which is
// wrong in both directions: a fast-moving milk that sells 40 units a day hits
// empty before an 80-unit alert ever fires, while a non-moving display piece
// raises a false alarm forever. The critical level is therefore derived from
// MOVEMENT (the same FSN classification the Optimization page already shows):
//
//   criticalLevel = max( floor(class), ceil(ratePerDay × leadTime × (1 + z)) )
//
//   ratePerDay  — average units sold per day in the FSN window
//   leadTime    — supplier lead time in days for that movement class
//   z           — service factor (how much safety buffer the class warrants)
//   floor       — a class-level minimum so every product has a sane bar even
//                 with little sales history
//
//   Fast (F)        7-day  lead, z 0.65, floor 120 — replenish FIRST, high bar
//   Slow (S)       14-day  lead, z 0.50, floor  60 — order conservatively
//   Non-moving (N) 30-day  lead, z 0.25, floor  32 — dead stock, low bar
//
// Pure data in, pure data out, so the SQLite backend, the npm-free fallback and
// any document driver produce identical levels — the dual-backend contract
// tests cover this.

const { classifyFsnCatalog, FSN_WINDOW_DAYS } = require('./fsn');
const { db } = require('./db');

// Memoized critical levels map (1 minute TTL)
let criticalCache = { at: 0, map: new Map() };

function criticalLevels(now = Date.now()) {
  if (criticalCache.map.size && now - criticalCache.at < 60000) return criticalCache.map;
  const products = db.prepare('SELECT id, name, price FROM products').all();
  const sales = db.prepare('SELECT product_id, transaction_date, qty FROM sales_transactions').all();
  criticalCache = { at: now, map: criticalLevelMap(products, sales) };
  return criticalCache.map;
}

function criticalLevelOf(productId) {
  return criticalLevelFromMap(criticalLevels(), productId);
}

// Supplier lead time (days) assumed per movement class.
const LEAD_TIME_DAYS = { F: 7, S: 14, N: 30 };

// Safety-buffer service factor per movement class (fraction of cycle demand).
const SERVICE_FACTOR = { F: 0.65, S: 0.5, N: 0.25 };

// Minimum critical level per class — keeps a sane bar for thin sales history.
const CLASS_FLOOR = { F: 120, S: 60, N: 32 };

// Absolute clamp so a data spike can never produce an absurd threshold.
const MIN_LEVEL = 5;
const MAX_LEVEL = 5000;

const CLASS_LABEL = { F: 'Fast-moving', S: 'Slow-moving', N: 'Non-moving' };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Critical level for one already-classified product.
 * @param {{ classification?: string, ratePerDay?: number|string }} fsnRow Row from fsn.js (classification F|S|N).
 * @returns {{ criticalLevel: number, classification: string, movementLabel: string,
 *            ratePerDay: number, leadTimeDays: number, safetyStock: number }}
 */
function criticalLevelFor(fsnRow) {
  const cls = fsnRow && CLASS_FLOOR[fsnRow.classification] !== undefined ? fsnRow.classification : 'N';
  const rate = Number(fsnRow && fsnRow.ratePerDay) || 0;
  const lead = LEAD_TIME_DAYS[cls];
  const z = SERVICE_FACTOR[cls];

  const cycleDemand = rate * lead;
  const safetyStock = Math.ceil(cycleDemand * z);
  const demandLevel = Math.ceil(cycleDemand) + safetyStock;

  return {
    criticalLevel: clamp(Math.max(demandLevel, CLASS_FLOOR[cls]), MIN_LEVEL, MAX_LEVEL),
    classification: cls,
    movementLabel: CLASS_LABEL[cls],
    ratePerDay: Math.round(rate * 100) / 100,
    leadTimeDays: lead,
    safetyStock,
  };
}

/**
 * Critical level for a single product id out of a prepared map.
 * Unknown products (e.g. freshly created, no sales history) get the
 * non-moving floor — the same value both backends use for a new product.
 */
function criticalLevelFromMap(map, productId) {
  const entry = map && map instanceof Map ? map.get(Number(productId)) : undefined;
  return entry ? entry.criticalLevel : criticalLevelFor(null).criticalLevel;
}

/**
 * Build the productId → critical-level map for a whole catalog.
 * @param {Array} products Catalog rows ({ id, name, price }).
 * @param {Array} sales Sales rows ({ product_id, transaction_date, qty }).
 * @param {{ windowDays?: number, now?: Date }} [opts]
 * @returns {Map<number, {criticalLevel: number, classification: string, movementLabel: string, ratePerDay: number, leadTimeDays: number, safetyStock: number}>}
 */
function criticalLevelMap(products, sales, opts = {}) {
  const rows = classifyFsnCatalog(products, sales, {
    windowDays: opts.windowDays !== undefined ? opts.windowDays : FSN_WINDOW_DAYS,
    now: opts.now,
  });
  const map = new Map();
  for (const row of rows) {
    if (row.id === null || !Number.isFinite(row.id)) continue;
    map.set(row.id, criticalLevelFor(row));
  }
  return map;
}

/**
 * Stock status for a quantity against its critical level — the three badges the
 * catalog and dashboard show.
 * @param {number|string} qty Quantity on hand (per product total, or per location).
 * @param {number|string} criticalLevel The product's critical level.
 * @returns {'out_of_stock'|'critical'|'low_stock'|'in_stock'}
 */
function stockStatus(qty, criticalLevel, lowStockMultiplier = 1.5) {
  const q = Number(qty) || 0;
  const level = Number(criticalLevel) || 0;
  // The widening factor comes from live System Settings (owner-tunable) —
  // the default keeps the historical 1.5× behavior.
  const mult = Number(lowStockMultiplier) > 1 ? Number(lowStockMultiplier) : 1.5;
  if (q <= 0) return 'out_of_stock';
  if (q <= level) return 'critical';
  if (q <= Math.ceil(level * mult)) return 'low_stock';
  return 'in_stock';
}

/**
 * Human label for a stock status (matches the mobile badge wording).
 * @param {string} status Output of stockStatus().
 */
function stockStatusLabel(status) {
  return (
    {
      out_of_stock: 'Out of Stock',
      critical: 'Critical',
      low_stock: 'Low Stock',
      in_stock: 'In Stock',
    }[status] || 'In Stock'
  );
}

module.exports = {
  LEAD_TIME_DAYS,
  SERVICE_FACTOR,
  CLASS_FLOOR,
  MIN_LEVEL,
  MAX_LEVEL,
  CLASS_LABEL,
  criticalLevelFor,
  criticalLevelFromMap,
  criticalLevelMap,
  criticalLevels,
  criticalLevelOf,
  stockStatus,
  stockStatusLabel,
};

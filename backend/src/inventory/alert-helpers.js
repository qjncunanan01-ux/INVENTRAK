const { db } = require('../db');
const { criticalLevelMap, criticalLevelFromMap, stockStatus } = require('./critical-level');
const settings = require('../governance/settings');
const { schedule } = require('./stocktake');

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

function refreshLowStockAlerts() {
  const map = criticalLevels();
  const rows = db.prepare('SELECT product_id, location_id, quantity FROM stock').all();
  const openFor = db.prepare("SELECT id, threshold, current_qty FROM inventory_alerts WHERE product_id = ? AND location_id = ? AND alert_type = 'low_stock' AND status = 'active'");
  const insert = db.prepare("INSERT INTO inventory_alerts (product_id, location_id, alert_type, threshold, current_qty, status) VALUES (?, ?, 'low_stock', ?, ?, 'active')");
  const refresh = db.prepare('UPDATE inventory_alerts SET threshold = ?, current_qty = ? WHERE id = ?');
  const resolve = db.prepare("UPDATE inventory_alerts SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?");

  for (const row of rows) {
    const level = criticalLevelFromMap(map, row.product_id);
    const open = openFor.get(row.product_id, row.location_id);
    if (row.quantity <= level) {
      if (!open) insert.run(row.product_id, row.location_id, level, row.quantity);
      else if (open.threshold !== level || open.current_qty !== row.quantity) refresh.run(level, row.quantity, open.id);
    } else if (open) resolve.run(open.id);
  }
}

const EXPIRY_WARNING_DAYS = 30;

function refreshExpiryAlerts(now = new Date()) {
  const today = new Date(now.getTime());
  today.setUTCHours(0, 0, 0, 0);

  const lots = db.prepare('SELECT product_id, location_id, SUM(qty) AS qty, expiry_date FROM stock_lots WHERE expiry_date IS NOT NULL AND qty > 0 GROUP BY product_id, location_id, expiry_date').all();
  const openFor = db.prepare("SELECT id, threshold, current_qty FROM inventory_alerts WHERE product_id = ? AND location_id = ? AND alert_type = ? AND status = 'active'");
  const insert = db.prepare("INSERT INTO inventory_alerts (product_id, location_id, alert_type, threshold, current_qty, expiry_date, status) VALUES (?, ?, ?, ?, ?, ?, 'active')");
  const refresh = db.prepare('UPDATE inventory_alerts SET threshold = ?, current_qty = ? WHERE id = ?');
  const resolve = db.prepare("UPDATE inventory_alerts SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?");

  const live = new Set();
  for (const lot of lots) {
    const exp = new Date(`${lot.expiry_date}T00:00:00Z`);
    if (!Number.isFinite(exp.getTime())) continue;
    const daysLeft = Math.round((exp.getTime() - today.getTime()) / 86400000);
    if (daysLeft > EXPIRY_WARNING_DAYS) continue;

    const type = daysLeft < 0 ? 'expired' : 'expiring_soon';
    live.add(`${lot.product_id}:${lot.location_id}:${type}`);

    const flipped = openFor.get(lot.product_id, lot.location_id, type === 'expired' ? 'expiring_soon' : 'expired');
    if (flipped) resolve.run(flipped.id);

    const open = openFor.get(lot.product_id, lot.location_id, type);
    if (!open) insert.run(lot.product_id, lot.location_id, type, daysLeft, lot.qty, lot.expiry_date);
    else if (open.threshold !== daysLeft || open.current_qty !== lot.qty) refresh.run(daysLeft, lot.qty, open.id);
  }

  const stale = db.prepare("SELECT id, product_id, location_id, alert_type FROM inventory_alerts WHERE status = 'active' AND alert_type IN ('expiring_soon', 'expired')").all();
  for (const row of stale) {
    if (!live.has(`${row.product_id}:${row.location_id}:${row.alert_type}`)) resolve.run(row.id);
  }
}

// Stocktake overdue flags — one per shelf that is due to be walked.
//
// Same upsert/resolve shape as the two passes above, so it is idempotent: the
// row is created when a shelf goes overdue, kept in step while it stays
// overdue, and resolved the moment the shelf is counted again. Re-running it a
// hundred times must not create a hundred rows or a hundred emails later.
//
// Column reuse, since inventory_alerts grew for a different feature:
//   threshold   days PAST due (so the number on screen is the urgency)
//   current_qty the shelf's stale+never-counted line count
// product_id is NULL by design — staleness belongs to the SHELF, not to a line.
function refreshStocktakeAlerts(now = Date.now()) {
  const cycleDays = settings.getStocktakeCycleDays();

  const locations = db.prepare('SELECT id, name FROM locations').all();
  const stock = db.prepare('SELECT product_id, location_id, quantity FROM stock').all();
  const counts = db.prepare('SELECT product_id, location_id, counted_at FROM inventory_counts').all();

  const board = schedule({ locations, stock, counts, cycleDays, now });

  const openFor = db.prepare(
    "SELECT id, threshold, current_qty FROM inventory_alerts WHERE location_id = ? AND alert_type = 'stale_count' AND status = 'active'",
  );
  const insert = db.prepare(
    "INSERT INTO inventory_alerts (product_id, location_id, alert_type, threshold, current_qty, status) VALUES (NULL, ?, 'stale_count', ?, ?, 'active')",
  );
  const refresh = db.prepare('UPDATE inventory_alerts SET threshold = ?, current_qty = ? WHERE id = ?');
  const resolve = db.prepare("UPDATE inventory_alerts SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?");

  const live = new Set();
  for (const row of board.rows) {
    if (row.status !== 'overdue' && row.status !== 'never_counted') continue;
    live.add(row.location_id);

    const daysPastDue = Math.max(0, -(row.days_until_due ?? 0));
    const staleLines = row.stale_lines + row.never_counted_lines;

    const open = openFor.get(row.location_id);
    if (!open) insert.run(row.location_id, daysPastDue, staleLines);
    else if (open.threshold !== daysPastDue || open.current_qty !== staleLines)
      refresh.run(daysPastDue, staleLines, open.id);
  }

  // Anything flagged and no longer due is resolved — including shelves that were
  // deleted outright, which is why this is keyed on the live set rather than on
  // the board alone.
  const stale = db
    .prepare("SELECT id, location_id FROM inventory_alerts WHERE status = 'active' AND alert_type = 'stale_count'")
    .all();
  for (const row of stale) {
    if (!live.has(Number(row.location_id))) resolve.run(row.id);
  }

  return board;
}

function refreshAlerts() {
  refreshLowStockAlerts();
  refreshExpiryAlerts();
  refreshStocktakeAlerts();
}

module.exports = { refreshAlerts, refreshStocktakeAlerts, criticalLevels, criticalLevelOf };
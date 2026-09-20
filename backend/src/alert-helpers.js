const { db } = require('./db');
const { criticalLevelMap, criticalLevelFromMap, stockStatus } = require('./critical-level');
const settings = require('./settings');

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

function refreshAlerts() {
  refreshLowStockAlerts();
  refreshExpiryAlerts();
}

module.exports = { refreshAlerts, criticalLevels, criticalLevelOf };
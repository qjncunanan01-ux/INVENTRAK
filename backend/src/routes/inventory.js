const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken, signToken } = require('../auth-core');
const { adminOnly, staffOrAdmin } = require('../middleware');
const { criticalLevels, criticalLevelFromMap, stockStatus } = require('../critical-level');
const { reconcile } = require('../reconciliation');
const { audit } = require('../audit');
const { validate } = require('../validation');
const settings = require('../settings');

function resolveLocation(value) {
  if (!value && value !== 0) return null;
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && Number.isInteger(numeric)) return numeric;
  const row = db.prepare('SELECT id FROM locations WHERE name = ?').get(value);
  return row ? row.id : null;
}

// GET /api/inventory
router.get('/', (req, res) => {
  const { location, low_stock } = req.query;

  const products = db.prepare('SELECT * FROM products WHERE status = ?').all('active');
  const locations = db.prepare('SELECT * FROM locations').all();

  const levelMap = criticalLevels();

  let items = products.map((p) => {
    let stocks;
    if (location) {
      const locId = resolveLocation(location);
      stocks = db.prepare('SELECT l.name, s.quantity FROM stock s JOIN locations l ON s.location_id = l.id WHERE s.product_id = ? AND s.location_id = ?').all(p.id, locId);
    } else {
      stocks = db.prepare('SELECT l.name, s.quantity FROM stock s JOIN locations l ON s.location_id = l.id WHERE s.product_id = ?').all(p.id);
    }

    const total = stocks.reduce((acc, item) => acc + item.quantity, 0);
    const detail = {};
    stocks.forEach((stock) => { detail[stock.name] = stock.quantity; });

    const info = criticalLevelFromMap(levelMap, p.id);

    return {
      product: p,
      locations: detail,
      total,
      critical_level: info.criticalLevel,
      movement_class: info.classification,
      movement_label: info.movementLabel,
      stock_status: stockStatus(total, info.criticalLevel, settings.getLowStockMultiplier()),
    };
  });

  if (low_stock === 'true') {
    items = items.filter((item) => item.total < item.critical_level);
  }

  res.json({ locations, items });
});

// POST /api/inventory/count — record a stocktake.
//
// Staff-tier: counting the shelf IS the staff role ("counts, QR scanning,
// requests"). Reading the RECONCILIATION is admin-tier (below) because it
// reports money at risk and names who last counted.
//
// system_qty is snapshotted HERE, at count time, because that is the only
// moment the system's belief about this shelf still matches what the counter
// was looking at. Storing it later would compare a physical figure against a
// number that has already moved on.
router.post('/count', authenticateToken, staffOrAdmin, validate({
  product_id: { required: true, type: 'number', min: 1 },
  location_id: { required: true, type: 'number', min: 1 },
  counted_qty: { required: true, type: 'number', min: 0 },
  note: { type: 'string' },
}), (req, res) => {
  const { product_id, location_id, counted_qty } = req.body;
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const location = db.prepare('SELECT id FROM locations WHERE id = ?').get(location_id);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const stockRow = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(product_id, location_id);
  const systemQty = stockRow ? stockRow.quantity : 0;

  // counted_at is written explicitly at millisecond precision rather than left
  // to SQLite's `datetime('now')`: the whole report compares it against sale
  // timestamps, and a second-resolution stamp collides with a sale made in the
  // same second. Same string format the rest of the codebase uses.
  const countedAt = new Date().toISOString();
  const info = db.prepare(
    'INSERT INTO inventory_counts (product_id, location_id, counted_qty, system_qty, counted_at, counted_by, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(product_id, location_id, counted_qty, systemQty, countedAt, req.user.username, req.body.note || null);

  audit('inventory.counted', {
    actor: req.user.username,
    actorRole: req.user.role,
    count_id: Number(info.lastInsertRowid),
    product_id,
    location_id,
    counted_qty,
    system_qty: systemQty,
    variance: counted_qty - systemQty,
  });

  res.status(201).json({
    ok: true,
    count_id: Number(info.lastInsertRowid),
    product_id,
    location_id,
    counted_qty,
    system_qty: systemQty,
    counted_at: countedAt,
    variance: counted_qty - systemQty,
  });
});

// GET /api/inventory/reconciliation — shelf vs system.
//
// Admin-tier, and deliberately NOT publicly cached: it reports money at risk.
// The arithmetic is in reconciliation.js, pure over arrays, so both backends
// compute it identically.
router.get('/reconciliation', authenticateToken, adminOnly, (req, res) => {
  const { product_id, only_variance } = req.query;

  let counts = db.prepare('SELECT product_id, location_id, counted_qty, system_qty, counted_at, counted_by, note FROM inventory_counts').all();
  // Only the most recent count per product/location: a shelf is reconciled
  // against the last time someone actually walked it, not against every walk
  // in history (which would double-count the same physical stock).
  const latest = new Map();
  for (const c of counts) {
    const key = `${c.product_id}@${c.location_id}`;
    const seen = latest.get(key);
    if (!seen || String(c.counted_at) > String(seen.counted_at)) latest.set(key, c);
  }
  counts = [...latest.values()];

  if (product_id) counts = counts.filter(c => Number(c.product_id) === Number(product_id));

  const stock = db.prepare('SELECT product_id, location_id, quantity FROM stock').all();
  // Sales carry no location, so the whole ledger is handed to the pure module
  // and it does the per-product filtering after the count timestamp.
  const sales = db.prepare('SELECT product_id, qty, transaction_date FROM sales_transactions').all();
  const products = db.prepare('SELECT id, name, category, price FROM products').all();

  const report = reconcile({ counts, stock, sales, products });
  const rows = only_variance === 'true'
    ? report.rows.filter(r => r.classification !== 'balanced')
    : report.rows;
  const names = Object.fromEntries(db.prepare('SELECT id, name FROM locations').all().map(l => [l.id, l.name]));
  res.json({
    ...report,
    rows: rows.map(r => ({ ...r, location: names[r.location_id] || `Location ${r.location_id}` })),
    locations: db.prepare('SELECT id, name FROM locations').all(),
  });
});

module.exports = router;
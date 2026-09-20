const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly, staffOrAdmin } = require('../middleware');
const { validate } = require('../validation');
const { criticalLevelOf, criticalLevelFromMap } = require('../critical-level');
const { audit } = require('../audit');

function resolveLocation(value) {
  if (!value && value !== 0) return null;
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && Number.isInteger(numeric)) return numeric;
  const row = db.prepare('SELECT id FROM locations WHERE name = ?').get(value);
  return row ? row.id : null;
}

function consumeStockLots(productId, locationId, quantity) {
  let remaining = quantity;
  const manifest = [];

  const lots = db.prepare('SELECT id, qty, expiry_date FROM stock_lots WHERE product_id = ? AND location_id = ? AND qty > 0 ORDER BY (expiry_date IS NULL) ASC, expiry_date ASC, received_at ASC, id ASC').all(productId, locationId);

  for (const lot of lots) {
    if (remaining <= 0) break;
    const consume = Math.min(lot.qty, remaining);
    db.prepare('UPDATE stock_lots SET qty = qty - ? WHERE id = ?').run(consume, lot.id);
    remaining -= consume;
    manifest.push({ expiry_date: lot.expiry_date == null ? null : lot.expiry_date, qty: consume });
  }

  if (remaining > 0) {
    db.prepare('UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?').run(remaining, productId, locationId);
    manifest.push({ expiry_date: null, qty: remaining });
  }

  return manifest;
}

function groupManifestByExpiry(manifest) {
  const groups = [];
  for (const entry of manifest) {
    const expiry = entry.expiry_date == null ? null : entry.expiry_date;
    const existing = groups.find(g => g.expiry_date === expiry);
    if (existing) existing.qty += entry.qty;
    else groups.push({ expiry_date: expiry, qty: entry.qty });
  }
  return groups;
}

function applyMovementEffect({ product_id, qty, type, srcId, dstId, now, expiryDate = null }) {
  const ensureStockRow = db.prepare('INSERT OR IGNORE INTO stock (product_id, location_id, quantity) VALUES (?, ?, 0)');

  if (srcId) ensureStockRow.run(product_id, srcId);
  if (dstId) ensureStockRow.run(product_id, dstId);

  if (type === 'stock-in' && dstId) {
    db.prepare('UPDATE stock SET quantity = quantity + ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, dstId);
    db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at, expiry_date) VALUES (?, ?, ?, ?, ?)').run(product_id, dstId, qty, now, expiryDate);
  } else if (type === 'stock-out' && srcId) {
    consumeStockLots(product_id, srcId, qty);
    db.prepare('UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, srcId);
  } else if (type === 'transfer' && srcId && dstId) {
    const manifest = groupManifestByExpiry(consumeStockLots(product_id, srcId, qty));
    const dstGroups = manifest.some(g => g.expiry_date != null) ? manifest : expiryDate ? [{ expiry_date: expiryDate, qty }] : manifest;
    db.prepare('UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, srcId);
    db.prepare('UPDATE stock SET quantity = quantity + ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, dstId);
    for (const g of dstGroups) {
      db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at, expiry_date) VALUES (?, ?, ?, ?, ?)').run(product_id, dstId, g.qty, now, g.expiry_date);
    }
  } else if (type === 'adjustment' && (srcId || dstId)) {
    const loc = dstId || srcId;
    db.prepare('UPDATE stock SET quantity = ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, loc);
    db.prepare('DELETE FROM stock_lots WHERE product_id = ? AND location_id = ?').run(product_id, loc);
    db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at, expiry_date) VALUES (?, ?, ?, ?, ?)').run(product_id, loc, qty, now, expiryDate);
  }

  const threshold = criticalLevelOf(product_id);
  if (srcId) {
    const updated = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(product_id, srcId);
    if (updated && updated.quantity < threshold) {
      const existingAlert = db.prepare('SELECT id FROM inventory_alerts WHERE product_id = ? AND location_id = ? AND alert_type = ? AND status = ?').get(product_id, srcId, 'low_stock', 'active');
      if (!existingAlert) {
        db.prepare('INSERT INTO inventory_alerts (product_id, location_id, alert_type, threshold, current_qty, status) VALUES (?, ?, ?, ?, ?, ?)').run(product_id, srcId, 'low_stock', threshold, updated.quantity, 'active');
      } else {
        db.prepare('UPDATE inventory_alerts SET current_qty = ? WHERE id = ?').run(updated.quantity, existingAlert.id);
      }
    }
  }
}

// POST /api/stock-movement
router.post('/', authenticateToken, adminOnly, validate({
  product_id: { required: true, type: 'number', min: 1 },
  qty: { required: true, type: 'number', min: 0.01 },
  type: { required: true, maxLength: 20 },
}), (req, res) => {
  const { product_id, qty, type, src_location, dst_location, notes, user, expiry_date } = req.body;

  const validTypes = ['stock-in', 'stock-out', 'transfer', 'adjustment'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
  }

  let expiryDate = null;
  if (expiry_date !== undefined && expiry_date !== null && expiry_date !== '') {
    const raw = String(expiry_date).trim();
    const normalized = raw.slice(0, 10);
    const asDate = new Date(`${normalized}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(asDate.getTime()) || asDate.toISOString().slice(0, 10) !== normalized) {
      return res.status(400).json({ error: 'expiry_date must be a valid date (YYYY-MM-DD)' });
    }
    expiryDate = normalized;
  }

  const product = db.prepare('SELECT id FROM products WHERE id = ? AND status = ?').get(product_id, 'active');
  if (!product) return res.status(404).json({ error: 'Product not found or inactive' });

  const now = new Date().toISOString();
  const srcId = resolveLocation(src_location);
  const dstId = resolveLocation(dst_location);

  if ((type === 'stock-out' || type === 'transfer') && srcId) {
    const preflightStock = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(product_id, srcId);
    if (!preflightStock || preflightStock.quantity < qty) {
      return res.status(400).json({ error: 'Insufficient stock at source location' });
    }
  }

  db.prepare('INSERT INTO stock_movements (product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(product_id, qty, type, srcId || null, dstId || null, notes || '', now, user || req.user?.username || 'system');

  applyMovementEffect({ product_id, qty, type, srcId, dstId, now, expiryDate });

  audit('stock.movement.created', { userId: req.user.id, username: req.user.username, type, productId: product_id, quantity: qty });

  res.json({ ok: true, message: `Stock ${type} recorded successfully` });
});

// GET /api/stock-movements
router.get('/', (req, res) => {
  const { page = 1, limit = 50, type, product_id } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  let where = 'WHERE 1=1';
  const params = [];

  if (type) { where += ' AND type = ?'; params.push(type); }
  if (product_id) { where += ' AND product_id = ?'; params.push(product_id); }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM stock_movements ${where}`).get(...params);
  const rows = db.prepare(`SELECT * FROM stock_movements ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limitNum, offset);

  if (!req.query.page && !req.query.limit) return res.json(rows);

  res.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total: countRow.total, totalPages: Math.ceil(countRow.total / limitNum) } });
});

module.exports = router;
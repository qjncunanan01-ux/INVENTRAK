const express = require('express');
const router = express.Router();
const { db } = require('../../db');
const { authenticateToken } = require('../../auth-core');
const { adminOnly } = require('../../middleware');
const { validate } = require('../../validation');
const { audit } = require('../../audit');
const { quantityInProductUnit } = require('../../stock-control/unit-conversion');
const { resolveLocation, applyMovementEffect } = require('../../stock-control/stock-movement-helpers');

// POST /api/stock-movement
router.post('/', authenticateToken, adminOnly, validate({
  product_id: { required: true, type: 'number', min: 1 },
  qty: { required: true, type: 'number', min: 0.01 },
  type: { required: true, maxLength: 20 },
}), (req, res) => {
  const { product_id, qty, qty_unit, type, src_location, dst_location, notes, user, expiry_date } = req.body;

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

  const product = db.prepare('SELECT id, unit FROM products WHERE id = ? AND status = ?').get(product_id, 'active');
  if (!product) return res.status(404).json({ error: 'Product not found or inactive' });

  const normalized = quantityInProductUnit({
    rows: db.prepare('SELECT from_unit, to_unit, rate FROM unit_conversions').all(),
    product,
    quantity: qty,
    enteredUnit: qty_unit,
  });
  if (!normalized.ok) return res.status(400).json({ error: normalized.error });
  const baseQty = normalized.quantity;

  const now = new Date().toISOString();
  const srcId = resolveLocation(src_location);
  const dstId = resolveLocation(dst_location);

  const hasSource = src_location !== undefined && src_location !== null && src_location !== '';
  const hasDestination = dst_location !== undefined && dst_location !== null && dst_location !== '';
  if ((hasSource && !srcId) || (hasDestination && !dstId)) {
    return res.status(404).json({ error: 'Location not found' });
  }
  if (type === 'stock-in' && !dstId) return res.status(400).json({ error: 'dst_location is required for stock-in' });
  if (type === 'stock-out' && !srcId) return res.status(400).json({ error: 'src_location is required for stock-out' });
  if (type === 'transfer' && (!srcId || !dstId)) return res.status(400).json({ error: 'src_location and dst_location are required for transfer' });
  if (type === 'transfer' && srcId === dstId) return res.status(400).json({ error: 'Source and destination locations must be different' });
  if (type === 'adjustment' && !srcId && !dstId) return res.status(400).json({ error: 'A source or destination location is required for adjustment' });

  if ((type === 'stock-out' || type === 'transfer') && srcId) {
    const preflightStock = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(product_id, srcId);
    if (!preflightStock || preflightStock.quantity < baseQty) {
      return res.status(400).json({ error: 'Insufficient stock at source location' });
    }
  }

  db.prepare('INSERT INTO stock_movements (product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(product_id, baseQty, type, srcId || null, dstId || null, notes || '', now, user || req.user?.username || 'system');

  applyMovementEffect({ product_id, qty: baseQty, type, srcId, dstId, now, expiryDate });

  audit('stock.movement.created', { userId: req.user.id, username: req.user.username, type, productId: product_id, quantity: baseQty, enteredQuantity: normalized.entered_quantity, enteredUnit: normalized.entered_unit });

  res.json({ ok: true, quantity: baseQty, unit: normalized.base_unit, entered_quantity: normalized.entered_quantity, entered_unit: normalized.entered_unit, message: `Stock ${type} recorded successfully` });
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

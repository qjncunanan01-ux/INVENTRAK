const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly, staffOrAdmin } = require('../middleware');
const { validate } = require('../validation');
const { applyMovementEffect } = require('../stock-movement-helpers');
const { audit } = require('../audit');
const { isIsoDate } = require('../validation');

function listAdjustments(dbRef, status) {
  const where = status ? ' WHERE a.status = ?' : '';
  const params = status ? [status] : [];
  return dbRef.prepare(`SELECT a.id, a.product_id, p.name as product_name, a.location_id, l.name as location_name,
    a.new_qty, a.reason, a.expiry_date, a.status, a.created_at, a.decided_at, a.decided_by,
    COALESCE(s.quantity, 0) as current_qty
   FROM stock_adjustments a
   JOIN products p ON p.id = a.product_id
   JOIN locations l ON l.id = a.location_id
   LEFT JOIN stock s ON s.product_id = a.product_id AND s.location_id = a.location_id
   ${where}
   ORDER BY a.created_at DESC`).all(...params);
}

function listTransfers(dbRef, status) {
  const where = status ? ' WHERE t.status = ?' : '';
  const params = status ? [status] : [];
  return dbRef.prepare(`SELECT t.id, t.product_id, p.name as product_name,
    t.src_location, s.name as src_location_name,
    t.dst_location, d.name as dst_location_name,
    t.qty, t.reason, t.status, t.created_at, t.decided_at, t.decided_by
   FROM stock_transfers t
   JOIN products p ON p.id = t.product_id
   JOIN locations s ON s.id = t.src_location
   JOIN locations d ON d.id = t.dst_location
   ${where}
   ORDER BY t.created_at DESC`).all(...params);
}

// GET /api/stock-adjustments
router.get('/stock-adjustments', authenticateToken, staffOrAdmin, (req, res) => {
  res.json(listAdjustments(db, req.query.status || null));
});

// POST /api/stock-adjustments
router.post('/stock-adjustments', authenticateToken, staffOrAdmin, validate({
  product_id: { required: true, type: 'number', min: 1 },
  location_id: { required: true, type: 'number', min: 1 },
  new_qty: { required: true, type: 'number', min: 0 },
  reason: { maxLength: 300 },
  expiry_date: { date: true, maxLength: 10 },
}), (req, res) => {
  const { product_id, location_id, new_qty, reason, expiry_date } = req.body;
  const product = db.prepare('SELECT id FROM products WHERE id = ? AND status = ?').get(product_id, 'active');
  if (!product) return res.status(404).json({ error: 'Product not found or inactive' });
  const loc = db.prepare('SELECT id FROM locations WHERE id = ?').get(location_id);
  if (!loc) return res.status(404).json({ error: 'Location not found' });

  const info = db.prepare('INSERT INTO stock_adjustments (product_id, location_id, new_qty, reason, expiry_date, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(product_id, location_id, new_qty, reason || '', expiry_date || null, 'pending');

  audit('stock.adjustment.created', { userId: req.user.id, username: req.user.username, adjustmentId: info.lastInsertRowid, productId: product_id, locationId: location_id, newQty: new_qty, expiryDate: expiry_date || null });
  res.status(201).json({ ok: true, id: info.lastInsertRowid, message: 'Adjustment created (pending approval)' });
});

function decideAdjustment(req, res, action) {
  const row = db.prepare('SELECT * FROM stock_adjustments WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Adjustment not found' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Adjustment already decided' });

  const now = new Date().toISOString();
  const actor = req.user?.username || 'admin';

  if (action === 'approve') {
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND status = ?').get(row.product_id, 'active');
    if (!product) return res.status(400).json({ error: 'Product is no longer active' });
    const loc = db.prepare('SELECT id FROM locations WHERE id = ?').get(row.location_id);
    if (!loc) return res.status(400).json({ error: 'Location no longer exists' });
  }

  if (action === 'approve') {
    const applied = db.transaction(() => {
      applyMovementEffect({ product_id: row.product_id, qty: row.new_qty, type: 'adjustment', srcId: null, dstId: row.location_id, now, expiryDate: row.expiry_date || null });
      db.prepare('INSERT INTO stock_movements (product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(row.product_id, row.new_qty, 'adjustment', null, row.location_id, `Adjustment #${row.id}: ${row.reason || 'approved correction'}`, now, actor);
      return db.prepare("UPDATE stock_adjustments SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'").run(now, actor, row.id);
    })();
    if (applied.changes === 0) return res.status(400).json({ error: 'Adjustment already decided' });

    audit('stock.adjustment.approved', { userId: req.user.id, username: req.user.username, adjustmentId: row.id });
    return res.json({ ok: true, message: 'Adjustment approved and applied to stock' });
  }

  db.prepare("UPDATE stock_adjustments SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ?").run(now, actor, row.id);
  audit('stock.adjustment.rejected', { userId: req.user.id, username: req.user.username, adjustmentId: row.id });
  res.json({ ok: true, message: 'Adjustment rejected (stock unchanged)' });
}

router.post('/stock-adjustments/:id/approve', authenticateToken, adminOnly, (req, res) => decideAdjustment(req, res, 'approve'));
router.post('/stock-adjustments/:id/reject', authenticateToken, adminOnly, (req, res) => decideAdjustment(req, res, 'reject'));

// GET /api/stock-transfers
router.get('/stock-transfers', authenticateToken, staffOrAdmin, (req, res) => {
  res.json(listTransfers(db, req.query.status || null));
});

// POST /api/stock-transfers
router.post('/stock-transfers', authenticateToken, staffOrAdmin, validate({
  product_id: { required: true, type: 'number', min: 1 },
  src_location: { required: true, type: 'number', min: 1 },
  dst_location: { required: true, type: 'number', min: 1 },
  qty: { required: true, type: 'number', min: 0.01 },
  reason: { maxLength: 300 },
}), (req, res) => {
  const { product_id, src_location, dst_location, qty, reason } = req.body;
  if (Number(src_location) === Number(dst_location)) return res.status(400).json({ error: 'Source and destination must differ' });
  const product = db.prepare('SELECT id FROM products WHERE id = ? AND status = ?').get(product_id, 'active');
  if (!product) return res.status(404).json({ error: 'Product not found or inactive' });
  const src = db.prepare('SELECT id FROM locations WHERE id = ?').get(src_location);
  const dst = db.prepare('SELECT id FROM locations WHERE id = ?').get(dst_location);
  if (!src || !dst) return res.status(404).json({ error: 'Location not found' });

  const info = db.prepare('INSERT INTO stock_transfers (product_id, src_location, dst_location, qty, reason, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(product_id, src_location, dst_location, qty, reason || '', 'pending');
  res.status(201).json({ ok: true, id: info.lastInsertRowid, message: 'Transfer created (pending approval)' });
});

function decideTransfer(req, res, action) {
  const row = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Transfer not found' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Transfer already decided' });

  const now = new Date().toISOString();
  const actor = req.user?.username || 'admin';

  if (action === 'approve') {
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND status = ?').get(row.product_id, 'active');
    if (!product) return res.status(400).json({ error: 'Product is no longer active' });
    const src = db.prepare('SELECT id FROM locations WHERE id = ?').get(row.src_location);
    const dst = db.prepare('SELECT id FROM locations WHERE id = ?').get(row.dst_location);
    if (!src || !dst) return res.status(400).json({ error: 'Location no longer exists' });
    const srcStock = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(row.product_id, row.src_location);
    if (!srcStock || srcStock.quantity < row.qty) return res.status(400).json({ error: 'Insufficient stock at source location' });

    const applied = db.transaction(() => {
      applyMovementEffect({ product_id: row.product_id, qty: row.qty, type: 'transfer', srcId: row.src_location, dstId: row.dst_location, now });
      db.prepare('INSERT INTO stock_movements (product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(row.product_id, row.qty, 'transfer', row.src_location, row.dst_location, `Transfer #${row.id}: ${row.reason || 'approved transfer'}`, now, actor);
      return db.prepare("UPDATE stock_transfers SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'").run(now, actor, row.id);
    })();
    if (applied.changes === 0) return res.status(400).json({ error: 'Transfer already decided' });
    return res.json({ ok: true, message: 'Transfer approved and applied to stock' });
  }

  db.prepare("UPDATE stock_transfers SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ?").run(now, actor, row.id);
  res.json({ ok: true, message: 'Transfer rejected (stock unchanged)' });
}

router.post('/stock-transfers/:id/approve', authenticateToken, adminOnly, (req, res) => decideTransfer(req, res, 'approve'));
router.post('/stock-transfers/:id/reject', authenticateToken, adminOnly, (req, res) => decideTransfer(req, res, 'reject'));

// GET /api/approvals
router.get('/approvals', authenticateToken, adminOnly, (req, res) => {
  res.json({ adjustments: listAdjustments(db, 'pending'), transfers: listTransfers(db, 'pending') });
});

module.exports = router;
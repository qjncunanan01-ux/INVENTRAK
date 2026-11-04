const express = require('express');
const router = express.Router();
const { db } = require('../../db');
const { authenticateToken } = require('../../auth-core');
const { adminOnly } = require('../../middleware');
const { validate } = require('../../validation');
const { resolveCustomer } = require('../../catalog-orders/customers');
const { applyMovementEffect } = require('../../stock-control/stock-movement-helpers');
const { audit } = require('../../audit');
const { quantityInProductUnit } = require('../../stock-control/unit-conversion');

// POST /api/sales — a counter / walk-in sale.
//
// THIS IS THE PHYSICAL-STORE PATH. It is the single most common way revenue
// enters this system, and until now it only wrote the revenue row. Verified by
// running it: selling 3 units left `stock` at 309 before and 309 after, because
// nothing here touched inventory. That split the system in half — the ANALYTICS
// were correct (ABC/FSN/EOQ/turnover/critical level all read
// `sales_transactions`, so a counter sale fed them properly) while the
// INVENTORY silently did not move. Worse, the FEFO lot ledger — the rule
// documented in ALGORITHMS.md §5 — was never consulted here, so the expiring
// batch did not leave the shelf first on the single most frequent sale type.
//
// So a sale now moves stock through exactly the same path a staff stock-out
// does (stock-movement-helpers.applyMovementEffect): FEFO lot consumption,
// the stock decrement, and the low-stock alert refresh. One code path, so the
// two cannot drift.
//
// The location is REQUIRED, not defaulted. A café has a counter and a stock
// room, and "which shelf did this leave?" is not a detail — it decides which
// lot is consumed and which alert is raised. Defaulting it would hide the
// question rather than answer it.
//
// Overselling is REFUSED (409) rather than allowed to drive stock negative.
// A negative quantity corrupts every downstream figure: the critical level
// compares against it, turnover divides by it, and the discrepancy is
// invisible in the sale log.
router.post('/', authenticateToken, adminOnly, validate({
  product_id: { required: true, type: 'number', min: 1 },
  qty: { required: true, type: 'number', min: 0.01 },
  location_id: { required: true, type: 'number', min: 1 },
}), (req, res) => {
  const { product_id, qty, qty_unit, customer_name, location_id } = req.body;
  const idempotencyKey = String(req.body.idempotency_key || '').trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return res.status(400).json({ error: 'Validation failed', details: ['idempotency_key must be 8–128 characters'] });
  }
  const fingerprint = JSON.stringify({
    product_id: Number(product_id),
    qty: Number(qty),
    qty_unit: String(qty_unit || '').trim().toLowerCase(),
    location_id: Number(location_id),
    customer_name: String(customer_name || req.user.username).trim(),
  });

  // The idempotency lookup, available-stock check, sale row, lot decrement,
  // and stored replay response share one IMMEDIATE SQLite transaction. That
  // prevents a retry or two simultaneous tills from recording the same sale
  // twice or overselling a shelf between the check and the write.
  const result = db.transaction(() => {
    const previous = db.prepare('SELECT idempotency_fingerprint, idempotency_response FROM sales_transactions WHERE idempotency_key = ?').get(idempotencyKey);
    if (previous) {
      if (previous.idempotency_fingerprint !== fingerprint) {
        return { status: 409, body: { error: 'idempotency_key was already used for a different sale' } };
      }
      let response = {};
      try { response = JSON.parse(previous.idempotency_response || '{}'); } catch {}
      return { status: 200, body: { ...response, idempotent_replay: true } };
    }

    const product = db.prepare('SELECT id, name, price, unit FROM products WHERE id = ? AND status = ?').get(product_id, 'active');
    if (!product) return { status: 404, body: { error: 'Product not found or inactive' } };
    const normalized = quantityInProductUnit({
      rows: db.prepare('SELECT from_unit, to_unit, rate FROM unit_conversions').all(),
      product,
      quantity: qty,
      enteredUnit: qty_unit,
    });
    if (!normalized.ok) return { status: 400, body: { error: normalized.error } };
    const baseQty = normalized.quantity;
    const location = db.prepare('SELECT id, name FROM locations WHERE id = ?').get(location_id);
    if (!location) return { status: 404, body: { error: 'Location not found' } };

    const total = Math.round(baseQty * product.price * 100) / 100;
    const buyerName = customer_name || req.user?.username || 'anonymous';
    const stockRow = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(product_id, location_id);
    const available = stockRow ? stockRow.quantity : 0;
    if (available < baseQty) {
      return { status: 409, body: { error: 'Insufficient stock at this location', available, requested: baseQty, location: location.name } };
    }

    let customerId = null;
    try {
      const rows = db.prepare('SELECT * FROM customers').all();
      const { customer, created, changed } = resolveCustomer(rows, { name: buyerName, now: new Date().toISOString() });
      if (customer) {
        if (created) {
          customerId = Number(db.prepare(
            `INSERT INTO customers (name, business_name, contact_number, email, address, user_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(customer.name, customer.business_name, customer.contact_number, customer.email, customer.address, customer.user_id, customer.created_at, customer.updated_at).lastInsertRowid);
        } else {
          customerId = Number(customer.id);
          if (changed) db.prepare('UPDATE customers SET updated_at = ? WHERE id = ?').run(customer.updated_at, customer.id);
        }
      }
    } catch (err) {
      console.error('[customers] resolve failed for sale:', err && err.message);
    }

    const info = db.prepare('INSERT INTO sales_transactions (product_id, qty, unit_price, total_amount, customer_name, customer_id, idempotency_key, idempotency_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(product_id, baseQty, product.price, total, buyerName, customerId, idempotencyKey, fingerprint);
    const effect = applyMovementEffect({ product_id, qty: baseQty, type: 'stock-out', srcId: location_id, now: new Date().toISOString() });
    const remaining = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(product_id, location_id);
    const response = {
      ok: true,
      total,
      quantity: baseQty,
      unit: normalized.base_unit,
      entered_quantity: normalized.entered_quantity,
      entered_unit: normalized.entered_unit,
      sale_id: Number(info.lastInsertRowid),
      location_id,
      location: location.name,
      stock_remaining: remaining ? remaining.quantity : 0,
      lots_consumed: effect.manifest,
      low_stock_alert: effect.lowStockAlert,
    };
    db.prepare('UPDATE sales_transactions SET idempotency_response = ? WHERE idempotency_key = ?').run(JSON.stringify(response), idempotencyKey);
    return {
      status: 201,
      body: response,
      audit: {
        actor: req.user.username,
        actorRole: req.user.role,
        sale_id: Number(info.lastInsertRowid),
        product_id,
        product: product.name,
        qty: baseQty,
        unit_price: product.price,
        total,
        enteredQuantity: normalized.entered_quantity,
        enteredUnit: normalized.entered_unit,
        location_id,
        location: location.name,
        customer: buyerName,
        customer_id: customerId,
      },
    };
  }).immediate();

  if (result.audit) audit('sale.recorded', result.audit);
  res.status(result.status).json(result.body);
});

// GET /api/sales
router.get('/', authenticateToken, adminOnly, (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  const countRow = db.prepare('SELECT COUNT(*) as total FROM sales_transactions').get();

  if (!req.query.page && !req.query.limit) {
    const rows = db.prepare(`SELECT s.id, s.product_id, s.qty, s.unit_price, s.total_amount,
      s.transaction_date, s.customer_name, s.customer_id, s.order_inquiry_id,
      p.name as product_name
      FROM sales_transactions s JOIN products p ON s.product_id = p.id
      ORDER BY s.transaction_date DESC`).all();
    return res.json(rows);
  }

  const rows = db.prepare(`SELECT s.id, s.product_id, s.qty, s.unit_price, s.total_amount,
    s.transaction_date, s.customer_name, s.customer_id, s.order_inquiry_id,
    p.name as product_name
    FROM sales_transactions s JOIN products p ON s.product_id = p.id
    ORDER BY s.transaction_date DESC LIMIT ? OFFSET ?`).all(limitNum, offset);
  res.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total: countRow.total, totalPages: Math.ceil(countRow.total / limitNum) } });
});

module.exports = router;

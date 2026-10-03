const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly } = require('../middleware');
const { validate } = require('../validation');
const { resolveCustomer } = require('../customers');
const { applyMovementEffect } = require('../stock-movement-helpers');
const { audit } = require('../audit');

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
  const { product_id, qty, customer_name, location_id } = req.body;
  const product = db.prepare('SELECT id, name, price FROM products WHERE id = ? AND status = ?').get(product_id, 'active');
  if (!product) return res.status(404).json({ error: 'Product not found or inactive' });

  const location = db.prepare('SELECT id, name FROM locations WHERE id = ?').get(location_id);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  // Price comes from the catalog, never the request, so a tampered client
  // cannot dictate what the sale is worth.
  const total = qty * product.price;
  const buyerName = customer_name || req.user?.username || 'anonymous';

  // Enough stock AT THIS LOCATION? Checked before anything is written.
  const stockRow = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(product_id, location_id);
  const available = stockRow ? stockRow.quantity : 0;
  if (available < qty) {
    return res.status(409).json({
      error: 'Insufficient stock at this location',
      available,
      requested: qty,
      location: location.name,
    });
  }

  // Link the sale to a Customer Record. A counter sale carries only a name, so
  // resolve-or-create on name (customers.js). Guarded: never fail a sale over
  // customer bookkeeping — the row simply lands with customer_id NULL.
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
        if (changed) {
          db.prepare('UPDATE customers SET updated_at = ? WHERE id = ?').run(customer.updated_at, customer.id);
        }
      }
    }
  } catch (err) {
    console.error('[customers] resolve failed for sale:', err && err.message);
  }

  const info = db.prepare('INSERT INTO sales_transactions (product_id, qty, unit_price, total_amount, customer_name, customer_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(product_id, qty, product.price, total, buyerName, customerId);

  // Move the stock. Same helper a staff stock-out uses, so FEFO, the
  // decrement and the alert refresh cannot diverge between the two paths.
  applyMovementEffect({
    product_id,
    qty,
    type: 'stock-out',
    srcId: location_id,
    now: new Date().toISOString(),
  });

  const remaining = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(product_id, location_id);

  // A sale is the one write where money changes hands, so it is audited on both
  // backends — the same reasoning as bulk-prices and bulk-costs.
  audit('sale.recorded', {
    actor: req.user.username,
    actorRole: req.user.role,
    sale_id: Number(info.lastInsertRowid),
    product_id,
    product: product.name,
    qty,
    unit_price: product.price,
    total,
    location_id,
    location: location.name,
    customer: buyerName,
    customer_id: customerId,
  });

  res.status(201).json({
    ok: true,
    total,
    sale_id: Number(info.lastInsertRowid),
    location_id,
    location: location.name,
    stock_remaining: remaining ? remaining.quantity : 0,
  });
});

// GET /api/sales
router.get('/', authenticateToken, adminOnly, (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  const countRow = db.prepare('SELECT COUNT(*) as total FROM sales_transactions').get();

  if (!req.query.page && !req.query.limit) {
    const rows = db.prepare('SELECT s.*, p.name as product_name FROM sales_transactions s JOIN products p ON s.product_id = p.id ORDER BY s.transaction_date DESC').all();
    return res.json(rows);
  }

  const rows = db.prepare('SELECT s.*, p.name as product_name FROM sales_transactions s JOIN products p ON s.product_id = p.id ORDER BY s.transaction_date DESC LIMIT ? OFFSET ?').all(limitNum, offset);
  res.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total: countRow.total, totalPages: Math.ceil(countRow.total / limitNum) } });
});

module.exports = router;
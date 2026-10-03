const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly } = require('../middleware');
const { validate } = require('../validation');
const { resolveCustomer } = require('../customers');

// POST /api/sales
router.post('/', authenticateToken, adminOnly, validate({
  product_id: { required: true, type: 'number', min: 1 },
  qty: { required: true, type: 'number', min: 0.01 },
}), (req, res) => {
  const { product_id, qty, customer_name } = req.body;
  const product = db.prepare('SELECT id, price FROM products WHERE id = ? AND status = ?').get(product_id, 'active');
  if (!product) return res.status(404).json({ error: 'Product not found or inactive' });

  const total = qty * product.price;
  const buyerName = customer_name || req.user?.username || 'anonymous';

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

  db.prepare('INSERT INTO sales_transactions (product_id, qty, unit_price, total_amount, customer_name, customer_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(product_id, qty, product.price, total, buyerName, customerId);

  res.status(201).json({ ok: true, total });
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
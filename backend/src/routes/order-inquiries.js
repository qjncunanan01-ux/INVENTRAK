const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly } = require('../middleware');
const { validate } = require('../validation');
const { sanitizeObject } = require('../sanitize');
const { normalizeLines } = require('../product-lines');
const { computeCostingSnapshot, snapshotRow, toPublic } = require('../costing');
const { resolveCustomer } = require('../customers');
const { buildPaymentStep } = require('../payments');
const { notifyInquiryStatus } = require('../notify');
const { enrichInquiryRows } = require('../inquiry-helpers');
const { ADMIN_TIER } = require('../roles');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../auth-core');

// GET /api/order-inquiries
router.get('/', authenticateToken, (req, res) => {
  const { page = 1, limit = 50, status } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  let where = 'WHERE 1=1';
  const params = [];

  if (status) { where += ' AND status = ?'; params.push(status); }

  if (!ADMIN_TIER.includes(req.user.role)) {
    const owner = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
    where += ' AND (user_id = ? OR customer_email = ? COLLATE NOCASE)';
    params.push(req.user.id, (owner && owner.email) || '');
  }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM order_inquiries ${where}`).get(...params);
  const rows = db.prepare(`SELECT * FROM order_inquiries ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limitNum, offset);

  if (!req.query.page && !req.query.limit) return res.json(enrichInquiryRows(rows));

  res.json({ data: enrichInquiryRows(rows), pagination: { page: pageNum, limit: limitNum, total: countRow.total, totalPages: Math.ceil(countRow.total / limitNum) } });
});

// PUT /api/order-inquiries/:id
router.put('/:id', authenticateToken, adminOnly, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'approved', 'rejected', 'fulfilled', 'delivered'];
  if (status && !validStatuses.includes(status)) return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });

  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });

  const updatedStatus = status || existing.status;
  let history = [];
  try { const parsed = JSON.parse(existing.status_history || '[]'); if (Array.isArray(parsed)) history = parsed; } catch { }
  if (history.length === 0) history.push({ status: existing.status, at: existing.created_at });
  if (updatedStatus !== (history[history.length - 1] || {}).status) history.push({ status: updatedStatus, at: new Date().toISOString() });

  db.prepare('UPDATE order_inquiries SET status = ?, status_history = ? WHERE id = ?').run(updatedStatus, JSON.stringify(history), req.params.id);

  if (updatedStatus !== 'pending') notifyInquiryStatus(existing, updatedStatus);

  res.json({ ok: true, message: `Inquiry ${updatedStatus}` });
});

// POST /api/order-inquiries
router.post('/', validate({
  customer_name: { required: true, maxLength: 100 },
  customer_email: { required: true, maxLength: 100 },
}), async (req, res) => {
  const { customer_name, customer_email, customer_phone, products, estimated_cost, notes, delivery_address, payment_method } = req.body;

  const cleanName = sanitizeObject(customer_name);
  const cleanEmail = sanitizeObject(customer_email);
  const cleanAddress = delivery_address ? sanitizeObject(delivery_address) : delivery_address;
  const cleanNotes = notes ? sanitizeObject(notes) : notes;

  if (Array.isArray(products)) {
    for (const item of products) {
      const qty = Number(item.quantity || item.qty);
      if (qty < 0) return res.status(400).json({ error: 'Validation failed', details: ['quantity must not be negative'] });
      if (qty > 10000) return res.status(400).json({ error: 'Validation failed', details: ['quantity must not exceed 10000'] });
    }
  }

  const validPayments = ['cod', 'gcash', 'card', 'other'];
  if (delivery_address !== undefined && String(delivery_address).length > 500) {
    return res.status(400).json({ error: 'Validation failed', details: ['delivery_address must be at most 500 characters'] });
  }
  if (payment_method !== undefined && !validPayments.includes(payment_method)) {
    return res.status(400).json({ error: 'Validation failed', details: ['payment_method must be one of cod, gcash, card, other'] });
  }

  const now = new Date().toISOString();

  let userId = null;
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    try { const decoded = jwt.verify(token, JWT_SECRET); if (decoded && decoded.id) userId = decoded.id; } catch { }
  }

  const { lines, total } = normalizeLines(products);
  const storedCost = total !== null ? total : (estimated_cost || 0);

  // Resolve the Customer Record this order belongs to BEFORE the insert, so the
  // inquiry can carry its customer_id. Resolve-or-create: one row per real
  // person, enriched with anything this order supplies that the first one did
  // not. Guests get a customer row too — a customer does not need an account.
  // Guarded: an order must never fail because customer bookkeeping did.
  let customerId = null;
  try {
    const existingCustomers = db.prepare('SELECT * FROM customers').all();
    const { customer, created, changed } = resolveCustomer(existingCustomers, {
      name: cleanName,
      email: cleanEmail,
      contact_number: customer_phone,
      address: cleanAddress,
      user_id: userId,
      now,
    });
    if (customer) {
      if (created) {
        const info = db.prepare(
          `INSERT INTO customers (name, business_name, contact_number, email, address, user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          customer.name, customer.business_name, customer.contact_number,
          customer.email, customer.address, customer.user_id,
          customer.created_at, customer.updated_at,
        );
        customerId = Number(info.lastInsertRowid);
      } else if (changed) {
        db.prepare(
          `UPDATE customers SET business_name = ?, contact_number = ?, email = ?,
             address = ?, user_id = ?, updated_at = ? WHERE id = ?`,
        ).run(
          customer.business_name, customer.contact_number, customer.email,
          customer.address, customer.user_id, customer.updated_at, customer.id,
        );
        customerId = Number(customer.id);
      } else {
        customerId = Number(customer.id);
      }
    }
  } catch (err) {
    console.error('[customers] resolve failed for inquiry:', err && err.message);
    customerId = null;
  }

  const inquiryId = db.prepare('INSERT INTO order_inquiries (customer_name, customer_email, customer_phone, products, estimated_cost, notes, delivery_address, payment_method, user_id, customer_id, status_history, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(cleanName, cleanEmail, customer_phone || null, JSON.stringify(lines), storedCost, cleanNotes || '', cleanAddress || null, payment_method || 'cod', userId, customerId, JSON.stringify([{ status: 'pending', at: now }]), 'pending', now).lastInsertRowid;

  // Freeze the economics NOW, while the catalog still reflects what the
  // customer was quoted. Without this, repricing a product silently rewrites
  // the profit of every past order. Never fatal: costing must not be able to
  // reject an order, so a failure is logged and the inquiry stands.
  try {
    const catalog = db.prepare('SELECT id, name, cost FROM products').all();
    const snapshot = computeCostingSnapshot({ lines, products: catalog, revenue: storedCost });
    const row = snapshotRow(inquiryId, snapshot, now);
    db.prepare(
      `INSERT INTO costing_records (inquiry_id, total_cost, total_revenue, target_quantity,
        cost_per_cup, suggested_selling_price, estimated_profit, cost_basis,
        lines_priced, lines_total, margin_percent, computed_at)
       VALUES (@inquiry_id, @total_cost, @total_revenue, @target_quantity,
        @cost_per_cup, @suggested_selling_price, @estimated_profit, @cost_basis,
        @lines_priced, @lines_total, @margin_percent, @computed_at)`,
    ).run(row);
  } catch (err) {
    console.error('[costing] snapshot failed for inquiry', inquiryId, err && err.message);
  }

  let payment = null;
  try { payment = await buildPaymentStep({ id: inquiryId, amount: storedCost, description: `INVENTRAK order ${inquiryId} — ${customer_name}`, email: customer_email, paymentMethod: payment_method || 'cod' }); } catch (err) { console.error('[payments] buildPaymentStep failed:', err && err.message); }
  if (payment) {
    db.prepare('UPDATE order_inquiries SET payment_method = ?, payment_status = ?, payment_reference = ?, payment_url = ?, payment_qr = ?, payment_provider = ? WHERE id = ?')
      .run(payment.payment_method, payment.payment_status, payment.payment_reference, payment.payment_url, payment.payment_qr, payment.payment_provider, inquiryId);
  }

  res.status(201).json({
    ok: true, message: 'Inquiry submitted', id: inquiryId,
    ...(payment ? { payment: { payment_method: payment.payment_method, payment_status: payment.payment_status, payment_reference: payment.payment_reference, payment_url: payment.payment_url, payment_qr: payment.payment_qr } } : {}),
  });
});

// GET /api/order-inquiries/:id/costing
// The immutable snapshot taken when the inquiry was submitted. Scoped exactly
// like the inquiry itself: admins see any, a customer sees only their own.
router.get('/:id/costing', authenticateToken, (req, res) => {
  const existing = db.prepare('SELECT id, user_id, customer_email FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });
  if (!ADMIN_TIER.includes(req.user.role)) {
    const owner = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
    const mine = Number(existing.user_id) === Number(req.user.id) || (owner && String(existing.customer_email || '').toLowerCase() === String(owner.email || '').toLowerCase());
    if (!mine) return res.status(403).json({ error: 'Not your inquiry' });
  }
  const row = db.prepare('SELECT * FROM costing_records WHERE inquiry_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No costing record for this inquiry' });
  res.json(toPublic(row));
});

// PUT /api/order-inquiries/:id/payment
router.put('/:id/payment', authenticateToken, (req, res) => {
  const { payment_status } = req.body;
  if (!['paid', 'unpaid', 'failed'].includes(payment_status)) return res.status(400).json({ error: 'payment_status must be one of paid, unpaid, failed' });
  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });
  if (!ADMIN_TIER.includes(req.user.role)) {
    const owner = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
    const mine = Number(existing.user_id) === Number(req.user.id) || (owner && String(existing.customer_email || '').toLowerCase() === String(owner.email || '').toLowerCase());
    if (!mine) return res.status(403).json({ error: 'Not your inquiry' });
  }
  db.prepare('UPDATE order_inquiries SET payment_status = ? WHERE id = ?').run(payment_status, req.params.id);
  res.json({ ok: true, payment_status });
});

module.exports = router;
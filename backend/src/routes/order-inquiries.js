const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly } = require('../middleware');
const { validate } = require('../validation');
const { sanitizeObject } = require('../sanitize');
const { normalizeLines } = require('../product-lines');
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

  const inquiryId = db.prepare('INSERT INTO order_inquiries (customer_name, customer_email, customer_phone, products, estimated_cost, notes, delivery_address, payment_method, user_id, status_history, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(cleanName, cleanEmail, customer_phone || null, JSON.stringify(lines), storedCost, cleanNotes || '', cleanAddress || null, payment_method || 'cod', userId, JSON.stringify([{ status: 'pending', at: now }]), 'pending', now).lastInsertRowid;

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
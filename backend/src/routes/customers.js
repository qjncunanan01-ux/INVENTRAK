const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly } = require('../middleware');
const { sanitizeObject } = require('../sanitize');
const { summarize } = require('../customers');

// GET /api/customers — the customer list with per-customer aggregates.
//
// Admin-only: it exposes what one person ordered and what they spent, which is
// nobody else's business. The mobile app never calls this.
router.get('/', authenticateToken, adminOnly, (req, res) => {
  const customers = db.prepare('SELECT * FROM customers ORDER BY name COLLATE NOCASE ASC').all();
  const inquiries = db.prepare('SELECT customer_id, created_at FROM order_inquiries WHERE customer_id IS NOT NULL').all();
  const sales = db.prepare('SELECT customer_id, total_amount, transaction_date FROM sales_transactions WHERE customer_id IS NOT NULL').all();
  res.json(summarize(customers, { inquiries, sales }));
});

// GET /api/customers/:id — one customer's record with their order and purchase
// history. This is the query the old schema could not answer: customer_name was
// free text repeated on every row, so one person's history was unretrievable.
router.get('/:id', authenticateToken, adminOnly, (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const inquiries = db.prepare(
    'SELECT id, status, estimated_cost, created_at, status_history FROM order_inquiries WHERE customer_id = ? ORDER BY created_at DESC',
  ).all(customer.id);
  const sales = db.prepare(
    'SELECT s.id, s.product_id, p.name as product_name, s.qty, s.total_amount, s.transaction_date FROM sales_transactions s LEFT JOIN products p ON s.product_id = p.id WHERE s.customer_id = ? ORDER BY s.transaction_date DESC',
  ).all(customer.id);

  const [withAgg] = summarize([customer], { inquiries, sales });
  res.json({ ...withAgg, inquiries, sales });
});

// PUT /api/customers/:id — admin edits the record (business name, contact,
// address). The identity fields (name, email) are editable too, but a duplicate
// email would violate the unique index, so that surfaces as a 409.
router.put('/:id', authenticateToken, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Customer not found' });

  const { name, business_name, contact_number, email, address } = req.body || {};
  if (email !== undefined && email !== null && email !== '') {
    const clash = db.prepare("SELECT id FROM customers WHERE lower(email) = lower(?) AND id != ?").get(String(email).trim(), req.params.id);
    if (clash) return res.status(409).json({ error: 'Another customer already uses this email' });
  }

  db.prepare(
    `UPDATE customers SET name = ?, business_name = ?, contact_number = ?, email = ?, address = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(
    name != null ? sanitizeObject(name) : existing.name,
    business_name != null ? sanitizeObject(business_name) : existing.business_name,
    contact_number != null ? sanitizeObject(contact_number) : existing.contact_number,
    email === undefined ? existing.email : (email === '' ? null : sanitizeObject(email)),
    address != null ? sanitizeObject(address) : existing.address,
    req.params.id,
  );
  res.json({ ok: true });
});

module.exports = router;
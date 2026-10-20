const express = require('express');
const router = express.Router();
const { db } = require('../../db');
const { authenticateToken } = require('../../auth-core');
const { adminOnly } = require('../../middleware');
const { validate } = require('../../validation');
const { sanitizeObject } = require('../../sanitize');
const { normalizeLines } = require('../../catalog-orders/product-lines');
const { computeCostingSnapshot, snapshotRow, toPublic } = require('../../insights/costing');
const { resolveCustomer } = require('../../catalog-orders/customers');
const { buildPaymentStep } = require('../../payments');
const { notifyInquiryStatus } = require('../../notify');
const { enrichInquiryRows } = require('../../catalog-orders/inquiry-helpers');
const { ADMIN_TIER } = require('../../roles');
const {
  normalizeFulfillment,
  normalizeReason,
  appendStatusEvent,
  checkStatusChange,
  checkCancellation,
} = require('../../catalog-orders/inquiry-lifecycle');
const { audit } = require('../../audit');
const { applyMovementEffect } = require('../../stock-control/stock-movement-helpers');
const { planOrderFulfillment } = require('../../catalog-orders/order-fulfillment');
const { ORDER_TERMS_VERSION } = require('../../catalog-orders/order-terms');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../../auth-core');

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
//
// Admin-only status moves. The RULES (which statuses are assignable, which
// transitions are legal, when a reason is mandatory) live in
// catalog-orders/inquiry-lifecycle so the npm-free backend cannot drift from
// this one. Cancellation is NOT reachable here on purpose: it has its own
// endpoint below, which records the actor, the timestamp and the reason.
router.put('/:id', authenticateToken, adminOnly, (req, res) => {
  const { status, rejection_reason } = req.body;
  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });

  const updatedStatus = status || existing.status;
  const refusal = checkStatusChange({ from: existing.status, to: updatedStatus });
  if (refusal) return res.status(refusal.status).json({ error: refusal.error });

  let fulfillmentLocation = null;
  let fulfillmentPlan = null;
  const mustCommitStock = ['fulfilled', 'delivered'].includes(updatedStatus) && !existing.inventory_committed_at;
  if (mustCommitStock) {
    if (['gcash', 'card'].includes(existing.payment_method) && existing.payment_status !== 'paid') {
      return res.status(409).json({ error: 'Payment must be verified before this inquiry can be fulfilled' });
    }
    const locationId = Number(req.body.location_id);
    fulfillmentLocation = db.prepare('SELECT id, name FROM locations WHERE id = ?').get(locationId);
    if (!fulfillmentLocation) return res.status(400).json({ error: 'Choose a valid stock location before fulfilling this order' });
    let lines = [];
    try { lines = JSON.parse(existing.products || '[]'); } catch {}
    fulfillmentPlan = planOrderFulfillment(lines, locationId, {
      findProduct: (line) => {
        const byId = Number(line.id);
        if (Number.isInteger(byId) && byId > 0) {
          return db.prepare('SELECT id, name, price FROM products WHERE id = ? AND status = ?').get(byId, 'active');
        }
        const name = String(line.name || '').trim();
        if (!name) return null;
        return db.prepare('SELECT id, name, price FROM products WHERE TRIM(LOWER(name)) = LOWER(?) AND status = ? ORDER BY id LIMIT 1').get(name, 'active');
      },
      getAvailable: (productId, locationId) => {
        const row = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(productId, locationId);
        return row ? row.quantity : 0;
      },
    });
    if (fulfillmentPlan.error) {
      return res.status(fulfillmentPlan.product_id ? 409 : 400).json({
        error: fulfillmentPlan.error,
        ...(fulfillmentPlan.product_id ? { available: fulfillmentPlan.available, requested: fulfillmentPlan.requested, product_id: fulfillmentPlan.product_id } : {}),
      });
    }
  }

  // Part 9 of the panel revisions: a rejection the customer cannot understand
  // is not a rejection. The reason is required and is stored on the inquiry as
  // well as in the timeline, so it survives even if the timeline is trimmed.
  let rejectionReason = existing.rejection_reason || null;
  if (updatedStatus === 'rejected') {
    const reason = normalizeReason(rejection_reason ?? req.body.reason, {
      required: true,
      field: 'rejection_reason',
    });
    if (reason.error) return res.status(400).json({ error: 'Validation failed', details: [reason.error] });
    rejectionReason = reason.value;
  }

  const now = new Date().toISOString();
  const { history } = appendStatusEvent(existing.status_history, {
    status: updatedStatus,
    at: now,
    by: req.user.id,
    reason: updatedStatus === 'rejected' ? rejectionReason : null,
    created_at: existing.created_at,
    current_status: existing.status,
  });

  const saveStatus = db.transaction(() => {
    if (mustCommitStock) {
      const now = new Date().toISOString();
      for (const line of fulfillmentPlan.plan) {
        db.prepare('INSERT INTO sales_transactions (product_id, qty, unit_price, total_amount, transaction_date, customer_name, customer_id, order_inquiry_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(line.product_id, line.qty, line.unit_price, line.qty * line.unit_price, now, existing.customer_name || 'customer', existing.customer_id || null, Number(req.params.id));
        db.prepare('INSERT INTO stock_movements (product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(line.product_id, line.qty, 'stock-out', fulfillmentLocation.id, null, `Customer order inquiry #${req.params.id} fulfilled`, now, req.user.username || 'admin');
        applyMovementEffect({ product_id: line.product_id, qty: line.qty, type: 'stock-out', srcId: fulfillmentLocation.id, now });
      }
      db.prepare('UPDATE order_inquiries SET fulfillment_location_id = ?, inventory_committed_at = ? WHERE id = ?')
        .run(fulfillmentLocation.id, now, req.params.id);
    }
    db.prepare('UPDATE order_inquiries SET status = ?, status_history = ?, rejection_reason = ? WHERE id = ?')
      .run(updatedStatus, JSON.stringify(history), rejectionReason, req.params.id);
  });
  try {
    saveStatus();
  } catch (err) {
    console.error('[orders] fulfillment stock update failed:', err && err.message);
    return res.status(500).json({ error: 'Could not complete the order and update stock' });
  }

  if (updatedStatus !== existing.status) {
    audit('inquiry.status_changed', {
      userId: req.user.id,
      inquiryId: Number(req.params.id),
      from: existing.status,
      to: updatedStatus,
    });
  }
  if (updatedStatus !== 'pending') notifyInquiryStatus(existing, updatedStatus);

  res.json({ ok: true, message: `Inquiry ${updatedStatus}` });
});

// POST /api/order-inquiries/:id/cancel
//
// Customer-initiated cancellation (Part 10). Rules enforced here, not in the
// apps:
//   · authenticate AND authorize — a customer may only cancel their OWN
//     inquiry (404 unknown, 403 someone else's, exactly like the costing
//     endpoint); admin tier may cancel on the customer's behalf.
//   · only pending / approved inquiries are cancellable. A fulfilled or
//     delivered order is a business problem, not a button, and an already
//     decided one keeps its decision.
//   · the cancellation records who, when and (optionally) why.
//   · repeating the request is idempotent — the original timestamp and reason
//     are returned, nothing is rewritten.
// No stock is touched: an inquiry has never deducted inventory (see the stock
// movement workflow), so there is no reservation to release here.
router.post('/:id/cancel', authenticateToken, (req, res) => {
  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });

  if (!ADMIN_TIER.includes(req.user.role)) {
    const owner = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
    const mine =
      Number(existing.user_id) === Number(req.user.id) ||
      (owner && String(existing.customer_email || '').toLowerCase() === String(owner.email || '').toLowerCase());
    if (!mine) return res.status(403).json({ error: 'Not your inquiry' });
  }

  const verdict = checkCancellation({ from: existing.status });
  if (verdict && verdict.alreadyCancelled) {
    return res.json({
      ok: true,
      message: 'Inquiry cancelled',
      cancelled_at: existing.cancelled_at,
      cancellation_reason: existing.cancellation_reason || null,
    });
  }
  if (verdict) return res.status(verdict.status).json({ error: verdict.error });

  const reason = normalizeReason(req.body.cancellation_reason ?? req.body.reason, {
    field: 'cancellation_reason',
  });
  if (reason.error) return res.status(400).json({ error: 'Validation failed', details: [reason.error] });

  const now = new Date().toISOString();
  const { history } = appendStatusEvent(existing.status_history, {
    status: 'cancelled',
    at: now,
    by: req.user.id,
    reason: reason.value,
    created_at: existing.created_at,
    current_status: existing.status,
  });

  db.prepare(
    'UPDATE order_inquiries SET status = ?, status_history = ?, cancelled_at = ?, cancellation_reason = ? WHERE id = ?',
  ).run('cancelled', JSON.stringify(history), now, reason.value, req.params.id);

  audit('inquiry.cancelled', {
    userId: req.user.id,
    inquiryId: Number(req.params.id),
    from: existing.status,
    reason: reason.value,
  });
  notifyInquiryStatus(existing, 'cancelled');

  res.json({ ok: true, message: 'Inquiry cancelled', cancelled_at: now, cancellation_reason: reason.value });
});

// POST /api/order-inquiries
router.post('/', validate({
  customer_name: { required: true, maxLength: 100 },
  customer_email: { required: true, maxLength: 100 },
}), async (req, res) => {
  const { customer_name, customer_email, customer_phone, products, estimated_cost, notes, delivery_address, payment_method, fulfillment_method } = req.body;

  const cleanName = sanitizeObject(customer_name);
  const cleanEmail = sanitizeObject(customer_email);
  const cleanAddress = delivery_address ? sanitizeObject(delivery_address) : delivery_address;
  const cleanNotes = notes ? sanitizeObject(notes) : notes;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(cleanEmail || '').trim())) {
    return res.status(400).json({ error: 'Validation failed', details: ['customer_email must be a valid email address'] });
  }
  if (customer_phone != null && String(customer_phone).trim() && !/^\+?[0-9()\-\s]{7,20}$/.test(String(customer_phone).trim())) {
    return res.status(400).json({ error: 'Validation failed', details: ['customer_phone must be a valid phone number (7–20 characters)'] });
  }
  if (notes != null && String(notes).length > 1000) {
    return res.status(400).json({ error: 'Validation failed', details: ['notes must be at most 1000 characters'] });
  }
  if (req.body.terms_accepted !== true) {
    return res.status(400).json({ error: 'Validation failed', details: ['You must accept the ordering terms before submitting'] });
  }
  if (req.body.terms_version !== ORDER_TERMS_VERSION) {
    return res.status(400).json({ error: 'Validation failed', details: ['terms_version is missing or out of date; review the current ordering terms'] });
  }

  if (Array.isArray(products)) {
    for (const item of products) {
      if (typeof item === 'string') continue; // Legacy line format, normalized below.
      const qty = Number(item && (item.quantity ?? item.qty));
      if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ error: 'Validation failed', details: ['quantity must be a positive whole number'] });
      if (qty > 10000) return res.status(400).json({ error: 'Validation failed', details: ['quantity must not exceed 10000'] });
    }
  }
  if (Array.isArray(products) && products.length > 500) {
    return res.status(400).json({ error: 'Validation failed', details: ['an order may not contain more than 500 product lines'] });
  }

  const validPayments = ['cod', 'gcash', 'card', 'other'];
  if (delivery_address !== undefined && String(delivery_address).length > 500) {
    return res.status(400).json({ error: 'Validation failed', details: ['delivery_address must be at most 500 characters'] });
  }
  if (payment_method !== undefined && !validPayments.includes(payment_method)) {
    return res.status(400).json({ error: 'Validation failed', details: ['payment_method must be one of cod, gcash, card, other'] });
  }

  // Fulfilment preference (Part 11). 'courier' without an address is incomplete,
  // so it is refused here rather than surfacing as an undeliverable order.
  const fulfillment = normalizeFulfillment({ fulfillment_method, delivery_address });
  if (fulfillment.error) {
    return res.status(400).json({ error: 'Validation failed', details: [fulfillment.error] });
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

  // The customer app includes catalog IDs so stock can be checked against the
  // live ledger. Legacy line-only clients remain readable during rollout; all
  // current app orders are checked here and again at fulfillment.
  const requestedByProduct = new Map();
  for (const line of lines) {
    if (line.id == null) continue;
    if (!Number.isInteger(line.id) || line.id < 1) {
      return res.status(400).json({ error: 'Validation failed', details: ['product id must be a positive integer'] });
    }
    requestedByProduct.set(line.id, (requestedByProduct.get(line.id) || 0) + line.qty);
    if (requestedByProduct.get(line.id) > 10000) {
      return res.status(400).json({ error: 'Validation failed', details: ['quantity per product must not exceed 10000 per inquiry'] });
    }
  }
  for (const [productId, requested] of requestedByProduct) {
    const product = db.prepare('SELECT id, name FROM products WHERE id = ? AND status = ?').get(productId, 'active');
    if (!product) return res.status(409).json({ error: `Product ${productId} is unavailable` });
    const row = db.prepare('SELECT COALESCE(SUM(quantity), 0) AS available FROM stock WHERE product_id = ?').get(productId);
    const available = Number(row && row.available) || 0;
    if (available < requested) {
      return res.status(409).json({
        error: `Not enough stock for ${product.name}`,
        product_id: productId,
        available,
        requested,
      });
    }
  }

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

  const acceptedTermsVersion = req.body.terms_accepted === true ? ORDER_TERMS_VERSION : null;
  const inquiryId = db.prepare('INSERT INTO order_inquiries (customer_name, customer_email, customer_phone, products, estimated_cost, notes, delivery_address, fulfillment_method, payment_method, user_id, customer_id, status_history, status, terms_version, terms_accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(cleanName, cleanEmail, customer_phone || null, JSON.stringify(lines), storedCost, cleanNotes || '', cleanAddress || null, fulfillment.method, payment_method || 'cod', userId, customerId, JSON.stringify([{ status: 'pending', at: now }]), 'pending', acceptedTermsVersion, acceptedTermsVersion ? now : null, now).lastInsertRowid;

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
    db.prepare('UPDATE order_inquiries SET payment_method = ?, payment_status = ?, payment_reference = ?, payment_url = ?, payment_qr = ?, payment_provider = ?, payment_updated_at = ? WHERE id = ?')
      .run(payment.payment_method, payment.payment_status, payment.payment_reference, payment.payment_url, payment.payment_qr, payment.payment_provider, now, inquiryId);
  }

  const createdInquiry = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(inquiryId);
  void notifyInquiryStatus(createdInquiry, 'pending');

  res.status(201).json({
    ok: true, message: 'Inquiry submitted', id: inquiryId,
    ...(payment ? { payment: { payment_method: payment.payment_method, payment_status: payment.payment_status, payment_reference: payment.payment_reference, payment_url: payment.payment_url, payment_qr: payment.payment_qr, payment_provider: payment.payment_provider } } : {}),
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
  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });
  const isAdmin = ADMIN_TIER.includes(req.user.role);
  if (isAdmin) {
    const { payment_status } = req.body;
    if (!['paid', 'unpaid', 'failed'].includes(payment_status)) return res.status(400).json({ error: 'payment_status must be one of paid, unpaid, failed' });
    const now = new Date().toISOString();
    db.prepare('UPDATE order_inquiries SET payment_status = ?, payment_updated_at = ? WHERE id = ?').run(payment_status, now, req.params.id);
    audit('inquiry.payment_verified', { userId: req.user.id, inquiryId: Number(req.params.id), payment_status });
    return res.json({ ok: true, payment_status, payment_updated_at: now });
  }

  {
    const owner = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
    const mine = Number(existing.user_id) === Number(req.user.id) || (owner && String(existing.customer_email || '').toLowerCase() === String(owner.email || '').toLowerCase());
    if (!mine) return res.status(403).json({ error: 'Not your inquiry' });
  }

  const now = new Date().toISOString();
  if (existing.payment_method === 'card' && existing.payment_provider === 'demo' && req.body.demo_card_confirmed === true) {
    if (existing.payment_status === 'paid') return res.json({ ok: true, payment_status: 'paid', payment_reference: existing.payment_reference, payment_updated_at: existing.payment_updated_at });
    db.prepare('UPDATE order_inquiries SET payment_status = ?, payment_customer_reference = ?, payment_updated_at = ? WHERE id = ?')
      .run('paid', existing.payment_reference, now, req.params.id);
    audit('inquiry.payment_demo_completed', { userId: req.user.id, inquiryId: Number(req.params.id), payment_reference: existing.payment_reference });
    return res.json({ ok: true, payment_status: 'paid', payment_reference: existing.payment_reference, payment_updated_at: now });
  }

  const customerReference = String(req.body.customer_reference || '').trim();
  if (existing.payment_method !== 'gcash') {
    return res.status(400).json({ error: 'Only GCash receipt references can be submitted for verification' });
  }
  if (customerReference.length < 5 || customerReference.length > 100 || !/^[A-Za-z0-9\- ]+$/.test(customerReference)) {
    return res.status(400).json({ error: 'Enter a valid GCash receipt reference (5–100 letters, numbers, spaces, or dashes)' });
  }
  if (!['unpaid', 'pending_verification'].includes(existing.payment_status)) {
    return res.status(409).json({ error: `This payment is already ${existing.payment_status}` });
  }
  db.prepare('UPDATE order_inquiries SET payment_status = ?, payment_customer_reference = ?, payment_updated_at = ? WHERE id = ?')
    .run('pending_verification', sanitizeObject(customerReference), now, req.params.id);
  audit('inquiry.payment_submitted', { userId: req.user.id, inquiryId: Number(req.params.id) });
  return res.json({ ok: true, payment_status: 'pending_verification', payment_updated_at: now });
});

module.exports = router;

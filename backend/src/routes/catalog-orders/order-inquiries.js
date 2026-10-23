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
const { applyMovementEffect, restoreStockReservation } = require('../../stock-control/stock-movement-helpers');
const { planOrderFulfillment } = require('../../catalog-orders/order-fulfillment');
const { currentOrderTerms } = require('../../catalog-orders/order-terms');
const {
  SYLVER_POLICY_DEMO,
  PAYMENT_METHODS,
  applyBulkDiscount,
  planStockReservation,
  availableOrderTerms,
} = require('../../catalog-orders/company-policy');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { JWT_SECRET } = require('../../auth-core');

function parseArray(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function withoutPrivateProofs(row) {
  if (!row) return row;
  const result = { ...row };
  result.payment_records = JSON.stringify(parseArray(row.payment_records).map(({ proof_data, ...record }) => record));
  result.return_requests = JSON.stringify(parseArray(row.return_requests).map(({ proof_data, ...request }) => request));
  return result;
}

function validProofDataUrl(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length > 900000) return false;
  let bytes;
  try { bytes = Buffer.from(match[2], 'base64'); } catch { return false; }
  if (!bytes.length || bytes.length > 650000) return false;
  if (match[1] === 'png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (match[1] === 'jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

function ownedBy(req, existing) {
  if (ADMIN_TIER.includes(req.user.role)) return true;
  const owner = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
  return Number(existing.user_id) === Number(req.user.id) ||
    (owner && String(existing.customer_email || '').toLowerCase() === String(owner.email || '').toLowerCase());
}

function totalDue(order) {
  return Math.round((Number(order.estimated_cost || 0) + Number(order.delivery_fee || 0)) * 100) / 100;
}

function reserveCompanyStock(existing, now) {
  const lines = parseArray(existing.products);
  const ids = [...new Set(lines.map((line) => Number(line.id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length !== lines.length) return { error: 'Refresh the catalog before confirming this order; every line must reference a current product' };
  const rows = db.prepare(`SELECT product_id, location_id, quantity FROM stock WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY location_id`).all(...ids);
  const plan = planStockReservation(lines, rows);
  if (plan.error) return plan;
  return { allocations: plan.allocations.map((allocation) => {
    const effect = applyMovementEffect({
      product_id: allocation.product_id,
      qty: allocation.qty,
      type: 'stock-out',
      srcId: allocation.location_id,
      now,
    });
    db.prepare('INSERT INTO stock_movements (product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(allocation.product_id, allocation.qty, 'stock-out', allocation.location_id, null, `Reserved for customer order inquiry #${existing.id}`, now, 'order-reservation');
    return { ...allocation, lot_manifest: effect.manifest };
  }) };
}

function releaseCompanyStock(existing, now) {
  for (const allocation of parseArray(existing.reservation_details)) {
    restoreStockReservation({
      product_id: Number(allocation.product_id),
      qty: Number(allocation.qty),
      locationId: Number(allocation.location_id),
      manifest: allocation.lot_manifest,
      now,
    });
    db.prepare('INSERT INTO stock_movements (product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(allocation.product_id, allocation.qty, 'stock-in', null, allocation.location_id, `Released reservation for customer order inquiry #${existing.id}`, now, 'order-reservation');
  }
}

// GET /api/order-inquiries
router.get('/policy', authenticateToken, (req, res) => {
  const terms = currentOrderTerms();
  const account = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
  const existingCustomer = db.prepare('SELECT id FROM customers WHERE user_id = ?').get(req.user.id) ||
    (account && db.prepare('SELECT id FROM customers WHERE user_id IS NULL AND lower(email) = lower(?)').get(account.email));
  res.json({
    demo_company_rules: SYLVER_POLICY_DEMO,
    credit_eligible: Boolean(SYLVER_POLICY_DEMO && existingCustomer),
    terms_version: terms.version,
    terms: terms.terms,
    ...(SYLVER_POLICY_DEMO ? availableOrderTerms() : {}),
  });
});

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

  const safeRows = rows.map(withoutPrivateProofs);
  if (!req.query.page && !req.query.limit) return res.json(enrichInquiryRows(safeRows));

  res.json({ data: enrichInquiryRows(safeRows), pagination: { page: pageNum, limit: limitNum, total: countRow.total, totalPages: Math.ceil(countRow.total / limitNum) } });
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
  const refusal = checkStatusChange({ from: existing.status, to: updatedStatus, companyDemo: SYLVER_POLICY_DEMO });
  if (refusal) return res.status(refusal.status).json({ error: refusal.error });

  let fulfillmentLocation = null;
  let fulfillmentPlan = null;
  const needsCompanyReservation = SYLVER_POLICY_DEMO &&
    ['approved', 'preparing'].includes(updatedStatus) && !existing.inventory_reserved_at;
  const mustCommitStock = !SYLVER_POLICY_DEMO && ['fulfilled', 'delivered'].includes(updatedStatus) && !existing.inventory_committed_at;
  let deliveryFee = Number(existing.delivery_fee) || 0;
  let deliverySchedule = existing.delivery_schedule || null;

  if (SYLVER_POLICY_DEMO && updatedStatus === 'approved' && existing.fulfillment_method === 'courier') {
    if (req.body.delivery_fee === undefined || !Number.isFinite(Number(req.body.delivery_fee)) || Number(req.body.delivery_fee) < 0) {
      return res.status(400).json({ error: 'Set the delivery fee (use 0 when no fee applies) before confirming a courier order' });
    }
    if (typeof req.body.delivery_schedule !== 'string' || !req.body.delivery_schedule.trim() || req.body.delivery_schedule.trim().length > 200) {
      return res.status(400).json({ error: 'Confirm the delivery schedule before confirming a courier order' });
    }
    deliveryFee = Math.round(Number(req.body.delivery_fee) * 100) / 100;
    deliverySchedule = req.body.delivery_schedule.trim();
  }

  if (SYLVER_POLICY_DEMO && updatedStatus === 'fulfilled' && existing.fulfillment_method === 'courier' && existing.payment_status !== 'paid') {
    return res.status(409).json({ error: 'Courier delivery must be paid and verified before dispatch' });
  }
  const approvedCredit = existing.payment_method === 'credit' && parseArray(existing.payment_records).some((record) => record.type === 'credit_approval' && record.status === 'approved');
  if (SYLVER_POLICY_DEMO && updatedStatus === 'delivered' && existing.payment_status !== 'paid' && !approvedCredit) {
    return res.status(409).json({ error: 'Record and verify the full payment before marking the order delivered' });
  }
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
    let reservation = null;
    if (needsCompanyReservation) {
      reservation = reserveCompanyStock(existing, now);
      if (reservation.error) {
        const error = new Error(reservation.error);
        error.status = 409;
        error.details = reservation;
        throw error;
      }
      db.prepare('UPDATE order_inquiries SET inventory_reserved_at = ?, reservation_details = ? WHERE id = ?')
        .run(now, JSON.stringify(reservation.allocations), req.params.id);
    }
    if (SYLVER_POLICY_DEMO && updatedStatus === 'rejected' && existing.inventory_reserved_at) {
      releaseCompanyStock(existing, now);
      db.prepare('UPDATE order_inquiries SET inventory_reserved_at = NULL, reservation_details = NULL WHERE id = ?').run(req.params.id);
    }
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
    if (SYLVER_POLICY_DEMO && updatedStatus === 'delivered' && !existing.sale_committed_at) {
      for (const line of parseArray(existing.reservation_details)) {
        db.prepare('INSERT INTO sales_transactions (product_id, qty, unit_price, total_amount, transaction_date, customer_name, customer_id, order_inquiry_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(line.product_id, line.qty, line.unit_price, Number(line.net_total) || Math.round(line.qty * line.unit_price * 100) / 100, now, existing.customer_name || 'customer', existing.customer_id || null, Number(req.params.id));
      }
      db.prepare('UPDATE order_inquiries SET sale_committed_at = ? WHERE id = ?').run(now, req.params.id);
    }
    db.prepare('UPDATE order_inquiries SET status = ?, status_history = ?, rejection_reason = ? WHERE id = ?')
      .run(updatedStatus, JSON.stringify(history), rejectionReason, req.params.id);
    if (SYLVER_POLICY_DEMO && updatedStatus === 'approved' && existing.fulfillment_method === 'courier') {
      db.prepare('UPDATE order_inquiries SET delivery_fee = ?, delivery_schedule = ? WHERE id = ?').run(deliveryFee, deliverySchedule, req.params.id);
    }
  });
  try {
    saveStatus();
  } catch (err) {
    if (err && err.status === 409) return res.status(409).json({ error: err.message, ...(err.details || {}) });
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
  if (updatedStatus !== 'pending') notifyInquiryStatus({ ...existing, delivery_fee: deliveryFee, delivery_schedule: deliverySchedule }, updatedStatus);

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

  const verdict = checkCancellation({ from: existing.status, fulfillment_method: existing.fulfillment_method, companyDemo: SYLVER_POLICY_DEMO });
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

  const cancelOrder = db.transaction(() => {
    if (SYLVER_POLICY_DEMO && existing.inventory_reserved_at) {
      releaseCompanyStock(existing, now);
      db.prepare('UPDATE order_inquiries SET inventory_reserved_at = NULL, reservation_details = NULL WHERE id = ?').run(req.params.id);
    }
    db.prepare(
      'UPDATE order_inquiries SET status = ?, status_history = ?, cancelled_at = ?, cancellation_reason = ? WHERE id = ?',
    ).run('cancelled', JSON.stringify(history), now, reason.value, req.params.id);
  });
  cancelOrder();

  audit('inquiry.cancelled', {
    userId: req.user.id,
    inquiryId: Number(req.params.id),
    from: existing.status,
    reason: reason.value,
  });
  notifyInquiryStatus(existing, 'cancelled');

  res.json({ ok: true, message: 'Inquiry cancelled', cancelled_at: now, cancellation_reason: reason.value });
});

router.post('/:id/change-request', authenticateToken, (req, res) => {
  if (!SYLVER_POLICY_DEMO) return res.status(404).json({ error: 'Not found' });
  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });
  if (!ownedBy(req, existing)) return res.status(403).json({ error: 'Not your inquiry' });
  if (!['pending', 'approved', 'preparing'].includes(existing.status)) return res.status(409).json({ error: 'Changes can only be requested while the order is under review or preparation' });
  const message = String(req.body.message || '').trim();
  if (!message || message.length > 1000) return res.status(400).json({ error: 'Enter a change request up to 1000 characters' });
  let current = null;
  try { current = JSON.parse(existing.change_request || 'null'); } catch {}
  if (current && current.status === 'pending') return res.status(409).json({ error: 'A change request is already awaiting review' });
  const request = { id: crypto.randomUUID(), message: sanitizeObject(message), status: 'pending', requested_at: new Date().toISOString() };
  db.prepare('UPDATE order_inquiries SET change_request = ? WHERE id = ?').run(JSON.stringify(request), req.params.id);
  return res.status(201).json({ ok: true, change_request: request });
});

router.put('/:id/change-request', authenticateToken, adminOnly, (req, res) => {
  if (!SYLVER_POLICY_DEMO) return res.status(404).json({ error: 'Not found' });
  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });
  let request = null;
  try { request = JSON.parse(existing.change_request || 'null'); } catch {}
  if (!request || request.status !== 'pending') return res.status(409).json({ error: 'There is no pending change request to review' });
  if (!['accepted', 'declined'].includes(req.body.decision)) return res.status(400).json({ error: 'decision must be accepted or declined' });
  request.status = req.body.decision;
  request.reviewed_at = new Date().toISOString();
  request.reviewed_by = req.user.id;
  request.response = sanitizeObject(String(req.body.response || '').trim()).slice(0, 500);
  db.prepare('UPDATE order_inquiries SET change_request = ? WHERE id = ?').run(JSON.stringify(request), req.params.id);
  return res.json({ ok: true, change_request: request });
});

router.post('/:id/return-requests', authenticateToken, (req, res) => {
  if (!SYLVER_POLICY_DEMO) return res.status(404).json({ error: 'Not found' });
  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });
  if (!ownedBy(req, existing)) return res.status(403).json({ error: 'Not your inquiry' });
  if (existing.status !== 'delivered') return res.status(409).json({ error: 'Returns can be requested after delivery' });
  const history = parseArray(existing.status_history);
  const delivered = [...history].reverse().find((event) => event.status === 'delivered');
  const deliveredAt = Date.parse(delivered?.at || '');
  if (!Number.isFinite(deliveredAt) || Date.now() - deliveredAt > 24 * 60 * 60 * 1000 || deliveredAt > Date.now()) return res.status(409).json({ error: 'The 24-hour return-report window has passed' });
  const reasons = ['incorrect', 'damaged', 'defective', 'discrepancy'];
  if (!reasons.includes(req.body.reason)) return res.status(400).json({ error: `reason must be one of ${reasons.join(', ')}` });
  const message = String(req.body.message || '').trim();
  if (message.length > 1000) return res.status(400).json({ error: 'message must be at most 1000 characters' });
  if (!validProofDataUrl(req.body.proof_data)) return res.status(400).json({ error: 'Attach a PNG, JPEG, or WebP photo up to 650 KB' });
  const requests = parseArray(existing.return_requests);
  if (requests.some((item) => item.status === 'pending')) return res.status(409).json({ error: 'A return request is already under review' });
  const request = { id: crypto.randomUUID(), reason: req.body.reason, message: sanitizeObject(message), proof_data: req.body.proof_data, status: 'pending', requested_at: new Date().toISOString() };
  requests.push(request);
  db.prepare('UPDATE order_inquiries SET return_requests = ? WHERE id = ?').run(JSON.stringify(requests), req.params.id);
  return res.status(201).json({ ok: true, return_request: { ...request, proof_data: undefined } });
});

router.get('/:id/return-proof', authenticateToken, (req, res) => {
  if (!SYLVER_POLICY_DEMO) return res.status(404).json({ error: 'Not found' });
  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });
  if (!ownedBy(req, existing)) return res.status(403).json({ error: 'Not your inquiry' });
  const request = parseArray(existing.return_requests).find((item) => String(item.id) === String(req.query.request_id));
  if (!request || !request.proof_data) return res.status(404).json({ error: 'No return photo is available' });
  return res.json({ return_request_id: request.id, proof_data: request.proof_data });
});

router.put('/:id/return-requests/:requestId', authenticateToken, adminOnly, (req, res) => {
  if (!SYLVER_POLICY_DEMO) return res.status(404).json({ error: 'Not found' });
  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });
  const requests = parseArray(existing.return_requests);
  const request = requests.find((item) => String(item.id) === String(req.params.requestId));
  if (!request || request.status !== 'pending') return res.status(409).json({ error: 'There is no pending return request to review' });
  if (!['approved', 'declined'].includes(req.body.decision)) return res.status(400).json({ error: 'decision must be approved or declined' });
  let refundAmount = 0;
  if (req.body.decision === 'approved') {
    refundAmount = Number(req.body.refund_amount);
    const refundMethod = req.body.refund_method;
    if (!Number.isFinite(refundAmount) || refundAmount < 0 || refundAmount > Number(existing.amount_paid || 0)) return res.status(400).json({ error: 'refund_amount must be between zero and the amount paid' });
    if (!['bank_transfer', 'original_method'].includes(refundMethod)) return res.status(400).json({ error: 'refund_method must be bank_transfer or original_method' });
    request.refund_amount = Math.round(refundAmount * 100) / 100;
    request.refund_method = refundMethod;
    request.refund_status = 'recorded_demo_only';
  }
  request.status = req.body.decision;
  request.reviewed_at = new Date().toISOString();
  request.reviewed_by = req.user.id;
  request.response = sanitizeObject(String(req.body.response || '').trim()).slice(0, 500);
  db.prepare('UPDATE order_inquiries SET return_requests = ? WHERE id = ?').run(JSON.stringify(requests), req.params.id);
  return res.json({ ok: true, return_request: { ...request, proof_data: undefined } });
});

// POST /api/order-inquiries
router.post('/', validate({
  customer_name: { required: true, min: 2, maxLength: 100 },
  customer_email: { required: true, maxLength: 100 },
  estimated_cost: { type: 'number', min: 0 },
}), async (req, res) => {
  const { customer_name, customer_email, customer_phone, products, estimated_cost, notes, delivery_address, payment_method, fulfillment_method } = req.body;

  if (typeof customer_name !== 'string' || typeof customer_email !== 'string') {
    return res.status(400).json({ error: 'Validation failed', details: ['customer_name and customer_email must be text'] });
  }
  if (customer_phone != null && typeof customer_phone !== 'string') {
    return res.status(400).json({ error: 'Validation failed', details: ['customer_phone must be text'] });
  }
  if (notes != null && typeof notes !== 'string') {
    return res.status(400).json({ error: 'Validation failed', details: ['notes must be text'] });
  }
  if (delivery_address != null && typeof delivery_address !== 'string') {
    return res.status(400).json({ error: 'Validation failed', details: ['delivery_address must be text'] });
  }
  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: 'Validation failed', details: ['Add at least one product to the inquiry'] });
  }

  const cleanName = sanitizeObject(customer_name).trim();
  const cleanEmail = sanitizeObject(customer_email).trim();
  const cleanPhone = customer_phone == null ? null : sanitizeObject(customer_phone).trim() || null;
  const cleanAddress = delivery_address == null ? null : sanitizeObject(delivery_address).trim() || null;
  const cleanNotes = notes == null ? '' : sanitizeObject(notes).trim();

  if (cleanName.length < 2 || cleanName.length > 100) {
    return res.status(400).json({ error: 'Validation failed', details: ['customer_name must be 2–100 characters after trimming'] });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(cleanEmail || '').trim())) {
    return res.status(400).json({ error: 'Validation failed', details: ['customer_email must be a valid email address'] });
  }
  if (cleanPhone && !/^\+?[0-9()\-\s]{7,20}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'Validation failed', details: ['customer_phone must be a valid phone number (7–20 characters)'] });
  }
  if (cleanNotes.length > 1000) {
    return res.status(400).json({ error: 'Validation failed', details: ['notes must be at most 1000 characters'] });
  }
  if (req.body.terms_accepted !== true) {
    return res.status(400).json({ error: 'Validation failed', details: ['You must accept the ordering terms before submitting'] });
  }
  const activeTerms = currentOrderTerms();
  if (req.body.terms_version !== activeTerms.version) {
    return res.status(400).json({ error: 'Validation failed', details: ['terms_version is missing or out of date; review the current ordering terms'] });
  }

  if (Array.isArray(products)) {
    for (const item of products) {
      if (typeof item === 'string') {
        const name = item.trim();
        if (!name || name.length > 200) return res.status(400).json({ error: 'Validation failed', details: ['product names must be 1–200 characters'] });
        continue; // Legacy line format, normalized below.
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return res.status(400).json({ error: 'Validation failed', details: ['each product must be a product line'] });
      }
      const lineName = item.name ?? item.product_name;
      if (lineName != null && (typeof lineName !== 'string' || !lineName.trim() || lineName.trim().length > 200)) {
        return res.status(400).json({ error: 'Validation failed', details: ['product names must be 1–200 characters'] });
      }
      if (item.id != null && (!Number.isInteger(Number(item.id)) || Number(item.id) < 1)) {
        return res.status(400).json({ error: 'Validation failed', details: ['product id must be a positive integer'] });
      }
      for (const field of ['price', 'original_price']) {
        if (item[field] != null && (!Number.isFinite(Number(item[field])) || Number(item[field]) < 0)) {
          return res.status(400).json({ error: 'Validation failed', details: [`${field} must be a finite non-negative amount`] });
        }
      }
      const qty = Number(item && (item.quantity ?? item.qty));
      if (!Number.isSafeInteger(qty) || qty < 1) return res.status(400).json({ error: 'Validation failed', details: ['quantity must be a positive whole number'] });
      if (!SYLVER_POLICY_DEMO && qty > 10000) return res.status(400).json({ error: 'Validation failed', details: ['quantity must not exceed 10000'] });
    }
  }
  if (Array.isArray(products) && products.length > 500) {
    return res.status(400).json({ error: 'Validation failed', details: ['an order may not contain more than 500 product lines'] });
  }

  let userId = null;
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    try { const decoded = jwt.verify(token, JWT_SECRET); if (decoded && decoded.id) userId = decoded.id; } catch { }
  }
  const account = userId ? db.prepare('SELECT email FROM users WHERE id = ?').get(userId) : null;
  const creditCustomer = SYLVER_POLICY_DEMO && account && String(account.email || '').toLowerCase() === cleanEmail.toLowerCase()
    ? (db.prepare('SELECT id, user_id FROM customers WHERE user_id = ?').get(userId) || db.prepare('SELECT id, user_id FROM customers WHERE user_id IS NULL AND lower(email) = lower(?)').get(account.email))
    : null;
  const existingCreditCustomer = creditCustomer;
  const validPayments = SYLVER_POLICY_DEMO
    ? [...PAYMENT_METHODS, ...(existingCreditCustomer ? ['credit'] : [])]
    : ['cod', 'gcash', 'other'];
  if (delivery_address !== undefined && String(delivery_address).length > 500) {
    return res.status(400).json({ error: 'Validation failed', details: ['delivery_address must be at most 500 characters'] });
  }
  if (payment_method !== undefined && !validPayments.includes(payment_method)) {
    return res.status(400).json({ error: 'Validation failed', details: [`payment_method must be one of ${validPayments.join(', ')}`] });
  }

  // Fulfilment preference (Part 11). 'courier' without an address is incomplete,
  // so it is refused here rather than surfacing as an undeliverable order.
  const fulfillment = normalizeFulfillment({ fulfillment_method, delivery_address: cleanAddress });
  if (fulfillment.error) {
    return res.status(400).json({ error: 'Validation failed', details: [fulfillment.error] });
  }
  if (SYLVER_POLICY_DEMO && payment_method === 'cash' && fulfillment.method === 'courier') {
    return res.status(400).json({ error: 'Cash is available for pickup; courier orders must be paid and verified before dispatch' });
  }
  if (SYLVER_POLICY_DEMO && payment_method === 'credit' && fulfillment.method === 'courier') {
    return res.status(400).json({ error: 'Credit is available for pickup only; courier orders must be paid before dispatch' });
  }
  if (SYLVER_POLICY_DEMO && payment_method === 'card' && fulfillment.method === 'courier') {
    return res.status(400).json({ error: 'The simulated card option is available for pickup orders only' });
  }

  const now = new Date().toISOString();

  const normalized = normalizeLines(products);
  let lines = normalized.lines;
  let discount = { total: normalized.total, discount_amount: 0, eligible_subtotal: 0 };
  if (SYLVER_POLICY_DEMO) {
    if (lines.some((line) => line.id == null)) {
      return res.status(400).json({ error: 'Refresh the catalog before placing a demo order; every item must match a current product' });
    }
    const catalog = db.prepare('SELECT id, name, category, price, status FROM products').all();
    const productsById = new Map(catalog.map((product) => [Number(product.id), product]));
    lines = lines.map((line) => {
      const product = productsById.get(Number(line.id));
      if (!product || product.status !== 'active') return line;
      // Demo checkout uses the current server catalog price so a modified
      // client payload cannot lower or raise the business price.
      return { ...line, name: product.name, unit_price: Number(product.price) || 0 };
    });
    discount = applyBulkDiscount(lines, (id) => productsById.get(Number(id)));
    lines = discount.lines;
  }
  const storedCost = SYLVER_POLICY_DEMO
    ? Number(discount.total) || 0
    : normalized.total !== null ? normalized.total : (estimated_cost || 0);

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
    if (!SYLVER_POLICY_DEMO && requestedByProduct.get(line.id) > 10000) {
      return res.status(400).json({ error: 'Validation failed', details: ['quantity per product must not exceed 10000 per inquiry'] });
    }
  }
  for (const [productId, requested] of requestedByProduct) {
    const product = db.prepare('SELECT id, name, category, price FROM products WHERE id = ? AND status = ?').get(productId, 'active');
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
      contact_number: cleanPhone,
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

  const acceptedTermsVersion = req.body.terms_accepted === true ? activeTerms.version : null;
  const inquiryId = db.prepare('INSERT INTO order_inquiries (customer_name, customer_email, customer_phone, products, estimated_cost, notes, delivery_address, fulfillment_method, payment_method, user_id, customer_id, status_history, status, terms_version, terms_accepted_at, bulk_discount_amount, bulk_discount_eligible_subtotal, delivery_fee, payment_records, return_requests, amount_paid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, \'[]\', \'[]\', 0, ?)')
    .run(cleanName, cleanEmail, cleanPhone, JSON.stringify(lines), storedCost, cleanNotes || '', fulfillment.address, fulfillment.method, payment_method || (SYLVER_POLICY_DEMO ? 'cash' : 'cod'), userId, customerId, JSON.stringify([{ status: 'pending', at: now }]), 'pending', acceptedTermsVersion, acceptedTermsVersion ? now : null, Number(discount.discount_amount) || 0, Number(discount.eligible_subtotal) || 0, now).lastInsertRowid;
  if (SYLVER_POLICY_DEMO && payment_method === 'credit') {
    db.prepare('UPDATE order_inquiries SET payment_status = ? WHERE id = ?').run('credit_pending', inquiryId);
  }

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
  try { payment = await buildPaymentStep({ id: inquiryId, amount: storedCost, description: `Sylver's order ${inquiryId} — ${cleanName}`, email: cleanEmail, paymentMethod: payment_method || 'cod' }); } catch (err) { console.error('[payments] buildPaymentStep failed:', err && err.message); }
  if (payment) {
    db.prepare('UPDATE order_inquiries SET payment_method = ?, payment_status = ?, payment_reference = ?, payment_url = ?, payment_qr = ?, payment_provider = ?, payment_updated_at = ? WHERE id = ?')
      .run(payment.payment_method, payment.payment_status, payment.payment_reference, payment.payment_url, payment.payment_qr, payment.payment_provider, now, inquiryId);
  }

  const createdInquiry = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(inquiryId);
  void notifyInquiryStatus(createdInquiry, 'pending');

  res.status(201).json({
    ok: true, message: 'Inquiry submitted', id: inquiryId,
    estimated_cost: storedCost,
    bulk_discount_amount: Number(discount.discount_amount) || 0,
    ...(payment ? { payment: { payment_method: payment.payment_method, payment_status: payment.payment_status, payment_reference: payment.payment_reference, payment_url: payment.payment_url, payment_qr: payment.payment_qr, payment_provider: payment.payment_provider, amount_due: storedCost } } : {}),
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
router.get('/:id/payment-proof', authenticateToken, (req, res) => {
  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });
  if (!ownedBy(req, existing)) return res.status(403).json({ error: 'Not your inquiry' });
  const records = parseArray(existing.payment_records);
  const record = req.query.record_id
    ? records.find((item) => String(item.id) === String(req.query.record_id))
    : [...records].reverse().find((item) => item.proof_data);
  if (!record || !record.proof_data) return res.status(404).json({ error: 'No receipt image is available' });
  res.json({ payment_record_id: record.id, proof_data: record.proof_data });
});

router.put('/:id/payment', authenticateToken, (req, res) => {
  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });
  const isAdmin = ADMIN_TIER.includes(req.user.role);

  if (SYLVER_POLICY_DEMO) {
    const now = new Date().toISOString();
    const records = parseArray(existing.payment_records);
    const due = totalDue(existing);
    if (isAdmin) {
      const { payment_status } = req.body;
      if (req.body.allow_partial === true) {
        if (!['approved', 'preparing'].includes(existing.status)) return res.status(409).json({ error: 'Confirm the order before authorizing a deposit or split payment' });
        if (records.some((record) => record.type === 'partial_payment_approval' && record.status === 'approved')) {
          return res.json({ ok: true, partial_payment_allowed: true, payment_updated_at: existing.payment_updated_at || now });
        }
        records.push({ id: crypto.randomUUID(), type: 'partial_payment_approval', status: 'approved', approved_by: req.user.id, approved_at: now });
        db.prepare('UPDATE order_inquiries SET payment_records = ?, payment_updated_at = ? WHERE id = ?').run(JSON.stringify(records), now, req.params.id);
        return res.json({ ok: true, partial_payment_allowed: true, payment_updated_at: now });
      }
      if (payment_status === 'credit_approved' && existing.payment_method === 'credit' && existing.customer_id) {
        if (!['approved', 'preparing'].includes(existing.status)) return res.status(409).json({ error: 'Confirm the order before approving an existing credit arrangement' });
        if (existing.fulfillment_method === 'courier') return res.status(409).json({ error: 'Courier orders must be paid and verified before dispatch' });
        if (!records.some((record) => record.type === 'credit_approval' && record.status === 'approved')) {
          records.push({ id: crypto.randomUUID(), type: 'credit_approval', status: 'approved', approved_by: req.user.id, approved_at: now });
        }
        db.prepare('UPDATE order_inquiries SET payment_records = ?, payment_status = ?, payment_updated_at = ? WHERE id = ?').run(JSON.stringify(records), 'credit_approved', now, req.params.id);
        audit('inquiry.credit_approved', { userId: req.user.id, inquiryId: Number(req.params.id) });
        notifyInquiryStatus(existing, 'credit_approved');
        return res.json({ ok: true, payment_status: 'credit_approved', payment_updated_at: now });
      }
      if (payment_status === 'paid' && existing.payment_method === 'cash' && req.body.payment_record_id == null) {
        const amount = Number(req.body.amount ?? due - Number(existing.amount_paid || 0));
        if (!Number.isFinite(amount) || amount <= 0 || amount > due - Number(existing.amount_paid || 0) + 0.01) {
          return res.status(400).json({ error: 'Enter a valid cash amount up to the outstanding balance' });
        }
        const outstanding = due - Number(existing.amount_paid || 0);
        if (amount < outstanding - 0.01 && !records.some((record) => record.type === 'partial_payment_approval' && record.status === 'approved')) {
          return res.status(409).json({ error: 'Deposits and split payments require staff approval first' });
        }
        records.push({ id: crypto.randomUUID(), method: 'cash', amount, paid_on: now.slice(0, 10), status: 'verified', verified_by: req.user.id, verified_at: now });
        const amountPaid = Math.round((Number(existing.amount_paid || 0) + amount) * 100) / 100;
        const nextStatus = amountPaid + 0.01 >= due ? 'paid' : 'partial';
        db.prepare('UPDATE order_inquiries SET payment_records = ?, amount_paid = ?, payment_status = ?, payment_updated_at = ? WHERE id = ?')
          .run(JSON.stringify(records), amountPaid, nextStatus, now, req.params.id);
        audit('inquiry.payment_verified', { userId: req.user.id, inquiryId: Number(req.params.id), payment_status: nextStatus, amount });
        notifyInquiryStatus(existing, 'payment_verified');
        return res.json({ ok: true, payment_status: nextStatus, amount_paid: amountPaid, amount_due: due, payment_updated_at: now });
      }
      if (payment_status === 'paid' || payment_status === 'failed') {
        const record = req.body.payment_record_id
          ? records.find((item) => String(item.id) === String(req.body.payment_record_id))
          : [...records].reverse().find((item) => item.status === 'pending_verification');
        if (!record) return res.status(409).json({ error: 'There is no submitted payment proof to review' });
        if (record.status !== 'pending_verification') return res.status(409).json({ error: 'This payment proof has already been reviewed' });
        record.status = payment_status === 'paid' ? 'verified' : 'failed';
        record.verified_by = req.user.id;
        record.verified_at = now;
        const amountPaid = payment_status === 'paid'
          ? Math.round((Number(existing.amount_paid || 0) + Number(record.amount || 0)) * 100) / 100
          : Number(existing.amount_paid || 0);
        const nextStatus = amountPaid + 0.01 >= due ? 'paid' : payment_status === 'paid' ? 'partial' : 'failed';
        db.prepare('UPDATE order_inquiries SET payment_records = ?, amount_paid = ?, payment_status = ?, payment_updated_at = ? WHERE id = ?')
          .run(JSON.stringify(records), amountPaid, nextStatus, now, req.params.id);
        audit('inquiry.payment_verified', { userId: req.user.id, inquiryId: Number(req.params.id), payment_status: nextStatus, amount: record.amount });
        notifyInquiryStatus(existing, payment_status === 'paid' ? 'payment_verified' : 'payment_failed');
        return res.json({ ok: true, payment_status: nextStatus, amount_paid: amountPaid, amount_due: due, payment_updated_at: now });
      }
      return res.status(400).json({ error: 'payment_status must be paid or failed; use a verified payment record' });
    }

    if (!ownedBy(req, existing)) return res.status(403).json({ error: 'Not your inquiry' });
    const creditSettlement = existing.payment_method === 'credit' && records.some((record) => record.type === 'credit_approval' && record.status === 'approved');
    if (!['approved', 'preparing'].includes(existing.status) && !creditSettlement) return res.status(409).json({ error: 'Wait for Sylver to confirm the order before paying' });
    if (existing.payment_method === 'card' && existing.payment_provider === 'demo_card' && existing.fulfillment_method === 'pickup' && req.body.demo_card_confirmed === true) {
      if (existing.payment_status === 'paid') return res.json({ ok: true, payment_status: 'paid', payment_reference: existing.payment_reference, payment_updated_at: existing.payment_updated_at });
      const amount = due;
      records.push({ id: crypto.randomUUID(), type: 'demo_card', method: 'card', amount, reference: existing.payment_reference, status: 'recorded_demo_only', submitted_at: now });
      db.prepare('UPDATE order_inquiries SET payment_records = ?, amount_paid = ?, payment_status = ?, payment_customer_reference = ?, payment_updated_at = ? WHERE id = ?')
        .run(JSON.stringify(records), amount, 'paid', existing.payment_reference, now, req.params.id);
      audit('inquiry.payment_demo_completed', { userId: req.user.id, inquiryId: Number(req.params.id), amount, payment_reference: existing.payment_reference });
      notifyInquiryStatus(existing, 'payment_verified');
      return res.json({ ok: true, payment_status: 'paid', amount_paid: amount, amount_due: amount, payment_reference: existing.payment_reference, payment_updated_at: now });
    }
    if (existing.fulfillment_method === 'courier' && (!existing.delivery_schedule || existing.delivery_fee == null)) return res.status(409).json({ error: 'Wait for Sylver to confirm the courier fee and schedule before paying' });
    const receiptMethod = existing.payment_method === 'credit' ? req.body.receipt_method : existing.payment_method;
    if (!['gcash', 'bank_transfer'].includes(receiptMethod)) {
      return res.status(400).json({ error: 'Only GCash or bank-transfer receipts can be submitted for verification' });
    }
    if (existing.payment_method === 'credit' && !creditSettlement) {
      return res.status(409).json({ error: 'Wait for staff to approve the existing customer credit arrangement before paying against it' });
    }
    const customerReference = String(req.body.customer_reference || '').trim();
    const amount = Number(req.body.amount);
    const paymentDate = String(req.body.payment_date || '').trim();
    if (customerReference.length < 5 || customerReference.length > 100 || !/^[A-Za-z0-9\- ]+$/.test(customerReference)) {
      return res.status(400).json({ error: 'Enter a valid payment reference (5–100 letters, numbers, spaces, or dashes)' });
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > due - Number(existing.amount_paid || 0) + 0.01) {
      return res.status(400).json({ error: 'Payment amount must be greater than zero and no more than the outstanding balance' });
    }
    const outstanding = due - Number(existing.amount_paid || 0);
    if (amount < outstanding - 0.01 && !records.some((record) => record.type === 'partial_payment_approval' && record.status === 'approved')) {
      return res.status(409).json({ error: 'Deposits and split payments require staff approval first' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || !Number.isFinite(Date.parse(`${paymentDate}T00:00:00Z`)) || paymentDate > now.slice(0, 10)) {
      return res.status(400).json({ error: 'Enter a valid payment date that is not in the future' });
    }
    if (!validProofDataUrl(req.body.proof_data)) return res.status(400).json({ error: 'Attach a PNG, JPEG, or WebP receipt image up to 650 KB' });
    if (records.some((item) => item.status === 'pending_verification')) {
      return res.status(409).json({ error: 'A payment is already waiting for staff verification' });
    }
    const record = {
      id: crypto.randomUUID(),
      method: receiptMethod,
      amount: Math.round(amount * 100) / 100,
      paid_on: paymentDate,
      reference: sanitizeObject(customerReference),
      proof_data: req.body.proof_data,
      status: 'pending_verification',
      submitted_at: now,
    };
    records.push(record);
    db.prepare('UPDATE order_inquiries SET payment_records = ?, payment_status = ?, payment_customer_reference = ?, payment_updated_at = ? WHERE id = ?')
      .run(JSON.stringify(records), 'pending_verification', record.reference, now, req.params.id);
    audit('inquiry.payment_submitted', { userId: req.user.id, inquiryId: Number(req.params.id), method: existing.payment_method, amount: record.amount });
    notifyInquiryStatus(existing, 'payment_pending');
    return res.json({ ok: true, payment_status: 'pending_verification', payment_record_id: record.id, payment_updated_at: now });
  }

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

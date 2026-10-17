const express = require('express');
const router = express.Router();
const { db } = require('../../db');
const { authenticateToken } = require('../../auth-core');
const { ADMIN_TIER, adminOnly } = require('../../middleware');
const { audit } = require('../../audit');

// Back-order management: one row per order inquiry that could not be fully
// fulfilled.
//
// AUTHORIZATION follows the rule the order-inquiry routes already use for the
// inquiry itself, because a back order is an ATTRIBUTE of an inquiry and
// carries the reason a customer's order fell short — which is nobody else's
// business. Reading: admin tier may read any; everyone else must own the
// inquiry (404 unknown inquiry, 403 not yours — the same codes and wording as
// /api/order-inquiries/:id/costing). Writing is admin-only: recording a
// shortfall is back-office workflow, and leaving it open to any authenticated
// caller would let a customer set another customer's back-order status.

function rowFromDb(r) {
  if (!r) return null;
  return {
    id: r.id,
    inquiry_id: r.inquiry_id,
    reason: r.reason,
    requested_by_date: r.requested_by_date,
    status: r.status,
    note: r.note,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// Shared ownership test for a single inquiry. Returns null when the caller may
// read it, or { status, error } describing the refusal.
function ownershipRefusal(inquiryId, user) {
  if (ADMIN_TIER.includes(user.role)) return null;
  const inquiry = db.prepare('SELECT id, user_id, customer_email FROM order_inquiries WHERE id = ?').get(inquiryId);
  if (!inquiry) return { status: 404, error: 'Order inquiry not found' };
  const owner = db.prepare('SELECT email FROM users WHERE id = ?').get(user.id);
  const mine =
    Number(inquiry.user_id) === Number(user.id) ||
    (owner && String(inquiry.customer_email || '').toLowerCase() === String(owner.email || '').toLowerCase());
  return mine ? null : { status: 403, error: 'Not your inquiry' };
}

// GET /api/back-orders -- list back orders (admins: all; everyone else: theirs).
router.get('/', authenticateToken, (req, res) => {
  if (ADMIN_TIER.includes(req.user.role)) {
    const rows = db.prepare('SELECT * FROM back_orders ORDER BY id DESC').all();
    return res.json(rows.map(rowFromDb));
  }
  const owner = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
  const rows = db
    .prepare(
      `SELECT b.* FROM back_orders b WHERE b.inquiry_id IN (
         SELECT id FROM order_inquiries WHERE user_id = ? OR customer_email = ? COLLATE NOCASE
       ) ORDER BY b.id DESC`
    )
    .all(req.user.id, (owner && owner.email) || '');
  res.json(rows.map(rowFromDb));
});

// GET /api/back-orders/:id -- the back order for one inquiry id.
router.get('/:id', authenticateToken, (req, res) => {
  const refusal = ownershipRefusal(req.params.id, req.user);
  if (refusal) return res.status(refusal.status).json({ error: refusal.error });
  const row = db.prepare('SELECT * FROM back_orders WHERE inquiry_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Back order not found' });
  res.json(rowFromDb(row));
});

// POST /api/back-orders -- create or update the back order for an inquiry.
router.post('/', authenticateToken, adminOnly, (req, res) => {
  const inquiry_id = Number(req.body.inquiry_id);
  if (!inquiry_id) return res.status(400).json({ error: 'inquiry_id is required' });
  const reason = req.body.reason == null ? null : String(req.body.reason || '').trim();
  const requested_by_date = req.body.requested_by_date == null ? null : String(req.body.requested_by_date || '').trim();
  const note = req.body.note == null ? null : String(req.body.note || '').trim();

  const existing = db.prepare('SELECT * FROM back_orders WHERE inquiry_id = ?').get(inquiry_id);
  const status = String(req.body.status || (existing && existing.status) || 'open').trim();
  let id;
  if (existing) {
    db.prepare(
      "UPDATE back_orders SET reason = ?, requested_by_date = ?, status = ?, note = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(reason == null ? existing.reason : reason, requested_by_date == null ? existing.requested_by_date : requested_by_date, status, note == null ? existing.note : note, existing.id);
    id = existing.id;
  } else {
    const info = db
      .prepare('INSERT INTO back_orders (inquiry_id, reason, requested_by_date, status, note) VALUES (?, ?, ?, ?, ?)')
      .run(inquiry_id, reason, requested_by_date, status, note);
    id = info.lastInsertRowid;
  }
  const row = rowFromDb(db.prepare('SELECT * FROM back_orders WHERE id = ?').get(id));
  if (ADMIN_TIER.includes(req.user.role)) {
    audit('back_order.upserted', { userId: req.user.id, inquiryId: row.inquiry_id, backOrderId: row.id });
  }
  res.json(row);
});

module.exports = router;

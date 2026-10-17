const express = require('express');
const router = express.Router();
const { db } = require('../../db');
const { authenticateToken } = require('../../auth-core');
const { adminOnly } = require('../../middleware');
const { audit } = require('../../audit');
const { createCorrectionRequest, rowFromDb } = require('../../stock-control/correction-helpers');

// Approver comments / correction requests: when an admin rejects a submission
// with a comment, the comment is stored here linked to the submission so the
// staff app can show it as a visible correction instruction before resubmission.
// Admin-only on every route, mirroring the npm-free backend.
//
// The WRITE itself lives in stock-control/correction-helpers.js because the
// reject handlers in approvals.js write the very same row when an approver
// types a comment next to the Reject button — one shape, two entry points.

// GET /api/correction-requests -- list, optionally filtered.
router.get('/', authenticateToken, adminOnly, (req, res) => {
  const where = [];
  const params = [];
  if (req.query.submission_id != null && req.query.submission_id !== '') {
    where.push('submission_id = ?');
    params.push(Number(req.query.submission_id));
  }
  if (req.query.status) {
    where.push('status = ?');
    params.push(req.query.status);
  }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM correction_requests${clause} ORDER BY id DESC`).all(...params);
  res.json(rows.map(rowFromDb));
});

// POST /api/correction-requests -- record a reject comment / correction request.
router.post('/', authenticateToken, adminOnly, (req, res) => {
  const { correctionRequest, error } = createCorrectionRequest({
    submission_id: req.body.submission_id,
    submission_type: req.body.submission_type,
    comment: req.body.comment,
    requested_by: req.user.username,
  });
  if (error) return res.status(400).json({ error });
  audit('correction_request.created', {
    userId: req.user.id,
    correctionId: correctionRequest.id,
    submissionId: correctionRequest.submission_id,
  });
  res.json(correctionRequest);
});

// GET /api/correction-requests/:id -- one request.
router.get('/:id', authenticateToken, adminOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM correction_requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Correction request not found' });
  res.json(rowFromDb(row));
});

// POST /api/correction-requests/:id/resolve -- mark as addressed.
router.post('/:id/resolve', authenticateToken, adminOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM correction_requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Correction request not found' });
  const status = String((req.body && req.body.status) || req.query.status || 'closed').trim();
  db.prepare("UPDATE correction_requests SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, row.id);
  audit('correction_request.resolved', { userId: req.user.id, correctionId: row.id, status });
  res.json(rowFromDb(db.prepare('SELECT * FROM correction_requests WHERE id = ?').get(row.id)));
});

module.exports = router;

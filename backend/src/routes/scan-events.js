const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../auth-core');
const { staffOrAdmin } = require('../middleware');
const { audit } = require('../audit');
const { SCAN_KINDS } = require('../app-core');

// POST /api/scan-events — record a scan into the audit trail (who scanned
// what, where and when). QR-only since the OCR retirement: product tags,
// location tags and unrecognized foreign codes all land here, recognized or
// not — an unrecognized code being pointed at the scanner is exactly the
// kind of event worth being able to review.
router.post('/scan-events', authenticateToken, staffOrAdmin, (req, res) => {
  const { payload, kind, target_id: targetId, location } = req.body || {};

  if (typeof payload !== 'string' || payload.trim() === '') return res.status(400).json({ error: 'Validation failed', details: ['payload is required'] });
  if (payload.length > 300) return res.status(400).json({ error: 'Validation failed', details: ['payload must be at most 300 characters'] });

  const scanKind = SCAN_KINDS.includes(kind) ? kind : 'unknown';
  const scanTarget = targetId === undefined || targetId === null || !Number.isFinite(Number(targetId)) ? null : Number(targetId);
  const scanLocation = typeof location === 'string' && location.trim() !== '' ? location.trim().slice(0, 100) : null;

  const event = { at: new Date().toISOString(), actor: req.user.username, actorRole: req.user.role, kind: scanKind, target_id: scanTarget, location: scanLocation, payload: payload.trim() };
  audit('scan.qr', event);

  res.status(201).json({ ok: true, event });
});

module.exports = router;

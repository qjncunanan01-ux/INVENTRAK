const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly, staffOrAdmin } = require('../middleware');
const { validate } = require('../validation');
const { handleOcr, handleOcrStock } = require('../ocr');
const { audit } = require('../audit');
const bodyParser = require('body-parser');
const { SCAN_KINDS } = require('../app-core');

// POST /api/ocr
router.post('/ocr', bodyParser.json({ limit: '12mb' }), async (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE status = ?').all('active');
  await handleOcr(req, res, (r, code, body) => r.status(code).json(body), products);
});

// POST /api/ocr/stock
router.post('/ocr/stock', bodyParser.json({ limit: '12mb' }), authenticateToken, staffOrAdmin, async (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE status = ?').all('active');
  const stockLookup = (productId) => {
    const rows = db.prepare('SELECT l.name, s.quantity FROM stock s JOIN locations l ON s.location_id = l.id WHERE s.product_id = ?').all(productId);
    const locations = {};
    let total = 0;
    for (const r of rows) { locations[r.name] = Number(r.quantity) || 0; total += Number(r.quantity) || 0; }
    return { locations, total };
  };
  await handleOcrStock(req, res, (r, code, body) => r.status(code).json(body), products, stockLookup);
});

// POST /api/scan-events
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
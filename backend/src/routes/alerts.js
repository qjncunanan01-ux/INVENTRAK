const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly } = require('../middleware');
const { refreshAlerts } = require('../app-core');

// GET /api/alerts
router.get('/', authenticateToken, adminOnly, (req, res) => {
  const { status = 'active' } = req.query;
  refreshAlerts();
  // LEFT JOIN on products, deliberately. A stale_count flag belongs to a SHELF,
  // so product_id is NULL — and an inner join here silently dropped every one
  // of them, which made the whole stocktake feature invisible on the one page
  // staff already look at. locations stays an inner join: every alert has one.
  const rows = db
    .prepare(
      'SELECT a.*, p.name as product_name, l.name as location_name FROM inventory_alerts a LEFT JOIN products p ON a.product_id = p.id JOIN locations l ON a.location_id = l.id WHERE a.status = ? ORDER BY a.created_at DESC',
    )
    .all(status);
  res.json(rows);
});

// PUT /api/alerts/:id/resolve
router.put('/:id/resolve', authenticateToken, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT id FROM inventory_alerts WHERE id = ? AND status = ?').get(req.params.id, 'active');
  if (!existing) return res.status(404).json({ error: 'Alert not found or already resolved' });
  db.prepare("UPDATE inventory_alerts SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true, message: 'Alert resolved' });
});

module.exports = router;
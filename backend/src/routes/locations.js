const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly } = require('../middleware');
const { validate } = require('../validation');

// GET /api/locations
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT id, name FROM locations ORDER BY id').all();
  res.json(rows);
});

// POST /api/locations
router.post('/', authenticateToken, adminOnly, validate({ name: { required: true, maxLength: 100 } }), (req, res) => {
  const { name } = req.body;
  const existing = db.prepare('SELECT id FROM locations WHERE name = ?').get(name);
  if (existing) return res.status(409).json({ error: 'Location already exists' });
  const info = db.prepare('INSERT INTO locations (name) VALUES (?)').run(name);
  res.status(201).json({ id: info.lastInsertRowid, name });
});

// DELETE /api/locations/:id
router.delete('/:id', authenticateToken, adminOnly, (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT id FROM locations WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Location not found' });

  const stockCount = db.prepare('SELECT COUNT(*) as count FROM stock WHERE location_id = ? AND quantity > 0').get(id);
  if (stockCount.count > 0) return res.status(400).json({ error: 'Cannot delete location with existing stock. Transfer stock first.' });

  const adjRefs = db.prepare('SELECT COUNT(*) as count FROM stock_adjustments WHERE location_id = ?').get(id).count;
  const trfRefs = db.prepare('SELECT COUNT(*) as count FROM stock_transfers WHERE src_location = ? OR dst_location = ?').get(id, id).count;
  if (adjRefs > 0 || trfRefs > 0) return res.status(400).json({ error: 'Cannot delete location referenced by stock adjustments or transfers. Resolve them first.' });

  db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  res.json({ ok: true, message: 'Location deleted' });
});

module.exports = router;
const express = require('express');
const router = express.Router();
const { db } = require('../../db');
const { authenticateToken } = require('../../auth-core');
const { adminOnly } = require('../../middleware');
const { audit } = require('../../audit');

// Units are matched case-insensitively and without surrounding whitespace, so
// 'KG' and ' kg ' are the same unit -- the same normalization the npm-free
// catalog applies. Identity rows are rejected because they make every
// conversion silently a no-op.
function normalizeUnit(u) {
  if (u == null) return '';
  return String(u).trim().toLowerCase();
}

function rowFromDb(r) {
  if (!r) return null;
  return {
    id: r.id,
    from_unit: r.from_unit,
    to_unit: r.to_unit,
    rate: r.rate,
    note: r.note,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// GET /api/unit-conversions -- the full catalog (admin only).
router.get('/', authenticateToken, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT * FROM unit_conversions ORDER BY from_unit, to_unit').all();
  res.json(rows.map(rowFromDb));
});

// POST /api/unit-conversions -- create or update one (from_unit, to_unit) rate.
router.post('/', authenticateToken, adminOnly, (req, res) => {
  const from_unit = normalizeUnit(req.body.from_unit);
  const to_unit = normalizeUnit(req.body.to_unit);
  if (!from_unit || !to_unit) return res.status(400).json({ error: 'from_unit and to_unit are required' });
  if (from_unit === to_unit) return res.status(400).json({ error: 'conversion cannot be an identity' });
  const rate = Number(req.body.rate);
  if (!Number.isFinite(rate) || rate <= 0) return res.status(400).json({ error: 'rate must be a positive number' });
  const note = req.body.note == null ? null : String(req.body.note || '').trim();

  const existing = db.prepare('SELECT id FROM unit_conversions WHERE from_unit = ? AND to_unit = ?').get(from_unit, to_unit);
  let id;
  if (existing) {
    db.prepare("UPDATE unit_conversions SET rate = ?, note = ?, updated_at = datetime('now') WHERE id = ?").run(rate, note, existing.id);
    id = existing.id;
  } else {
    const info = db
      .prepare('INSERT INTO unit_conversions (from_unit, to_unit, rate, note, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(from_unit, to_unit, rate, note, req.user.id);
    id = info.lastInsertRowid;
  }
  const row = rowFromDb(db.prepare('SELECT * FROM unit_conversions WHERE id = ?').get(id));
  audit('unit_conversion.upserted', { userId: req.user.id, conversionId: row.id });
  res.json(row);
});

// DELETE /api/unit-conversions/:id -- remove a conversion.
router.delete('/:id', authenticateToken, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT * FROM unit_conversions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Conversion not found' });
  db.prepare('DELETE FROM unit_conversions WHERE id = ?').run(existing.id);
  audit('unit_conversion.deleted', { userId: req.user.id, conversionId: existing.id });
  res.json({ ok: true });
});

module.exports = router;

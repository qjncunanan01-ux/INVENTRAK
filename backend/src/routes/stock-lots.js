const express = require('express');
const router = express.Router();
const { db } = require('../db');

// GET /api/stock-lots
router.get('/', (req, res) => {
  const { product_id, location_id, expiring_within } = req.query;

  let query = 'SELECT sl.id, sl.product_id, sl.location_id, sl.qty, sl.received_at, sl.expiry_date, p.name as product_name, l.name as location_name FROM stock_lots sl JOIN products p ON sl.product_id = p.id JOIN locations l ON sl.location_id = l.id WHERE sl.qty > 0';
  const params = [];

  if (product_id) { query += ' AND sl.product_id = ?'; params.push(product_id); }
  if (location_id) { query += ' AND sl.location_id = ?'; params.push(location_id); }

  if (expiring_within !== undefined) {
    const days = Number(expiring_within);
    if (!Number.isFinite(days) || days < 0 || days > 3650) return res.status(400).json({ error: 'expiring_within must be a number of days (0-3650)' });
    const cutoff = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    query += ' AND sl.expiry_date IS NOT NULL AND sl.expiry_date <= ?';
    params.push(cutoff);
  }

  query += ' ORDER BY (sl.expiry_date IS NULL) ASC, sl.expiry_date ASC, sl.received_at ASC, sl.id ASC';
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

module.exports = router;
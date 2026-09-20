const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly } = require('../middleware');
const settings = require('../settings');
const { audit } = require('../audit');

// GET /api/health
router.get('/', (req, res) => {
  res.json({ ok: true, status: 'ok', driver: 'sqlite', time: new Date().toISOString() });
});

// GET /api/health/integrity
router.get('/integrity', authenticateToken, adminOnly, (req, res) => {
  const errors = [];

  const dups = db.prepare('SELECT product_id, location_id, COUNT(*) as c FROM stock GROUP BY product_id, location_id HAVING c > 1').all();
  dups.forEach((d) => errors.push(`duplicate stock row: product ${d.product_id}, location ${d.location_id} (x${d.c})`));

  db.prepare('SELECT product_id, location_id, quantity FROM stock WHERE quantity < 0').all().forEach((r) =>
    errors.push(`negative stock: product ${r.product_id}, location ${r.location_id} = ${r.quantity}`));

  const lots = db.prepare('SELECT product_id, location_id, SUM(qty) as s FROM stock_lots GROUP BY product_id, location_id').all();
  lots.forEach((l) => {
    const st = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(l.product_id, l.location_id);
    if (!st) errors.push(`FIFO lots exist for product ${l.product_id}, location ${l.location_id} with no stock row`);
    else if (Math.abs(st.quantity - l.s) > 1e-6) errors.push(`FIFO lots (${l.s}) != stock (${st.quantity}) for product ${l.product_id}, location ${l.location_id}`);
  });

  db.prepare('SELECT DISTINCT product_id FROM stock_movements').all().forEach((m) => {
    const p = db.prepare('SELECT id, status FROM products WHERE id = ?').get(m.product_id);
    if (!p || p.status !== 'active') errors.push(`movement references inactive/missing product ${m.product_id}`);
  });

  res.json({ ok: errors.length === 0, errors, checkedAt: new Date().toISOString() });
});

// GET /api/cache/stats lives in routes/cache.js (its own mount) so the path
// matches the OpenAPI spec, the npm-free fallback, and the generated clients.

module.exports = router;
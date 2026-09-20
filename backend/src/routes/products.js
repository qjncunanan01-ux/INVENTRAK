const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly, staffOrAdmin } = require('../middleware');
const { validate } = require('../validation');
const { sanitizeObject } = require('../sanitize');
const { criticalLevels, criticalLevelFromMap } = require('../critical-level');
const { stockStatus } = require('../critical-level');
const settings = require('../settings');
const { audit } = require('../audit');
const { enrichInquiryRows } = require('../inquiry-helpers');

const MAX_BULK_PRICES = 2000;

// GET /api/products
router.get('/', (req, res) => {
  const { page = 1, limit = 50, search, category, status = 'active' } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  let where = 'WHERE status = ?';
  const params = [status];

  if (search) {
    where += ' AND (name LIKE ? OR category LIKE ? OR brand LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  if (category) {
    where += ' AND category = ?';
    params.push(category);
  }

  if (!req.query.page && !req.query.limit) {
    const rows = db.prepare(`SELECT * FROM products ${where} ORDER BY name ASC`).all(...params);
    return res.json(rows);
  }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM products ${where}`).get(...params);
  const rows = db.prepare(`SELECT * FROM products ${where} ORDER BY name ASC LIMIT ? OFFSET ?`).all(...params, limitNum, offset);

  res.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total: countRow.total, totalPages: Math.ceil(countRow.total / limitNum) } });
});

// GET /api/products/categories
router.get('/categories', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT category FROM products WHERE status = ? ORDER BY category').all('active');
  res.json(rows.map(r => r.category));
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Product not found' });
  res.json(row);
});

// POST /api/products
router.post('/', authenticateToken, adminOnly, validate({
  name: { required: true, maxLength: 200 },
  category: { required: true, maxLength: 100 },
  price: { required: true, type: 'number', min: 0 },
  image: { maxLength: 300 },
}), (req, res) => {
  const { name, category, brand, description, size, unit, price, status, image } = req.body;
  const info = db.prepare('INSERT INTO products (name, category, brand, description, size, unit, price, status, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sanitizeObject(name), sanitizeObject(category), sanitizeObject(brand || ''), sanitizeObject(description || ''), sanitizeObject(size || ''), sanitizeObject(unit || 'pcs'), price, status || 'active', image || null);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/products/:id
router.put('/:id', authenticateToken, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const { name, category, brand, description, size, unit, price, status, image } = req.body;
  db.prepare('UPDATE products SET name=?, category=?, brand=?, description=?, size=?, unit=?, price=?, status=?, image=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(sanitizeObject(name), sanitizeObject(category), sanitizeObject(brand), sanitizeObject(description), sanitizeObject(size), sanitizeObject(unit), price, status, image || null, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/products/:id
router.delete('/:id', authenticateToken, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  db.prepare('UPDATE products SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run('inactive', req.params.id);
  res.json({ ok: true, message: 'Product deactivated' });
});

// POST /api/products/bulk-prices
router.post('/bulk-prices', authenticateToken, adminOnly, (req, res) => {
  const { prices } = req.body || {};
  if (!Array.isArray(prices)) return res.status(400).json({ error: 'Validation failed', details: ['prices must be an array of { name, price } entries'] });
  if (prices.length === 0) return res.status(400).json({ error: 'Validation failed', details: ['prices must not be empty'] });
  if (prices.length > MAX_BULK_PRICES) return res.status(400).json({ error: 'Validation failed', details: [`prices must not exceed ${MAX_BULK_PRICES} entries`] });

  const skipped = [];
  const stmtUpdate = db.prepare('UPDATE products SET price = ?, updated_at = datetime(\'now\') WHERE id = ?');
  const stmtById = db.prepare('SELECT id FROM products WHERE id = ?');
  const stmtByName = db.prepare('SELECT id FROM products WHERE TRIM(LOWER(name)) = LOWER(?)');

  let updated = 0;
  for (const entry of prices) {
    const name = entry && typeof entry.name === 'string' ? entry.name.trim() : null;
    const price = entry && entry.price;

    if (price === undefined || price === null || price === '' || (typeof price === 'string' && price.trim() === '') || !Number.isFinite(Number(price)) || Number(price) < 0) {
      skipped.push({ name: name || '(unnamed)', reason: 'invalid price' });
      continue;
    }
    if (name && name.length > 200) {
      skipped.push({ name: name.slice(0, 60) + '…', reason: 'name too long' });
      continue;
    }

    const priceNum = Number(price);
    let row = null;
    if (entry.id !== undefined && entry.id !== null && entry.id !== '') {
      const idNum = Number(entry.id);
      if (Number.isInteger(idNum) && idNum >= 1) row = stmtById.get(idNum);
    }
    if (!row && name) row = stmtByName.get(name);
    if (!row) {
      skipped.push({ name: name || '(unnamed)', reason: 'not found' });
      continue;
    }
    stmtUpdate.run(priceNum, row.id);
    updated++;
  }

  res.json({ ok: true, total: prices.length, updated, skipped });
});

module.exports = router;
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
const { skuForProductId, isSkuShape, handleQrProductLookup } = require('../qr-codes');
const { enrichInquiryRows } = require('../inquiry-helpers');
const { stripCost, stripCostAll } = require('../product-visibility');
const { parseCostEntry } = require('../costing');

// The catalog is public and served with `Cache-Control: public, max-age=300`,
// so it can be cached by a CDN or proxy. That rules out making the payload
// depend on WHO is asking: an admin's response could sit in a shared cache and
// be handed to an anonymous visitor. `cost` is therefore stripped
// UNCONDITIONALLY from every public product read, and admin-only cost access
// lives on its own endpoint (GET /api/products/costs), which is authenticated
// and never publicly cached.
const shapeProducts = (rows) => stripCostAll(rows);

const MAX_BULK_PRICES = 2000;
const MAX_BULK_COSTS = 2000;

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
    return res.json(shapeProducts(rows));
  }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM products ${where}`).get(...params);
  const rows = db.prepare(`SELECT * FROM products ${where} ORDER BY name ASC LIMIT ? OFFSET ?`).all(...params, limitNum, offset);

  res.json({ data: shapeProducts(rows), pagination: { page: pageNum, limit: limitNum, total: countRow.total, totalPages: Math.ceil(countRow.total / limitNum) } });
});

// GET /api/products/categories
router.get('/categories', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT category FROM products WHERE status = ? ORDER BY category').all('active');
  res.json(rows.map(r => r.category));
});

// GET /api/products/qr/:code — QR product identification (staff or admin).
// Replaces the OCR scan pipeline: the scanned tag yields an IDENTIFIER, the
// server resolves it against the database and returns the product with a live
// per-location stock snapshot and open FIFO lots in one round trip. Accepts a
// full tag payload ("INVENTRAK:PROD:42"), a SKU ("PRD-000042" / "MILK-001")
// or a bare numeric id (legacy barcode fallback). NOTE: declared BEFORE
// /:id so Express does not swallow "qr" as an id.
// GET /api/products/costs — admin-only cost-of-goods sheet (the bulk cost-entry
// screen). Kept OFF the cached public catalog on purpose: it is authenticated,
// never publicly cached, and is the only read path that reveals `cost`.
// Declared BEFORE /:id so Express does not swallow "costs" as a product id.
router.get('/costs', authenticateToken, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT id, sku, name, price, cost FROM products ORDER BY name ASC').all();
  res.json(rows);
});

// GET /api/products/qr/:code — QR product identification (staff or admin).
router.get('/qr/:code', authenticateToken, staffOrAdmin, async (req, res) => {
  // Strip cost unconditionally: this response goes to STAFF devices, and the
  // staff tier is deliberately not entitled to the margin (locked by
  // security.test.js, which fails if "cost" appears in this payload).
  const products = db.prepare('SELECT * FROM products').all().map(stripCost);
  const stockLookup = (productId) => {
    const rows = db.prepare('SELECT l.name, s.quantity FROM stock s JOIN locations l ON s.location_id = l.id WHERE s.product_id = ?').all(productId);
    const locations = {};
    let total = 0;
    for (const r of rows) { locations[r.name] = Number(r.quantity) || 0; total += Number(r.quantity) || 0; }
    return { locations, total };
  };
  const lotsFor = (productId) =>
    db.prepare(`SELECT sl.id, sl.product_id, sl.location_id, sl.qty, sl.received_at, sl.expiry_date, l.name as location_name
                FROM stock_lots sl JOIN locations l ON sl.location_id = l.id
                WHERE sl.qty > 0 AND sl.product_id = ?
                ORDER BY (sl.expiry_date IS NULL) ASC, sl.expiry_date ASC, sl.received_at ASC, sl.id ASC`).all(productId);
  await handleQrProductLookup(req, res, (r, code, body) => r.status(code).json(body), {
    products,
    stockLookup,
    lotsFor,
  });
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Product not found' });
  res.json(shapeProducts([row])[0]);
});

// POST /api/products
router.post('/', authenticateToken, adminOnly, validate({
  name: { required: true, maxLength: 200 },
  category: { required: true, maxLength: 100 },
  price: { required: true, type: 'number', min: 0 },
  image: { maxLength: 300 },
}), (req, res) => {
  const { name, category, brand, description, size, unit, price, cost, status, image, sku } = req.body;
  // Cost of goods (optional). Null means "not costed" — costing then skips this
  // product honestly rather than guessing (see costing.js cost_basis).
  if (cost !== undefined && cost !== null && !(Number(cost) >= 0)) {
    return res.status(400).json({ error: 'Validation failed', details: ['cost must be a non-negative number or null'] });
  }
  const costValue = cost === undefined || cost === '' ? null : (cost === null ? null : Number(cost));
  // SKU: a valid custom code wins; otherwise the deterministic system code is
  // assigned on create, so every product is QR-addressable from birth.
  let skuValue = null;
  if (sku !== undefined && sku !== null && String(sku).trim() !== '') {
    const candidate = String(sku).trim().toUpperCase();
    if (!isSkuShape(candidate)) {
      return res.status(400).json({ error: 'Validation failed', details: ['sku must be 3-32 characters: letters, numbers and dashes only'] });
    }
    if (db.prepare('SELECT id FROM products WHERE sku = ?').get(candidate)) {
      return res.status(409).json({ error: 'Validation failed', details: ['A product with this SKU already exists'] });
    }
    skuValue = candidate;
  }
  const info = db.prepare('INSERT INTO products (sku, name, category, brand, description, size, unit, price, cost, status, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(skuValue, sanitizeObject(name), sanitizeObject(category), sanitizeObject(brand || ''), sanitizeObject(description || ''), sanitizeObject(size || ''), sanitizeObject(unit || 'pcs'), price, costValue, status || 'active', image || null);
  const newId = Number(info.lastInsertRowid);
  if (skuValue === null) {
    db.prepare('UPDATE products SET sku = ? WHERE id = ?').run(skuForProductId(newId), newId);
  }
  res.status(201).json({ id: newId });
});

// PUT /api/products/:id
router.put('/:id', authenticateToken, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const { name, category, brand, description, size, unit, price, cost, status, image, sku } = req.body;
  // Optional custom SKU on update: same validation as create. An absent/blank
  // value leaves the existing SKU untouched (labels must stay valid).
  let skuValue;
  if (sku !== undefined && sku !== null) {
    if (String(sku).trim() === '') {
      return res.status(400).json({ error: 'Validation failed', details: ['sku cannot be cleared — reprint the tag instead'] });
    }
    const candidate = String(sku).trim().toUpperCase();
    if (!isSkuShape(candidate)) {
      return res.status(400).json({ error: 'Validation failed', details: ['sku must be 3-32 characters: letters, numbers and dashes only'] });
    }
    const clash = db.prepare('SELECT id FROM products WHERE sku = ?').get(candidate);
    if (clash && Number(clash.id) !== Number(req.params.id)) {
      return res.status(409).json({ error: 'Validation failed', details: ['A product with this SKU already exists'] });
    }
    skuValue = candidate;
  }
  // Cost is a full-replace field like price (this PUT nulls every unspecified
  // column), so `cost: null` deliberately clears it back to "not costed".
  if (cost !== undefined && cost !== null && !(Number(cost) >= 0)) {
    return res.status(400).json({ error: 'Validation failed', details: ['cost must be a non-negative number or null'] });
  }
  const costValue = cost === undefined || cost === '' ? null : (cost === null ? null : Number(cost));
  db.prepare('UPDATE products SET name=?, category=?, brand=?, description=?, size=?, unit=?, price=?, cost=?, status=?, image=?, sku=COALESCE(?, sku), updated_at=datetime(\'now\') WHERE id=?')
    .run(sanitizeObject(name), sanitizeObject(category), sanitizeObject(brand), sanitizeObject(description), sanitizeObject(size), sanitizeObject(unit), price, costValue, status, image || null, skuValue === undefined ? null : skuValue, req.params.id);
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
  const touched = [];
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
    // Named, not just counted. Pricing is what every downstream margin
    // statement is computed from, so a bulk reprice has to leave the same
    // trace the cost sheet already did. Capped so a 2000-row sheet cannot blow
    // up the audit row.
    if (touched.length < 25) {
      const existing = db.prepare('SELECT name FROM products WHERE id = ?').get(row.id);
      touched.push(existing ? existing.name : `id ${row.id}`);
    }
  }

  if (updated > 0) {
    audit('product.price.bulk_update', {
      actor: req.user.username,
      actorRole: req.user.role,
      updated,
      total: prices.length,
      skipped: skipped.length,
      products: touched,
    });
  }

  res.json({ ok: true, total: prices.length, updated, skipped });
});

// POST /api/products/bulk-costs
//
// The cost-of-goods counterpart to /bulk-prices: sets unit cost on many
// products in one request, which is how a 205-row catalog gets costed at
// all. Admin-only and audited, because `cost` is the one field that decides
// whether the business is profitable and it is stripped from every public
// read (see product-visibility.js).
router.post('/bulk-costs', authenticateToken, adminOnly, (req, res) => {
  const { costs } = req.body || {};
  if (!Array.isArray(costs)) return res.status(400).json({ error: 'Validation failed', details: ['costs must be an array of { name, cost } entries'] });
  if (costs.length === 0) return res.status(400).json({ error: 'Validation failed', details: ['costs must not be empty'] });
  if (costs.length > MAX_BULK_COSTS) return res.status(400).json({ error: 'Validation failed', details: [`costs must not exceed ${MAX_BULK_COSTS} entries`] });

  const skipped = [];
  const stmtUpdate = db.prepare('UPDATE products SET cost = ?, updated_at = datetime(\'now\') WHERE id = ?');
  const stmtById = db.prepare('SELECT id FROM products WHERE id = ?');
  const stmtByName = db.prepare('SELECT id FROM products WHERE TRIM(LOWER(name)) = LOWER(?)');

  let updated = 0;
  let cleared = 0;
  const touched = [];
  for (const entry of costs) {
    const name = entry && typeof entry.name === 'string' ? entry.name.trim() : null;
    const parsed = parseCostEntry(entry);

    if (parsed.skip) {
      skipped.push({ name: name || '(unnamed)', reason: 'no cost given' });
      continue;
    }
    if (parsed.error) {
      skipped.push({ name: name || '(unnamed)', reason: parsed.error });
      continue;
    }
    if (name && name.length > 200) {
      skipped.push({ name: name.slice(0, 60) + '…', reason: 'name too long' });
      continue;
    }

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
    if (parsed.clear) {
      stmtUpdate.run(null, row.id);
      cleared++;
    } else {
      stmtUpdate.run(parsed.value, row.id);
      updated++;
    }
    // Named in the audit event, not just counted: a change log that says
    // "3 costs updated" without saying which three is not a change log. Capped
    // so a 2000-row sheet cannot blow up the audit row.
    if (touched.length < 25) {
      const existing = db.prepare('SELECT name FROM products WHERE id = ?').get(row.id);
      touched.push(existing ? existing.name : `id ${row.id}`);
    }
  }

  if (updated > 0 || cleared > 0) {
    audit('product.cost.bulk_update', {
      actor: req.user.username,
      actorRole: req.user.role,
      updated,
      cleared,
      total: costs.length,
      skipped: skipped.length,
      products: touched,
    });
  }

  res.json({ ok: true, total: costs.length, updated, cleared, skipped });
});

module.exports = router;
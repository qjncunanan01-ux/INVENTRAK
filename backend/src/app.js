const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const dataDir = path.join(__dirname, '..', 'data');
const productsFile = path.join(dataDir, 'products.json');

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function seedDatabase() {
  const existing = db.prepare('SELECT COUNT(*) as count FROM products').get();
  if (existing.count > 0) return;
  const products = readJSON(productsFile) || [];
  if (!products.length) return;

  const insertProduct = db.prepare('INSERT INTO products (name, category, brand, description, size, unit, price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const getLocation = db.prepare('SELECT id FROM locations WHERE name = ?');
  const insertLocation = db.prepare('INSERT INTO locations (name) VALUES (?)');
  const insertStock = db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)');
  const insertLot = db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)');

  const locations = ['Showroom', 'Stockroom 1', 'Stockroom 2'];
  db.transaction(() => {
    for (const name of locations) {
      if (!getLocation.get(name)) insertLocation.run(name);
    }

    for (const p of products) {
      const result = insertProduct.run(
        p['Product Name'] || p.name,
        p['Category'] || p.category,
        p['Brand'] || p.brand || '',
        p['Description'] || '',
        p['Size'] || p.size || '',
        p['Unit'] || p.unit || 'pcs',
        p['Price'] || p.price || 0,
        'active'
      );
      const pid = result.lastInsertRowid;
      for (const name of locations) {
        const locId = getLocation.get(name).id;
        const qty = Math.floor(Math.random() * 160) + 20;
        insertStock.run(pid, locId, qty);
        insertLot.run(pid, locId, qty, new Date().toISOString());
      }
    }
  })();
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post('/api/auth/login', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  res.json({ token: 'demo-token', user: { username, role: 'admin' } });
});

app.get('/api/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products WHERE status = ?').all('active');
  res.json(rows);
});

app.get('/api/products/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Product not found' });
  res.json(row);
});

app.post('/api/products', (req, res) => {
  const { name, category, brand, description, size, unit, price, status } = req.body;
  const stmt = db.prepare('INSERT INTO products (name, category, brand, description, size, unit, price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const info = stmt.run(name, category, brand, description, size, unit, price, status || 'active');
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/products/:id', (req, res) => {
  const { name, category, brand, description, size, unit, price, status } = req.body;
  db.prepare('UPDATE products SET name=?, category=?, brand=?, description=?, size=?, unit=?, price=?, status=? WHERE id=?')
    .run(name, category, brand, description, size, unit, price, status, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/products/:id', (req, res) => {
  db.prepare('UPDATE products SET status = ? WHERE id = ?').run('inactive', req.params.id);
  res.json({ ok: true });
});

app.get('/api/inventory', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE status = ?').all('active');
  const locations = db.prepare('SELECT * FROM locations').all();
  const out = products.map(p => {
    const stocks = db.prepare('SELECT l.name, s.quantity FROM stock s JOIN locations l ON s.location_id = l.id WHERE s.product_id = ?').all(p.id);
    const total = stocks.reduce((acc, item) => acc + item.quantity, 0);
    const detail = {};
    stocks.forEach(s => { detail[s.name] = s.quantity; });
    return { product: p, locations: detail, total };
  });
  res.json({ locations, items: out });
});

function resolveLocation(value) {
  if (!value && value !== 0) return null;
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && Number.isInteger(numeric)) {
    return numeric;
  }
  const row = db.prepare('SELECT id FROM locations WHERE name = ?').get(value);
  return row ? row.id : null;
}

function consumeStockLots(productId, locationId, quantity) {
  let remaining = quantity;
  const lots = db.prepare('SELECT id, qty FROM stock_lots WHERE product_id = ? AND location_id = ? ORDER BY received_at ASC').all(productId, locationId);
  for (const lot of lots) {
    if (remaining <= 0) break;
    const consume = Math.min(lot.qty, remaining);
    db.prepare('UPDATE stock_lots SET qty = qty - ? WHERE id = ?').run(consume, lot.id);
    remaining -= consume;
  }
  if (remaining > 0) {
    db.prepare('UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?').run(remaining, productId, locationId);
  }
}

app.post('/api/stock-movement', (req, res) => {
  const { product_id, qty, type, src_location, dst_location, notes, user } = req.body;
  const now = new Date().toISOString();
  const srcId = resolveLocation(src_location);
  const dstId = resolveLocation(dst_location);

  db.prepare('INSERT INTO stock_movements (product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(product_id, qty, type, srcId || null, dstId || null, notes || '', now, user || 'system');

  const ensureStockRow = db.prepare('INSERT OR IGNORE INTO stock (product_id, location_id, quantity) VALUES (?, ?, 0)');
  if (srcId) ensureStockRow.run(product_id, srcId);
  if (dstId) ensureStockRow.run(product_id, dstId);

  if (type === 'stock-in' && dstId) {
    db.prepare('UPDATE stock SET quantity = quantity + ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, dstId);
    db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)').run(product_id, dstId, qty, now);
  } else if (type === 'stock-out' && srcId) {
    consumeStockLots(product_id, srcId, qty);
    db.prepare('UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, srcId);
  } else if (type === 'transfer' && srcId && dstId) {
    consumeStockLots(product_id, srcId, qty);
    db.prepare('UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, srcId);
    db.prepare('UPDATE stock SET quantity = quantity + ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, dstId);
    db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)').run(product_id, dstId, qty, now);
  } else if (type === 'adjustment' && (srcId || dstId)) {
    const loc = dstId || srcId;
    db.prepare('UPDATE stock SET quantity = ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, loc);
  }
  res.json({ ok: true });
});

app.get('/api/stock-movements', (req, res) => {
  const rows = db.prepare('SELECT * FROM stock_movements ORDER BY created_at DESC').all();
  res.json(rows);
});

app.get('/api/stock-lots', (req, res) => {
  const rows = db.prepare('SELECT sl.id, sl.product_id, sl.location_id, sl.qty, sl.received_at, p.name as product_name, l.name as location_name FROM stock_lots sl JOIN products p ON sl.product_id = p.id JOIN locations l ON sl.location_id = l.id ORDER BY sl.received_at ASC').all();
  res.json(rows);
});

app.get('/api/locations', (req, res) => {
  const rows = db.prepare('SELECT id, name FROM locations ORDER BY id').all();
  res.json(rows);
});

app.post('/api/locations', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Location name is required' });
  const info = db.prepare('INSERT INTO locations (name) VALUES (?)').run(name);
  res.json({ id: info.lastInsertRowid, name });
});

app.delete('/api/locations/:id', (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/optimization/:productId', (req, res) => {
  const pid = req.params.productId;
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
  if (!product) return res.status(404).json({ error: 'product not found' });
  const annualDemand = 1000;
  const orderingCost = 50;
  const holdingCostRate = 0.2;
  const C = product.price || 1;
  const H = holdingCostRate * C;
  const D = annualDemand;
  const S = orderingCost;
  const EOQ = Math.sqrt((2 * D * S) / H);
  const leadTimeDays = 7;
  const dailyDemand = D / 365;
  const ROP = Math.ceil(dailyDemand * leadTimeDays);
  const safetyStock = Math.ceil(Math.sqrt(D) * 0.1);
  res.json({ EOQ: Math.round(EOQ), ROP, safetyStock });
});

app.get('/api/optimization/abc', (req, res) => {
  const products = db.prepare('SELECT id, name, price FROM products WHERE status = ?').all('active');
  const arr = products.map((p, idx) => ({ id: p.id, name: p.name, value: ((idx + 1) * 10) * p.price }));
  arr.sort((a, b) => b.value - a.value);
  const total = arr.reduce((sum, item) => sum + item.value, 0);
  let cum = 0;
  const result = arr.map(item => {
    cum += item.value;
    const pct = (cum / total) * 100;
    let classification = 'C';
    if (pct <= 70) classification = 'A';
    else if (pct <= 90) classification = 'B';
    return { ...item, classification };
  });
  res.json(result);
});

app.get('/api/order-inquiries', (req, res) => {
  const rows = db.prepare('SELECT * FROM order_inquiries ORDER BY created_at DESC').all();
  res.json(rows);
});

app.put('/api/order-inquiries/:id', (req, res) => {
  const { status } = req.body;
  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });
  const updatedStatus = status || existing.status;
  db.prepare('UPDATE order_inquiries SET status = ? WHERE id = ?').run(updatedStatus, req.params.id);
  res.json({ ok: true });
});

app.post('/api/order-inquiries', (req, res) => {
  const { customer_name, customer_email, products, estimated_cost, notes } = req.body;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO order_inquiries (customer_name, customer_email, products, estimated_cost, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(customer_name, customer_email, JSON.stringify(products), estimated_cost, notes, 'pending', now);
  res.json({ ok: true });
});

module.exports = { app, seedDatabase };

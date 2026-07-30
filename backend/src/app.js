const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'inventrak-secret-key-2024';
const dataDir = path.join(__dirname, '..', 'data');
const productsFile = path.join(dataDir, 'products.json');

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// --- Auth Middleware ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// --- Validation Helpers ---
function validate(schema) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
      }
      if (value !== undefined && value !== null && value !== '') {
        if (rules.type === 'number' && isNaN(Number(value))) {
          errors.push(`${field} must be a number`);
        }
        if (rules.min !== undefined && Number(value) < rules.min) {
          errors.push(`${field} must be at least ${rules.min}`);
        }
        if (rules.maxLength && String(value).length > rules.maxLength) {
          errors.push(`${field} must be at most ${rules.maxLength} characters`);
        }
      }
    }
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    next();
  };
}

// --- Seed Database ---
function seedDatabase() {
  const existing = db.prepare('SELECT COUNT(*) as count FROM products').get();
  if (existing.count > 0) return;

  // Seed default admin user
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hashedPw = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)').run('admin', hashedPw, 'admin', 'admin@inventrak.com');
  }

  // Seed demo customer
  const custExists = db.prepare('SELECT id FROM users WHERE username = ?').get('customer');
  if (!custExists) {
    const hashedPw = bcrypt.hashSync('customer123', 10);
    db.prepare('INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)').run('customer', hashedPw, 'customer', 'customer@example.com');
  }

  const products = readJSON(productsFile) || [];
  if (!products.length) return;

  const insertProduct = db.prepare('INSERT INTO products (name, category, brand, description, size, unit, price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const getLocation = db.prepare('SELECT id FROM locations WHERE name = ?');
  const insertLocation = db.prepare('INSERT INTO locations (name) VALUES (?)');
  const insertStock = db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)');
  const insertLot = db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)');
  const insertSales = db.prepare('INSERT INTO sales_transactions (product_id, qty, unit_price, total_amount, transaction_date, customer_name) VALUES (?, ?, ?, ?, ?, ?)');

  const locations = ['Showroom', 'Stockroom 1', 'Stockroom 2'];
  const customers = ['Juan Dela Cruz', 'Maria Santos', 'Jose Rizal'];

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

      // Seed sales data for demand calculation (last 90 days)
      const price = p['Price'] || p.price || 1;
      for (const cust of customers) {
        const saleQty = Math.floor(Math.random() * 15) + 1;
        const daysAgo = Math.floor(Math.random() * 90);
        const date = new Date(Date.now() - daysAgo * 86400000).toISOString();
        insertSales.run(pid, saleQty, price, saleQty * price, date, cust);
      }
    }
  })();
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ================= AUTH ROUTES =================

app.post('/api/auth/register', validate({
  username: { required: true, maxLength: 50 },
  password: { required: true, min: 6, maxLength: 100 },
  email: { required: true, maxLength: 100 }
}), (req, res) => {
  const { username, password, email } = req.body;
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already exists' });

  const hashedPw = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)').run(username, hashedPw, 'customer', email);
  const token = jwt.sign({ id: result.lastInsertRowid, username, role: 'customer' }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: result.lastInsertRowid, username, role: 'customer', email } });
});

app.post('/api/auth/login', validate({
  username: { required: true },
  password: { required: true }
}), (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, email: user.email } });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT id, username, role, email, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ================= PRODUCT ROUTES =================

app.get('/api/products', (req, res) => {
  const { page = 1, limit = 50, search, category, status = 'active' } = req.query;
  const pageNum = Math.max(1, parseInt(page));
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

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM products ${where}`).get(...params);
  const rows = db.prepare(`SELECT * FROM products ${where} ORDER BY name ASC LIMIT ? OFFSET ?`).all(...params, limitNum, offset);

  res.json({
    data: rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: countRow.total,
      totalPages: Math.ceil(countRow.total / limitNum)
    }
  });
});

app.get('/api/products/categories', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT category FROM products WHERE status = ? ORDER BY category').all('active');
  res.json(rows.map(r => r.category));
});

app.get('/api/products/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Product not found' });
  res.json(row);
});

app.post('/api/products', authenticateToken, adminOnly, validate({
  name: { required: true, maxLength: 200 },
  category: { required: true, maxLength: 100 },
  price: { required: true, type: 'number', min: 0 }
}), (req, res) => {
  const { name, category, brand, description, size, unit, price, status } = req.body;
  const stmt = db.prepare('INSERT INTO products (name, category, brand, description, size, unit, price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const info = stmt.run(name, category, brand || '', description || '', size || '', unit || 'pcs', price, status || 'active');
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/products/:id', authenticateToken, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const { name, category, brand, description, size, unit, price, status } = req.body;
  db.prepare('UPDATE products SET name=?, category=?, brand=?, description=?, size=?, unit=?, price=?, status=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(name, category, brand, description, size, unit, price, status, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/products/:id', authenticateToken, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  db.prepare('UPDATE products SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run('inactive', req.params.id);
  res.json({ ok: true, message: 'Product deactivated' });
});

// ================= INVENTORY ROUTES =================

app.get('/api/inventory', (req, res) => {
  const { location, low_stock } = req.query;
  const products = db.prepare('SELECT * FROM products WHERE status = ?').all('active');
  const locations = db.prepare('SELECT * FROM locations').all();

  let items = products.map(p => {
    let stocks;
    if (location) {
      const locId = resolveLocation(location);
      stocks = db.prepare('SELECT l.name, s.quantity FROM stock s JOIN locations l ON s.location_id = l.id WHERE s.product_id = ? AND s.location_id = ?').all(p.id, locId);
    } else {
      stocks = db.prepare('SELECT l.name, s.quantity FROM stock s JOIN locations l ON s.location_id = l.id WHERE s.product_id = ?').all(p.id);
    }
    const total = stocks.reduce((acc, item) => acc + item.quantity, 0);
    const detail = {};
    stocks.forEach(s => { detail[s.name] = s.quantity; });
    return { product: p, locations: detail, total };
  });

  if (low_stock === 'true') {
    items = items.filter(item => item.total < 80);
  }

  res.json({ locations, items });
});

// ================= STOCK MOVEMENT ROUTES =================

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
  const lots = db.prepare('SELECT id, qty FROM stock_lots WHERE product_id = ? AND location_id = ? AND qty > 0 ORDER BY received_at ASC').all(productId, locationId);
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

app.post('/api/stock-movement', authenticateToken, validate({
  product_id: { required: true, type: 'number', min: 1 },
  qty: { required: true, type: 'number', min: 0.01 },
  type: { required: true, maxLength: 20 }
}), (req, res) => {
  const { product_id, qty, type, src_location, dst_location, notes, user } = req.body;
  const validTypes = ['stock-in', 'stock-out', 'transfer', 'adjustment'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
  }

  const product = db.prepare('SELECT id FROM products WHERE id = ? AND status = ?').get(product_id, 'active');
  if (!product) return res.status(404).json({ error: 'Product not found or inactive' });

  const now = new Date().toISOString();
  const srcId = resolveLocation(src_location);
  const dstId = resolveLocation(dst_location);

  db.prepare('INSERT INTO stock_movements (product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(product_id, qty, type, srcId || null, dstId || null, notes || '', now, user || req.user?.username || 'system');

  const ensureStockRow = db.prepare('INSERT OR IGNORE INTO stock (product_id, location_id, quantity) VALUES (?, ?, 0)');
  if (srcId) ensureStockRow.run(product_id, srcId);
  if (dstId) ensureStockRow.run(product_id, dstId);

  if (type === 'stock-in' && dstId) {
    db.prepare('UPDATE stock SET quantity = quantity + ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, dstId);
    db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)').run(product_id, dstId, qty, now);
  } else if (type === 'stock-out' && srcId) {
    const currentStock = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(product_id, srcId);
    if (!currentStock || currentStock.quantity < qty) {
      return res.status(400).json({ error: 'Insufficient stock at source location' });
    }
    consumeStockLots(product_id, srcId, qty);
    db.prepare('UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, srcId);
  } else if (type === 'transfer' && srcId && dstId) {
    const currentStock = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(product_id, srcId);
    if (!currentStock || currentStock.quantity < qty) {
      return res.status(400).json({ error: 'Insufficient stock at source location' });
    }
    consumeStockLots(product_id, srcId, qty);
    db.prepare('UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, srcId);
    db.prepare('UPDATE stock SET quantity = quantity + ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, dstId);
    db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)').run(product_id, dstId, qty, now);
  } else if (type === 'adjustment' && (srcId || dstId)) {
    const loc = dstId || srcId;
    db.prepare('UPDATE stock SET quantity = ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, loc);
  }

  // Check and create low stock alerts
  const threshold = 80;
  if (srcId) {
    const updated = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(product_id, srcId);
    if (updated && updated.quantity < threshold) {
      const existingAlert = db.prepare('SELECT id FROM inventory_alerts WHERE product_id = ? AND location_id = ? AND alert_type = ? AND status = ?')
        .get(product_id, srcId, 'low_stock', 'active');
      if (!existingAlert) {
        db.prepare('INSERT INTO inventory_alerts (product_id, location_id, alert_type, threshold, current_qty, status) VALUES (?, ?, ?, ?, ?, ?)')
          .run(product_id, srcId, 'low_stock', threshold, updated.quantity, 'active');
      } else {
        db.prepare('UPDATE inventory_alerts SET current_qty = ? WHERE id = ?').run(updated.quantity, existingAlert.id);
      }
    }
  }

  res.json({ ok: true, message: `Stock ${type} recorded successfully` });
});

app.get('/api/stock-movements', (req, res) => {
  const { page = 1, limit = 50, type, product_id } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  let where = 'WHERE 1=1';
  const params = [];
  if (type) { where += ' AND type = ?'; params.push(type); }
  if (product_id) { where += ' AND product_id = ?'; params.push(product_id); }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM stock_movements ${where}`).get(...params);
  const rows = db.prepare(`SELECT * FROM stock_movements ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limitNum, offset);

  res.json({
    data: rows,
    pagination: { page: pageNum, limit: limitNum, total: countRow.total, totalPages: Math.ceil(countRow.total / limitNum) }
  });
});

app.get('/api/stock-lots', (req, res) => {
  const { product_id, location_id } = req.query;
  let query = `SELECT sl.id, sl.product_id, sl.location_id, sl.qty, sl.received_at, p.name as product_name, l.name as location_name FROM stock_lots sl JOIN products p ON sl.product_id = p.id JOIN locations l ON sl.location_id = l.id WHERE sl.qty > 0`;
  const params = [];
  if (product_id) { query += ' AND sl.product_id = ?'; params.push(product_id); }
  if (location_id) { query += ' AND sl.location_id = ?'; params.push(location_id); }
  query += ' ORDER BY sl.received_at ASC';
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// ================= LOCATION ROUTES =================

app.get('/api/locations', (req, res) => {
  const rows = db.prepare('SELECT id, name FROM locations ORDER BY id').all();
  res.json(rows);
});

app.post('/api/locations', authenticateToken, adminOnly, validate({
  name: { required: true, maxLength: 100 }
}), (req, res) => {
  const { name } = req.body;
  const existing = db.prepare('SELECT id FROM locations WHERE name = ?').get(name);
  if (existing) return res.status(409).json({ error: 'Location already exists' });

  const info = db.prepare('INSERT INTO locations (name) VALUES (?)').run(name);
  res.status(201).json({ id: info.lastInsertRowid, name });
});

app.delete('/api/locations/:id', authenticateToken, adminOnly, (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT id FROM locations WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Location not found' });

  const stockCount = db.prepare('SELECT COUNT(*) as count FROM stock WHERE location_id = ? AND quantity > 0').get(id);
  if (stockCount.count > 0) {
    return res.status(400).json({ error: 'Cannot delete location with existing stock. Transfer stock first.' });
  }

  db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  res.json({ ok: true, message: 'Location deleted' });
});

// ================= OPTIMIZATION ROUTES =================

app.get('/api/optimization/:productId', (req, res) => {
  const pid = req.params.productId;

  if (pid === 'abc') {
    const products = db.prepare('SELECT id, name, price FROM products WHERE status = ?').all('active');
    // Get real sales data for demand-based ABC
    const salesData = db.prepare(`SELECT product_id, SUM(qty) as total_qty, SUM(total_amount) as total_value FROM sales_transactions GROUP BY product_id`).all();
    const salesMap = {};
    salesData.forEach(s => { salesMap[s.product_id] = { qty: s.total_qty, value: s.total_value }; });

    const arr = products.map(p => {
      const sales = salesMap[p.id] || { qty: 0, value: 0 };
      // Use sales value if available, otherwise fallback to price-based
      const annualValue = sales.value > 0 ? sales.value : ((p.price || 1) * 12);
      return { id: p.id, name: p.name, value: annualValue, annualQty: sales.qty };
    });
    arr.sort((a, b) => b.value - a.value);
    const total = arr.reduce((sum, item) => sum + item.value, 0);
    let cum = 0;
    const result = arr.map(item => {
      cum += item.value;
      const pct = total > 0 ? (cum / total) * 100 : 0;
      let classification = 'C';
      if (pct <= 70) classification = 'A';
      else if (pct <= 90) classification = 'B';
      return { ...item, classification };
    });
    return res.json(result);
  }

  // Single product optimization
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  // Get real sales data
  const salesData = db.prepare('SELECT SUM(qty) as total_qty FROM sales_transactions WHERE product_id = ?').get(pid);
  const annualDemand = salesData?.total_qty > 0 ? salesData.total_qty : 1000;

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

  // Inventory turnover
  const currentStock = db.prepare('SELECT SUM(quantity) as total FROM stock WHERE product_id = ?').get(pid);
  const avgInventory = currentStock?.total || 1;
  const turnover = annualDemand / avgInventory;

  res.json({
    EOQ: Math.round(EOQ),
    ROP,
    safetyStock,
    annualDemand,
    turnoverRatio: Math.round(turnover * 100) / 100,
    avgInventory: Math.round(avgInventory)
  });
});

app.get('/api/optimization', (req, res) => {
  const products = db.prepare('SELECT id, name, price FROM products WHERE status = ?').all('active');
  const results = products.map(p => {
    const salesData = db.prepare('SELECT SUM(qty) as total_qty FROM sales_transactions WHERE product_id = ?').get(p.id);
    const annualDemand = salesData?.total_qty > 0 ? salesData.total_qty : 100;
    const C = p.price || 1;
    const H = 0.2 * C;
    const EOQ = Math.sqrt((2 * annualDemand * 50) / H);
    const currentStock = db.prepare('SELECT SUM(quantity) as total FROM stock WHERE product_id = ?').get(p.id);
    const avgInv = currentStock?.total || 1;
    return {
      productId: p.id,
      productName: p.name,
      eoq: Math.round(EOQ),
      annualDemand,
      turnoverRatio: Math.round((annualDemand / avgInv) * 100) / 100
    };
  });
  res.json(results);
});

// ================= ORDER INQUIRY ROUTES =================

app.get('/api/order-inquiries', (req, res) => {
  const { page = 1, limit = 50, status } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  let where = 'WHERE 1=1';
  const params = [];
  if (status) { where += ' AND status = ?'; params.push(status); }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM order_inquiries ${where}`).get(...params);
  const rows = db.prepare(`SELECT * FROM order_inquiries ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limitNum, offset);

  res.json({
    data: rows,
    pagination: { page: pageNum, limit: limitNum, total: countRow.total, totalPages: Math.ceil(countRow.total / limitNum) }
  });
});

app.put('/api/order-inquiries/:id', authenticateToken, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'approved', 'rejected', 'fulfilled'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });

  const updatedStatus = status || existing.status;
  db.prepare('UPDATE order_inquiries SET status = ? WHERE id = ?').run(updatedStatus, req.params.id);
  res.json({ ok: true, message: `Inquiry ${updatedStatus}` });
});

app.post('/api/order-inquiries', validate({
  customer_name: { required: true, maxLength: 100 },
  customer_email: { required: true, maxLength: 100 }
}), (req, res) => {
  const { customer_name, customer_email, products, estimated_cost, notes } = req.body;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO order_inquiries (customer_name, customer_email, products, estimated_cost, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(customer_name, customer_email, JSON.stringify(products || []), estimated_cost || 0, notes || '', 'pending', now);
  res.status(201).json({ ok: true, message: 'Inquiry submitted' });
});

// ================= ANALYTICS/REPORT ROUTES =================

app.get('/api/analytics/summary', (req, res) => {
  const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE status = ?').get('active').count;
  const totalStock = db.prepare('SELECT SUM(quantity) as total FROM stock').get().total || 0;
  const lowStockItems = db.prepare('SELECT COUNT(*) as count FROM stock WHERE quantity < 80').get().count;
  const totalLocations = db.prepare('SELECT COUNT(*) as count FROM locations').get().count;
  const pendingInquiries = db.prepare("SELECT COUNT(*) as count FROM order_inquiries WHERE status = 'pending'").get().count;
  const totalSales = db.prepare('SELECT SUM(total_amount) as total FROM sales_transactions').get().total || 0;
  const totalMovements = db.prepare('SELECT COUNT(*) as count FROM stock_movements').get().count;
  const activeAlerts = db.prepare("SELECT COUNT(*) as count FROM inventory_alerts WHERE status = 'active'").get().count;

  // Top 5 products by stock value
  const topProducts = db.prepare(`
    SELECT p.id, p.name, SUM(s.quantity * p.price) as stock_value
    FROM stock s JOIN products p ON s.product_id = p.id
    WHERE p.status = 'active'
    GROUP BY p.id
    ORDER BY stock_value DESC
    LIMIT 5
  `).all();

  // Monthly stock movement counts
  const monthlyMovements = db.prepare(`
    SELECT strftime('%Y-%m', created_at) as month, type, COUNT(*) as count
    FROM stock_movements
    GROUP BY month, type
    ORDER BY month DESC
    LIMIT 12
  `).all();

  res.json({
    totalProducts,
    totalStock,
    lowStockItems,
    totalLocations,
    pendingInquiries,
    totalSales,
    totalMovements,
    activeAlerts,
    topProducts,
    monthlyMovements
  });
});

app.get('/api/analytics/export/:type', authenticateToken, adminOnly, (req, res) => {
  const { type } = req.params;
  const format = req.query.format || 'json';

  let data;
  switch (type) {
    case 'products':
      data = db.prepare('SELECT * FROM products WHERE status = ?').all('active');
      break;
    case 'inventory':
      data = db.prepare('SELECT p.name as product, l.name as location, s.quantity FROM stock s JOIN products p ON s.product_id = p.id JOIN locations l ON s.location_id = l.id WHERE p.status = ? ORDER BY p.name, l.name').all('active');
      break;
    case 'movements':
      data = db.prepare('SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 1000').all();
      break;
    default:
      return res.status(404).json({ error: 'Export type not found. Use: products, inventory, movements' });
  }

  if (format === 'csv') {
    const headers = Object.keys(data[0] || {}).join(',');
    const rows = data.map(row => Object.values(row).map(v => `"${v}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${type}-${Date.now()}.csv`);
    return res.send(`${headers}\n${rows}`);
  }

  res.json(data);
});

// ================= ALERT ROUTES =================

app.get('/api/alerts', authenticateToken, (req, res) => {
  const { status = 'active' } = req.query;
  const rows = db.prepare(`
    SELECT a.*, p.name as product_name, l.name as location_name
    FROM inventory_alerts a
    JOIN products p ON a.product_id = p.id
    JOIN locations l ON a.location_id = l.id
    WHERE a.status = ?
    ORDER BY a.created_at DESC
  `).all(status);
  res.json(rows);
});

app.put('/api/alerts/:id/resolve', authenticateToken, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT id FROM inventory_alerts WHERE id = ? AND status = ?').get(req.params.id, 'active');
  if (!existing) return res.status(404).json({ error: 'Alert not found or already resolved' });

  db.prepare("UPDATE inventory_alerts SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true, message: 'Alert resolved' });
});

// ================= SALES TRANSACTION ROUTES =================

app.post('/api/sales', authenticateToken, validate({
  product_id: { required: true, type: 'number', min: 1 },
  qty: { required: true, type: 'number', min: 0.01 }
}), (req, res) => {
  const { product_id, qty, customer_name } = req.body;
  const product = db.prepare('SELECT id, price FROM products WHERE id = ? AND status = ?').get(product_id, 'active');
  if (!product) return res.status(404).json({ error: 'Product not found or inactive' });

  const total = qty * product.price;
  db.prepare('INSERT INTO sales_transactions (product_id, qty, unit_price, total_amount, customer_name) VALUES (?, ?, ?, ?, ?)')
    .run(product_id, qty, product.price, total, customer_name || req.user?.username || 'anonymous');
  res.status(201).json({ ok: true, total });
});

app.get('/api/sales', authenticateToken, (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  const countRow = db.prepare('SELECT COUNT(*) as total FROM sales_transactions').get();
  const rows = db.prepare(`
    SELECT s.*, p.name as product_name
    FROM sales_transactions s
    JOIN products p ON s.product_id = p.id
    ORDER BY s.transaction_date DESC
    LIMIT ? OFFSET ?
  `).all(limitNum, offset);

  res.json({
    data: rows,
    pagination: { page: pageNum, limit: limitNum, total: countRow.total, totalPages: Math.ceil(countRow.total / limitNum) }
  });
});

// ================= USER MANAGEMENT =================

app.get('/api/users', authenticateToken, adminOnly, (req, res) => {
  const users = db.prepare('SELECT id, username, role, email, created_at FROM users ORDER BY id').all();
  res.json(users);
});

module.exports = { app, seedDatabase };

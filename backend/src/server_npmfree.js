const http = require('http');
const fs = require('fs');
const path = require('path');

// Allow tests to point the fallback at an isolated data directory.
const dataDir = process.env.INVENTRAK_DATA_DIR || path.join(__dirname, '..', 'data');
const productsFile = path.join(dataDir, 'products.json');
const inventoryFile = path.join(dataDir, 'inventory.json');
const movementsFile = path.join(dataDir, 'stock_movements.json');
const orderFile = path.join(dataDir, 'order_inquiries.json');
const openapiFile = path.join(__dirname, '..', 'openapi.json');

// In-memory stores (npm-free fallback keeps no persistent users/sales DB)
let users = [
  { id: 1, username: 'admin', password: 'admin123', role: 'admin', email: 'admin@inventrak.com', created_at: new Date().toISOString() },
  { id: 2, username: 'customer', password: 'customer123', role: 'customer', email: 'customer@example.com', created_at: new Date().toISOString() },
];
let nextUserId = 3;
let salesTransactions = [];
let nextSaleId = 1;

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

if (!fs.existsSync(inventoryFile)) {
  const products = readJSON(productsFile) || [];
  const locs = ['Showroom', 'Stockroom 1', 'Stockroom 2'];
  const items = products.map((p, idx) => {
    const stocks = {};
    let total = 0;
    locs.forEach(l => { const q = Math.floor(Math.random() * 180) + 20; stocks[l] = q; total += q; });
    return {
      product: formatProduct(p, idx),
      locations: stocks,
      total
    };
  });
  writeJSON(inventoryFile, { locations: locs, items });
}

if (!fs.existsSync(movementsFile)) writeJSON(movementsFile, []);
if (!fs.existsSync(orderFile)) writeJSON(orderFile, []);

// Mirrors the SQLite backend: empty/absent seed fields map to '' and an
// explicit null (e.g. a partial PUT that nulls a column) stays null.
function formatProduct(p, idx) {
  const now = new Date().toISOString();
  const pick = (a, b, fallback) => (a !== undefined ? a : (b !== undefined ? b : fallback));
  return {
    id: idx + 1,
    name: pick(p['Product Name'], p.name, ''),
    category: pick(p['Category'], p.category, ''),
    brand: pick(p['Brand'], p.brand, ''),
    description: pick(p['Description'], p.description, ''),
    size: pick(p['Size'], p.size, ''),
    unit: pick(p['Unit'], p.unit, ''),
    // Preserve an explicit null (partial PUT nulls the column) to match SQLite.
    price: pick(p['Price'], p.price, 0),
    status: pick(p['status'], p.status, 'active'),
    created_at: p.created_at || now,
    updated_at: p.updated_at || now
  };
}

// Dynamic demand: actual stock-out usage from movements (TODO 4.1 parity with SQLite backend)
function computeDemand(productId) {
  const movements = readJSON(movementsFile) || [];
  const outQty = movements
    .filter(m => m.product_id === Number(productId) && (m.type === 'stock-out' || m.type === 'transfer'))
    .reduce((sum, m) => sum + (Number(m.qty) || 0), 0);
  return outQty > 0 ? outQty : 100;
}

function getInventory() {
  const inv = readJSON(inventoryFile) || { locations: [], items: [] };
  return inv;
}

// Alerts mirror the SQLite backend: they are created when a movement drops a
// location below the threshold (not auto-derived on every read), and persist
// until resolved.
let alerts = [];
let nextAlertId = 1;

function upsertLowStockAlert(productId, locationId, qty) {
  if (qty >= 80) return;
  const existing = alerts.find(a => a.product_id === Number(productId) && a.location_id === Number(locationId) && a.status === 'active');
  if (existing) {
    existing.current_qty = qty;
    return;
  }
  const inv = getInventory();
  const item = inv.items.find(i => i.product && Number(i.product.id) === Number(productId));
  alerts.push({
    id: nextAlertId++,
    product_id: Number(productId),
    location_id: Number(locationId),
    product_name: (item && item.product && item.product.name) || `Product ${productId}`,
    location_name: inv.locations[Number(locationId) - 1] || 'All',
    alert_type: 'low_stock',
    threshold: 80,
    current_qty: qty,
    status: 'active',
    created_at: new Date().toISOString(),
    resolved_at: null
  });
}

function computeAlerts() {
  return alerts.filter(a => a.status === 'active');
}

function parseBody(req, callback) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try { callback(null, JSON.parse(body || '{}')); }
    catch (err) { callback(err); }
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// --- Demo-token auth (mirrors the SQLite backend's protected routes) ---
function authUser(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return { missing: true };
  if (!token.startsWith('demo-token-')) return { invalid: true };
  const id = Number(token.split('-').pop());
  const user = users.find(u => u.id === id);
  return user ? { user } : { invalid: true };
}

function requireAuth(req, res, adminOnly = false, next) {
  const result = authUser(req);
  if (result.missing) return sendJson(res, 401, { error: 'Access token required' });
  if (result.invalid) return sendJson(res, 403, { error: 'Invalid or expired token' });
  if (adminOnly && result.user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });
  req.user = result.user;
  return next(req, res);
}

const swaggerUiHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>INVENTRAK API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body style="margin:0">
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: '/api/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
      });
    };
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = req.url;
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // ================= API DOCS =================

  if (req.method === 'GET' && url === '/api/openapi.json') {
    const spec = readJSON(openapiFile) || { error: 'openapi.json not found' };
    return sendJson(res, 200, spec);
  }

  if (req.method === 'GET' && url === '/api/docs') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(swaggerUiHtml);
  }

  // ================= AUTH =================

  if (req.method === 'POST' && url === '/api/auth/login') {
    return parseBody(req, (err, obj) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
      if (!obj.username || !obj.password) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['username and password are required'] });
      }
      const user = users.find(u => u.username === obj.username && u.password === obj.password);
      if (!user) return sendJson(res, 401, { error: 'Invalid username or password' });
      return sendJson(res, 200, {
        token: `demo-token-${user.id}`,
        user: { id: user.id, username: user.username, role: user.role, email: user.email }
      });
    });
  }

  if (req.method === 'POST' && url === '/api/auth/register') {
    return parseBody(req, (err, obj) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
      if (!obj.username || !obj.password || !obj.email) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['username, password and email are required'] });
      }
      if (String(obj.password).length < 6) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['password must be at least 6 characters'] });
      }
      if (String(obj.username).length > 50) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['username must be at most 50 characters'] });
      }
      if (users.some(u => u.username === obj.username)) return sendJson(res, 409, { error: 'Username already exists' });
      const user = { id: nextUserId++, username: obj.username, password: obj.password, role: 'customer', email: obj.email, created_at: new Date().toISOString() };
      users.push(user);
      return sendJson(res, 200, {
        token: `demo-token-${user.id}`,
        user: { id: user.id, username: user.username, role: user.role, email: user.email }
      });
    });
  }

  if (req.method === 'GET' && url === '/api/auth/me') {
    return requireAuth(req, res, false, (req, res) => {
      return sendJson(res, 200, { id: req.user.id, username: req.user.username, role: req.user.role, email: req.user.email, created_at: req.user.created_at });
    });
  }

  // ================= PRODUCTS =================

  if (req.method === 'GET' && url.startsWith('/api/products/categories')) {
    const products = readJSON(productsFile) || [];
    const cats = [...new Set(products.map(p => p['Category'] || p.category).filter(Boolean))];
    return sendJson(res, 200, cats);
  }

  if (req.method === 'GET' && (url === '/api/products' || url.startsWith('/api/products?'))) {
    const parsed = new URL(url, 'http://localhost');
    const page = parsed.searchParams.get('page');
    const limit = parsed.searchParams.get('limit');
    const search = parsed.searchParams.get('search');
    const category = parsed.searchParams.get('category');
    const products = readJSON(productsFile) || [];
    let formatted = products.map(formatProduct).filter(p => p.status === 'active');

    if (search) {
      const s = search.toLowerCase();
      formatted = formatted.filter(p => (p.name + ' ' + p.category + ' ' + p.brand).toLowerCase().includes(s));
    }
    if (category) {
      formatted = formatted.filter(p => p.category === category);
    }

    if (page !== null || limit !== null) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const offset = (pageNum - 1) * limitNum;
      return sendJson(res, 200, {
        data: formatted.slice(offset, offset + limitNum),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: formatted.length,
          totalPages: Math.ceil(formatted.length / limitNum)
        }
      });
    }
    return sendJson(res, 200, formatted);
  }

  if (req.method === 'GET' && url.startsWith('/api/products/')) {
    const id = parseInt(url.split('/').pop(), 10);
    const products = readJSON(productsFile) || [];
    if (!products[id - 1]) return sendJson(res, 404, { error: 'Product not found' });
    // Match the SQLite backend: the row is returned regardless of status.
    return sendJson(res, 200, formatProduct(products[id - 1], id - 1));
  }

  if (req.method === 'POST' && url === '/api/products') {
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
        if (!obj.name || !obj.category) return sendJson(res, 400, { error: 'Validation failed', details: ['name and category are required'] });
        const products = readJSON(productsFile) || [];
        const newProduct = {
          'Product Name': obj.name,
          'Category': obj.category,
          'Brand': obj.brand || '',
          'Description': obj.description || '',
          'Size': obj.size || '',
          'Unit': obj.unit || 'pcs',
          'Price': Number(obj.price) || 0,
          'status': 'active'
        };
        products.push(newProduct);
        writeJSON(productsFile, products);
        return sendJson(res, 201, { id: products.length });
      });
    });
  }

  if (req.method === 'PUT' && url.startsWith('/api/products/')) {
    const id = parseInt(url.split('/').pop(), 10);
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
        const products = readJSON(productsFile) || [];
        if (!products[id - 1]) return sendJson(res, 404, { error: 'Product not found' });
        const p = products[id - 1];
        // Mirror the SQLite backend: a partial PUT nulls the unspecified columns.
        p['Product Name'] = obj.name ?? null;
        p['Category'] = obj.category ?? null;
        p['Brand'] = obj.brand ?? null;
        p['Description'] = obj.description ?? null;
        p['Size'] = obj.size ?? null;
        p['Unit'] = obj.unit ?? null;
        p['Price'] = obj.price !== undefined ? Number(obj.price) : null;
        p['status'] = obj.status ?? null;
        writeJSON(productsFile, products);
        return sendJson(res, 200, { ok: true });
      });
    });
  }

  if (req.method === 'DELETE' && url.startsWith('/api/products/')) {
    const id = parseInt(url.split('/').pop(), 10);
    return requireAuth(req, res, true, (req, res) => {
      const products = readJSON(productsFile) || [];
      if (!products[id - 1]) return sendJson(res, 404, { error: 'Product not found' });
      products[id - 1]['status'] = 'inactive';
      writeJSON(productsFile, products);
      return sendJson(res, 200, { ok: true, message: 'Product deactivated' });
    });
  }

  // ================= INVENTORY =================

  if (req.method === 'GET' && url.startsWith('/api/inventory')) {
    const inv = getInventory();
    const parsed = new URL(url, 'http://localhost');
    const lowStock = parsed.searchParams.get('low_stock') === 'true';
    const location = parsed.searchParams.get('location');
    const products = readJSON(productsFile) || [];
    // Match the SQLite backend: every ACTIVE product appears, including ones
    // created after the inventory snapshot (those simply have no stock yet).
    const byId = new Map(inv.items.map(i => [Number(i.product && i.product.id), i]));
    let items = products
      .map((p, idx) => {
        const existing = byId.get(idx + 1);
        return existing || { product: formatProduct(p, idx), locations: {}, total: 0 };
      })
      .filter(item => item.product && item.product.status !== 'inactive');
    if (location) {
      items = items.map(item => ({
        ...item,
        locations: item.locations[location] !== undefined ? { [location]: item.locations[location] } : {},
        total: item.locations[location] || 0
      }));
    }
    if (lowStock) items = items.filter(item => item.total < 80);
    const locations = inv.locations.map((name, index) => ({ id: index + 1, name }));
    return sendJson(res, 200, { locations, items });
  }

  // ================= LOCATIONS =================

  if (req.method === 'GET' && url === '/api/locations') {
    const inv = getInventory();
    return sendJson(res, 200, inv.locations.map((name, index) => ({ id: index + 1, name })));
  }

  if (req.method === 'POST' && url === '/api/locations') {
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
        const inv = getInventory();
        if (!obj.name) return sendJson(res, 400, { error: 'Validation failed', details: ['name is required'] });
        if (inv.locations.includes(obj.name)) return sendJson(res, 409, { error: 'Location already exists' });
        inv.locations.push(obj.name);
        writeJSON(inventoryFile, inv);
        return sendJson(res, 201, { id: inv.locations.length, name: obj.name });
      });
    });
  }

  if (req.method === 'DELETE' && url.startsWith('/api/locations/')) {
    const id = Number(url.split('/').pop());
    return requireAuth(req, res, true, (req, res) => {
      const inv = getInventory();
      if (Number.isNaN(id) || id <= 0 || id > inv.locations.length) return sendJson(res, 404, { error: 'Location not found' });
      const removedName = inv.locations[id - 1];
      const hasStock = inv.items.some(item => (item.locations[removedName] || 0) > 0);
      if (hasStock) {
        return sendJson(res, 400, { error: 'Cannot delete location with existing stock. Transfer stock first.' });
      }
      inv.locations.splice(id - 1, 1);
      inv.items.forEach(item => { delete item.locations[removedName]; });
      writeJSON(inventoryFile, inv);
      return sendJson(res, 200, { ok: true, message: 'Location deleted' });
    });
  }

  // ================= STOCK MOVEMENTS =================

  if (req.method === 'GET' && url.startsWith('/api/stock-movements')) {
    const parsed = new URL(url, 'http://localhost');
    const page = parsed.searchParams.get('page');
    const limit = parsed.searchParams.get('limit');
    const type = parsed.searchParams.get('type');
    const productId = parsed.searchParams.get('product_id');
    let movements = readJSON(movementsFile) || [];
    if (type) movements = movements.filter(m => m.type === type);
    if (productId) movements = movements.filter(m => Number(m.product_id) === Number(productId));
    if (page !== null || limit !== null) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const offset = (pageNum - 1) * limitNum;
      return sendJson(res, 200, {
        data: movements.slice(offset, offset + limitNum),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: movements.length,
          totalPages: Math.ceil(movements.length / limitNum)
        }
      });
    }
    return sendJson(res, 200, movements);
  }

  if (req.method === 'GET' && url.split('?')[0] === '/api/stock-lots') {
    const parsed = new URL(url, 'http://localhost');
    const productId = parsed.searchParams.get('product_id');
    const locationId = parsed.searchParams.get('location_id');
    const inv = getInventory();
    const lots = [];
    inv.items.forEach(item => {
      inv.locations.forEach(loc => {
        const qty = item.locations[loc] || 0;
        if (qty > 0) {
          const lot = { id: lots.length + 1, product_id: item.product.id, product_name: item.product.name, location_id: inv.locations.indexOf(loc) + 1, location_name: loc, qty, received_at: new Date().toISOString() };
          if (productId && Number(lot.product_id) !== Number(productId)) return;
          if (locationId && Number(lot.location_id) !== Number(locationId)) return;
          lots.push(lot);
        }
      });
    });
    return sendJson(res, 200, lots);
  }

  if (req.method === 'POST' && url === '/api/stock-movement') {
    return requireAuth(req, res, false, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
        if (!obj.product_id || !obj.qty || !obj.type) {
          return sendJson(res, 400, { error: 'Validation failed', details: ['product_id, qty and type are required'] });
        }
        if (!['stock-in', 'stock-out', 'transfer', 'adjustment'].includes(obj.type)) {
          return sendJson(res, 400, { error: 'Invalid type. Must be one of: stock-in, stock-out, transfer, adjustment' });
        }
        const products = readJSON(productsFile) || [];
        if (!products[Number(obj.product_id) - 1] || (products[Number(obj.product_id) - 1] && products[Number(obj.product_id) - 1]['status'] === 'inactive')) {
          return sendJson(res, 404, { error: 'Product not found or inactive' });
        }
        const movements = readJSON(movementsFile) || [];
        const newMovement = {
          id: movements.length + 1,
          product_id: obj.product_id,
          qty: obj.qty,
          type: obj.type,
          src_location: obj.src_location || null,
          dst_location: obj.dst_location || null,
          notes: obj.notes || '',
          created_at: new Date().toISOString(),
          user: obj.user || (req.user && req.user.username) || 'system'
        };
        movements.unshift(newMovement);
        writeJSON(movementsFile, movements);

        const inv = getInventory();
        const item = inv.items.find(i => i.product.id === Number(obj.product_id));
        if (item) {
          const locFor = (loc) => typeof loc === 'string' ? loc : (inv.locations[Number(loc) - 1]);
          if (obj.type === 'stock-in' && obj.dst_location) {
            const loc = locFor(obj.dst_location);
            item.locations[loc] = (item.locations[loc] || 0) + obj.qty;
          } else if (obj.type === 'stock-out' && obj.src_location) {
            const loc = locFor(obj.src_location);
            const available = item.locations[loc] || 0;
            if (available < obj.qty) return sendJson(res, 400, { error: 'Insufficient stock at source location' });
            item.locations[loc] = available - obj.qty;
          } else if (obj.type === 'transfer' && obj.src_location && obj.dst_location) {
            const src = locFor(obj.src_location);
            const dst = locFor(obj.dst_location);
            const available = item.locations[src] || 0;
            if (available < obj.qty) return sendJson(res, 400, { error: 'Insufficient stock at source location' });
            item.locations[src] = available - obj.qty;
            item.locations[dst] = (item.locations[dst] || 0) + obj.qty;
          } else if (obj.type === 'adjustment' && (obj.dst_location || obj.src_location)) {
            const loc = locFor(obj.dst_location || obj.src_location);
            item.locations[loc] = obj.qty;
          }
          item.total = Object.values(item.locations).reduce((sum, qty) => sum + qty, 0);
          writeJSON(inventoryFile, inv);
          // Mirror the SQLite backend: create/update a low-stock alert when a
          // source location drops below the threshold after a movement.
          if (obj.src_location) {
            const srcName = locFor(obj.src_location);
            const srcId = typeof obj.src_location === 'number' ? obj.src_location : inv.locations.indexOf(srcName) + 1;
            upsertLowStockAlert(item.product.id, srcId, item.locations[srcName] || 0);
          }
        }

        return sendJson(res, 200, { ok: true, message: `Stock ${obj.type} recorded successfully` });
      });
    });
  }

  // ================= ORDER INQUIRIES =================

  if (req.method === 'GET' && url.startsWith('/api/order-inquiries')) {
    return requireAuth(req, res, false, (req, res) => {
    const parsed = new URL(url, 'http://localhost');
    const page = parsed.searchParams.get('page');
    const limit = parsed.searchParams.get('limit');
    const status = parsed.searchParams.get('status');
    let orders = readJSON(orderFile) || [];
    if (status) orders = orders.filter(o => o.status === status);
    if (page !== null || limit !== null) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const offset = (pageNum - 1) * limitNum;
      return sendJson(res, 200, {
        data: orders.slice(offset, offset + limitNum),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: orders.length,
          totalPages: Math.ceil(orders.length / limitNum)
        }
      });
    }
    return sendJson(res, 200, orders);
    });
  }

  if (req.method === 'PUT' && url.startsWith('/api/order-inquiries/')) {
    const id = Number(url.split('/').pop());
    return requireAuth(req, res, false, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
        const orders = readJSON(orderFile) || [];
        const order = orders.find(o => o.id === id);
        if (!order) return sendJson(res, 404, { error: 'Order inquiry not found' });
        if (!['pending', 'approved', 'rejected', 'fulfilled'].includes(obj.status)) {
          return sendJson(res, 400, { error: 'Invalid status. Must be one of: pending, approved, rejected, fulfilled' });
        }
        order.status = obj.status || order.status;
        writeJSON(orderFile, orders);
        return sendJson(res, 200, { ok: true, message: `Inquiry ${order.status}` });
      });
    });
  }

  if (req.method === 'POST' && url === '/api/order-inquiries') {
    return parseBody(req, (err, obj) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
      if (!obj.customer_name || !obj.customer_email) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['customer_name and customer_email are required'] });
      }
      const orders = readJSON(orderFile) || [];
      const newOrder = {
        id: orders.length + 1,
        customer_name: obj.customer_name,
        customer_email: obj.customer_email,
        products: JSON.stringify(obj.products || []),
        estimated_cost: obj.estimated_cost || 0,
        notes: obj.notes || '',
        status: 'pending',
        created_at: new Date().toISOString()
      };
      orders.unshift(newOrder);
      writeJSON(orderFile, orders);
      return sendJson(res, 201, { ok: true, message: 'Inquiry submitted' });
    });
  }

  // ================= OPTIMIZATION =================

  if (req.method === 'GET' && url.startsWith('/api/optimization')) {
    const parts = url.split('/').filter(Boolean);
    const pid = parts[2];
    const products = readJSON(productsFile) || [];

    if (pid === 'abc') {
      const arr = products.map((p, idx) => ({
        id: idx + 1,
        name: p['Product Name'] || p.name,
        value: ((idx + 1) * 10) * (p['Price'] || p.price || 1),
        annualQty: 0
      }));
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
      return sendJson(res, 200, result);
    }

    if (!pid) {
      // Bulk optimization metrics for all products
      const results = products.map((p, idx) => {
        const C = p['Price'] || p.price || 1;
        const D = computeDemand(idx + 1);
        const H = 0.2 * C;
        const EOQ = Math.sqrt((2 * D * 50) / H);
        const inv = getInventory();
        const item = inv.items.find(i => i.product.id === idx + 1);
        const avgInv = item?.total || 1;
        return {
          productId: idx + 1,
          productName: p['Product Name'] || p.name,
          eoq: Math.round(EOQ),
          annualDemand: D,
          turnoverRatio: Math.round((D / avgInv) * 100) / 100
        };
      });
      return sendJson(res, 200, results);
    }

    const product = products[pid - 1];
    if (!product) return sendJson(res, 404, { error: 'Product not found' });
    const C = product['Price'] || product.price || 1;
    const D = computeDemand(pid);
    const S = 50;
    const H = 0.2 * C;
    const EOQ = Math.sqrt((2 * D * S) / H);
    const leadTimeDays = 7;
    const ROP = Math.ceil((D / 365) * leadTimeDays);
    const safetyStock = Math.ceil(Math.sqrt(D) * 0.1);
    const inv = getInventory();
    const item = inv.items.find(i => i.product.id === Number(pid));
    const avgInventory = item?.total || 1;
    return sendJson(res, 200, {
      EOQ: Math.round(EOQ),
      ROP,
      safetyStock,
      annualDemand: D,
      turnoverRatio: Math.round((D / avgInventory) * 100) / 100,
      avgInventory
    });
  }

  // ================= ANALYTICS =================

  if (req.method === 'GET' && url.startsWith('/api/analytics')) {
    const parts = url.split('/').filter(Boolean);

    if (parts[2] === 'summary') {
      const products = readJSON(productsFile) || [];
      const inv = getInventory();
      const movements = readJSON(movementsFile) || [];
      const orders = readJSON(orderFile) || [];        const totalProducts = products.filter(p => p['status'] !== 'inactive').length;
        const totalStock = inv.items.reduce((sum, i) => sum + i.total, 0);
      const lowStockItems = inv.items.filter(i => i.total < 80).length;
      const totalLocations = inv.locations.length;
      const pendingInquiries = orders.filter(o => o.status === 'pending').length;
      const totalSales = salesTransactions.reduce((sum, s) => sum + s.total_amount, 0);
      const totalMovements = movements.length;
      const activeAlerts = computeAlerts().length;

      const topProducts = inv.items
        .map(i => ({ id: i.product.id, name: i.product.name, stock_value: i.total * (i.product.price || 0) }))
        .sort((a, b) => b.stock_value - a.stock_value)
        .slice(0, 5);

      // Match the SQLite shape: one row per (month, type) with { month, type, count }.
      const monthTypeMap = {};
      movements.forEach(m => {
        const month = (m.created_at || '').substring(0, 7);
        if (!month) return;
        const key = `${month}|${m.type}`;
        if (!monthTypeMap[key]) monthTypeMap[key] = { month, type: m.type, count: 0 };
        monthTypeMap[key].count += 1;
      });
      const monthlyMovements = Object.values(monthTypeMap)
        .sort((a, b) => (b.month + b.type).localeCompare(a.month + a.type))
        .slice(0, 12);

      return sendJson(res, 200, {
        totalProducts, totalStock, lowStockItems, totalLocations,
        pendingInquiries, totalSales, totalMovements, activeAlerts,
        topProducts, monthlyMovements
      });
    }

    if (parts[2] === 'export') {
      return requireAuth(req, res, true, (req, res) => {
        const type = parts[3];
        const format = new URL(url, 'http://localhost').searchParams.get('format') || 'json';
        let data = [];
        if (type === 'products') data = (readJSON(productsFile) || []).filter(p => p['status'] !== 'inactive').map(formatProduct);
        else if (type === 'inventory') {
          const inv = getInventory();
          inv.items.forEach(item => inv.locations.forEach(loc => {
            data.push({ product: item.product.name, location: loc, quantity: item.locations[loc] || 0 });
          }));
        } else if (type === 'movements') data = readJSON(movementsFile) || [];
        else return sendJson(res, 404, { error: 'Export type not found. Use: products, inventory, movements' });

        if (format === 'csv') {
          const headers = Object.keys(data[0] || {}).join(',');
          const rows = data.map(row => Object.values(row).map(v => `"${v}"`).join(',')).join('\n');
          res.writeHead(200, {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename=${type}-${Date.now()}.csv`
          });
          return res.end(`${headers}\n${rows}`);
        }
        return sendJson(res, 200, data);
      });
    }

    return sendJson(res, 404, { error: 'Not found' });
  }

  // ================= SALES =================

  if (req.method === 'GET' && url.startsWith('/api/sales')) {
    return requireAuth(req, res, false, (req, res) => {
      const parsed = new URL(url, 'http://localhost');
      const page = parsed.searchParams.get('page');
      const limit = parsed.searchParams.get('limit');
      const products = readJSON(productsFile) || [];
      const enriched = salesTransactions.map(s => ({
        ...s,
        product_name: (products[s.product_id - 1] && (products[s.product_id - 1]['Product Name'] || products[s.product_id - 1].name)) || ''
      }));
      if (page !== null || limit !== null) {
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
        const offset = (pageNum - 1) * limitNum;
        return sendJson(res, 200, {
          data: enriched.slice(offset, offset + limitNum),
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: enriched.length,
            totalPages: Math.ceil(enriched.length / limitNum)
          }
        });
      }
      return sendJson(res, 200, enriched);
    });
  }

  if (req.method === 'POST' && url === '/api/sales') {
    return requireAuth(req, res, false, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
        if (!obj.product_id || !obj.qty) return sendJson(res, 400, { error: 'Validation failed', details: ['product_id and qty are required'] });
        const products = readJSON(productsFile) || [];
        const p = products[Number(obj.product_id) - 1];
        if (!p) return sendJson(res, 404, { error: 'Product not found or inactive' });
        const total = Number(obj.qty) * (p['Price'] || p.price || 0);
        salesTransactions.push({
          id: nextSaleId++,
          product_id: Number(obj.product_id),
          qty: Number(obj.qty),
          unit_price: p['Price'] || p.price || 0,
          total_amount: total,
          transaction_date: new Date().toISOString(),
          customer_name: obj.customer_name || 'anonymous'
        });
        return sendJson(res, 201, { ok: true, total });
      });
    });
  }

  // ================= USERS & ALERTS =================

  if (req.method === 'GET' && url === '/api/users') {
    return requireAuth(req, res, true, (req, res) => {
      return sendJson(res, 200, users.map(u => ({ id: u.id, username: u.username, role: u.role, email: u.email, created_at: u.created_at })));
    });
  }

  if (req.method === 'GET' && url === '/api/alerts') {
    return requireAuth(req, res, false, (req, res) => {
      return sendJson(res, 200, computeAlerts());
    });
  }

  if (req.method === 'PUT' && url.startsWith('/api/alerts/') && url.endsWith('/resolve')) {
    return requireAuth(req, res, true, (req, res) => {
      const id = Number(url.split('/')[3]);
      const alert = computeAlerts().find(a => a.id === id);
      if (!alert) return sendJson(res, 404, { error: 'Alert not found or already resolved' });
      alert.status = 'resolved';
      alert.resolved_at = new Date().toISOString();
      return sendJson(res, 200, { ok: true, message: 'Alert resolved' });
    });
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

function createServer(port = process.env.PORT || 4001) {
  return server.listen(port);
}

if (require.main === module) {
  createServer();
  console.log(`npm-free backend running on ${process.env.PORT || 4001}`);
}

module.exports = { createServer };

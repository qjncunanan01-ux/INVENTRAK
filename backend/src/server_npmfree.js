const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DEMO_SEED, SEED_EPOCH, mulberry32, DEMO_LOCATIONS, DEMO_CUSTOMERS } = require('./prng');

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

// --- Demo-token auth: HMAC-signed so a token cannot be forged. The SQLite
// backend signs JWTs with a secret; this mirrors that with zero dependencies.
const TOKEN_SECRET = process.env.NPMFREE_TOKEN_SECRET || 'inventrak-npmfree-token-secret';

function signToken(userId) {
  const payload = String(userId);
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `demo-token-${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.startsWith('demo-token-')) return null;
  const body = token.slice('demo-token-'.length);
  const dot = body.lastIndexOf('.');
  if (dot <= 0) return null;
  const idStr = body.slice(0, dot);
  const sig = body.slice(dot + 1);
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 1) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(idStr).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return users.find(u => u.id === id) || null;
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

// Deterministic demo data: same fixed-seed PRNG and draw order as the SQLite
// seeder (app.js seedDatabase / seed.js), so fresh boots of either backend
// produce IDENTICAL stock and sales.
if (!fs.existsSync(inventoryFile)) {
  const products = readJSON(productsFile) || [];
  const rand = mulberry32(DEMO_SEED);
  const items = products.map((p, idx) => {
    const stocks = {};
    let total = 0;
    // Draws 1-3: location stock (same formula as the SQLite seeder).
    DEMO_LOCATIONS.forEach(l => { const q = Math.floor(rand() * 160) + 20; stocks[l] = q; total += q; });
    // Draws 4-9 belong to the sales stream; consume them so the next
    // product's stock draws line up with the SQLite seeder's stream.
    for (let i = 0; i < 6; i++) rand();
    return {
      product: formatProduct(p, idx),
      locations: stocks,
      total
    };
  });
  writeJSON(inventoryFile, { locations: DEMO_LOCATIONS, items });
}

// Seed the in-memory sales history from the same stream (draws 4-9 per
// product: 2 per customer), mirroring the SQLite seeder exactly.
function seedSales() {
  if (salesTransactions.length > 0) return;
  const products = readJSON(productsFile) || [];
  if (!products.length) return;
  const rand = mulberry32(DEMO_SEED);
  products.forEach((p, idx) => {
    // Draws 1-3 belong to location stock; consume them to keep the stream
    // aligned with the SQLite seeder's per-product draw order.
    DEMO_LOCATIONS.forEach(() => rand());
    const price = p['Price'] || p.price || 1;
    DEMO_CUSTOMERS.forEach(cust => {
      const saleQty = Math.floor(rand() * 15) + 1;
      const daysAgo = Math.floor(rand() * 90);
      salesTransactions.push({
        id: nextSaleId++,
        product_id: idx + 1,
        qty: saleQty,
        unit_price: price,
        total_amount: saleQty * price,
        transaction_date: new Date(SEED_EPOCH - daysAgo * 86400000).toISOString(),
        customer_name: cust
      });
    });
  });
}
seedSales();

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

// Seeded products.json rows carry no status field (treated as active); active
// is the only status that may be sold or stocked (mirrors the SQLite
// `WHERE status = 'active'` checks — a nulled status counts as inactive).
function isProductActive(p) {
  return p && (p['status'] === undefined || p['status'] === 'active');
}

// Exact-path matcher for the parametrized routes (e.g. /api/products/1):
// requires exactly `segments` path parts with a numeric final segment, so
// deeper paths 404 exactly like Express routes do.
function isParamPath(url, prefix, segments) {
  const parts = url.split('?')[0].split('/').filter(Boolean);
  return parts.length === segments && parts.slice(0, segments - 1).join('/') === prefix && /^\d+$/.test(parts[parts.length - 1]);
}

// Dynamic demand: actual sales volume, mirroring the SQLite backend's
// sales-transaction SUM(qty) with the same fallbacks (100 bulk / 1000 single).
function computeDemand(productId, fallback = 100) {
  const qty = salesTransactions
    .filter(s => Number(s.product_id) === Number(productId))
    .reduce((sum, s) => sum + (Number(s.qty) || 0), 0);
  return qty > 0 ? qty : fallback;
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

// Mirror Express/body-parser: cap request bodies at 100 KB so a client cannot
// exhaust memory with a giant payload (the SQLite backend rejects these too).
const MAX_BODY_BYTES = 100 * 1024;

function bodyError(res, err) {
  if (err && err.status === 413) return sendJson(res, 413, { error: 'Payload Too Large' });
  return sendJson(res, 400, { error: 'Invalid JSON' });
}

function parseBody(req, callback) {
  let body = '';
  let tooLarge = false;
  req.on('data', chunk => {
    if (tooLarge) return;
    body += chunk;
    // Count raw bytes (not chars) so multibyte UTF-8 bodies are capped at the
    // same limit Express/body-parser applies.
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      tooLarge = true;
      body = '';
    }
  });
  req.on('end', () => {
    if (tooLarge) return callback({ status: 413 });
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
  const user = verifyToken(token);
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

  // ================= INTEGRITY =================

  if (req.method === 'GET' && url.split('?')[0] === '/api/health/integrity') {
    return requireAuth(req, res, true, (req, res) => {
      const errors = [];
      const inv = getInventory();
      const products = readJSON(productsFile) || [];
      inv.items.forEach(item => {
        const sum = Object.values(item.locations).reduce((a, b) => a + b, 0);
        if (Math.abs(sum - item.total) > 1e-6) {
          errors.push(`locations sum != total for product ${item.product.id}`);
        }
        Object.entries(item.locations).forEach(([loc, q]) => {
          if (q < 0) errors.push(`negative stock: product ${item.product.id}, ${loc} = ${q}`);
        });
      });
      const movements = readJSON(movementsFile) || [];
      movements.forEach(m => {
        const p = products[m.product_id - 1];
        if (!p || !isProductActive(p)) {
          errors.push(`movement references inactive/missing product ${m.product_id}`);
        }
      });
      return sendJson(res, 200, {
        ok: errors.length === 0,
        errors,
        checkedAt: new Date().toISOString()
      });
    });
  }

  // ================= API DOCS =================

  if (req.method === 'GET' && url.split('?')[0] === '/api/openapi.json') {
    const spec = readJSON(openapiFile) || { error: 'openapi.json not found' };
    return sendJson(res, 200, spec);
  }

  if (req.method === 'GET' && url.split('?')[0] === '/api/docs') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(swaggerUiHtml);
  }

  // ================= AUTH =================

  if (req.method === 'POST' && url.split('?')[0] === '/api/auth/login') {
    return parseBody(req, (err, obj) => {
      if (err) return bodyError(res, err);
      if (!obj.username || !obj.password) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['username and password are required'] });
      }
      const user = users.find(u => u.username === obj.username && u.password === obj.password);
      if (!user) return sendJson(res, 401, { error: 'Invalid username or password' });
      return sendJson(res, 200, {
        token: signToken(user.id),
        user: { id: user.id, username: user.username, role: user.role, email: user.email }
      });
    });
  }

  if (req.method === 'POST' && url.split('?')[0] === '/api/auth/register') {
    return parseBody(req, (err, obj) => {
      if (err) return bodyError(res, err);
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
        token: signToken(user.id),
        user: { id: user.id, username: user.username, role: user.role, email: user.email }
      });
    });
  }

  if (req.method === 'GET' && url.split('?')[0] === '/api/auth/me') {
    return requireAuth(req, res, false, (req, res) => {
      return sendJson(res, 200, { id: req.user.id, username: req.user.username, role: req.user.role, email: req.user.email, created_at: req.user.created_at });
    });
  }

  // ================= PRODUCTS =================

  if (req.method === 'GET' && url.split('?')[0] === '/api/products/categories') {
    const products = readJSON(productsFile) || [];
    const cats = [...new Set(products.filter(isProductActive).map(p => p['Category'] || p.category).filter(Boolean))].sort();
    return sendJson(res, 200, cats);
  }

  if (req.method === 'GET' && url.split('?')[0] === '/api/products') {
    const parsed = new URL(url, 'http://localhost');
    const page = parsed.searchParams.get('page');
    const limit = parsed.searchParams.get('limit');
    const search = parsed.searchParams.get('search');
    const category = parsed.searchParams.get('category');
    const products = readJSON(productsFile) || [];
    const statusParam = parsed.searchParams.get('status');
    const want = statusParam || 'active';
    // Format the FULL array with original indices first so ids stay stable
    // (SQLite keeps stable AUTOINCREMENT ids), then filter on status. Sort by
    // name to mirror the SQLite backend's `ORDER BY name ASC`.
    let formatted = products
      .map(formatProduct)
      .filter(f => want === 'active' ? isProductActive(f) : f.status === want)
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));

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

  if (req.method === 'GET' && isParamPath(url, 'api/products', 3)) {
    const id = parseInt(url.split('?')[0].split('/').pop(), 10);
    const products = readJSON(productsFile) || [];
    if (!products[id - 1]) return sendJson(res, 404, { error: 'Product not found' });
    // Match the SQLite backend: the row is returned regardless of status.
    return sendJson(res, 200, formatProduct(products[id - 1], id - 1));
  }

  if (req.method === 'POST' && url.split('?')[0] === '/api/products') {
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
        if (!obj.name || !obj.category) return sendJson(res, 400, { error: 'Validation failed', details: ['name and category are required'] });
        // Mirror the SQLite validate() schema: price is required and numeric >= 0.
        const priceNum = Number(obj.price);
        if (obj.price === undefined || obj.price === null || obj.price === '' || !Number.isFinite(priceNum) || priceNum < 0) {
          return sendJson(res, 400, { error: 'Validation failed', details: ['price is required and must be a number >= 0'] });
        }
        const products = readJSON(productsFile) || [];
        const newProduct = {
          'Product Name': obj.name,
          'Category': obj.category,
          'Brand': obj.brand || '',
          'Description': obj.description || '',
          'Size': obj.size || '',
          'Unit': obj.unit || 'pcs',
          'Price': priceNum,
          'status': 'active'
        };
        products.push(newProduct);
        writeJSON(productsFile, products);
        return sendJson(res, 201, { id: products.length });
      });
    });
  }

  if (req.method === 'PUT' && isParamPath(url, 'api/products', 3)) {
    const id = parseInt(url.split('?')[0].split('/').pop(), 10);
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
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

  // INVARIANT: product ids are array positions + 1, so the products array must
  // NEVER be spliced — only soft-deactivated (status = 'inactive'). Splicing
  // would silently reindex every downstream id (by-id lookups `products[id-1]`,
  // POST `{ id: products.length }`, the integrity check, inventory merges).
  if (req.method === 'DELETE' && isParamPath(url, 'api/products', 3)) {
    const id = parseInt(url.split('?')[0].split('/').pop(), 10);
    return requireAuth(req, res, true, (req, res) => {
      const products = readJSON(productsFile) || [];
      if (!products[id - 1]) return sendJson(res, 404, { error: 'Product not found' });
      products[id - 1]['status'] = 'inactive';
      writeJSON(productsFile, products);
      return sendJson(res, 200, { ok: true, message: 'Product deactivated' });
    });
  }

  // ================= INVENTORY =================

  if (req.method === 'GET' && url.split('?')[0] === '/api/inventory') {
    const inv = getInventory();
    const parsed = new URL(url, 'http://localhost');
    const lowStock = parsed.searchParams.get('low_stock') === 'true';
    const location = parsed.searchParams.get('location');
    const products = readJSON(productsFile) || [];
    // Match the SQLite backend: every ACTIVE product appears, including ones
    // created after the inventory snapshot (those simply have no stock yet).
    const byId = new Map(inv.items.map(i => [Number(i.product && i.product.id), i]));
    // Always format the product from the LIVE products file (stable ids + live
    // status); reuse only the snapshot's stock so deactivated products drop
    // out exactly like the SQLite `WHERE status='active'` inventory query.
    let items = products
      .map((p, idx) => {
        const existing = byId.get(idx + 1);
        return {
          product: formatProduct(p, idx),
          locations: existing ? existing.locations : {},
          total: existing ? existing.total : 0
        };
      })
      .filter(item => item.product && isProductActive(item.product));
    if (location) {
      // Accept a numeric location id or a name, mirroring the SQLite
      // resolveLocation() helper (the numeric form is used by the UI).
      const locId = Number(location);
      const locName = Number.isInteger(locId) && locId >= 1 && locId <= inv.locations.length
        ? inv.locations[locId - 1]
        : location;
      items = items.map(item => ({
        ...item,
        locations: item.locations[locName] !== undefined ? { [locName]: item.locations[locName] } : {},
        total: item.locations[locName] || 0
      }));
    }
    if (lowStock) items = items.filter(item => item.total < 80);
    const locations = inv.locations.map((name, index) => ({ id: index + 1, name }));
    return sendJson(res, 200, { locations, items });
  }

  // ================= LOCATIONS =================

  if (req.method === 'GET' && url.split('?')[0] === '/api/locations') {
    const inv = getInventory();
    return sendJson(res, 200, inv.locations.map((name, index) => ({ id: index + 1, name })));
  }

  if (req.method === 'POST' && url.split('?')[0] === '/api/locations') {
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
        const inv = getInventory();
        if (!obj.name) return sendJson(res, 400, { error: 'Validation failed', details: ['name is required'] });
        if (inv.locations.includes(obj.name)) return sendJson(res, 409, { error: 'Location already exists' });
        inv.locations.push(obj.name);
        writeJSON(inventoryFile, inv);
        return sendJson(res, 201, { id: inv.locations.length, name: obj.name });
      });
    });
  }

  if (req.method === 'DELETE' && isParamPath(url, 'api/locations', 3)) {
    const id = Number(url.split('?')[0].split('/').pop());
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

  if (req.method === 'GET' && url.split('?')[0] === '/api/stock-movements') {
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

  if (req.method === 'POST' && url.split('?')[0] === '/api/stock-movement') {
    return requireAuth(req, res, false, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
        if (!obj.product_id || !obj.qty || !obj.type) {
          return sendJson(res, 400, { error: 'Validation failed', details: ['product_id, qty and type are required'] });
        }
        if (!['stock-in', 'stock-out', 'transfer', 'adjustment'].includes(obj.type)) {
          return sendJson(res, 400, { error: 'Invalid type. Must be one of: stock-in, stock-out, transfer, adjustment' });
        }
        // Mirror the SQLite validate() schema: qty must be a positive number
        // and product_id a positive integer. A negative qty stock-out would
        // otherwise ADD stock, and a non-numeric qty would string-concatenate
        // into the inventory totals.
        const qty = Number(obj.qty);
        const pid = Number(obj.product_id);
        if (!Number.isFinite(qty) || qty <= 0) {
          return sendJson(res, 400, { error: 'Validation failed', details: ['qty must be a positive number'] });
        }
        // Mirror the SQLite validate(): reject non-numeric ids with 400, but
        // let fractional ids fall through to the product lookup (which 404s,
        // exactly like SQLite's `WHERE id = ?` with no matching row).
        if (Number.isNaN(pid) || pid < 1) {
          return sendJson(res, 400, { error: 'Validation failed', details: ['product_id must be a positive number'] });
        }
        const products = readJSON(productsFile) || [];
        if (!products[pid - 1] || !isProductActive(products[pid - 1])) {
          return sendJson(res, 404, { error: 'Product not found or inactive' });
        }
        // Pre-flight stock availability so a rejected movement leaves no trace
        // in the movement ledger (mirrors the SQLite backend).
        const inv = getInventory();
        const item = inv.items.find(i => i.product.id === pid);
        const locFor = (loc) => typeof loc === 'string' ? loc : (inv.locations[Number(loc) - 1]);
        if ((obj.type === 'stock-out' || obj.type === 'transfer') && obj.src_location) {
          const available = item ? (item.locations[locFor(obj.src_location)] || 0) : 0;
          if (available < qty) return sendJson(res, 400, { error: 'Insufficient stock at source location' });
        }
        const movements = readJSON(movementsFile) || [];
        const newMovement = {
          id: movements.length + 1,
          product_id: pid,
          qty,
          type: obj.type,
          src_location: obj.src_location || null,
          dst_location: obj.dst_location || null,
          notes: obj.notes || '',
          created_at: new Date().toISOString(),
          user: obj.user || (req.user && req.user.username) || 'system'
        };
        movements.unshift(newMovement);
        writeJSON(movementsFile, movements);

        if (item) {
          if (obj.type === 'stock-in' && obj.dst_location) {
            const loc = locFor(obj.dst_location);
            item.locations[loc] = (item.locations[loc] || 0) + qty;
          } else if (obj.type === 'stock-out' && obj.src_location) {
            const loc = locFor(obj.src_location);
            item.locations[loc] = item.locations[loc] - qty;
          } else if (obj.type === 'transfer' && obj.src_location && obj.dst_location) {
            const src = locFor(obj.src_location);
            const dst = locFor(obj.dst_location);
            item.locations[src] = item.locations[src] - qty;
            item.locations[dst] = (item.locations[dst] || 0) + qty;
          } else if (obj.type === 'adjustment' && (obj.dst_location || obj.src_location)) {
            const loc = locFor(obj.dst_location || obj.src_location);
            item.locations[loc] = qty;
          }
          item.total = Object.values(item.locations).reduce((sum, q) => sum + q, 0);
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

  if (req.method === 'GET' && url.split('?')[0] === '/api/order-inquiries') {
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

  if (req.method === 'PUT' && isParamPath(url, 'api/order-inquiries', 3)) {
    const id = Number(url.split('?')[0].split('/').pop());
    return requireAuth(req, res, false, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
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

  if (req.method === 'POST' && url.split('?')[0] === '/api/order-inquiries') {
    return parseBody(req, (err, obj) => {
      if (err) return bodyError(res, err);
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
    const parts = url.split('?')[0].split('/').filter(Boolean);
    // Valid shapes are /api/optimization (bulk), /api/optimization/abc, and
    // /api/optimization/{productId}. Deeper paths must 404 like Express does.
    if (parts.length !== 2 && parts.length !== 3) {
      return sendJson(res, 404, { error: 'Not found' });
    }
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
    // Single-product demand falls back to 1000 (SQLite uses 1000 here, 100 bulk).
    const D = computeDemand(pid, 1000);
    const S = 50;
    const H = 0.2 * C;
    const EOQ = Math.sqrt((2 * D * S) / H);
    const leadTimeDays = 7;
    const ROP = Math.ceil((D / 365) * leadTimeDays);
    const safetyStock = Math.ceil(Math.sqrt(D) * 0.1);
    const inv = getInventory();
    const item = inv.items.find(i => i.product.id === Number(pid));
    const avgInventory = Math.round(item?.total || 1);
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
    const parts = url.split('?')[0].split('/').filter(Boolean);
    // Valid shapes are /api/analytics/summary and /api/analytics/export/{type}.
    const validAnalyticsPath =
      (parts.length === 3 && parts[2] === 'summary') ||
      (parts.length === 4 && parts[2] === 'export');
    if (!validAnalyticsPath) {
      return sendJson(res, 404, { error: 'Not found' });
    }

    if (parts[2] === 'summary') {
      const products = readJSON(productsFile) || [];
      const inv = getInventory();
      const movements = readJSON(movementsFile) || [];
      const orders = readJSON(orderFile) || [];        const totalProducts = products.filter(isProductActive).length;
        const totalStock = inv.items.reduce((sum, i) => sum + i.total, 0);
      // Per (product, location) rows below the threshold — mirrors the SQLite
      // `SELECT COUNT(*) FROM stock WHERE quantity < 80` semantics.
      const lowStockItems = inv.items.reduce(
        (sum, i) => sum + Object.values(i.locations).filter(q => q < 80).length,
        0
      );
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
        if (type === 'products') data = (readJSON(productsFile) || []).filter(isProductActive).map(formatProduct);
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

  if (req.method === 'GET' && url.split('?')[0] === '/api/sales') {
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
        if (err) return bodyError(res, err);
        // Mirror the SQLite validate() schema: qty must be a positive number
        // and product_id a positive integer (a NaN/negative qty would corrupt
        // the recorded total, and inactive products must not be sold).
        const saleQty = Number(obj.qty);
        const salePid = Number(obj.product_id);
        if (!Number.isFinite(saleQty) || saleQty <= 0) {
          return sendJson(res, 400, { error: 'Validation failed', details: ['qty must be a positive number'] });
        }
        // Mirror the SQLite validate(): reject non-numeric ids with 400, but
        // let fractional ids fall through to the product lookup (which 404s,
        // exactly like SQLite's `WHERE id = ?` with no matching row).
        if (Number.isNaN(salePid) || salePid < 1) {
          return sendJson(res, 400, { error: 'Validation failed', details: ['product_id must be a positive number'] });
        }
        const products = readJSON(productsFile) || [];
        const p = products[salePid - 1];
        if (!p || !isProductActive(p)) return sendJson(res, 404, { error: 'Product not found or inactive' });
        const total = saleQty * (p['Price'] || p.price || 0);
        salesTransactions.push({
          id: nextSaleId++,
          product_id: salePid,
          qty: saleQty,
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

  if (req.method === 'GET' && url.split('?')[0] === '/api/users') {
    return requireAuth(req, res, true, (req, res) => {
      return sendJson(res, 200, users.map(u => ({ id: u.id, username: u.username, role: u.role, email: u.email, created_at: u.created_at })));
    });
  }

  if (req.method === 'GET' && url.split('?')[0] === '/api/alerts') {
    return requireAuth(req, res, false, (req, res) => {
      const status = new URL(url, 'http://localhost').searchParams.get('status') || 'active';
      return sendJson(res, 200, alerts.filter(a => a.status === status));
    });
  }

  if (req.method === 'PUT' && url.startsWith('/api/alerts/') && url.split('?')[0].endsWith('/resolve') && url.split('?')[0].split('/').length === 5) {
    return requireAuth(req, res, true, (req, res) => {
      const id = Number(url.split('?')[0].split('/')[3]);
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

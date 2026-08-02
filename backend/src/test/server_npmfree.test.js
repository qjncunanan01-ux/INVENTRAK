const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('../server_npmfree');

let server;
let baseUrl;
let adminToken;

// The npm-free server persists to the tracked JSON data files, so back them up
// before the suite runs and restore them afterwards to avoid polluting the repo.
const dataFiles = [
  'products.json',
  'inventory.json',
  'order_inquiries.json',
  'stock_movements.json',
];
const backups = {};

before(async () => {
  const dataDir = path.join(__dirname, '..', '..', 'data');
  for (const file of dataFiles) {
    const fp = path.join(dataDir, file);
    backups[file] = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : null;
  }
  server = createServer(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const loginBody = await loginRes.json();
  adminToken = loginBody.token;
});

after(() => {
  server.close();
  const dataDir = path.join(__dirname, '..', '..', 'data');
  for (const file of dataFiles) {
    const fp = path.join(dataDir, file);
    if (backups[file] === null) {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } else {
      fs.writeFileSync(fp, backups[file], 'utf8');
    }
  }
});

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function authRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}`, ...options.headers };
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

test('GET /api/products returns products list', async () => {
  const { status, body } = await request('/api/products');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body), 'expected body to be an array');
  assert.ok(body.length > 0, 'expected at least one product');
  assert.ok(body[0].hasOwnProperty('name'));
});

test('POST /api/auth/login returns a token and user', async () => {
  const { status, body } = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.user.username, 'admin');
  assert.ok(body.token);
});

test('GET /api/inventory returns inventory data', async () => {
  const { status, body } = await request('/api/inventory');
  assert.strictEqual(status, 200);
  assert.ok(body.locations);
  assert.ok(body.items);
});

test('GET /api/locations returns locations list', async () => {
  const { status, body } = await request('/api/locations');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.length > 0);
});

test('POST /api/stock-movement records a movement', async () => {
  const { status, body } = await authRequest('/api/stock-movement', {
    method: 'POST',
    body: JSON.stringify({ product_id: 1, qty: 3, type: 'stock-in', dst_location: 'Showroom' }),
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
});

test('POST /api/stock-movement requires auth', async () => {
  const { status } = await request('/api/stock-movement', {
    method: 'POST',
    body: JSON.stringify({ product_id: 1, qty: 3, type: 'stock-in', dst_location: 'Showroom' }),
  });
  assert.strictEqual(status, 401);
});

test('GET /api/stock-movements returns movements', async () => {
  const { status, body } = await request('/api/stock-movements');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
});

test('GET /api/stock-lots returns lot data', async () => {
  const { status, body } = await request('/api/stock-lots');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
});

test('GET /api/optimization/abc returns classifications', async () => {
  const { status, body } = await request('/api/optimization/abc');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
});

test('GET /api/optimization/1 returns EOQ data', async () => {
  const { status, body } = await request('/api/optimization/1');
  assert.strictEqual(status, 200);
  assert.ok(body.EOQ);
  assert.ok(body.ROP);
  assert.ok(body.safetyStock);
});

test('POST /api/order-inquiries stores inquiry', async () => {
  const { status, body } = await request('/api/order-inquiries', {
    method: 'POST',
    body: JSON.stringify({
      customer_name: 'Test User',
      customer_email: 'test@example.com',
      products: ['Widget x2'],
      estimated_cost: 200,
    }),
  });
  assert.strictEqual(status, 201);
  assert.strictEqual(body.ok, true);
});

test('GET /api/order-inquiries returns inquiries', async () => {
  const { status, body } = await authRequest('/api/order-inquiries');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
});

test('CRUD locations', async () => {
  const createRes = await authRequest('/api/locations', {
    method: 'POST',
    body: JSON.stringify({ name: `Test Loc ${Date.now()}` }),
  });
  assert.strictEqual(createRes.status, 201);
  assert.ok(createRes.body.id);
});

test('GET /api/analytics/summary returns dashboard data', async () => {
  const { status, body } = await request('/api/analytics/summary');
  assert.strictEqual(status, 200);
  assert.ok(body.totalProducts !== undefined);
  assert.ok(body.totalStock !== undefined);
});

test('POST /api/sales records a sale', async () => {
  const { status, body } = await authRequest('/api/sales', {
    method: 'POST',
    body: JSON.stringify({ product_id: 1, qty: 2, customer_name: 'Buyer' }),
  });
  assert.strictEqual(status, 201);
  assert.strictEqual(body.ok, true);
});

test('POST /api/sales requires auth', async () => {
  const { status } = await request('/api/sales', {
    method: 'POST',
    body: JSON.stringify({ product_id: 1, qty: 2, customer_name: 'Buyer' }),
  });
  assert.strictEqual(status, 401);
});

test('GET /api/products/categories returns categories', async () => {
  const { status, body } = await request('/api/products/categories');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
});

test('GET /api/auth/me returns the logged-in user', async () => {
  const { status, body } = await authRequest('/api/auth/me');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.username, 'admin');
});

test('GET /api/users requires admin', async () => {
  const okRes = await authRequest('/api/users');
  assert.strictEqual(okRes.status, 200);
  assert.ok(Array.isArray(okRes.body));
  const noTokenRes = await request('/api/users');
  assert.strictEqual(noTokenRes.status, 401);
});

test('GET /api/analytics/export requires admin', async () => {
  const okRes = await authRequest('/api/analytics/export/products');
  assert.strictEqual(okRes.status, 200);
  const noTokenRes = await request('/api/analytics/export/products');
  assert.strictEqual(noTokenRes.status, 401);
});

test('GET /api/docs serves Swagger UI and openapi.json', async () => {
  const docs = await request('/api/docs');
  assert.strictEqual(docs.status, 200);
  const spec = await request('/api/openapi.json');
  assert.strictEqual(spec.status, 200);
  assert.strictEqual(spec.body.info.title, 'INVENTRAK Inventory Management API');
});

test('GET /api/optimization returns bulk metrics', async () => {
  const { status, body } = await request('/api/optimization');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
});

test('POST /api/auth/register creates a user', async () => {
  const { status, body } = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'npfreeuser', password: 'test123', email: 'npfree@example.com' }),
  });
  assert.strictEqual(status, 200);
  assert.ok(body.token);
});

test('GET /api/nonexistent returns 404', async () => {
  const { status } = await request('/api/nonexistent');
  assert.strictEqual(status, 404);
});

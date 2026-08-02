const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, seedDatabase } = require('../app');

let server;
let baseUrl;
let adminToken;

before(() => {
  seedDatabase();
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
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

// ===== Auth =====

test('POST /api/auth/login returns a token for the seeded admin user', async () => {
  const { status, body } = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.user.username, 'admin');
  assert.strictEqual(body.user.role, 'admin');
  assert.ok(body.token);
  adminToken = body.token;
});

test('POST /api/auth/login rejects invalid credentials', async () => {
  const { status } = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
  });
  assert.strictEqual(status, 401);
});

test('POST /api/auth/register creates a new customer user', async () => {
  const username = `newuser_${Date.now()}`;
  const { status, body } = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'test123', email: `${username}@example.com` }),
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.user.username, username);
  assert.strictEqual(body.user.role, 'customer');
  assert.ok(body.token);
});

test('POST /api/auth/register rejects duplicate usernames', async () => {
  const { status } = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'test123', email: 'admin2@example.com' }),
  });
  assert.strictEqual(status, 409);
});

test('POST /api/auth/register validates required fields', async () => {
  const { status } = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'nofielduser', password: 'test123' }),
  });
  assert.strictEqual(status, 400);
});

// ===== Products =====

test('GET /api/products returns products list', async () => {
  const { status, body } = await request('/api/products');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body), 'expected body to be an array');
  assert.ok(body.length > 0, 'expected at least one product');
  assert.ok(body[0].hasOwnProperty('name'));
});

test('GET /api/products with pagination', async () => {
  const { status, body } = await request('/api/products?page=1&limit=5');
  assert.strictEqual(status, 200);
  assert.ok(body.data);
  assert.ok(body.pagination);
  assert.strictEqual(body.pagination.page, 1);
  assert.strictEqual(body.pagination.limit, 5);
});

test('GET /api/products with search', async () => {
  const { status, body } = await request('/api/products?search=test');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.data || body));
});

test('GET /api/products/categories returns category list', async () => {
  const { status, body } = await request('/api/products/categories');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
});

test('GET /api/products/:id returns a single product', async () => {
  const { status, body } = await request('/api/products/1');
  assert.strictEqual(status, 200);
  assert.ok(body.name);
});

test('GET /api/products/9999 returns 404', async () => {
  const { status, body } = await request('/api/products/9999');
  assert.strictEqual(status, 404);
  assert.ok(body.error);
});

test('POST /api/products creates a product (admin only)', async () => {
  const { status, body } = await authRequest('/api/products', {
    method: 'POST',
    body: JSON.stringify({ name: 'New Prod', category: 'Widgets', price: 100 }),
  });
  assert.strictEqual(status, 201);
  assert.ok(body.id);
});

test('POST /api/products returns 401 without token', async () => {
  const { status } = await request('/api/products', {
    method: 'POST',
    body: JSON.stringify({ name: 'New Prod', category: 'Widgets', price: 100 }),
  });
  assert.strictEqual(status, 401);
});

test('PUT /api/products/:id updates a product', async () => {
  const { status, body } = await authRequest('/api/products/1', {
    method: 'PUT',
    body: JSON.stringify({ name: 'Updated Name', category: 'Updated', price: 250, status: 'active' }),
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
});

test('DELETE /api/products/:id soft-deletes a product', async () => {
  const created = await authRequest('/api/products', {
    method: 'POST',
    body: JSON.stringify({ name: 'To Delete', category: 'Widgets', price: 10 }),
  });
  const { status, body } = await authRequest(`/api/products/${created.body.id}`, { method: 'DELETE' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
});

// ===== Inventory =====

test('GET /api/inventory returns inventory data', async () => {
  const { status, body } = await request('/api/inventory');
  assert.strictEqual(status, 200);
  assert.ok(body.locations);
  assert.ok(body.items);
});

test('GET /api/inventory?low_stock=true filters low stock', async () => {
  const { status, body } = await request('/api/inventory?low_stock=true');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.items));
});

// ===== Stock Movements =====

test('POST /api/stock-movement records a movement (auth required)', async () => {
  const postRes = await authRequest('/api/stock-movement', {
    method: 'POST',
    body: JSON.stringify({ product_id: 1, qty: 5, type: 'stock-in', dst_location: 1, notes: 'Test movement' }),
  });
  assert.strictEqual(postRes.status, 200);
  assert.strictEqual(postRes.body.ok, true);

  const getRes = await request('/api/stock-movements');
  assert.strictEqual(getRes.status, 200);
  assert.ok(Array.isArray(getRes.body));
});

test('POST /api/stock-movement returns 401 without token', async () => {
  const { status } = await request('/api/stock-movement', {
    method: 'POST',
    body: JSON.stringify({ product_id: 1, qty: 5, type: 'stock-in', dst_location: 1 }),
  });
  assert.strictEqual(status, 401);
});

test('POST /api/stock-movement rejects invalid type', async () => {
  const { status } = await authRequest('/api/stock-movement', {
    method: 'POST',
    body: JSON.stringify({ product_id: 1, qty: 5, type: 'not-a-type', dst_location: 1 }),
  });
  assert.strictEqual(status, 400);
});

test('GET /api/stock-lots returns FIFO lot data', async () => {
  const { status, body } = await request('/api/stock-lots');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
});

// ===== Locations =====

test('POST /api/locations creates a location (admin only)', async () => {
  const name = `Test Location ${Date.now()}`;
  const createRes = await authRequest('/api/locations', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  assert.strictEqual(createRes.status, 201);
  assert.ok(createRes.body.id);

  const getRes = await request('/api/locations');
  assert.strictEqual(getRes.status, 200);
  assert.ok(getRes.body.some(l => l.name === name));
});

test('POST /api/locations returns 409 for duplicates', async () => {
  const name = `Dup Location ${Date.now()}`;
  await authRequest('/api/locations', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  const { status } = await authRequest('/api/locations', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  assert.strictEqual(status, 409);
});

test('GET /api/locations returns 401 without token check via protected create', async () => {
  const { status } = await request('/api/locations', {
    method: 'POST',
    body: JSON.stringify({ name: 'No Auth Loc' }),
  });
  assert.strictEqual(status, 401);
});

// ===== Order Inquiries =====

test('POST /api/order-inquiries stores inquiry and GET returns it', async () => {
  const payload = {
    customer_name: 'Test User',
    customer_email: 'test@example.com',
    products: ['Test Widget x2'],
    estimated_cost: 200,
    notes: 'Please contact me',
  };

  const postResponse = await request('/api/order-inquiries', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  assert.strictEqual(postResponse.status, 201);
  assert.strictEqual(postResponse.body.ok, true);

  const getResponse = await authRequest('/api/order-inquiries');
  assert.strictEqual(getResponse.status, 200);
  assert.ok(Array.isArray(getResponse.body));
  assert.ok(getResponse.body.some(item => item.customer_email === payload.customer_email));
});

test('POST /api/order-inquiries validates required fields', async () => {
  const { status } = await request('/api/order-inquiries', {
    method: 'POST',
    body: JSON.stringify({ products: [] }),
  });
  assert.strictEqual(status, 400);
});

test('PUT /api/order-inquiries/:id updates status (auth required)', async () => {
  const getRes = await request('/api/order-inquiries');
  if (getRes.body.length > 0) {
    const id = getRes.body[0].id;
    const putRes = await authRequest(`/api/order-inquiries/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'approved' }),
    });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.ok, true);
  }
});

test('PUT /api/order-inquiries/9999 returns 404', async () => {
  const { status } = await authRequest('/api/order-inquiries/9999', {
    method: 'PUT',
    body: JSON.stringify({ status: 'approved' }),
  });
  assert.strictEqual(status, 404);
});

// ===== Optimization =====

test('GET /api/optimization/:id returns EOQ data', async () => {
  const { status, body } = await request('/api/optimization/1');
  assert.strictEqual(status, 200);
  assert.ok(body.EOQ);
  assert.ok(body.ROP);
  assert.ok(body.safetyStock);
});

test('GET /api/optimization/abc returns ABC classification', async () => {
  const { status, body } = await request('/api/optimization/abc');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
  if (body.length > 0) {
    assert.ok(body[0].classification);
  }
});

test('GET /api/optimization returns bulk metrics', async () => {
  const { status, body } = await request('/api/optimization');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
});

// ===== Analytics =====

test('GET /api/analytics/summary returns dashboard data', async () => {
  const { status, body } = await request('/api/analytics/summary');
  assert.strictEqual(status, 200);
  assert.ok(body.totalProducts !== undefined);
  assert.ok(body.totalStock !== undefined);
  assert.ok(body.lowStockItems !== undefined);
  assert.ok(Array.isArray(body.topProducts));
});

test('GET /api/analytics/export/products returns product data (admin only)', async () => {
  const { status } = await authRequest('/api/analytics/export/products');
  assert.strictEqual(status, 200);
});

test('GET /api/analytics/export/bogus returns 404', async () => {
  const { status } = await authRequest('/api/analytics/export/bogus');
  assert.strictEqual(status, 404);
});

// ===== Users & Alerts =====

test('GET /api/users returns user list (admin only)', async () => {
  const { status, body } = await authRequest('/api/users');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
});

test('GET /api/users returns 401 without token', async () => {
  const { status } = await request('/api/users');
  assert.strictEqual(status, 401);
});

test('GET /api/alerts returns alerts for authenticated user', async () => {
  const { status, body } = await authRequest('/api/alerts');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
});

// ===== 404 =====

test('GET /api/nonexistent returns 404', async () => {
  const { status } = await request('/api/nonexistent');
  assert.strictEqual(status, 404);
});

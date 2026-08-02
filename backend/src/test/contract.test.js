// Contract test: boots the SQLite backend and the npm-free fallback side by
// side and asserts that every endpoint exposes the same HTTP status code and
// the same response body SHAPE (keys, nesting, value types) on both servers.
//
// The boot/teardown + request helpers live in ./harness (isolated temp dirs).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { sqlite, npmfree, bootBoth, teardown, call, shapeOf, both } = require('./harness');

before(async () => {
  await bootBoth();
});

after(() => {
  teardown();
});

// ===== Auth =====

test('contract: login admin + customer return identical shapes', async () => {
  await both('POST /api/auth/login (admin)', '/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' },
  });
  await both('POST /api/auth/login (customer)', '/api/auth/login', {
    method: 'POST',
    body: { username: 'customer', password: 'customer123' },
  });
});

test('contract: login rejects bad credentials identically', async () => {
  await both('POST /api/auth/login (bad pw)', '/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'wrong' },
  });
  await both('POST /api/auth/login (missing field)', '/api/auth/login', {
    method: 'POST',
    body: { username: 'admin' },
  });
});

test('contract: register happy path + duplicates + validation', async () => {
  const username = `contract_user_${Date.now()}`;
  await both('POST /api/auth/register', '/api/auth/register', {
    method: 'POST',
    body: { username, password: 'test123', email: `${username}@example.com` },
  });
  await both('POST /api/auth/register (duplicate)', '/api/auth/register', {
    method: 'POST',
    body: { username, password: 'test123', email: `${username}@example.com` },
  });
  await both('POST /api/auth/register (missing email)', '/api/auth/register', {
    method: 'POST',
    body: { username: `nofield_${Date.now()}`, password: 'test123' },
  });
  await both('POST /api/auth/register (short password)', '/api/auth/register', {
    method: 'POST',
    body: { username: `shortpw_${Date.now()}`, password: '123', email: 'x@y.com' },
  });
});

test('contract: /api/auth/me identical for valid, missing, and invalid tokens', async () => {
  await both('GET /api/auth/me (admin)', '/api/auth/me', { auth: 'admin' });
  await both('GET /api/auth/me (no token)', '/api/auth/me');
  await both('GET /api/auth/me (invalid token)', '/api/auth/me', { auth: 'invalid' });
});

// ===== Products =====

test('contract: products list, pagination, search, categories, by-id, 404', async () => {
  await both('GET /api/products', '/api/products');
  await both('GET /api/products?page=1&limit=3', '/api/products?page=1&limit=3');
  await both('GET /api/products?search=a', '/api/products?search=a');
  await both('GET /api/products/categories', '/api/products/categories');
  await both('GET /api/products/1', '/api/products/1');
  await both('GET /api/products/99999', '/api/products/99999');
});

test('contract: product CRUD lifecycle', async () => {
  const payload = { name: 'Contract Widget', category: 'Contract', price: 42 };
  const s = await call(sqlite.url, '/api/products', {
    method: 'POST', token: sqlite.token.admin, body: payload,
  });
  const n = await call(npmfree.url, '/api/products', {
    method: 'POST', token: npmfree.token.admin, body: payload,
  });
  assert.strictEqual(s.status, 201, 'sqlite create product');
  assert.strictEqual(n.status, 201, 'npmfree create product');
  assert.strictEqual(shapeOf(s.json), shapeOf(n.json), 'create product shapes');

  const sPut = await call(sqlite.url, `/api/products/${s.json.id}`, {
    method: 'PUT', token: sqlite.token.admin, body: { name: 'Contract Widget v2', category: 'Contract', price: 50, status: 'active' },
  });
  const nPut = await call(npmfree.url, `/api/products/${n.json.id}`, {
    method: 'PUT', token: npmfree.token.admin, body: { name: 'Contract Widget v2', category: 'Contract', price: 50, status: 'active' },
  });
  assert.strictEqual(shapeOf(sPut.json), shapeOf(nPut.json), 'update product shapes');

  // A partial PUT (no price/status) must null those columns identically.
  const sPut2 = await call(sqlite.url, `/api/products/${s.json.id}`, {
    method: 'PUT', token: sqlite.token.admin, body: { name: 'Contract Widget v3' },
  });
  const nPut2 = await call(npmfree.url, `/api/products/${n.json.id}`, {
    method: 'PUT', token: npmfree.token.admin, body: { name: 'Contract Widget v3' },
  });
  assert.strictEqual(shapeOf(sPut2.json), shapeOf(nPut2.json), 'partial update shapes');
  const sGet2 = await call(sqlite.url, `/api/products/${s.json.id}`);
  const nGet2 = await call(npmfree.url, `/api/products/${n.json.id}`);
  assert.strictEqual(sGet2.status, nGet2.status, 'fetch partial-updated product status');
  assert.strictEqual(shapeOf(sGet2.json), shapeOf(nGet2.json), 'fetch partial-updated product shapes');

  const sDel = await call(sqlite.url, `/api/products/${s.json.id}`, { method: 'DELETE', token: sqlite.token.admin });
  const nDel = await call(npmfree.url, `/api/products/${n.json.id}`, { method: 'DELETE', token: npmfree.token.admin });
  assert.strictEqual(shapeOf(sDel.json), shapeOf(nDel.json), 'delete product shapes');

  // Soft-deleted products are still fetchable by id on both backends.
  const sGet = await call(sqlite.url, `/api/products/${s.json.id}`);
  const nGet = await call(npmfree.url, `/api/products/${n.json.id}`);
  assert.strictEqual(sGet.status, nGet.status, 'fetch deleted product status');
  assert.strictEqual(shapeOf(sGet.json), shapeOf(nGet.json), 'fetch deleted product shapes');
});

test('contract: product auth enforcement (401 without token, 403 for customer)', async () => {
  await both('POST /api/products (no token)', '/api/products', {
    method: 'POST', body: { name: 'X', category: 'Y', price: 1 },
  });
  await both('POST /api/products (customer)', '/api/products', {
    method: 'POST', auth: 'customer', body: { name: 'X', category: 'Y', price: 1 },
  });
});

// ===== Inventory & Locations =====

test('contract: inventory list + low-stock + location filter', async () => {
  await both('GET /api/inventory', '/api/inventory');
  // A freshly created product has 0 stock, so low_stock is non-empty on both.
  const s = await call(sqlite.url, '/api/products', {
    method: 'POST', token: sqlite.token.admin, body: { name: 'Low Stock Item', category: 'Contract', price: 9 },
  });
  const n = await call(npmfree.url, '/api/products', {
    method: 'POST', token: npmfree.token.admin, body: { name: 'Low Stock Item', category: 'Contract', price: 9 },
  });
  assert.strictEqual(s.status, 201);
  assert.strictEqual(n.status, 201);
  await both('GET /api/inventory?low_stock=true', '/api/inventory?low_stock=true');
  await both('GET /api/inventory?location=Showroom', '/api/inventory?location=Showroom');
});

test('contract: locations list/create/duplicate/delete', async () => {
  await both('GET /api/locations', '/api/locations');
  const name = `Contract Loc ${Date.now()}`;
  const s = await call(sqlite.url, '/api/locations', { method: 'POST', token: sqlite.token.admin, body: { name } });
  const n = await call(npmfree.url, '/api/locations', { method: 'POST', token: npmfree.token.admin, body: { name } });
  assert.strictEqual(s.status, 201);
  assert.strictEqual(n.status, 201);
  assert.strictEqual(shapeOf(s.json), shapeOf(n.json), 'create location shapes');

  await both('POST /api/locations (duplicate)', '/api/locations', {
    method: 'POST', auth: 'admin', body: { name },
  });

  const sDel = await call(sqlite.url, `/api/locations/${s.json.id}`, { method: 'DELETE', token: sqlite.token.admin });
  const nDel = await call(npmfree.url, `/api/locations/${n.json.id}`, { method: 'DELETE', token: npmfree.token.admin });
  assert.strictEqual(sDel.status, nDel.status, 'delete location status');
  assert.strictEqual(shapeOf(sDel.json), shapeOf(nDel.json), 'delete location shapes');

  await both('POST /api/locations (no token)', '/api/locations', { method: 'POST', body: { name: 'NoAuth' } });
});

// ===== Stock Movements =====

test('contract: stock movements + lots', async () => {
  await both('POST /api/stock-movement (stock-in)', '/api/stock-movement', {
    method: 'POST', auth: 'admin', body: { product_id: 1, qty: 10, type: 'stock-in', dst_location: 1, notes: 'contract' },
  });
  await both('POST /api/stock-movement (invalid type)', '/api/stock-movement', {
    method: 'POST', auth: 'admin', body: { product_id: 1, qty: 1, type: 'bogus', dst_location: 1 },
  });
  await both('POST /api/stock-movement (insufficient stock)', '/api/stock-movement', {
    method: 'POST', auth: 'admin', body: { product_id: 1, qty: 999999, type: 'stock-out', src_location: 1 },
  });
  await both('POST /api/stock-movement (no token)', '/api/stock-movement', {
    method: 'POST', body: { product_id: 1, qty: 1, type: 'stock-in', dst_location: 1 },
  });
  await both('GET /api/stock-movements', '/api/stock-movements');
  await both('GET /api/stock-movements?page=1&limit=2', '/api/stock-movements?page=1&limit=2');
  await both('GET /api/stock-lots', '/api/stock-lots');
  await both('GET /api/stock-lots?product_id=1', '/api/stock-lots?product_id=1');
});

// ===== Order Inquiries =====

test('contract: order inquiries lifecycle', async () => {
  const payload = {
    customer_name: 'Contract Customer',
    customer_email: 'contract@example.com',
    products: ['Widget x2'],
    estimated_cost: 120,
    notes: 'contract test',
  };
  await both('POST /api/order-inquiries', '/api/order-inquiries', { method: 'POST', body: payload });
  await both('POST /api/order-inquiries (missing email)', '/api/order-inquiries', {
    method: 'POST', body: { customer_name: 'No Email' },
  });
  await both('GET /api/order-inquiries (customer)', '/api/order-inquiries', { auth: 'customer' });
  await both('GET /api/order-inquiries?status=pending (customer)', '/api/order-inquiries?status=pending', { auth: 'customer' });
  await both('GET /api/order-inquiries (no token)', '/api/order-inquiries');

  const s = await call(sqlite.url, '/api/order-inquiries', { token: sqlite.token.customer });
  const n = await call(npmfree.url, '/api/order-inquiries', { token: npmfree.token.customer });
  assert.ok(s.json.length > 0, 'sqlite has inquiries');
  assert.ok(n.json.length > 0, 'npmfree has inquiries');
  const sId = s.json[0].id;
  const nId = n.json[0].id;

  const sPut = await call(sqlite.url, `/api/order-inquiries/${sId}`, {
    method: 'PUT', token: sqlite.token.admin, body: { status: 'approved' },
  });
  const nPut = await call(npmfree.url, `/api/order-inquiries/${nId}`, {
    method: 'PUT', token: npmfree.token.admin, body: { status: 'approved' },
  });
  assert.strictEqual(sPut.status, nPut.status, 'inquiry update status');
  assert.strictEqual(shapeOf(sPut.json), shapeOf(nPut.json), 'inquiry update shapes');

  await both('PUT /api/order-inquiries/99999 (404)', '/api/order-inquiries/99999', {
    method: 'PUT', auth: 'admin', body: { status: 'approved' },
  });
  await both('PUT /api/order-inquiries (no token)', `/api/order-inquiries/${sId}`, {
    method: 'PUT', body: { status: 'approved' },
  });
});

// ===== Optimization =====

test('contract: optimization bulk, abc, per-product, 404', async () => {
  await both('GET /api/optimization', '/api/optimization');
  await both('GET /api/optimization/abc', '/api/optimization/abc');
  await both('GET /api/optimization/1', '/api/optimization/1');
  await both('GET /api/optimization/99999', '/api/optimization/99999');
});

// ===== Analytics =====

test('contract: analytics summary + exports', async () => {
  await both('GET /api/analytics/summary', '/api/analytics/summary');
  await both('GET /api/analytics/export/products', '/api/analytics/export/products', { auth: 'admin' });
  await both('GET /api/analytics/export/inventory', '/api/analytics/export/inventory', { auth: 'admin' });
  await both('GET /api/analytics/export/movements', '/api/analytics/export/movements', { auth: 'admin' });
  await both('GET /api/analytics/export/bogus', '/api/analytics/export/bogus', { auth: 'admin' });
  await both('GET /api/analytics/export/products (no token)', '/api/analytics/export/products');
});

// ===== Sales & Users =====

test('contract: sales + users', async () => {
  await both('POST /api/sales', '/api/sales', {
    method: 'POST', auth: 'admin', body: { product_id: 1, qty: 2, customer_name: 'Buyer' },
  });
  await both('POST /api/sales (no token)', '/api/sales', {
    method: 'POST', body: { product_id: 1, qty: 2 },
  });
  await both('GET /api/sales', '/api/sales', { auth: 'admin' });
  await both('GET /api/sales (no token)', '/api/sales');
  await both('GET /api/users', '/api/users', { auth: 'admin' });
  await both('GET /api/users (no token)', '/api/users');
  await both('GET /api/users (customer)', '/api/users', { auth: 'customer' });
});

// ===== Alerts =====

test('contract: alerts are empty, then created by low-stock movement, then resolvable', async () => {
  await both('GET /api/alerts (initial)', '/api/alerts', { auth: 'admin' });

  // Drive product 1 / location 1 below the 80-unit threshold on both backends.
  await both('POST /api/stock-movement (adjust low)', '/api/stock-movement', {
    method: 'POST', auth: 'admin', body: { product_id: 1, qty: 5, type: 'adjustment', dst_location: 1 },
  });
  await both('POST /api/stock-movement (drain)', '/api/stock-movement', {
    method: 'POST', auth: 'admin', body: { product_id: 1, qty: 5, type: 'stock-out', src_location: 1 },
  });

  const s = await call(sqlite.url, '/api/alerts', { token: sqlite.token.admin });
  const n = await call(npmfree.url, '/api/alerts', { token: npmfree.token.admin });
  assert.strictEqual(s.status, n.status, 'alerts list status');
  assert.strictEqual(shapeOf(s.json), shapeOf(n.json), 'alerts list shapes');
  assert.ok(s.json.length > 0, 'sqlite should have an active alert');
  assert.ok(n.json.length > 0, 'npmfree should have an active alert');

  const sResolve = await call(sqlite.url, `/api/alerts/${s.json[0].id}/resolve`, { method: 'PUT', token: sqlite.token.admin });
  const nResolve = await call(npmfree.url, `/api/alerts/${n.json[0].id}/resolve`, { method: 'PUT', token: npmfree.token.admin });
  assert.strictEqual(sResolve.status, nResolve.status, 'resolve alert status');
  assert.strictEqual(shapeOf(sResolve.json), shapeOf(nResolve.json), 'resolve alert shapes');

  await both('PUT /api/alerts/99999/resolve (404)', '/api/alerts/99999/resolve', {
    method: 'PUT', auth: 'admin',
  });
  await both('GET /api/alerts (after resolve)', '/api/alerts', { auth: 'admin' });
});

// ===== Docs & 404s =====

test('contract: Swagger UI + identical OpenAPI document', async () => {
  const s = await call(sqlite.url, '/api/docs');
  const n = await call(npmfree.url, '/api/docs');
  assert.strictEqual(s.status, 200, 'sqlite serves docs');
  assert.strictEqual(n.status, 200, 'npmfree serves docs');
  assert.match(s.contentType, /text\/html/, 'sqlite docs is html');
  assert.match(n.contentType, /text\/html/, 'npmfree docs is html');

  const sSpec = await call(sqlite.url, '/api/openapi.json');
  const nSpec = await call(npmfree.url, '/api/openapi.json');
  assert.strictEqual(sSpec.status, 200);
  assert.strictEqual(nSpec.status, 200);
  assert.deepStrictEqual(sSpec.json, nSpec.json, 'both servers serve the identical OpenAPI document');
});

test('contract: unknown routes return the same JSON 404', async () => {
  await both('GET /api/does-not-exist', '/api/does-not-exist');
  await both('DELETE /api/does-not-exist', '/api/does-not-exist', { auth: 'admin' });
});

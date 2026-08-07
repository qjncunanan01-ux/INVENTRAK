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
    body: { username, password: 'Test123!', email: `${username}@example.com`, phone: '09171234567' },
  });
  await both('POST /api/auth/register (duplicate)', '/api/auth/register', {
    method: 'POST',
    body: { username, password: 'Test123!', email: `${username}@example.com`, phone: '09171234567' },
  });
  await both('POST /api/auth/register (missing email)', '/api/auth/register', {
    method: 'POST',
    body: { username: `nofield_${Date.now()}`, password: 'Test123!', phone: '09171234567' },
  });
  await both('POST /api/auth/register (missing phone)', '/api/auth/register', {
    method: 'POST',
    body: { username: `nophone_${Date.now()}`, password: 'Test123!', email: 'x@y.com' },
  });
  await both('POST /api/auth/register (short password)', '/api/auth/register', {
    method: 'POST',
    body: { username: `shortpw_${Date.now()}`, password: '123', email: 'x@y.com', phone: '09171234567' },
  });
  // Password policy: 8 chars but no symbol -> rejected identically on both.
  await both('POST /api/auth/register (password missing symbol)', '/api/auth/register', {
    method: 'POST',
    body: { username: `nosymbol_${Date.now()}`, password: 'Test1234', email: 'x@y.com', phone: '09171234567' },
  });
  // Over-long password -> rejected identically on both (parity for maxLength).
  await both('POST /api/auth/register (password too long)', '/api/auth/register', {
    method: 'POST',
    body: { username: `longpw_${Date.now()}`, password: 'Test123!'.repeat(20), email: 'x@y.com', phone: '09171234567' },
  });
});

test('contract: /api/auth/me identical for valid, missing, and invalid tokens', async () => {
  await both('GET /api/auth/me (admin)', '/api/auth/me', { auth: 'admin' });
  await both('GET /api/auth/me (no token)', '/api/auth/me');
  await both('GET /api/auth/me (invalid token)', '/api/auth/me', { auth: 'invalid' });

  // Regression: a WELL-FORMED but forged token (correct prefix + numeric id +
  // garbage signature) must be rejected exactly like a tampered JWT on the
  // SQLite side — the npm-free HMAC comparison must actually be exercised.
  for (const side of [sqlite, npmfree]) {
    const res = await call(side.url, '/api/auth/me', {
      token: 'demo-token-1.forged-signature-that-does-not-match',
    });
    assert.strictEqual(res.status, 403, `${side === sqlite ? 'sqlite' : 'npmfree'} forged token must 403`);
  }
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

test('contract: rejected stock-out leaves no movement record on either backend', async () => {
  // Regression: a stock-out that fails the availability check must not leave a
  // phantom entry in the movement ledger (it would skew analytics + demand).
  for (const side of [sqlite, npmfree]) {
    const before = await call(side.url, '/api/stock-movements');
    const res = await call(side.url, '/api/stock-movement', {
      method: 'POST', token: side.token.admin,
      body: { product_id: 1, qty: 999999999, type: 'stock-out', src_location: 1 },
    });
    assert.strictEqual(res.status, 400, 'insufficient stock must 400');
    const after = await call(side.url, '/api/stock-movements');
    assert.strictEqual(
      after.json.length, before.json.length,
      'rejected stock-out must not append a movement record'
    );
  }
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

  // customer_phone value parity: submit WITH a phone, then both backends must
  // return the same phone (locks the npmfree read-normalization).
  const phonePayload = { ...payload, customer_name: 'Phone Customer', customer_email: 'phone@example.com', customer_phone: '+639171234567' };
  const sp = await call(sqlite.url, '/api/order-inquiries', { method: 'POST', body: phonePayload });
  const np = await call(npmfree.url, '/api/order-inquiries', { method: 'POST', body: phonePayload });
  assert.strictEqual(sp.status, 201);
  assert.strictEqual(np.status, 201);
  const spList = await call(sqlite.url, '/api/order-inquiries', { token: sqlite.token.customer });
  const npList = await call(npmfree.url, '/api/order-inquiries', { token: npmfree.token.customer });
  const sPhone = spList.json.find((o) => o.customer_email === 'phone@example.com');
  const nPhone = npList.json.find((o) => o.customer_email === 'phone@example.com');
  assert.strictEqual(sPhone.customer_phone, '+639171234567', 'sqlite stores phone');
  assert.strictEqual(nPhone.customer_phone, '+639171234567', 'npmfree stores phone');
  assert.strictEqual(sPhone.customer_phone, nPhone.customer_phone, 'phone value parity');
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

// ===== Validation & edge-case parity =====

test('contract: input validation + edge cases behave identically', async () => {
  // Requests the SQLite schema rejects (or handles specially) that the
  // npm-free fallback must mirror exactly.
  const cases = [
    ['POST /api/sales qty="abc"', '/api/sales', { method: 'POST', auth: 'admin', body: { product_id: 1, qty: 'abc' } }],
    ['POST /api/sales qty=-5', '/api/sales', { method: 'POST', auth: 'admin', body: { product_id: 1, qty: -5 } }],
    ['POST /api/sales product_id="abc"', '/api/sales', { method: 'POST', auth: 'admin', body: { product_id: 'abc', qty: 2 } }],
    ['POST /api/products no price', '/api/products', { method: 'POST', auth: 'admin', body: { name: 'NoPrice', category: 'X' } }],
    ['POST /api/products price="abc"', '/api/products', { method: 'POST', auth: 'admin', body: { name: 'BadPrice', category: 'X', price: 'abc' } }],
    ['POST /api/products price=-5', '/api/products', { method: 'POST', auth: 'admin', body: { name: 'NegPrice', category: 'X', price: -5 } }],
    ['GET /api/alerts?status=resolved', '/api/alerts?status=resolved', { auth: 'admin' }],
    ['GET /api/alerts?status=bogus', '/api/alerts?status=bogus', { auth: 'admin' }],
    ['GET /api/products?page=abc', '/api/products?page=abc'],
    ['GET /api/stock-movements?page=abc', '/api/stock-movements?page=abc'],
    ['GET /api/order-inquiries?page=abc', '/api/order-inquiries?page=abc', { auth: 'admin' }],
    ['DELETE /api/locations/1.5', '/api/locations/1.5', { method: 'DELETE', auth: 'admin' }],
    ['DELETE /api/locations/1/x', '/api/locations/1/x', { method: 'DELETE', auth: 'admin' }],
    ['GET /api/products/1/2', '/api/products/1/2'],
    ['PUT /api/products/1/2', '/api/products/1/2', { method: 'PUT', auth: 'admin', body: { name: 'x' } }],
    ['PUT /api/order-inquiries/1/2', '/api/order-inquiries/1/2', { method: 'PUT', auth: 'admin', body: { status: 'approved' } }],
    ['GET /api/products?status=inactive', '/api/products?status=inactive'],
  ];
  for (const [label, p, opts] of cases) {
    await both(label, p, opts);
  }

  // Deactivating a product then selling it must 404 on both backends.
  await call(sqlite.url, '/api/products/2', { method: 'DELETE', token: sqlite.token.admin });
  await call(npmfree.url, '/api/products/2', { method: 'DELETE', token: npmfree.token.admin });
  await both('POST /api/sales inactive product', '/api/sales', { method: 'POST', auth: 'admin', body: { product_id: 2, qty: 2 } });

  // Malformed JSON must be a 400 client error on both, never a 500.
  for (const side of [sqlite, npmfree]) {
    const res = await fetch(`${side.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    });
    assert.strictEqual(res.status, 400, 'malformed JSON must 400');
  }

  // The status param must actually filter content, not just match status codes.
  const sInactive = await call(sqlite.url, '/api/products?status=inactive');
  const nInactive = await call(npmfree.url, '/api/products?status=inactive');
  assert.ok(sInactive.json.length > 0, 'sqlite should list the deactivated product');
  assert.strictEqual(sInactive.json.length, nInactive.json.length, 'inactive product list length parity');
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

// ===== Deep-path 404 parity =====

test('contract: deeper paths on list endpoints 404 identically on both backends', async () => {
  // The npm-free fallback matches list endpoints by prefix; without exact
  // matching, /api/order-inquiries/5 (etc.) would wrongly return the full
  // list. Express 404s these, so both must.
  const cases = [
    { p: '/api/order-inquiries/5', auth: 'customer' },
    { p: '/api/order-inquiries/99999', auth: 'customer' },
    { p: '/api/inventory/5' },
    { p: '/api/inventory/5/x' },
    { p: '/api/stock-movements/5' },
    { p: '/api/sales/5', auth: 'admin' },
    { p: '/api/products/categories/x' },
    { p: '/api/optimization/abc/x' },
    { p: '/api/optimization/abc/extra' },
    { p: '/api/analytics/summary/x', auth: 'admin' },
    { p: '/api/analytics/export/products/x', auth: 'admin' },
    { p: '/api/analytics/bogus', auth: 'admin' },
  ];
  for (const c of cases) {
    await both(`deep-path GET ${c.p}`, c.p, { auth: c.auth || null });
  }
});

// ===== Value parity (deterministic seed) =====

test('contract: deterministic seed means VALUES match, not just shapes', async () => {
  // Both backends seed from the same products.json with the same fixed-seed
  // PRNG and draw order, so fresh boots produce IDENTICAL stock and sales.
  // This guards the documented analytics/optimization divergence.
  const s = await call(sqlite.url, '/api/analytics/summary');
  const n = await call(npmfree.url, '/api/analytics/summary');
  assert.strictEqual(s.status, n.status);
  for (const k of ['totalProducts', 'totalStock', 'lowStockItems', 'totalLocations', 'totalSales', 'totalMovements', 'pendingInquiries']) {
    assert.strictEqual(s.json[k], n.json[k], `analytics ${k}: sqlite=${s.json[k]} npmfree=${n.json[k]}`);
  }

  // Per-product inventory totals identical on both backends.
  const si = await call(sqlite.url, '/api/inventory');
  const ni = await call(npmfree.url, '/api/inventory');
  const sBy = new Map(si.json.items.map(i => [Number(i.product.id), i.total]));
  const nBy = new Map(ni.json.items.map(i => [Number(i.product.id), i.total]));
  assert.strictEqual(sBy.size, nBy.size, 'same product count');
  for (const [pid, total] of sBy) {
    assert.strictEqual(total, nBy.get(pid), `product ${pid} total`);
  }

  // Sales ledger value parity (seeded history is identical).
  const ss = await call(sqlite.url, '/api/sales', { token: sqlite.token.admin });
  const ns = await call(npmfree.url, '/api/sales', { token: npmfree.token.admin });
  assert.strictEqual(ss.json.length, ns.json.length, 'sales row count');
  const sumS = ss.json.reduce((a, r) => a + r.total_amount, 0);
  const sumN = ns.json.reduce((a, r) => a + r.total_amount, 0);
  assert.strictEqual(sumS, sumN, 'total sales value');

  // Optimization values identical (demand now derives from the same sales).
  const so = await call(sqlite.url, '/api/optimization/1');
  const no = await call(npmfree.url, '/api/optimization/1');
  assert.deepStrictEqual(so.json, no.json, 'optimization/1 values');
});

// ===== Integrity endpoint =====

test('contract: health/integrity is admin-only and reports clean data identically', async () => {
  await both('GET /api/health/integrity (no token)', '/api/health/integrity');
  await both('GET /api/health/integrity (customer)', '/api/health/integrity', { auth: 'customer' });
  const s = await call(sqlite.url, '/api/health/integrity', { token: sqlite.token.admin });
  const n = await call(npmfree.url, '/api/health/integrity', { token: npmfree.token.admin });
  assert.strictEqual(s.status, 200);
  assert.strictEqual(n.status, 200);
  assert.strictEqual(shapeOf(s.json), shapeOf(n.json), 'integrity shapes');
  assert.strictEqual(s.json.ok, true, 'sqlite integrity should be clean: ' + JSON.stringify(s.json.errors));
  assert.strictEqual(n.json.ok, true, 'npmfree integrity should be clean: ' + JSON.stringify(n.json.errors));
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

test('contract: admin-only write routes reject a CUSTOMER token with 403 on both backends', async () => {
  // A customer account can never create an admin (register hardcodes role
  // 'customer'), so its token must not be able to mutate store data.
  const uname = `cust_${Date.now().toString(36)}`;
  await both('register customer for role test', '/api/auth/register', {
    method: 'POST',
    body: { username: uname, password: 'Test123!', email: `${uname}@example.com`, phone: '09171234567' },
  });

  for (const side of [sqlite, npmfree]) {
    const login = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: uname, password: 'Test123!' },
    });
    assert.strictEqual(login.status, 200);
    assert.strictEqual(login.json.user.role, 'customer');
    const customerToken = login.json.token;

    // Write routes the customer must NOT be able to use.
    const cases = [
      ['POST /api/products', '/api/products', { method: 'POST', body: { name: 'Hack', category: 'X', price: 1 } }],
      ['PUT /api/products/:id', '/api/products/1', { method: 'PUT', body: { name: 'Hack' } }],
      ['DELETE /api/products/:id', '/api/products/1', { method: 'DELETE' }],
      ['POST /api/stock-movement', '/api/stock-movement', { method: 'POST', body: { product_id: 1, qty: 1, type: 'in' } }],
      ['POST /api/locations', '/api/locations', { method: 'POST', body: { name: 'Hack Site' } }],
      ['PUT /api/order-inquiries/:id', '/api/order-inquiries/1', { method: 'PUT', body: { status: 'approved' } }],
      ['POST /api/sales', '/api/sales', { method: 'POST', body: { product_id: 1, qty: 1 } }],
      ['GET /api/users', '/api/users', { method: 'GET' }],
    ];
    for (const [label, path, opts] of cases) {
      const res = await call(side.url, path, { ...opts, token: customerToken });
      assert.strictEqual(res.status, 403, `${side === sqlite ? 'sqlite' : 'npmfree'} ${label} must 403 for a customer`);
    }

    // The customer's OWN flows still work: place an inquiry (201) and read
    // the inquiry list back (200 — the mobile history screen relies on this
    // GET staying customer-accessible on BOTH backends).
    const own = await call(side.url, '/api/order-inquiries', { method: 'POST', token: customerToken, body: {
      customer_name: uname, customer_email: `${uname}@example.com`, customer_phone: '09171234567',
      products: ['Widget x1'], estimated_cost: 100,
    } });
    assert.strictEqual(own.status, 201, 'customer can still place an inquiry');
    const hist = await call(side.url, '/api/order-inquiries', { token: customerToken });
    assert.strictEqual(hist.status, 200, `${side === sqlite ? 'sqlite' : 'npmfree'} customer can read inquiry history`);
  }
});

test('contract: promote is admin-only and promotes a customer identically on both backends', async () => {
  const uname = `promo_${Date.now().toString(36)}`;
  await both('register user to promote', '/api/auth/register', {
    method: 'POST',
    body: { username: uname, password: 'Test123!', email: `${uname}@example.com`, phone: '09171234567' },
  });

  // A customer token cannot promote anyone.
  for (const side of [sqlite, npmfree]) {
    const login = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: uname, password: 'Test123!' },
    });
    const res = await call(side.url, '/api/admin/promote', {
      method: 'POST', token: login.json.token, body: { username: uname },
    });
    assert.strictEqual(res.status, 403, 'customer token cannot promote');
  }

  // An admin promotes the customer -> role flips to admin, then the new admin
  // can log in and reach the users list.
  for (const side of [sqlite, npmfree]) {
    const prom = await call(side.url, '/api/admin/promote', {
      method: 'POST', token: side.token.admin, body: { username: uname },
    });
    assert.strictEqual(prom.status, 200, `${side === sqlite ? 'sqlite' : 'npmfree'} admin can promote`);
    assert.strictEqual(prom.json.user.role, 'admin');

    const relogin = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: uname, password: 'Test123!' },
    });
    assert.strictEqual(relogin.json.user.role, 'admin');
    const users = await call(side.url, '/api/users', { token: relogin.json.token });
    assert.strictEqual(users.status, 200, 'promoted user can read the users list');
  }

  // Promoting again (already an admin) 404s identically.
  await both('promote again -> 404', '/api/admin/promote', {
    method: 'POST', body: { username: uname }, auth: 'admin',
  });
});

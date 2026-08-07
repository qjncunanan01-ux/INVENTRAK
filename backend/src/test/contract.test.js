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

test('contract: bulk price update matches by name and id identically on both backends', async () => {
  // Create a uniquely-named product on both backends so the name match is
  // unambiguous (the seeded catalog has thousands of rows on the shared files).
  const uname = `Bulk ${Date.now().toString(36)}`;
  const s = await call(sqlite.url, '/api/products', {
    method: 'POST', token: sqlite.token.admin, body: { name: uname, category: 'Contract', price: 1 },
  });
  const n = await call(npmfree.url, '/api/products', {
    method: 'POST', token: npmfree.token.admin, body: { name: uname, category: 'Contract', price: 1 },
  });
  assert.strictEqual(s.status, 201);
  assert.strictEqual(n.status, 201);

  // Batch: one exact-name match, one missing name, one invalid price, and one
  // id-based match (using each backend's own product id). Response key set and
  // skipped reasons must be identical on both.
  const prices = [
    { name: uname, price: 777 },
    { name: 'No Such Product ' + Date.now(), price: 99 },
    { name: 'Bad Price', price: 'abc' },
    { id: s.json.id, name: uname, price: 888 },
  ];
  const body = { prices };
  const sRes = await call(sqlite.url, '/api/products/bulk-prices', { method: 'POST', token: sqlite.token.admin, body });
  const nRes = await call(npmfree.url, '/api/products/bulk-prices', { method: 'POST', token: npmfree.token.admin, body: { prices: prices.map((p, i) => i === 3 ? { ...p, id: n.json.id } : p) } });
  assert.strictEqual(sRes.status, 200);
  assert.strictEqual(nRes.status, 200);
  assert.strictEqual(shapeOf(sRes.json), shapeOf(nRes.json), 'bulk price result shapes');
  assert.strictEqual(sRes.json.updated, 2, 'sqlite updated name + id matches');
  assert.strictEqual(nRes.json.updated, 2, 'npmfree updated name + id matches');
  assert.strictEqual(sRes.json.total, 4);
  assert.strictEqual(shapeOf(sRes.json.skipped), shapeOf(nRes.json.skipped), 'skipped shapes');

  // The id-based match is the last write: the product price must be 888 on
  // both backends after the batch.
  const sGet = await call(sqlite.url, `/api/products/${s.json.id}`);
  const nGet = await call(npmfree.url, `/api/products/${n.json.id}`);
  assert.strictEqual(sGet.json.price, 888, 'sqlite final price');
  assert.strictEqual(nGet.json.price, 888, 'npmfree final price');

  // Validation errors: non-array / empty / oversized batches 400 identically.
  await both('bulk not an array', '/api/products/bulk-prices', { method: 'POST', auth: 'admin', body: { prices: 'nope' } });
  await both('bulk empty', '/api/products/bulk-prices', { method: 'POST', auth: 'admin', body: { prices: [] } });
  await both('bulk no token', '/api/products/bulk-prices', { method: 'POST', body: { prices: [{ name: 'x', price: 1 }] } });
  await both('bulk customer forbidden', '/api/products/bulk-prices', { method: 'POST', auth: 'customer', body: { prices: [{ name: 'x', price: 1 }] } });

  // A negative price is skipped (never aborts), identically on both.
  const neg = await both('bulk negative price', '/api/products/bulk-prices', {
    method: 'POST', auth: 'admin', body: { prices: [{ name: uname, price: -5 }] },
  });
  assert.strictEqual(neg.a.json.updated, 0);
  assert.strictEqual(neg.b.json.updated, 0);
  assert.strictEqual(shapeOf(neg.a.json.skipped), shapeOf(neg.b.json.skipped), 'negative-price skip shapes');
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
  // Place the inquiry WITH the customer token on both backends so it is
  // stamped with its owner (per-account history scoping).
  await both('POST /api/order-inquiries (owner)', '/api/order-inquiries', { method: 'POST', auth: 'customer', body: payload });
  await both('POST /api/order-inquiries (missing email)', '/api/order-inquiries', {
    method: 'POST', body: { customer_name: 'No Email' },
  });

  // customer_phone value parity: submit WITH a phone (as the owner), then both
  // backends must return the same phone (locks the npmfree read-normalization).
  const phonePayload = { ...payload, customer_name: 'Phone Customer', customer_email: 'customer@example.com', customer_phone: '+639171234567' };
  const sp = await call(sqlite.url, '/api/order-inquiries', { method: 'POST', token: sqlite.token.customer, body: phonePayload });
  const np = await call(npmfree.url, '/api/order-inquiries', { method: 'POST', token: npmfree.token.customer, body: phonePayload });
  assert.strictEqual(sp.status, 201);
  assert.strictEqual(np.status, 201);
  const spList = await call(sqlite.url, '/api/order-inquiries', { token: sqlite.token.customer });
  const npList = await call(npmfree.url, '/api/order-inquiries', { token: npmfree.token.customer });
  const sPhone = spList.json.find((o) => o.customer_email === 'customer@example.com');
  const nPhone = npList.json.find((o) => o.customer_email === 'customer@example.com');
  assert.ok(sPhone, 'sqlite owner sees the phone order');
  assert.ok(nPhone, 'npmfree owner sees the phone order');
  assert.strictEqual(sPhone.customer_phone, '+639171234567', 'sqlite stores phone');
  assert.strictEqual(nPhone.customer_phone, '+639171234567', 'npmfree stores phone');
  assert.strictEqual(sPhone.customer_phone, nPhone.customer_phone, 'phone value parity');

  // Per-account scoping: a DIFFERENT account sees none of the owner's orders
  // on either backend (each customer only sees their own history).
  for (const side of [sqlite, npmfree]) {
    const uname = `other_${Date.now().toString(36)}_${side === sqlite ? 's' : 'n'}`;
    const reg = await call(side.url, '/api/auth/register', {
      method: 'POST', body: { username: uname, password: 'Test123!', email: `${uname}@example.com`, phone: '09171234567' },
    });
    assert.strictEqual(reg.status, 200);
    const login = await call(side.url, '/api/auth/login', { method: 'POST', body: { username: uname, password: 'Test123!' } });
    const otherList = await call(side.url, '/api/order-inquiries', { token: login.json.token });
    assert.strictEqual(otherList.status, 200);
    assert.strictEqual(otherList.json.length, 0, `${side === sqlite ? 'sqlite' : 'npmfree'}: a different account sees no orders`);
  }

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

  // Progress timeline: the status change appended to status_history on both
  // backends ('placed' event from created_at, then the new status).
  for (const side of [sqlite, npmfree]) {
    const after = await call(side.url, '/api/order-inquiries', { token: side.token.admin });
    const row = after.json.find((o) => o.id === (side === sqlite ? sId : nId));
    assert.ok(row, `${side === sqlite ? 'sqlite' : 'npmfree'} updated row found`);
    const history = JSON.parse(row.status_history);
    assert.ok(Array.isArray(history) && history.length >= 2, `${side === sqlite ? 'sqlite' : 'npmfree'} timeline has placed + approved`);
    assert.strictEqual(history[0].status, 'pending');
    assert.strictEqual(history[history.length - 1].status, 'approved');
    assert.ok(history.every((h) => h.at && !Number.isNaN(Date.parse(h.at))), 'every timeline step has a timestamp');
  }

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

test('contract: product images serve on both backends without crashing the server', async () => {
  // Regression lock for the ERR_HTTP_HEADERS_SENT crash: the npm-free server
  // used to write the 404 headers BEFORE the /images handler, so every image
  // request threw and killed the whole process. Both backends must serve a
  // real catalog image AND survive the request (subsequent API call still
  // answers).
  const p = await call(sqlite.url, '/api/products?limit=200');
  const items = p.json.data || p.json;
  const withImg = items.find((x) => x.image);
  assert.ok(withImg, 'catalog has a product with an image');

  for (const side of [sqlite, npmfree]) {
    const img = await call(side.url, withImg.image);
    assert.strictEqual(img.status, 200, `${side.name} serves ${withImg.image}`);
    assert.ok(img.text && img.text.length > 100, 'image bytes returned');
    // Server must still be alive afterwards (this crashed before the fix).
    const alive = await call(side.url, '/api/products/categories');
    assert.strictEqual(alive.status, 200, `${side.name} alive after image request`);
  }

  // Directory traversal is blocked, not served.
  const evil = await call(npmfree.url, '/images/../src/app.js');
  assert.notStrictEqual(evil.status, 200, 'traversal must not serve a file');
});

test('contract: unpaginated list endpoints return the FULL catalog on both backends', async () => {
  // Regression lock for the hidden-LIMIT parity bug: /api/sales and
  // /api/products used to apply a default LIMIT 50 even on the unpaginated
  // path, so with a 192-product catalog the SQLite side returned 50 rows
  // while the npm-free side returned all 192 (silently truncating the
  // order-inquiry picker and any client that fetches without page/limit).
  const s = await call(sqlite.url, '/api/products');
  const n = await call(npmfree.url, '/api/products');
  assert.ok(Array.isArray(s.json) && Array.isArray(n.json), 'no page/limit -> bare array');
  assert.ok(s.json.length >= 150, `sqlite returns full catalog (got ${s.json.length})`);
  assert.strictEqual(s.json.length, n.json.length, 'same product count on both backends');

  const ss = await call(sqlite.url, '/api/sales', { token: sqlite.token.admin });
  const ns = await call(npmfree.url, '/api/sales', { token: npmfree.token.admin });
  assert.ok(Array.isArray(ss.json) && Array.isArray(ns.json));
  assert.strictEqual(ss.json.length, ns.json.length, 'same sales count on both backends');
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

test('contract: checkout fields (delivery_address + payment_method) are stored and returned identically', async () => {
  const uname = `addr_${Date.now().toString(36)}`;
  await both('register for checkout test', '/api/auth/register', {
    method: 'POST',
    body: { username: uname, password: 'Test123!', email: `${uname}@example.com`, phone: '09171234567' },
  });

  for (const side of [sqlite, npmfree]) {
    const login = await call(side.url, '/api/auth/login', {
      method: 'POST', body: { username: uname, password: 'Test123!' },
    });
    const token = login.json.token;

    // Place an order with checkout info.
    const posted = await call(side.url, '/api/order-inquiries', {
      method: 'POST', token,
      body: {
        customer_name: uname, customer_email: `${uname}@example.com`, customer_phone: '09171234567',
        products: ['Widget x2'], estimated_cost: 200, notes: 'checkout test',
        delivery_address: '123 Mabini St, Brgy. San Isidro, Manila', payment_method: 'gcash',
      },
    });
    assert.strictEqual(posted.status, 201);

    // The inquiry list carries the checkout fields back.
    const list = await call(side.url, '/api/order-inquiries', { token });
    assert.strictEqual(list.status, 200);
    const rows = list.json.data || list.json;
    const mine = rows.find((r) => r.customer_name === uname);
    assert.ok(mine, `${side === sqlite ? 'sqlite' : 'npmfree'} inquiry found`);
    assert.strictEqual(mine.delivery_address, '123 Mabini St, Brgy. San Isidro, Manila');
    assert.strictEqual(mine.payment_method, 'gcash');
  }

  // Invalid payment_method -> identical 400 on both.
  await both('invalid payment_method', '/api/order-inquiries', {
    method: 'POST',
    body: { customer_name: 'x', customer_email: 'x@y.com', payment_method: 'crypto' },
  });

  // Oversized delivery_address -> identical 400 on both.
  await both('oversized delivery_address', '/api/order-inquiries', {
    method: 'POST',
    body: { customer_name: 'x', customer_email: 'x@y.com', delivery_address: 'a'.repeat(501) },
  });
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

// ===== GCash payment step + delivered status =====

test('contract: GCash checkout returns a payment step identically', async () => {
  const res = await both('POST /api/order-inquiries (gcash)', '/api/order-inquiries', {
    method: 'POST',
    auth: 'customer',
    body: {
      customer_name: 'Pay Test',
      customer_email: 'pay@test.com',
      customer_phone: '09171234567',
      products: ['Butterscotch Sauce x1'],
      estimated_cost: 1070,
      delivery_address: '1 Pay St',
      payment_method: 'gcash',
    },
  });
  // Both must expose the payment step with a reference + QR.
  for (const side of [sqlite, npmfree]) {
    const body = side === sqlite ? res.a.json : res.b.json;
    assert.strictEqual(body.ok, true);
    assert.ok(Number(body.id) > 0, `${side} returns an inquiry id`);
    assert.ok(body.payment, `${side} returns a payment step`);
    assert.strictEqual(body.payment.payment_method, 'gcash');
    assert.strictEqual(body.payment.payment_status, 'unpaid');
    assert.ok(body.payment.payment_reference, `${side} has a reference`);
    assert.ok(/^https?:\/\//.test(body.payment.payment_qr), `${side} QR is a URL`);
  }

  // The stored inquiry carries the payment fields on read-back.
  for (const side of [sqlite, npmfree]) {
    const list = await call(side.url, '/api/order-inquiries?limit=1', { token: side.token.customer });
    const first = (list.json.data || list.json)[0];
    assert.strictEqual(first.payment_method, 'gcash');
    assert.strictEqual(first.payment_status, 'unpaid');
    assert.ok(first.payment_reference);
    assert.ok(first.payment_qr);
  }
});

test('contract: COD checkout returns no payment step', async () => {
  const res = await both('POST /api/order-inquiries (cod)', '/api/order-inquiries', {
    method: 'POST',
    body: { customer_name: 'Cod Test', customer_email: 'cod@test.com', products: ['x1'], payment_method: 'cod' },
  });
  assert.strictEqual(res.a.json.payment, undefined);
  assert.strictEqual(res.b.json.payment, undefined);
});

test('contract: mark own inquiry paid identically', async () => {
  const created = await both('create for payment', '/api/order-inquiries', {
    method: 'POST', auth: 'customer',
    body: { customer_name: 'Paid Test', customer_email: 'paid@test.com', products: ['x1'], payment_method: 'gcash', estimated_cost: 100 },
  });
  const idA = created.a.json.id;
  const idB = created.b.json.id;

  // Each side marks its OWN inquiry paid (ids may differ between servers).
  const res = await both('PUT payment paid', `/api/order-inquiries/${idA}/payment`, {
    method: 'PUT', auth: 'customer', body: { payment_status: 'paid' },
  });
  assert.strictEqual(res.a.json.payment_status, 'paid');
  const resB = await call(npmfree.url, `/api/order-inquiries/${idB}/payment`, {
    method: 'PUT', token: npmfree.token.customer, body: { payment_status: 'paid' },
  });
  assert.strictEqual(resB.status, 200);
  assert.strictEqual(resB.json.payment_status, 'paid');

  // Invalid payment_status -> identical 400 on both.
  await both('PUT payment invalid', `/api/order-inquiries/${idA}/payment`, {
    method: 'PUT', auth: 'customer', body: { payment_status: 'confirmed' },
  });
});

test('contract: delivered status accepted identically', async () => {
  const created = await both('create for delivered', '/api/order-inquiries', {
    method: 'POST',
    body: { customer_name: 'Del Test', customer_email: 'del@test.com', products: ['x1'] },
  });
  const idA = created.a.json.id;
  const idB = created.b.json.id;
  await both('PUT delivered', `/api/order-inquiries/${idA}`, {
    method: 'PUT', auth: 'admin', body: { status: 'delivered' },
  });
  const resB = await call(npmfree.url, `/api/order-inquiries/${idB}`, {
    method: 'PUT', token: npmfree.token.admin, body: { status: 'delivered' },
  });
  assert.strictEqual(resB.status, 200);
  // Invalid status still 400s identically.
  await both('PUT invalid status', `/api/order-inquiries/${idA}`, {
    method: 'PUT', auth: 'admin', body: { status: 'shipped' },
  });
});

// ===== OCR endpoint (validation parity; engine is lazy) =====

test('contract: OCR validation rejects bad payloads identically', async () => {
  await both('OCR missing image', '/api/ocr', { method: 'POST', body: {} });
  await both('OCR empty image', '/api/ocr', { method: 'POST', body: { image: '' } });
  await both('OCR non-base64', '/api/ocr', { method: 'POST', body: { image: 'not base64 !!!' } });
});

// ===== Stock adjustments / transfers + approvals + reports =====

test('contract: stock adjustments + transfers approval workflow is identical', async () => {
  // Create a pending adjustment on both backends.
  const adj = await both('POST /api/stock-adjustments', '/api/stock-adjustments', {
    method: 'POST', auth: 'admin', body: { product_id: 1, location_id: 1, new_qty: 150, reason: 'physical count' },
  });
  assert.strictEqual(adj.a.status, 201);
  assert.strictEqual(adj.b.status, 201);
  assert.strictEqual(shapeOf(adj.a.json), shapeOf(adj.b.json), 'create adjustment shapes');

  // Both pending queues expose the same shape and one pending row.
  const q1 = await both('GET /api/approvals (after adjustment)', '/api/approvals', { auth: 'admin' });
  assert.strictEqual(shapeOf(q1.a.json), shapeOf(q1.b.json), 'approvals shape parity');
  assert.ok(Array.isArray(q1.a.json.adjustments) && q1.a.json.adjustments.length >= 1, 'sqlite has a pending adjustment');
  assert.ok(Array.isArray(q1.b.json.adjustments) && q1.b.json.adjustments.length >= 1, 'npmfree has a pending adjustment');

  // Create a pending transfer on both backends.
  const tr = await both('POST /api/stock-transfers', '/api/stock-transfers', {
    method: 'POST', auth: 'admin', body: { product_id: 1, src_location: 2, dst_location: 3, qty: 10, reason: 'restock showroom' },
  });
  assert.strictEqual(tr.a.status, 201);
  assert.strictEqual(shapeOf(tr.a.json), shapeOf(tr.b.json), 'create transfer shapes');

  // Invalid inputs 400 identically.
  await both('POST /api/stock-adjustments (bad qty)', '/api/stock-adjustments', {
    method: 'POST', auth: 'admin', body: { product_id: 1, location_id: 1, new_qty: -5 },
  });
  await both('POST /api/stock-transfers (same location)', '/api/stock-transfers', {
    method: 'POST', auth: 'admin', body: { product_id: 1, src_location: 1, dst_location: 1, qty: 5 },
  });
  await both('POST /api/stock-transfers (bad product)', '/api/stock-transfers', {
    method: 'POST', auth: 'admin', body: { product_id: 99999, src_location: 1, dst_location: 2, qty: 5 },
  });

  // Approve the adjustment on each side (each side has its own id).
  const listA = await call(sqlite.url, '/api/stock-adjustments', { token: sqlite.token.admin });
  const listB = await call(npmfree.url, '/api/stock-adjustments', { token: npmfree.token.admin });
  const idA = listA.json[0].id;
  const idB = listB.json[0].id;
  assert.strictEqual(shapeOf(listA.json[0]), shapeOf(listB.json[0]), 'adjustment row shape parity');

  const appr = await both('POST approve adjustment', `/api/stock-adjustments/${idA}/approve`, {
    method: 'POST', auth: 'admin',
  });
  assert.strictEqual(appr.a.status, 200);
  await call(npmfree.url, `/api/stock-adjustments/${idB}/approve`, { method: 'POST', token: npmfree.token.admin });

  // Approving an approved adjustment 400s identically.
  await both('POST approve adjustment (already decided)', `/api/stock-adjustments/${idA}/approve`, {
    method: 'POST', auth: 'admin',
  });

  // Approve the transfer per-side.
  const tlistA = await call(sqlite.url, '/api/stock-transfers', { token: sqlite.token.admin });
  const tlistB = await call(npmfree.url, '/api/stock-transfers', { token: npmfree.token.admin });
  assert.strictEqual(shapeOf(tlistA.json[0]), shapeOf(tlistB.json[0]), 'transfer row shape parity');
  const tidA = tlistA.json[0].id;
  const tidB = tlistB.json[0].id;
  await both('POST approve transfer', `/api/stock-transfers/${tidA}/approve`, {
    method: 'POST', auth: 'admin',
  });
  await call(npmfree.url, `/api/stock-transfers/${tidB}/approve`, { method: 'POST', token: npmfree.token.admin });

  // The movement ledger now contains adjustment + transfer rows on both sides.
  const movA = await call(sqlite.url, '/api/stock-movements?type=transfer', { token: sqlite.token.admin });
  const movB = await call(npmfree.url, '/api/stock-movements?type=transfer', { token: npmfree.token.admin });
  assert.strictEqual(shapeOf(movA.json), shapeOf(movB.json), 'movement ledger parity');

  // Reject flow on a fresh request (product 3 stays active in this suite;
  // product 2 was soft-deleted by an earlier contract test).
  await both('POST /api/stock-transfers (reject me)', '/api/stock-transfers', {
    method: 'POST', auth: 'admin', body: { product_id: 3, src_location: 1, dst_location: 3, qty: 3, reason: 'cancel' },
  });
  const rlistA = await call(sqlite.url, '/api/stock-transfers?status=pending', { token: sqlite.token.admin });
  const rlistB = await call(npmfree.url, '/api/stock-transfers?status=pending', { token: npmfree.token.admin });
  await both('POST reject transfer', `/api/stock-transfers/${rlistA.json[0].id}/reject`, {
    method: 'POST', auth: 'admin',
  });
  await call(npmfree.url, `/api/stock-transfers/${rlistB.json[0].id}/reject`, { method: 'POST', token: npmfree.token.admin });

  // Status filter + full list still parity.
  await both('GET /api/stock-adjustments?status=approved', '/api/stock-adjustments?status=approved', { auth: 'admin' });
  await both('GET /api/stock-transfers', '/api/stock-transfers', { auth: 'admin' });
  await both('GET /api/approvals (empty pending)', '/api/approvals', { auth: 'admin' });
});

test('contract: approving a stale request (inactive product / gone location) 400s identically', async () => {
  // Deactivate product 1 on both backends (contract parity of the soft delete),
  // then a pending adjustment created earlier would fail to approve.
  await call(sqlite.url, '/api/products/1', { method: 'DELETE', token: sqlite.token.admin });
  await call(npmfree.url, '/api/products/1', { method: 'DELETE', token: npmfree.token.admin });

  const stale = await both('POST /api/stock-adjustments (stale product)', '/api/stock-adjustments', {
    method: 'POST', auth: 'admin', body: { product_id: 1, location_id: 1, new_qty: 999, reason: 'stale test' },
  });
  assert.strictEqual(stale.a.status, 404, 'inactive product 404s on create (sqlite)');
  assert.strictEqual(stale.b.status, 404, 'inactive product 404s on create (npmfree)');

  // Create against an active product, THEN deactivate it, then try to approve.
  const created = await both('POST /api/stock-adjustments (will go stale)', '/api/stock-adjustments', {
    method: 'POST', auth: 'admin', body: { product_id: 3, location_id: 1, new_qty: 250, reason: 'stale approve test' },
  });
  assert.strictEqual(created.a.status, 201);
  assert.strictEqual(created.b.status, 201);
  await call(sqlite.url, '/api/products/3', { method: 'DELETE', token: sqlite.token.admin });
  await call(npmfree.url, '/api/products/3', { method: 'DELETE', token: npmfree.token.admin });

  const listA = await call(sqlite.url, '/api/stock-adjustments?status=pending', { token: sqlite.token.admin });
  const listB = await call(npmfree.url, '/api/stock-adjustments?status=pending', { token: npmfree.token.admin });
  assert.strictEqual(shapeOf(listA.json), shapeOf(listB.json), 'pending adjustment list shape parity');
  const apprA = await call(sqlite.url, `/api/stock-adjustments/${listA.json[0].id}/approve`, { method: 'POST', token: sqlite.token.admin });
  const apprB = await call(npmfree.url, `/api/stock-adjustments/${listB.json[0].id}/approve`, { method: 'POST', token: npmfree.token.admin });
  assert.strictEqual(apprA.status, 400, 'sqlite: stale approve 400');
  assert.strictEqual(apprB.status, 400, 'npmfree: stale approve 400');
  assert.strictEqual(shapeOf(apprA.json), shapeOf(apprB.json), 'stale approve error shapes');
});

test('contract: deleting a location referenced by adjustments/transfers 400s identically', async () => {
  // Create an adjustment on location 1, then attempt to delete location 1.
  await both('POST /api/stock-adjustments (loc guard)', '/api/stock-adjustments', {
    method: 'POST', auth: 'admin', body: { product_id: 4, location_id: 1, new_qty: 100, reason: 'location guard' },
  });
  const delA = await call(sqlite.url, '/api/locations/1', { method: 'DELETE', token: sqlite.token.admin });
  const delB = await call(npmfree.url, '/api/locations/1', { method: 'DELETE', token: npmfree.token.admin });
  assert.strictEqual(delA.status, 400, 'sqlite blocks location delete');
  assert.strictEqual(delB.status, 400, 'npmfree blocks location delete');
  assert.strictEqual(shapeOf(delA.json), shapeOf(delB.json), 'location-delete guard shapes');
});

test('contract: reports endpoint exposes the printable report shape identically', async () => {
  const res = await both('GET /api/reports', '/api/reports', { auth: 'admin' });
  assert.strictEqual(res.a.status, 200);
  assert.strictEqual(shapeOf(res.a.json), shapeOf(res.b.json), 'reports shape parity');
  for (const side of [sqlite, npmfree]) {
    const body = side === sqlite ? res.a.json : res.b.json;
    assert.ok(body.generated_at, `${side} generated_at`);
    assert.ok(Array.isArray(body.dailySales), `${side} dailySales`);
    assert.ok(Array.isArray(body.stockByLocation), `${side} stockByLocation`);
    assert.ok(body.orderStatusSummary && typeof body.orderStatusSummary === 'object', `${side} orderStatusSummary`);
    assert.ok(Array.isArray(body.lowStock), `${side} lowStock`);
    assert.ok(Array.isArray(body.fastMovers), `${side} fastMovers`);
    assert.ok(Array.isArray(body.slowMovers), `${side} slowMovers`);
    assert.ok(body.summary && Number.isFinite(body.summary.total_products), `${side} summary.total_products`);
    assert.ok(Number.isFinite(body.summary.transactions), `${side} summary.transactions`);
  }
  // Auth: reports + approvals require an admin token.
  await both('GET /api/reports (no token)', '/api/reports', {});
  await both('GET /api/approvals (no token)', '/api/approvals', {});
});

// ===== Analytics extensions =====

test('contract: analytics summary exposes the new dashboard data identically', async () => {
  const res = await both('analytics summary', '/api/analytics/summary', {});
  for (const side of [sqlite, npmfree]) {
    const body = side === sqlite ? res.a.json : res.b.json;
    assert.ok(Array.isArray(body.lowStockList), `${side} lowStockList`);
    assert.ok(Array.isArray(body.stockByLocation), `${side} stockByLocation`);
    assert.ok(Array.isArray(body.fastMovingProducts), `${side} fastMovingProducts`);
    assert.ok(Array.isArray(body.slowMovingProducts), `${side} slowMovingProducts`);
    assert.ok(Array.isArray(body.dailySalesValue), `${side} dailySalesValue`);
    assert.ok(Number.isFinite(body.transactionCount), `${side} transactionCount`);
    assert.ok(Number.isFinite(body.customersServed), `${side} customersServed`);
    assert.ok(body.orderStatusSummary && typeof body.orderStatusSummary === 'object', `${side} orderStatusSummary`);
    assert.ok(body.stockByLocation.length >= 1, `${side} has per-location stock`);
    assert.ok(body.stockByLocation[0].location, `${side} location name`);
  }
});

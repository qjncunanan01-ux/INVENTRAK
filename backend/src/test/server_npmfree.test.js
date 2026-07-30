const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../server_npmfree');

let server;
let baseUrl;

before(() => {
  server = createServer(0);
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
    body: JSON.stringify({ username: 'tester', password: 'anypass' }),
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.user.username, 'tester');
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
  const { status, body } = await request('/api/stock-movement', {
    method: 'POST',
    body: JSON.stringify({ product_id: 1, qty: 3, type: 'stock-in', dst_location: 'Showroom' }),
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
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
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
});

test('GET /api/order-inquiries returns inquiries', async () => {
  const { status, body } = await request('/api/order-inquiries');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body));
});

test('CRUD locations', async () => {
  const createRes = await request('/api/locations', {
    method: 'POST',
    body: JSON.stringify({ name: 'Test Loc' }),
  });
  assert.strictEqual(createRes.status, 200);
  assert.ok(createRes.body.id);
});

test('GET /api/nonexistent returns 404', async () => {
  const { status } = await request('/api/nonexistent');
  assert.strictEqual(status, 404);
});

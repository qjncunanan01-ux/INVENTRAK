const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, seedDatabase } = require('../app');
const http = require('node:http');

let server;
let baseUrl;

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
  const res = await fetch(`${baseUrl}${path}`, options);
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

test('POST /api/order-inquiries stores inquiry and GET /api/order-inquiries returns it', async () => {
  const payload = {
    customer_name: 'Test User',
    customer_email: 'test@example.com',
    products: ['Test Widget x2'],
    estimated_cost: 200,
    notes: 'Please contact me',
  };

  const postResponse = await request('/api/order-inquiries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.strictEqual(postResponse.status, 200);
  assert.strictEqual(postResponse.body.ok, true);

  const getResponse = await request('/api/order-inquiries');
  assert.strictEqual(getResponse.status, 200);
  assert.ok(Array.isArray(getResponse.body));
  assert.ok(getResponse.body.some(item => item.customer_email === payload.customer_email));
});

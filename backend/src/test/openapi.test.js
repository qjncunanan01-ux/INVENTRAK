// OpenAPI conformance test: boots the SQLite backend and the npm-free
// fallback side by side, then drives every documented operation and validates
// the ACTUAL responses (and the request bodies we send) against the schemas in
// backend/openapi.json using ajv.
//
// This is the drift guard: even if both backends happen to agree on some shape,
// the spec is the source of truth for what they MAY return. A response that
// violates its schema (or a status code that is not documented) fails here.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const spec = require('../../openapi.json');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

// ---- Schema preparation ---------------------------------------------------
// OpenAPI 3.0 uses `nullable: true` (not part of JSON Schema draft-07) and
// `$ref` components. We dereference and normalize so ajv validates exactly
// what the spec declares.
//
// Two strictness rules keep the guard honest:
//   - `nullable: true` becomes a `null`-union type (ajv has no native support)
//   - object schemas with declared `properties` get `additionalProperties:
//     false` so a field that the backends add without updating the spec fails
//     validation — the exact "both backends happen to agree" drift scenario.
const derefSeen = new Set();
function prepare(node) {
  if (Array.isArray(node)) return node.map(prepare);
  if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/components/schemas/')) {
      const name = node.$ref.split('/').pop();
      if (derefSeen.has(name)) return { type: 'object' }; // cycle guard
      derefSeen.add(name);
      const resolved = prepare(spec.components.schemas[name]);
      derefSeen.delete(name);
      return resolved;
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'example') continue; // metadata, not validation
      if (k === 'nullable' && v === true) {
        // `type: X, nullable: true` -> `type: [X, 'null']`
        if (typeof out.type === 'string') out.type = [out.type, 'null'];
        else if (Array.isArray(out.type)) out.type = [...out.type, 'null'];
        else out.type = ['null'];
        continue;
      }
      out[k] = prepare(v);
    }
    if (out.properties && out.additionalProperties === undefined) {
      out.additionalProperties = false;
    }
    return out;
  }
  return node;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validators = new Map();
function validatorFor(schema) {
  const key = JSON.stringify(schema);
  if (!validators.has(key)) validators.set(key, ajv.compile(prepare(schema)));
  return validators.get(key);
}

// Resolves a concrete request path (/api/products/1) to its templated spec
// path (/api/products/{id}) by matching segment by segment.
function matchTemplatePath(concrete) {
  if (spec.paths[concrete]) return concrete;
  const parts = concrete.split('/');
  for (const candidate of Object.keys(spec.paths)) {
    const cParts = candidate.split('/');
    if (cParts.length !== parts.length) continue;
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const isParam = /^\{[^}]+\}$/.test(cParts[i]);
      if (!isParam && cParts[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return candidate;
  }
  return null;
}

function operationFor(method, pathname) {
  const clean = pathname.split('?')[0];
  const template = matchTemplatePath(clean);
  const item = template && spec.paths[template][method.toLowerCase()];
  if (!item) throw new Error(`Operation ${method} ${clean} not documented in openapi.json`);
  return item;
}

function jsonSchemaOf(operation, status) {
  const response = operation.responses && operation.responses[String(status)];
  if (!response) return null; // status not documented -> handled by caller
  const content = response.content && response.content['application/json'];
  return (content && content.schema) || null;
}

function errorsText(validate) {
  return JSON.stringify(validate.errors || [], null, 1);
}

// Validates a single backend's response + our request body against the spec.
async function assertConform(label, side, method, pathname, { auth = null, body, checkRequest = true } = {}) {
  const res = await call(side.url, pathname, {
    method,
    body,
    token: auth ? side.token[auth] : null,
  });

  const op = operationFor(method, pathname);

  // 1. The status code we got must be documented.
  assert.ok(
    op.responses && op.responses[String(res.status)],
    `${label} (${side.name}): status ${res.status} for ${method} ${pathname} is NOT documented in openapi.json. Documented: ${Object.keys(op.responses || {}).join(', ')}`
  );

  // 2. The request body we sent must conform to the documented requestBody.
  //    (Negative cases that are deliberately invalid set checkRequest: false.)
  const rb = op.requestBody && op.requestBody.content && op.requestBody.content['application/json'];
  if (checkRequest && body !== undefined && rb && rb.schema) {
    const v = validatorFor(rb.schema);
    const ok = v(body);
    assert.ok(
      ok,
      `${label} (${side.name}): request body violates ${method} ${pathname} schema:\n${errorsText(v)}`
    );
  }

  // 3. The response body must conform to the documented schema for that status.
  const schema = jsonSchemaOf(op, res.status);
  if (schema && res.json !== null) {
    const v = validatorFor(schema);
    const ok = v(res.json);
    assert.ok(
      ok,
      `${label} (${side.name}): response body violates ${method} ${pathname} [${res.status}] schema:\n${errorsText(v)}\n  body: ${JSON.stringify(res.json).slice(0, 400)}`
    );
  }
  return res;
}

// Runs a scenario against BOTH backends and validates each one independently.
async function bothConform(label, method, pathname, opts = {}) {
  const a = await assertConform(label, { ...sqlite, name: 'sqlite' }, method, pathname, opts);
  const b = await assertConform(label, { ...npmfree, name: 'npmfree' }, method, pathname, opts);
  assert.strictEqual(a.status, b.status, `${label}: status mismatch ${a.status} vs ${b.status}`);
  return { a, b };
}

before(async () => {
  await bootBoth();
});

after(() => {
  teardown();
});

// ===== Spec structure =====

test('openapi: every operation in the spec has an operationId', () => {
  for (const [p, m] of Object.entries(spec.paths)) {
    for (const [meth, op] of Object.entries(m)) {
      if (!['get', 'post', 'put', 'delete'].includes(meth)) continue;
      assert.ok(op.operationId, `${meth.toUpperCase()} ${p} must declare operationId`);
    }
  }
});

test('openapi: both servers serve the identical, valid spec document', async () => {
  for (const side of [{ ...sqlite, name: 'sqlite' }, { ...npmfree, name: 'npmfree' }]) {
    const res = await call(side.url, '/api/openapi.json');
    assert.strictEqual(res.status, 200, `${side.name} serves spec`);
    assert.deepStrictEqual(res.json, spec, `${side.name} serves the committed spec`);
  }
  const s = await call(sqlite.url, '/api/docs');
  assert.strictEqual(s.status, 200);
  assert.match(s.contentType, /text\/html/);
});

// ===== Auth =====

test('openapi: register validates request + response', async () => {
  const username = `openapi_user_${Date.now()}`;
  await bothConform('register', 'POST', '/api/auth/register', {
    body: { username, password: 'test123', email: `${username}@example.com` },
  });
  await bothConform('register duplicate', 'POST', '/api/auth/register', {
    body: { username, password: 'test123', email: `${username}@example.com` },
  });
  await bothConform('register invalid', 'POST', '/api/auth/register', {
    body: { username: 'x', password: '123' }, checkRequest: false,
  });
});

test('openapi: login happy path + failure', async () => {
  await bothConform('login admin', 'POST', '/api/auth/login', {
    body: { username: 'admin', password: 'admin123' },
  });
  await bothConform('login bad password', 'POST', '/api/auth/login', {
    body: { username: 'admin', password: 'nope' },
  });
});

test('openapi: /api/auth/me for valid, missing, and invalid tokens', async () => {
  await bothConform('me valid', 'GET', '/api/auth/me', { auth: 'admin' });
  await bothConform('me no token', 'GET', '/api/auth/me');
  await bothConform('me invalid token', 'GET', '/api/auth/me', { auth: 'invalid' });
});

// ===== Products =====

test('openapi: products list (array + paginated), categories, by-id, 404', async () => {
  await bothConform('products list', 'GET', '/api/products');
  await bothConform('products paginated', 'GET', '/api/products?page=1&limit=3');
  await bothConform('products search', 'GET', '/api/products?search=a');
  await bothConform('products categories', 'GET', '/api/products/categories');
  await bothConform('product by id', 'GET', '/api/products/1');
  await bothConform('product 404', 'GET', '/api/products/99999');
});

test('openapi: product CRUD + auth enforcement', async () => {
  const payload = { name: 'OpenAPI Widget', category: 'OpenAPI', price: 42 };
  const s = await assertConform('create product', { ...sqlite, name: 'sqlite' }, 'POST', '/api/products', {
    auth: 'admin', body: payload,
  });
  const n = await assertConform('create product', { ...npmfree, name: 'npmfree' }, 'POST', '/api/products', {
    auth: 'admin', body: payload,
  });
  assert.strictEqual(s.status, 201);
  assert.strictEqual(n.status, 201);

  const body = { name: 'OpenAPI Widget v2', category: 'OpenAPI', price: 50, status: 'active' };
  await bothConform('update product', 'PUT', `/api/products/${s.json.id}`, { auth: 'admin', body });
  await bothConform('delete product', 'DELETE', `/api/products/${s.json.id}`, { auth: 'admin' });
  await bothConform('update 404', 'PUT', '/api/products/99999', { auth: 'admin', body });
  await bothConform('create no token', 'POST', '/api/products', { body: payload });
  await bothConform('create customer forbidden', 'POST', '/api/products', { auth: 'customer', body: payload });
});

// ===== Inventory & Locations =====

test('openapi: inventory list + low stock + location filter', async () => {
  await bothConform('inventory', 'GET', '/api/inventory');
  await bothConform('inventory low stock', 'GET', '/api/inventory?low_stock=true');
  await bothConform('inventory by location', 'GET', '/api/inventory?location=Showroom');
});

test('openapi: locations list/create/duplicate/delete', async () => {
  await bothConform('locations', 'GET', '/api/locations');
  const name = `OpenAPI Loc ${Date.now()}`;
  const s = await assertConform('create location', { ...sqlite, name: 'sqlite' }, 'POST', '/api/locations', {
    auth: 'admin', body: { name },
  });
  const n = await assertConform('create location', { ...npmfree, name: 'npmfree' }, 'POST', '/api/locations', {
    auth: 'admin', body: { name },
  });
  assert.strictEqual(s.status, 201);
  assert.strictEqual(n.status, 201);
  await bothConform('location duplicate', 'POST', '/api/locations', { auth: 'admin', body: { name } });
  await bothConform('delete location', 'DELETE', `/api/locations/${s.json.id}`, { auth: 'admin' });
  await bothConform('delete location 404', 'DELETE', '/api/locations/99999', { auth: 'admin' });
});

// ===== Stock Movements =====

test('openapi: stock movement + movements list + lots', async () => {
  await bothConform('stock-in', 'POST', '/api/stock-movement', {
    auth: 'admin', body: { product_id: 1, qty: 10, type: 'stock-in', dst_location: 1, notes: 'openapi' },
  });
  await bothConform('invalid type', 'POST', '/api/stock-movement', {
    auth: 'admin', body: { product_id: 1, qty: 1, type: 'bogus', dst_location: 1 }, checkRequest: false,
  });
  await bothConform('insufficient stock', 'POST', '/api/stock-movement', {
    auth: 'admin', body: { product_id: 1, qty: 999999, type: 'stock-out', src_location: 1 },
  });
  await bothConform('movement no token', 'POST', '/api/stock-movement', {
    body: { product_id: 1, qty: 1, type: 'stock-in', dst_location: 1 },
  });
  await bothConform('movements list', 'GET', '/api/stock-movements');
  await bothConform('movements paginated', 'GET', '/api/stock-movements?page=1&limit=2');
  await bothConform('lots', 'GET', '/api/stock-lots');
  await bothConform('lots filtered', 'GET', '/api/stock-lots?product_id=1');
});

// ===== Order Inquiries =====

test('openapi: order inquiries lifecycle', async () => {
  const payload = {
    customer_name: 'OpenAPI Customer',
    customer_email: 'openapi@example.com',
    products: ['Widget x2'],
    estimated_cost: 120,
    notes: 'openapi test',
  };
  await bothConform('create inquiry', 'POST', '/api/order-inquiries', { body: payload });
  await bothConform('inquiry missing email', 'POST', '/api/order-inquiries', {
    body: { customer_name: 'No Email' }, checkRequest: false,
  });
  await bothConform('inquiries list', 'GET', '/api/order-inquiries', { auth: 'customer' });
  await bothConform('inquiries by status', 'GET', '/api/order-inquiries?status=pending', { auth: 'customer' });
  await bothConform('inquiries list no token', 'GET', '/api/order-inquiries');

  const s = await call(sqlite.url, '/api/order-inquiries', { token: sqlite.token.customer });
  const n = await call(npmfree.url, '/api/order-inquiries', { token: npmfree.token.customer });
  assert.ok(s.json.length > 0 && n.json.length > 0);
  const sId = s.json[0].id;
  const nId = n.json[0].id;
  await bothConform('update inquiry', 'PUT', `/api/order-inquiries/${sId}`, {
    auth: 'admin', body: { status: 'approved' },
  });
  await bothConform('update inquiry 404', 'PUT', '/api/order-inquiries/99999', {
    auth: 'admin', body: { status: 'approved' },
  });
  // nId used only to keep parity with the contract suite's shape checks.
  void nId;
});

// ===== Optimization =====

test('openapi: optimization bulk, abc, per-product, 404', async () => {
  await bothConform('optimization bulk', 'GET', '/api/optimization');
  await bothConform('optimization abc', 'GET', '/api/optimization/abc');
  await bothConform('optimization per product', 'GET', '/api/optimization/1');
  await bothConform('optimization 404', 'GET', '/api/optimization/99999');
});

// ===== Analytics =====

test('openapi: analytics summary + exports', async () => {
  await bothConform('analytics summary', 'GET', '/api/analytics/summary');
  await bothConform('export products', 'GET', '/api/analytics/export/products', { auth: 'admin' });
  await bothConform('export inventory', 'GET', '/api/analytics/export/inventory', { auth: 'admin' });
  await bothConform('export movements', 'GET', '/api/analytics/export/movements', { auth: 'admin' });
  await bothConform('export bogus type', 'GET', '/api/analytics/export/bogus', { auth: 'admin' });
  await bothConform('export no token', 'GET', '/api/analytics/export/products');
});

// ===== Sales & Users =====

test('openapi: sales + users', async () => {
  await bothConform('create sale', 'POST', '/api/sales', {
    auth: 'admin', body: { product_id: 1, qty: 2, customer_name: 'Buyer' },
  });
  await bothConform('sale no token', 'POST', '/api/sales', {
    body: { product_id: 1, qty: 2 },
  });
  await bothConform('sales list', 'GET', '/api/sales', { auth: 'admin' });
  await bothConform('sales list no token', 'GET', '/api/sales');
  await bothConform('users', 'GET', '/api/users', { auth: 'admin' });
  await bothConform('users no token', 'GET', '/api/users');
  await bothConform('users customer forbidden', 'GET', '/api/users', { auth: 'customer' });
});

// ===== Alerts =====

test('openapi: alerts lifecycle conforms', async () => {
  await bothConform('alerts initial', 'GET', '/api/alerts', { auth: 'admin' });

  // Drive product 1 / location 1 below the 80-unit threshold on both backends.
  await bothConform('adjust low', 'POST', '/api/stock-movement', {
    auth: 'admin', body: { product_id: 1, qty: 5, type: 'adjustment', dst_location: 1 },
  });
  await bothConform('drain', 'POST', '/api/stock-movement', {
    auth: 'admin', body: { product_id: 1, qty: 5, type: 'stock-out', src_location: 1 },
  });

  const s = await call(sqlite.url, '/api/alerts', { token: sqlite.token.admin });
  const n = await call(npmfree.url, '/api/alerts', { token: npmfree.token.admin });
  assert.ok(s.json.length > 0, 'sqlite alert created');
  assert.ok(n.json.length > 0, 'npmfree alert created');

  await bothConform('resolve alert', 'PUT', `/api/alerts/${s.json[0].id}/resolve`, { auth: 'admin' });
  await bothConform('resolve 404', 'PUT', '/api/alerts/99999/resolve', { auth: 'admin' });
});

// ===== 404s =====

test('openapi: unknown routes return documented-ish JSON 404', async () => {
  // Unknown routes are NOT documented operations; the contract suite covers
  // parity. Here we only assert both backends return the same JSON 404 shape.
  const s = await call(sqlite.url, '/api/does-not-exist');
  const n = await call(npmfree.url, '/api/does-not-exist');
  assert.strictEqual(s.status, n.status);
  assert.deepStrictEqual(s.json, n.json);
});

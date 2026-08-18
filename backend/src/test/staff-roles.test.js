// Staff-role access control tests (OWASP: role-based access control / least
// privilege). Staff accounts may propose stock adjustments and transfers,
// view their lists, scan for stock levels, and view reports — but every
// decision and admin write (approvals, products, orders, locations, sales,
// users) stays admin-only. Runs against BOTH backends through the harness so
// the split stays in parity.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { sqlite, npmfree, bootBoth, teardown, call, both } = require('./harness');

before(async () => {
  await bootBoth();
  // Log the demo staff account in on both backends and stash the tokens so
  // the `both` parity helper can use them.
  for (const side of [sqlite, npmfree]) {
    const res = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: 'staff', password: 'staff123' },
    });
    assert.strictEqual(res.status, 200, 'staff login must succeed');
    side.token.staff = res.json.token;
  }
});
after(() => {
  teardown();
});

// Grab a real product + two locations from the public endpoints so the
// adjustment/transfer bodies pass validation.
async function sampleRefs(url) {
  const products = await call(url, '/api/products');
  const locations = await call(url, '/api/locations');
  const product = products.json.find((p) => p.status === 'active') || products.json[0];
  const locs = locations.json.slice(0, 2);
  return { product, src: locs[0], dst: locs[1] };
}

test('staff can create and list stock adjustments on both backends', async () => {
  const { product, src } = await sampleRefs(sqlite.url);
  for (const side of [sqlite, npmfree]) {
    const created = await call(side.url, '/api/stock-adjustments', {
      method: 'POST',
      token: side.token.staff,
      body: { product_id: product.id, location_id: src.id, new_qty: 42, reason: 'staff-count correction' },
    });
    assert.strictEqual(created.status, 201, `staff POST adjustment ${side.url}`);
    const list = await call(side.url, '/api/stock-adjustments', { token: side.token.staff });
    assert.strictEqual(list.status, 200, `staff GET adjustments ${side.url}`);
    assert.ok(Array.isArray(list.json), 'adjustment list is an array');
  }
});

test('staff can create and list stock transfers on both backends', async () => {
  const { product, src, dst } = await sampleRefs(sqlite.url);
  for (const side of [sqlite, npmfree]) {
    const created = await call(side.url, '/api/stock-transfers', {
      method: 'POST',
      token: side.token.staff,
      body: { product_id: product.id, src_location: src.id, dst_location: dst.id, qty: 2, reason: 'staff move' },
    });
    assert.strictEqual(created.status, 201, `staff POST transfer ${side.url}`);
    const list = await call(side.url, '/api/stock-transfers', { token: side.token.staff });
    assert.strictEqual(list.status, 200, `staff GET transfers ${side.url}`);
  }
});

test('staff can view reports and export analytics; customers cannot', async () => {
  const r = await both('staff reports', '/api/reports?days=14', { auth: 'staff' });
  assert.strictEqual(r.a.status, 200, 'staff reports must be 200');
  const exportRes = await both('staff analytics export', '/api/analytics/export/products?format=csv', { auth: 'staff' });
  assert.strictEqual(exportRes.a.status, 200, 'staff analytics export must be 200');
  const denied = await both('customer reports', '/api/reports?days=14', { auth: 'customer' });
  assert.strictEqual(denied.a.status, 403, 'customer reports must stay 403');
});

test('staff can use Scan & Stock; customers cannot', async () => {
  const staff = await both('staff scan', '/api/ocr/stock', { method: 'POST', auth: 'staff', body: {} });
  // Empty body hits OCR input validation (400), NOT the role gate (403).
  assert.strictEqual(staff.a.status, 400, 'staff reaches OCR validation');
  const customer = await both('customer scan', '/api/ocr/stock', { method: 'POST', auth: 'customer', body: {} });
  assert.strictEqual(customer.a.status, 403, 'customer is role-blocked from stock scan');
});

test('staff cannot approve, decide, or touch admin-only modules', async () => {
  const { product, src } = await sampleRefs(sqlite.url);
  for (const side of [sqlite, npmfree]) {
    const created = await call(side.url, '/api/stock-adjustments', {
      method: 'POST',
      token: side.token.staff,
      body: { product_id: product.id, location_id: src.id, new_qty: 7, reason: 'pending for approval' },
    });
    assert.strictEqual(created.status, 201);

    const id = created.json.id;
    const checks = [
      ['/api/approvals', 'GET'],
      [`/api/stock-adjustments/${id}/approve`, 'POST'],
      [`/api/stock-adjustments/${id}/reject`, 'POST'],
      ['/api/products', 'POST'],
      ['/api/locations', 'POST'],
      ['/api/users', 'GET'],
      ['/api/sales', 'GET'],
      ['/api/stock-movement', 'POST'],
      ['/api/order-inquiries/1', 'PUT'],
      ['/api/health/integrity', 'GET'],
    ];
    for (const [path, method] of checks) {
      const res = await call(side.url, path, {
        method,
        token: side.token.staff,
        body: method === 'POST' || method === 'PUT' ? {} : undefined,
      });
      assert.strictEqual(res.status, 403, `staff ${method} ${path} on ${side.url} must be 403 (got ${res.status})`);
    }
  }
});

test('staff login is rejected as a customer-grade account for admin writes', async () => {
  // The admin dashboard gate (LoginPage) allows staff — but the backend still
  // refuses staff on the approve route that powers the Approvals page, so a
  // staff token can never change real data.
  const approvals = await both('staff approvals', '/api/approvals', { auth: 'staff' });
  assert.strictEqual(approvals.a.status, 403);
});

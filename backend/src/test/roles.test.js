// Four-role RBAC (see backend/src/roles.js): owner, super_admin, admin, staff.
//
// The role spec splits the admin portal into:
//   owner / super_admin / admin  → the whole portal including money surfaces
//   staff                        → daily inventory work only, NEVER sales,
//                                  prices, customers, orders, reports or
//                                  business analytics
//   super_admin / owner only     → account, role and permission management
//
// Runs against BOTH backends through the shared harness so the split can never
// drift between the SQLite backend and the npm-free fallback.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { sqlite, npmfree, bootBoth, teardown, call, both } = require('./harness');

before(async () => {
  await bootBoth();
});
after(() => {
  teardown();
});

const ADMIN_TIER = ['admin', 'super_admin', 'owner'];
// Role → harness token key. The demo login names differ from the role names
// (super_admin signs in as `superadmin`), and the harness stores tokens per
// login, so tests must map between them.
const TOKEN_KEY = { admin: 'admin', super_admin: 'superadmin', owner: 'owner', staff: 'staff', customer: 'customer' };

test('every seeded role can log in and reports its role', async () => {
  const cases = [
    ['admin', 'admin'],
    ['super_admin', 'superadmin'],
    ['owner', 'owner'],
    ['staff', 'staff'],
    ['customer', 'customer'],
  ];
  for (const [expectedRole, tokenKey] of cases) {
    assert.strictEqual(TOKEN_KEY[expectedRole], tokenKey, 'TOKEN_KEY map stays in sync');
    for (const side of [sqlite, npmfree]) {
      assert.ok(side.token[tokenKey], `${tokenKey} token on ${side.url}`);
      const me = await call(side.url, '/api/auth/me', { token: side.token[tokenKey] });
      assert.strictEqual(me.status, 200, `${expectedRole} /api/auth/me ${side.url}`);
      assert.strictEqual(me.json.role, expectedRole, `${tokenKey} role`);
    }
  }
});

test('the admin tier (admin, super_admin, owner) can read every money surface', async () => {
  for (const role of ADMIN_TIER) {
    const auth = TOKEN_KEY[role];
    const summary = await both(`${role} analytics summary`, '/api/analytics/summary', { auth });
    assert.strictEqual(summary.a.status, 200, `${role} analytics summary`);

    const reports = await both(`${role} reports`, '/api/reports?days=14', { auth });
    assert.strictEqual(reports.a.status, 200, `${role} reports`);

    const users = await both(`${role} users`, '/api/users', { auth });
    assert.strictEqual(users.a.status, 200, `${role} users`);
  }
});

test('inventory staff are blocked from every money surface', async () => {
  const blocked = [
    ['/api/analytics/summary', 'GET'],
    ['/api/reports?days=14', 'GET'],
    ['/api/analytics/export/products', 'GET'],
    ['/api/sales', 'GET'],
    ['/api/alerts', 'GET'],
    ['/api/users', 'GET'],
    ['/api/health/integrity', 'GET'],
  ];
  for (const [path, method] of blocked) {
    const res = await both(`staff blocked ${path}`, path, { method, auth: 'staff' });
    assert.strictEqual(res.a.status, 403, `staff must be 403 on ${path}`);
  }
});

test('inventory staff keep the daily inventory + scanning modules', async () => {
  const allowed = [
    ['/api/inventory', 'GET'],
    ['/api/stock-movements', 'GET'],
    ['/api/stock-lots', 'GET'],
    ['/api/stock-adjustments', 'GET'],
    ['/api/stock-transfers', 'GET'],
  ];
  for (const [path, method] of allowed) {
    const res = await both(`staff allowed ${path}`, path, { method, auth: 'staff' });
    assert.strictEqual(res.a.status, 200, `staff must reach ${path}`);
  }
});

test('the web-portal flag refuses staff (mobile-only); the same account signs in on mobile', async () => {
  for (const side of [sqlite, npmfree]) {
    // Portal login (portal: 'admin' — what the web admin sends): refused with
    // a specific, actionable code, never a session.
    const denied = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: 'staff', password: 'staff123', portal: 'admin' },
    });
    assert.strictEqual(denied.status, 403, 'staff + portal must be 403');
    assert.strictEqual(denied.json.code, 'portal_mobile_only');
    assert.ok(denied.json.error, 'an explanation ships with the refusal');

    // The SAME account without the flag (the mobile app's login) still gets
    // a full session — staff tools live on the phone by design.
    const mobile = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: 'staff', password: 'staff123' },
    });
    assert.strictEqual(mobile.status, 200, 'staff without portal flag = mobile login');
    assert.strictEqual(mobile.json.user.role, 'staff');
    assert.ok(mobile.json.token, 'mobile staff get a session token');

    // Every admin-tier role passes the portal gate.
    const adminLogins = [
      ['admin', 'admin123'],
      ['superadmin', 'super123'],
      ['owner', 'owner123'],
    ];
    for (const [username, password] of adminLogins) {
      const ok = await call(side.url, '/api/auth/login', {
        method: 'POST',
        body: { username, password, portal: 'admin' },
      });
      assert.strictEqual(ok.status, 200, `${username} passes the portal gate`);
    }
  }
});

test('management tier may grant privileged roles; a plain admin may not', async () => {
  // A plain admin can grant staff/admin …
  const ownerRole = await both(
    'admin grants staff',
    '/api/admin/promote',
    { method: 'POST', auth: 'admin', body: { username: 'staff', role: 'staff' } }
  );
  assert.strictEqual(ownerRole.a.status, 200, 'admin may re-assign the staff role');

  // … but NOT the privileged roles.
  const denied = await both(
    'admin grants owner',
    '/api/admin/promote',
    { method: 'POST', auth: 'admin', body: { username: 'customer', role: 'owner' } }
  );
  assert.strictEqual(denied.a.status, 403, 'a plain admin must not mint an owner');

  // The management tier can.
  const promoted = await both(
    'owner grants super_admin',
    '/api/admin/promote',
    { method: 'POST', auth: 'owner', body: { username: 'customer', role: 'super_admin' } }
  );
  assert.strictEqual(promoted.a.status, 200, 'owner may grant super_admin');

  // Unknown roles are rejected outright.
  const bogus = await both(
    'owner grants bogus role',
    '/api/admin/promote',
    { method: 'POST', auth: 'owner', body: { username: 'customer', role: 'root' } }
  );
  assert.strictEqual(bogus.a.status, 400, 'unknown role must be rejected');

  // Put the demo customer back so later files in the same process see it.
  await both('restore customer', '/api/admin/promote', {
    method: 'POST',
    auth: 'owner',
    body: { username: 'customer', role: 'customer' },
  });
});

test('role changes are audited', async () => {
  const promote = await both('audited promote', '/api/admin/promote', {
    method: 'POST',
    auth: 'owner',
    body: { username: 'staff', role: 'staff' },
  });
  assert.strictEqual(promote.a.status, 200);

  const trail = await both('audit trail', '/api/audit-trail?limit=50', { auth: 'owner' });
  assert.strictEqual(trail.a.status, 200);
  const logs = trail.a.json.data || trail.a.json;
  assert.ok(
    logs.some((entry) => entry.event === 'auth.role_change'),
    'a role change must appear in the audit trail'
  );
});

test('scan events are recorded on both backends (parity)', async () => {
  const body = { payload: 'INVENTRAK:PROD:7', kind: 'product', target_id: 7, location: null };
  const okRes = await both('scan event product', '/api/scan-events', { method: 'POST', auth: 'staff', body });
  assert.strictEqual(okRes.a.status, 201, 'staff may record a scan');
  assert.strictEqual(okRes.a.json.ok, true);
  assert.strictEqual(okRes.a.json.event.kind, 'product');
  assert.strictEqual(okRes.a.json.event.target_id, 7);
  assert.strictEqual(okRes.a.json.event.actor, 'staff');

  const loc = await both('scan event location', '/api/scan-events', {
    method: 'POST',
    auth: 'admin',
    body: { payload: 'INVENTRAK:LOC:2:Stockroom%201', kind: 'location', target_id: 2, location: 'Stockroom 1' },
  });
  assert.strictEqual(loc.a.status, 201);
  assert.strictEqual(loc.a.json.event.location, 'Stockroom 1');

  // An unknown payload is still recorded (an unrecognized tag is exactly what
  // the audit trail should capture).
  const unknown = await both('scan event unknown', '/api/scan-events', {
    method: 'POST',
    auth: 'staff',
    body: { payload: 'https://example.com/not-a-tag', kind: 'unknown' },
  });
  assert.strictEqual(unknown.a.status, 201);
  assert.strictEqual(unknown.a.json.event.kind, 'unknown');
  assert.strictEqual(unknown.a.json.event.target_id, null);
});

test('scan events validate input and enforce role', async () => {
  const empty = await both('scan empty payload', '/api/scan-events', {
    method: 'POST',
    auth: 'staff',
    body: { payload: '   ' },
  });
  assert.strictEqual(empty.a.status, 400, 'blank payload is rejected');

  const tooLong = await both('scan long payload', '/api/scan-events', {
    method: 'POST',
    auth: 'staff',
    body: { payload: 'x'.repeat(301) },
  });
  assert.strictEqual(tooLong.a.status, 400, 'over-long payload is rejected');

  const customer = await both('scan by customer', '/api/scan-events', {
    method: 'POST',
    auth: 'customer',
    body: { payload: 'INVENTRAK:PROD:1' },
  });
  assert.strictEqual(customer.a.status, 403, 'customers cannot write scan events');

  const noToken = await both('scan without token', '/api/scan-events', {
    method: 'POST',
    body: { payload: 'INVENTRAK:PROD:1' },
  });
  assert.strictEqual(noToken.a.status, 401);
});

test('a recorded scan shows up in the audit trail', async () => {
  const marker = `INVENTRAK:PROD:${Date.now()}`;
  const res = await both('scan for audit', '/api/scan-events', {
    method: 'POST',
    auth: 'owner',
    body: { payload: marker, kind: 'product', target_id: 99 },
  });
  assert.strictEqual(res.a.status, 201);

  for (const side of [sqlite, npmfree]) {
    const trail = await call(side.url, '/api/audit-trail?limit=50', { token: side.token.owner });
    assert.strictEqual(trail.status, 200);
    const logs = trail.json.data || trail.json;
    const hit = logs.find((entry) => entry.event === 'scan.qr' && JSON.stringify(entry).includes(marker));
    assert.ok(hit, `scan.qr audit entry for ${marker} on ${side.url}`);
  }
});

test('management tier is required for the health integrity report', async () => {
  // Integrity is admin-tier (it exposes operational detail, not accounts).
  for (const role of ADMIN_TIER) {
    const res = await both(`${role} integrity`, '/api/health/integrity', { auth: TOKEN_KEY[role] });
    assert.strictEqual(res.a.status, 200, `${role} may read integrity`);
  }
  const staff = await both('staff integrity', '/api/health/integrity', { auth: 'staff' });
  assert.strictEqual(staff.a.status, 403);
  const customer = await both('customer integrity', '/api/health/integrity', { auth: 'customer' });
  assert.strictEqual(customer.a.status, 403);
});

// OWASP: no default/test accounts in production. The seeded demo credentials
// (admin/admin123, customer/customer123) are rejected with the generic error
// whenever DISABLE_DEMO_ACCOUNTS=true — verified end-to-end on both backends
// by flipping the env var at runtime (the gate reads it per request).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');
const { isDemoAccountBlocked } = require('../demo-accounts');

before(async () => {
  await bootBoth();
});
after(() => {
  teardown();
});

test('isDemoAccountBlocked unit behavior', () => {
  const prev = process.env.DISABLE_DEMO_ACCOUNTS;
  try {
    delete process.env.DISABLE_DEMO_ACCOUNTS;
    assert.strictEqual(isDemoAccountBlocked('admin'), false);
    assert.strictEqual(isDemoAccountBlocked('customer'), false);
    process.env.DISABLE_DEMO_ACCOUNTS = 'true';
    assert.strictEqual(isDemoAccountBlocked('admin'), true);
    assert.strictEqual(isDemoAccountBlocked('ADMIN'), true, 'case-insensitive');
    assert.strictEqual(isDemoAccountBlocked('customer'), true);
    assert.strictEqual(isDemoAccountBlocked('realuser'), false, 'real accounts never blocked');
    process.env.DISABLE_DEMO_ACCOUNTS = 'false';
    assert.strictEqual(isDemoAccountBlocked('admin'), false);
  } finally {
    if (prev === undefined) delete process.env.DISABLE_DEMO_ACCOUNTS;
    else process.env.DISABLE_DEMO_ACCOUNTS = prev;
  }
});

test('DISABLE_DEMO_ACCOUNTS=true blocks seeded logins on both backends', async () => {
  const prev = process.env.DISABLE_DEMO_ACCOUNTS;
  try {
    process.env.DISABLE_DEMO_ACCOUNTS = 'true';
    for (const side of [sqlite, npmfree]) {
      // Correct credentials but a disabled demo account -> generic 401.
      const admin = await call(side.url, '/api/auth/login', {
        method: 'POST',
        body: { username: 'admin', password: 'admin123' },
      });
      assert.strictEqual(admin.status, 401, 'admin demo login blocked');
      assert.strictEqual(admin.json.error, 'Invalid username or password', 'generic message, no account hint');

      const customer = await call(side.url, '/api/auth/login', {
        method: 'POST',
        body: { username: 'customer', password: 'customer123' },
      });
      assert.strictEqual(customer.status, 401, 'customer demo login blocked');

      // A real account still works.
      const reg = await call(side.url, '/api/auth/register', {
        method: 'POST',
        body: {
          username: 'realperson',
          password: 'Str0ng!Pass',
          email: 'realperson@example.com',
          phone: '09171234567',
        },
      });
      assert.strictEqual(reg.status, 200, 'register works while demo accounts are disabled');
      const login = await call(side.url, '/api/auth/login', {
        method: 'POST',
        body: { username: 'realperson', password: 'Str0ng!Pass' },
      });
      assert.strictEqual(login.status, 200, 'real account login works');
    }
  } finally {
    if (prev === undefined) delete process.env.DISABLE_DEMO_ACCOUNTS;
    else process.env.DISABLE_DEMO_ACCOUNTS = prev;
  }
});

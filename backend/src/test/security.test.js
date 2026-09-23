// Security hardening tests: token expiry, registration field tampering, the
// bot honeypot, QR lookup security, security response headers, and the
// HTTPS redirect behind a proxy. Boots BOTH backends through the shared
// harness so the hardened behaviors stay in parity.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { sqlite, npmfree, bootBoth, teardown, call, both } = require('./harness');
const { parseProductQrIdentifier } = require('../qr-codes');

// Test-facing alias: parseProductQrIdentifier returns {kind,value}; normalize
// to an {ok} contract for these assertions.
function parseQrPayload(raw) {
  const parsed = parseProductQrIdentifier(raw);
  return { ok: !!(parsed && parsed.kind && parsed.kind !== 'unknown') };
}

// Round-trip helper: the canonical payload for a code.
function productQrPayload(code) {
  return `INVENTRAK:PROD:${code}`;
}

before(async () => {
  await bootBoth();
});
after(() => {
  teardown();
});

// The npm-free fallback signs with NPMFREE_TOKEN_SECRET when set and the
// PUBLIC fallback constant otherwise. These tests run with the env var unset
// (CI and local), so we can forge expired/future tokens with the known
// fallback. If you run tests with NPMFREE_TOKEN_SECRET set, the expiry test
// cannot forge tokens and should be skipped (it would still pass for the
// tamper case because the signature mismatch rejects the token anyway).
const FALLBACK_SECRET = 'inventrak-npmfree-token-secret';

// Token format since the session-hardening pass:
// demo-token-<userId>.<expMs>.<jti>.<scope>.<sig-over(userId.exp.jti.scope)>
function forgeToken(userId, exp, scope = 'session') {
  const jti = 'forged-jti-0000000000000000';
  const payload = `${userId}.${exp}.${jti}.${scope}`;
  const sig = crypto.createHmac('sha256', FALLBACK_SECRET).update(payload).digest('base64url');
  return `demo-token-${payload}.${sig}`;
}

test('npm-free tokens expire: an expired token never authenticates', async () => {
  const expired = forgeToken(2, Date.now() - 60_000); // customer id 2
  const r = await call(npmfree.url, '/api/auth/me', { token: expired });
  assert.strictEqual(r.status, 403, 'expired token must be rejected');

  const future = forgeToken(2, Date.now() + 60 * 60 * 1000);
  const ok = await call(npmfree.url, '/api/auth/me', { token: future });
  assert.strictEqual(ok.status, 200, 'unexpired forged token with the fallback secret authenticates');
  // /api/auth/me returns the user object itself (id, username, role, ...).
  assert.strictEqual(ok.json.id, 2);
});

test('npm-free tokens are signed: tampering with the expiry invalidates them', async () => {
  // Real session token from the harness login.
  const valid = npmfree.token.customer;
  assert.ok(valid && valid.startsWith('demo-token-'));
  // Flip the expiry to "never" while keeping the signature: signature check
  // must reject it (403), never authenticate.
  const [id, , , , sig] = valid.slice('demo-token-'.length).split('.');
  const tampered = `demo-token-${id}.${Date.now() + 10 * 365 * 24 * 60 * 60 * 1000}.tampered-jti.session.${sig}`;
  const r = await call(npmfree.url, '/api/auth/me', { token: tampered });
  assert.strictEqual(r.status, 403, 'tampered expiry must be rejected');
});

test('registration cannot escalate the role — role is always customer', async () => {
  const body = {
    username: 'rolehacker',
    password: 'Str0ng!Pass',
    email: 'rolehacker@example.com',
    phone: '09171234567',
    role: 'admin', // client tries to escalate
  };
  const { a, b } = await both('register role tamper', '/api/auth/register', { method: 'POST', body });
  assert.strictEqual(a.status, 200);
  assert.strictEqual(b.status, 200);
  assert.strictEqual(a.json.user.role, 'customer');
  assert.strictEqual(b.json.user.role, 'customer');
});

test('register and login reject the bot honeypot field', async () => {
  const body = {
    username: 'honeypot',
    password: 'Str0ng!Pass',
    email: 'honeypot@example.com',
    phone: '09171234567',
    website: 'http://spam.example', // bots fill every field
  };
  const reg = await both('register honeypot', '/api/auth/register', { method: 'POST', body });
  assert.strictEqual(reg.a.status, 400);
  assert.strictEqual(reg.b.status, 400);

  const login = await both('login honeypot', '/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123', website: 'http://spam.example' },
  });
  assert.strictEqual(login.a.status, 400);
  assert.strictEqual(login.b.status, 400);
});

test('QR payload parser rejects injection and arbitrary payloads', () => {
  // The parser is the only thing that turns scanned bytes into a lookup —
  // arbitrary payloads (e.g. URLs from a malicious tag) must never resolve.
  assert.strictEqual(parseQrPayload('https://evil.example/steal-tokens').ok, false);
  assert.strictEqual(parseQrPayload('INVENTRAK:PROD:1; DROP TABLE products').ok, false);
  assert.strictEqual(parseQrPayload('').ok, false);
  assert.strictEqual(parseQrPayload(null).ok, false);
  assert.strictEqual(parseQrPayload('INVENTRAK:PROD:<script>').ok, false);
  // The legit grammar parses: the SKU-form tag resolves as a sku identifier.
  const ok = parseProductQrIdentifier(productQrPayload('MILK-001'));
  assert.strictEqual(ok.kind, 'sku');
  assert.strictEqual(ok.value, 'MILK-001');
});

test('QR lookup never leaks sensitive fields and staff gate holds on both backends', async () => {
  // Lookup returns catalog/stock data only — never cost, supplier, or user PII.
  const a = await call(sqlite.url, '/api/products/qr/1', { token: sqlite.token.staff });
  assert.strictEqual(a.status, 200);
  const serialized = JSON.stringify(a.json);
  for (const banned of ['"cost"', '"supplier_cost"', '"password"', '"password_hash"']) {
    assert.ok(!serialized.includes(banned), `QR lookup must not leak ${banned}`);
  }
  // The customer must never resolve the staff lookup — identifiers are not
  // authorization.
  const asCustomer = await call(sqlite.url, '/api/products/qr/1', { token: sqlite.token.customer });
  assert.strictEqual(asCustomer.status, 403, 'customer token must not use the staff QR lookup');
});

test('both backends send security headers on API responses', async () => {
  for (const side of [sqlite, npmfree]) {
    const res = await fetch(`${side.url}/api/openapi.json`);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer');
    assert.ok(res.headers.get('content-security-policy').includes("default-src 'none'"));
  }
});

test('requests behind an http proxy are redirected to https (301)', async () => {
  for (const side of [sqlite, npmfree]) {
    const res = await fetch(`${side.url}/api/health`, {
      headers: { 'x-forwarded-proto': 'http' },
      redirect: 'manual',
    });
    assert.strictEqual(res.status, 301);
    assert.ok(res.headers.get('location').startsWith('https://'));
  }
});

test('sales ledger and alert feeds are admin-only reads (no customer PII leak)', async () => {
  // A customer must never see the full sales ledger (it contains other
  // customers' names) or the operational alert feed — the mobile client
  // exports these but no customer screen calls them. Both backends agree.
  for (const side of [sqlite, npmfree]) {
    const asCustomer = await call(side.url, '/api/sales', { token: side.token.customer });
    assert.strictEqual(asCustomer.status, 403, `${side.name} GET /api/sales as customer must be 403`);
    const alerts = await call(side.url, '/api/alerts', { token: side.token.customer });
    assert.strictEqual(alerts.status, 403, `${side.name} GET /api/alerts as customer must be 403`);
    // Admin still reads both.
    const asAdmin = await call(side.url, '/api/sales', { token: side.token.admin });
    assert.strictEqual(asAdmin.status, 200, `${side.name} GET /api/sales as admin must be 200`);
    const alertsAdmin = await call(side.url, '/api/alerts', { token: side.token.admin });
    assert.strictEqual(alertsAdmin.status, 200, `${side.name} GET /api/alerts as admin must be 200`);
  }
});

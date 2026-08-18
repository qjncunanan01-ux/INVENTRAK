// One-time recovery codes (lost-phone backup for admin MFA) on BOTH backends:
// enrollment returns 10 codes shown once, codes are stored only as hashes
// (SQLite at-rest check), a code logs the admin in exactly once, TOTP still
// works alongside, regeneration invalidates the old set, and the endpoints
// are admin-only.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { sqlite, npmfree, bootBoth, teardown, call, db } = require('./harness');
const { totp } = require('../totp');

before(async () => {
  await bootBoth();
});
after(() => {
  teardown();
});

const CODE_RE = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

// The SQLite backend hashes with HMAC-SHA256 keyed by JWT_SECRET (public
// fallback in tests). Reproduce it to prove codes are stored only hashed.
const TEST_JWT_SECRET = 'inventrak-secret-key-2024';
const hashOf = (norm) => crypto.createHmac('sha256', TEST_JWT_SECRET).update(norm).digest('hex');

// Enrolls the admin (setup -> confirm). Returns { secret, recoveryCodes }.
async function enroll(side) {
  const setup = await call(side.url, '/api/auth/mfa/setup', { method: 'POST', token: side.token.admin });
  assert.strictEqual(setup.status, 200, 'setup when MFA disabled');
  const confirm = await call(side.url, '/api/auth/mfa/confirm', {
    method: 'POST',
    token: side.token.admin,
    body: { code: totp(setup.json.secret) },
  });
  assert.strictEqual(confirm.status, 200);
  assert.ok(Array.isArray(confirm.json.recovery_codes), 'confirm returns recovery codes');
  return { secret: setup.json.secret, recoveryCodes: confirm.json.recovery_codes };
}

// Disables MFA using the current secret (returns the disable result).
async function disableMfa(side, secret) {
  return call(side.url, '/api/auth/mfa/disable', {
    method: 'POST',
    token: side.token.admin,
    body: { code: totp(secret) },
  });
}

// Password login -> challenge token.
async function challenge(side) {
  const r = await call(side.url, '/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' },
  });
  assert.strictEqual(r.json.mfa_required, true);
  return r.json.mfaToken;
}

// Verifies with `code` and returns the raw result.
const verifyWith = (side, mfaToken, code) =>
  call(side.url, '/api/auth/mfa/verify', { method: 'POST', body: { mfaToken, code } });

test('enrollment returns 10 well-formed one-time codes on both backends', async () => {
  for (const side of [sqlite, npmfree]) {
    const { secret, recoveryCodes } = await enroll(side);
    assert.strictEqual(recoveryCodes.length, 10);
    for (const c of recoveryCodes) assert.match(c, CODE_RE, 'XXXX-XXXX-XXXX format');
    assert.strictEqual(new Set(recoveryCodes).size, 10, 'all unique');
    const disable = await disableMfa(side, secret);
    assert.strictEqual(disable.status, 200, 'cleanup disable');
  }
});

test('SQLite stores only hashes of recovery codes — never the plaintext', async () => {
  const { secret, recoveryCodes } = await enroll(sqlite);
  const row = db.prepare('SELECT mfa_recovery FROM users WHERE id = 1').get();
  const stored = JSON.parse(row.mfa_recovery);
  assert.strictEqual(stored.length, 10, '10 hashes stored');
  for (let i = 0; i < recoveryCodes.length; i++) {
    const norm = recoveryCodes[i].replace(/-/g, '');
    assert.notStrictEqual(stored[i], recoveryCodes[i], 'plaintext never stored');
    assert.strictEqual(stored[i], hashOf(norm), 'stored value is the keyed HMAC of the code');
  }
  const disable = await disableMfa(sqlite, secret);
  assert.strictEqual(disable.status, 200, 'cleanup disable');
});

test('a recovery code logs the admin in exactly once (both backends)', async () => {
  for (const side of [sqlite, npmfree]) {
    const { secret, recoveryCodes } = await enroll(side);
    const code = recoveryCodes[0];

    // Forgiveness: lowercase + no dashes still works (normalized server-side).
    const first = await verifyWith(side, await challenge(side), code.toLowerCase().replace(/-/g, ''));
    assert.strictEqual(first.status, 200, 'recovery code logs in');
    assert.ok(first.json.token);
    assert.strictEqual(first.json.user.role, 'admin');

    // Single-use: the same code must NOT work on a fresh challenge.
    const second = await verifyWith(side, await challenge(side), code);
    assert.strictEqual(second.status, 401, 'used recovery code is consumed');

    // A second (unused) code still works — the set isn't all burned.
    const third = await verifyWith(side, await challenge(side), recoveryCodes[1]);
    assert.strictEqual(third.status, 200, 'next code still valid');

    // TOTP still works alongside the recovery codes.
    const totpResult = await verifyWith(side, await challenge(side), totp(secret));
    assert.strictEqual(totpResult.status, 200, 'TOTP still works after recovery-code use');

    const disable = await disableMfa(side, secret);
    assert.strictEqual(disable.status, 200, 'cleanup disable');
  }
});

test('wrong recovery codes are rejected (401), real codes untouched', async () => {
  for (const side of [sqlite, npmfree]) {
    const { secret, recoveryCodes } = await enroll(side);
    const bad = await verifyWith(side, await challenge(side), 'ZZZZ-ZZZZ-ZZZZ');
    assert.strictEqual(bad.status, 401);
    const good = await verifyWith(side, await challenge(side), recoveryCodes[0]);
    assert.strictEqual(good.status, 200);
    const disable = await disableMfa(side, secret);
    assert.strictEqual(disable.status, 200, 'cleanup disable');
  }
});

test('regenerating recovery codes invalidates the old set (both backends)', async () => {
  for (const side of [sqlite, npmfree]) {
    const { secret, recoveryCodes: oldCodes } = await enroll(side);
    const regen = await call(side.url, '/api/auth/mfa/recovery-codes', { method: 'POST', token: side.token.admin });
    assert.strictEqual(regen.status, 200);
    const newCodes = regen.json.recovery_codes;
    assert.strictEqual(newCodes.length, 10);
    assert.notStrictEqual(newCodes[0], oldCodes[0], 'fresh codes');

    const oldStillWorks = await verifyWith(side, await challenge(side), oldCodes[0]);
    assert.strictEqual(oldStillWorks.status, 401, 'old codes invalidated');
    const newWorks = await verifyWith(side, await challenge(side), newCodes[0]);
    assert.strictEqual(newWorks.status, 200, 'new code works');

    const disable = await disableMfa(side, secret);
    assert.strictEqual(disable.status, 200, 'cleanup disable');
  }
});

test('recovery-codes endpoint is admin-only on both backends', async () => {
  for (const side of [sqlite, npmfree]) {
    const customer = await call(side.url, '/api/auth/mfa/recovery-codes', { method: 'POST', token: side.token.customer });
    assert.strictEqual(customer.status, 403);
    const anon = await call(side.url, '/api/auth/mfa/recovery-codes', { method: 'POST' });
    assert.strictEqual(anon.status, 401);
  }
});

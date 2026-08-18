// Admin MFA (TOTP) end-to-end on BOTH backends: setup -> confirm -> login
// yields a challenge -> wrong code rejected -> right code issues a session ->
// disable restores password-only login. Also proves customers can never touch
// the admin-only MFA endpoints.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');
const { totp } = require('../totp');

before(async () => {
  await bootBoth();
});
after(() => {
  teardown();
});

async function adminMfaFlow(side, label) {
  // 1. Admin login BEFORE enrollment -> normal session (harness already did it,
  //    but assert the gate isn't triggered yet).
  // 2. Generate a secret.
  const setup = await call(side.url, '/api/auth/mfa/setup', {
    method: 'POST',
    token: side.token.admin,
  });
  assert.strictEqual(setup.status, 200, `${label}: mfa/setup`);
  assert.ok(setup.json.secret && setup.json.otpauth_url, `${label}: setup returns secret + otpauth url`);
  assert.match(setup.json.secret, /^[A-Z2-7]{32}$/, `${label}: base32 secret`);
  assert.match(setup.json.otpauth_url, /^otpauth:\/\/totp\//, `${label}: otpauth url`);

  // 3. Confirm with a live code -> MFA enabled.
  const confirm = await call(side.url, '/api/auth/mfa/confirm', {
    method: 'POST',
    token: side.token.admin,
    body: { code: totp(setup.json.secret) },
  });
  assert.strictEqual(confirm.status, 200, `${label}: mfa/confirm with live code`);
  assert.strictEqual(confirm.json.ok, true, `${label}: confirm ok`);

  // 4. Password login now returns a CHALLENGE, never a session.
  const challenge = await call(side.url, '/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' },
  });
  assert.strictEqual(challenge.status, 200, `${label}: login still 200`);
  assert.strictEqual(challenge.json.mfa_required, true, `${label}: mfa_required flag`);
  assert.ok(challenge.json.mfaToken, `${label}: challenge token issued`);
  assert.strictEqual(challenge.json.token, undefined, `${label}: NO session token before MFA`);
  assert.strictEqual(challenge.json.user, undefined, `${label}: NO user object before MFA`);

  // 5. Wrong code -> 401.
  const wrong = await call(side.url, '/api/auth/mfa/verify', {
    method: 'POST',
    body: { mfaToken: challenge.json.mfaToken, code: '000000' },
  });
  assert.strictEqual(wrong.status, 401, `${label}: wrong code rejected`);

  // 6. Right code -> real session that works on /me.
  const right = await call(side.url, '/api/auth/mfa/verify', {
    method: 'POST',
    body: { mfaToken: challenge.json.mfaToken, code: totp(setup.json.secret) },
  });
  assert.strictEqual(right.status, 200, `${label}: right code accepted`);
  assert.ok(right.json.token, `${label}: session issued`);
  assert.strictEqual(right.json.user.role, 'admin', `${label}: session is admin`);
  const me = await call(side.url, '/api/auth/me', { token: right.json.token });
  assert.strictEqual(me.status, 200, `${label}: MFA-issued session works`);

  // 7. A session token can't be used as an MFA challenge (scope separation).
  const sessionAsMfa = await call(side.url, '/api/auth/mfa/verify', {
    method: 'POST',
    body: { mfaToken: side.token.admin, code: totp(setup.json.secret) },
  });
  assert.strictEqual(sessionAsMfa.status, 401, `${label}: session token is not a valid challenge`);

  // 8. Disable with the live code -> password-only login again.
  const disable = await call(side.url, '/api/auth/mfa/disable', {
    method: 'POST',
    token: right.json.token,
    body: { code: totp(setup.json.secret) },
  });
  assert.strictEqual(disable.status, 200, `${label}: mfa/disable`);
  const afterDisable = await call(side.url, '/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' },
  });
  assert.strictEqual(afterDisable.status, 200, `${label}: login after disable`);
  assert.strictEqual(afterDisable.json.mfa_required, undefined, `${label}: no challenge after disable`);
  assert.ok(afterDisable.json.token, `${label}: session restored`);
}

test('admin MFA lifecycle — SQLite backend', async () => {
  await adminMfaFlow(sqlite, 'sqlite');
});

test('admin MFA lifecycle — npm-free backend', async () => {
  await adminMfaFlow(npmfree, 'npmfree');
});

test('MFA endpoints are admin-only on both backends', async () => {
  for (const side of [sqlite, npmfree]) {
    for (const pathname of ['/api/auth/mfa/setup', '/api/auth/mfa/confirm', '/api/auth/mfa/disable']) {
      const r = await call(side.url, pathname, {
        method: 'POST',
        token: side.token.customer,
        body: pathname.endsWith('setup') ? {} : { code: '123456' },
      });
      assert.strictEqual(r.status, 403, `${pathname} with customer token on ${side === sqlite ? 'sqlite' : 'npmfree'}`);
    }
    // Anonymous -> 401.
    const anon = await call(side.url, '/api/auth/mfa/setup', { method: 'POST' });
    assert.strictEqual(anon.status, 401, `anonymous mfa/setup on ${side === sqlite ? 'sqlite' : 'npmfree'}`);
  }
});

test('MFA challenge verify is brute-force throttled', async () => {
  for (const side of [sqlite, npmfree]) {
    // Re-enroll (tests 1-2 disabled MFA at the end), get a real challenge,
    // then hammer it with wrong codes until the per-IP throttle engages.
    const setup = await call(side.url, '/api/auth/mfa/setup', {
      method: 'POST',
      token: side.token.admin,
    });
    assert.strictEqual(setup.status, 200);
    const confirm = await call(side.url, '/api/auth/mfa/confirm', {
      method: 'POST',
      token: side.token.admin,
      body: { code: totp(setup.json.secret) },
    });
    assert.strictEqual(confirm.status, 200);
    const challenge = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin123' },
    });
    assert.strictEqual(challenge.json.mfa_required, true);

    let saw429 = false;
    for (let i = 0; i < 8; i++) {
      const r = await call(side.url, '/api/auth/mfa/verify', {
        method: 'POST',
        body: { mfaToken: challenge.json.mfaToken, code: '000000' },
      });
      if (r.status === 429) { saw429 = true; break; }
      assert.strictEqual(r.status, 401, 'wrong codes are rejected before the throttle engages');
    }
    assert.strictEqual(saw429, true, '5 wrong codes must trip the per-IP throttle');

    // Clean up: disable MFA using the still-valid pre-enrollment admin session.
    const disable = await call(side.url, '/api/auth/mfa/disable', {
      method: 'POST',
      token: side.token.admin,
      body: { code: totp(setup.json.secret) },
    });
    assert.strictEqual(disable.status, 200, 'cleanup disable');
  }
});

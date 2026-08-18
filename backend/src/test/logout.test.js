// Server-side session revocation: after /api/auth/logout, the presented token
// is dead (403) even though it is cryptographically valid and unexpired, on
// BOTH backends. A fresh login issues a brand-new token that works.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

before(async () => {
  await bootBoth();
});
after(() => {
  teardown();
});

test('logout revokes the token on both backends', async () => {
  for (const side of [sqlite, npmfree]) {
    const label = side === sqlite ? 'sqlite' : 'npmfree';

    // Fresh login -> token works.
    const login = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: 'customer', password: 'customer123' },
    });
    assert.strictEqual(login.status, 200, `${label}: login`);
    const token = login.json.token;

    const meBefore = await call(side.url, '/api/auth/me', { token });
    assert.strictEqual(meBefore.status, 200, `${label}: token valid before logout`);

    // Logout destroys the session.
    const logout = await call(side.url, '/api/auth/logout', { method: 'POST', token });
    assert.strictEqual(logout.status, 200, `${label}: logout`);
    assert.strictEqual(logout.json.ok, true, `${label}: logout ok`);

    // The same token is now rejected even though it is unexpired.
    const meAfter = await call(side.url, '/api/auth/me', { token });
    assert.strictEqual(meAfter.status, 403, `${label}: revoked token rejected (403)`);

    // A second logout with the same token is also rejected (not replayable).
    const logoutAgain = await call(side.url, '/api/auth/logout', { method: 'POST', token });
    assert.strictEqual(logoutAgain.status, 403, `${label}: revoked token can't logout twice`);

    // A brand-new login issues a working token.
    const relogin = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: 'customer', password: 'customer123' },
    });
    assert.strictEqual(relogin.status, 200, `${label}: relogin`);
    assert.notStrictEqual(relogin.json.token, token, `${label}: new session token`);
    const meNew = await call(side.url, '/api/auth/me', { token: relogin.json.token });
    assert.strictEqual(meNew.status, 200, `${label}: fresh session works`);
  }
});

test('logout without a token is rejected', async () => {
  for (const side of [sqlite, npmfree]) {
    const r = await call(side.url, '/api/auth/logout', { method: 'POST' });
    assert.strictEqual(r.status, 401);
  }
});

// Login lockout: unit tests for the shared factory (injected clock, no
// network) and integration tests that drive the REAL /api/auth/login on BOTH
// backends (SQLite + npm-free) via the harness, asserting the two servers
// lock out identically and that legit users are never affected.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createLoginLockout } = require('../login-lockout');
const { sqlite, npmfree, bootBoth, teardown, call, both } = require('./harness');

// ===== Unit: factory with an injectable clock ==============================

function makeClock(initial = 1_000_000) {
  let t = initial;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('lockout: unit — locks after maxFailures+1 failures and reports retryAfterMs', () => {
  const clock = makeClock();
  const lk = createLoginLockout({ maxFailures: 3, windowMs: 60_000, baseLockoutMs: 5_000, maxLockoutMs: 40_000, now: clock.now });

  for (let i = 1; i <= 3; i++) {
    const r = lk.recordFailure('bob', '10.0.0.1');
    assert.strictEqual(r.locked, false, `failure ${i} must not lock yet`);
  }
  // 4th failure breaches the 3-strike threshold -> locked.
  const r = lk.recordFailure('bob', '10.0.0.1');
  assert.strictEqual(r.locked, true, 'breach must lock');
  assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= 5_000, `retryAfterMs=${r.retryAfterMs}`);
  // check() while locked agrees.
  assert.strictEqual(lk.check('bob', '10.0.0.1').locked, true);
});

test('lockout: unit — a single typo never locks; success clears the counter', () => {
  const clock = makeClock();
  const lk = createLoginLockout({ maxFailures: 5, windowMs: 60_000, baseLockoutMs: 5_000, now: clock.now });
  lk.recordFailure('alice', '10.0.0.2');
  assert.strictEqual(lk.check('alice', '10.0.0.2').locked, false);
  lk.recordSuccess('alice', '10.0.0.2');
  // Counter cleared: five more failures must NOT lock yet (threshold is 5).
  for (let i = 0; i < 5; i++) lk.recordFailure('alice', '10.0.0.2');
  assert.strictEqual(lk.check('alice', '10.0.0.2').locked, false);
  lk.recordFailure('alice', '10.0.0.2'); // 6th breaches -> locked
  assert.strictEqual(lk.check('alice', '10.0.0.2').locked, true);
});

test('lockout: unit — lockout duration doubles per breach (exponential backoff)', () => {
  const clock = makeClock();
  const lk = createLoginLockout({ maxFailures: 2, windowMs: 600_000, baseLockoutMs: 10_000, maxLockoutMs: 40_000, now: clock.now });

  const breach = (ip) => {
    lk.recordFailure('carol', ip);
    lk.recordFailure('carol', ip);
    return lk.recordFailure('carol', ip); // 3rd -> locked
  };

  const first = breach('10.0.0.3');
  assert.ok(first.retryAfterMs > 8_000 && first.retryAfterMs <= 10_000, `first lockout ~base: ${first.retryAfterMs}`);

  // Let the first lockout expire, then breach again -> 2x.
  clock.advance(11_000);
  assert.strictEqual(lk.check('carol', '10.0.0.3').locked, false, 'lockout expires');
  const second = breach('10.0.0.3');
  assert.ok(second.retryAfterMs > 18_000 && second.retryAfterMs <= 20_000, `second lockout ~2x: ${second.retryAfterMs}`);

  // Let it expire again -> 4x, but capped at maxLockoutMs.
  clock.advance(21_000);
  const third = breach('10.0.0.3');
  assert.ok(third.retryAfterMs > 38_000 && third.retryAfterMs <= 40_000, `third lockout ~4x: ${third.retryAfterMs}`);
  clock.advance(41_000);
  const fourth = breach('10.0.0.3');
  assert.strictEqual(fourth.retryAfterMs, 40_000, 'cap at maxLockoutMs');
});

test('lockout: unit — sliding window: stale failures stop counting, slow attacks still lock', () => {
  const clock = makeClock();
  const lk = createLoginLockout({ maxFailures: 3, windowMs: 60_000, baseLockoutMs: 5_000, now: clock.now });
  lk.recordFailure('dave', '10.0.0.4');
  clock.advance(61_000); // window slides past the failure
  // The first failure after the slide resets the count (stale one dropped).
  for (let i = 0; i < 3; i++) lk.recordFailure('dave', '10.0.0.4');
  assert.strictEqual(lk.check('dave', '10.0.0.4').locked, false, '3 fresh in-window failures still under threshold');
  lk.recordFailure('dave', '10.0.0.4'); // 4th in-window -> breaches
  assert.strictEqual(lk.check('dave', '10.0.0.4').locked, true, '4th in-window failure locks');
});

test('lockout: unit — unknown usernames count (no username oracle) and key is case-insensitive + IP-scoped', () => {
  const clock = makeClock();
  const lk = createLoginLockout({ maxFailures: 3, windowMs: 60_000, baseLockoutMs: 5_000, now: clock.now });
  // Unknown user 'ghost' locks just like a real one.
  for (let i = 0; i < 4; i++) lk.recordFailure('ghost', '10.0.0.5');
  assert.strictEqual(lk.check('ghost', '10.0.0.5').locked, true);
  // Same account from a DIFFERENT IP is unaffected (per-IP isolation).
  assert.strictEqual(lk.check('ghost', '10.0.0.6').locked, false);
  // Different casing shares the bucket.
  assert.strictEqual(lk.check('GHOST', '10.0.0.5').locked, true);
});

test('lockout: unit — expired lockout buckets are pruned (no unbounded growth)', () => {
  const clock = makeClock();
  const lk = createLoginLockout({ maxFailures: 1, windowMs: 60_000, baseLockoutMs: 1_000, now: clock.now });
  for (let i = 0; i < 20; i++) lk.recordFailure(`user${i}`, `10.0.${i}.1`);
  assert.strictEqual(lk._buckets.size, 20, 'all buckets exist while locked');
  clock.advance(120_000); // every lockout expired AND window passed
  lk.recordFailure('fresh', '10.99.0.1'); // triggers a prune pass
  assert.ok(lk._buckets.size <= 1, `stale buckets pruned (${lk._buckets.size} left)`);
});

// ===== Integration: both backends behave identically under attack ==========

let probeUser;
before(async () => {
  await bootBoth();
  probeUser = `lockout_probe_${Date.now()}`;
});

after(() => {
  teardown();
});

test('lockout: both backends lock the same account after the same number of failures', async () => {
  // 5 failures: 401s, not locked yet on either side.
  for (let i = 0; i < 5; i++) {
    const { a, b } = await both('lockout probe failure', '/api/auth/login', {
      method: 'POST',
      body: { username: probeUser, password: 'WrongPass1!' },
    });
    assert.strictEqual(a.status, 401, `sqlite attempt ${i + 1}`);
    assert.strictEqual(b.status, 401, `npmfree attempt ${i + 1}`);
  }
  // 6th failure crosses the threshold: still 401 for THIS request, but it
  // arms the lock. The 7th request is rejected with 429 on BOTH backends.
  const breach = await both('lockout breach', '/api/auth/login', {
    method: 'POST',
    body: { username: probeUser, password: 'WrongPass1!' },
  });
  assert.strictEqual(breach.a.status, 401, 'crossing request is a plain 401');
  assert.strictEqual(breach.b.status, 401, 'npmfree crossing request is a plain 401');

  const { a, b } = await both('lockout 429', '/api/auth/login', {
    method: 'POST',
    body: { username: probeUser, password: 'WrongPass1!' },
  });
  assert.strictEqual(a.status, 429, 'sqlite must 429 once locked');
  assert.strictEqual(b.status, 429, 'npmfree must 429 once locked');
  assert.strictEqual(typeof a.json.retryAfterSeconds, 'number');
  assert.strictEqual(typeof b.json.retryAfterSeconds, 'number');
  assert.ok(a.json.retryAfterSeconds >= 1 && b.json.retryAfterSeconds >= 1);
  assert.match(a.json.error, /Too many failed login attempts/);
  assert.match(b.json.error, /Too many failed login attempts/);

  // Subsequent attempts stay locked out on both (cheap rejection path).
  const { a: a2, b: b2 } = await both('lockout sustained', '/api/auth/login', {
    method: 'POST',
    body: { username: probeUser, password: 'WrongPass1!' },
  });
  assert.strictEqual(a2.status, 429);
  assert.strictEqual(b2.status, 429);
});

test('lockout: other accounts and IPs stay usable while one account is locked', async () => {
  // 'customer' (a real seeded account, distinct username) can still log in.
  for (const side of [sqlite, npmfree]) {
    const res = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: 'customer', password: 'customer123' },
    });
    assert.strictEqual(res.status, 200, `${side === sqlite ? 'sqlite' : 'npmfree'} unaffected account logs in`);
  }
});

test('lockout: a successful login clears the counter (single typo then success is safe)', async () => {
  const user = `lockout_clear_${Date.now()}`;
  // Register the user on both backends, then log in.
  for (const side of [sqlite, npmfree]) {
    const reg = await call(side.url, '/api/auth/register', {
      method: 'POST',
      body: { username: user, password: 'Strong!Pass123', email: `${user}@example.com`, phone: '09171234567' },
    });
    assert.strictEqual(reg.status, 200, 'register for clear test');
  }
  // One wrong attempt then a correct login on both.
  for (const side of [sqlite, npmfree]) {
    await call(side.url, '/api/auth/login', {
      method: 'POST', body: { username: user, password: 'WrongPass1!' },
    });
    const ok = await call(side.url, '/api/auth/login', {
      method: 'POST', body: { username: user, password: 'Strong!Pass123' },
    });
    assert.strictEqual(ok.status, 200, 'success after one typo clears the counter');
  }
  // Five more failures must NOT lock (the success reset the count)…
  for (let i = 0; i < 5; i++) {
    const { a, b } = await both('post-clear failure', '/api/auth/login', {
      method: 'POST',
      body: { username: user, password: 'WrongPass1!' },
    });
    assert.strictEqual(a.status, 401);
    assert.strictEqual(b.status, 401);
  }
  // …the 6th crosses the threshold and the 7th is 429 on both.
  await both('post-clear breach', '/api/auth/login', {
    method: 'POST',
    body: { username: user, password: 'WrongPass1!' },
  });
  const { a, b } = await both('post-clear 429', '/api/auth/login', {
    method: 'POST',
    body: { username: user, password: 'WrongPass1!' },
  });
  assert.strictEqual(a.status, 429);
  assert.strictEqual(b.status, 429);
});

// Reset-endpoint brute-force protection (REAL lockout defaults — runs in its
// own process so the thresholds are the production ones):
//   1. reset-password wrong-code guesses are throttled per IP: after enough
//      wrong codes, the endpoint returns 429 (exponential backoff) on BOTH
//      backends, so a 1M-combination code can't be brute-forced inside its
//      TTL window.
//   2. A successful reset clears the account's LOGIN lockout: a customer who
//      was locked out of logging in (429) can reset their password and
//      immediately log back in with it — the reset proves ownership.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { sqlite, npmfree, bootBoth, teardown, call, both } = require('./harness');

// The notify layer logs the reset email payload (code included) when no
// provider key is set — parse the JSON payload to redeem the code for real.
async function requestCode(side, email) {
  let lines = [];
  const orig = console.log;
  console.log = (...args) => {
    const line = args.join(' ');
    if (line.includes('password reset code')) lines.push(line);
    orig(...args);
  };
  let res;
  try {
    res = await call(side.url, '/api/auth/forgot-password', { method: 'POST', body: { email } });
  } finally {
    console.log = orig;
  }
  assert.strictEqual(res.status, 200);
  const idx = lines[0] && lines[0].indexOf(' :: ');
  const code = idx > 0 ? (() => {
    try {
      const text = JSON.parse(lines[0].slice(idx + 4)).text || '';
      const m = text.match(/\n\s+(\d{6})\s*\n/);
      return m && m[1];
    } catch { return null; }
  })() : null;
  assert.ok(/^\d{6}$/.test(code || ''), `expected a 6-digit code, got ${code}`);
  return code;
}

let user;
const email = () => `${user}@example.com`;

before(async () => {
  await bootBoth();
  user = `reset_lock_${Date.now().toString(36)}`;
});

after(() => {
  teardown();
});

// NOTE on ordering: both tests share the per-IP 'reset-password' lockout
// bucket (node:test runs top-level tests sequentially, so order is defined).
// The lockout-clear test MUST run first — its successful reset clears the
// bucket — and the brute-force test runs last (it ends with the bucket
// deliberately locked, and nothing after it needs the endpoint).
test('reset: a successful reset clears the account LOGIN lockout on BOTH backends', async () => {
  for (const side of [sqlite, npmfree]) {
    const uname = `${user}_login_${side === sqlite ? 's' : 'n'}`;
    await call(side.url, '/api/auth/register', {
      method: 'POST',
      body: { username: uname, password: 'OldPass!123', email: `${uname}@example.com` },
    });

    // Lock the account out of LOGIN: 6 wrong passwords.
    for (let i = 0; i < 6; i++) {
      await call(side.url, '/api/auth/login', {
        method: 'POST',
        body: { username: uname, password: 'WrongPass1!' },
      });
    }
    const lockedOut = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: uname, password: 'OldPass!123' },
    });
    assert.strictEqual(lockedOut.status, 429, `${side === sqlite ? 'sqlite' : 'npmfree'} account is login-locked`);

    // Reset the password with a valid code (fresh IP quota for the reset
    // endpoint — the two buckets are independent).
    const code = await requestCode(side, `${uname}@example.com`);
    const reset = await call(side.url, '/api/auth/reset-password', {
      method: 'POST',
      body: { code, password: 'BrandNew!456' },
    });
    assert.strictEqual(reset.status, 200);

    // The new password logs in immediately — the reset lifted the lockout.
    const fresh = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: uname, password: 'BrandNew!456' },
    });
    assert.strictEqual(fresh.status, 200, `${side === sqlite ? 'sqlite' : 'npmfree'} login works after reset clears the lockout`);
  }
});

test('reset: wrong-code guessing is throttled to 429 on BOTH backends (brute-force protection)', async () => {
  for (const side of [sqlite, npmfree]) {
    // Register a fresh account per side so the code belongs to it.
    const uname = `${user}_${side === sqlite ? 's' : 'n'}`;
    const reg = await call(side.url, '/api/auth/register', {
      method: 'POST',
      body: { username: uname, password: 'OldPass!123', email: `${uname}@example.com` },
    });
    assert.strictEqual(reg.status, 200);

    // Issue a real code (the attacker would know the victim's email).
    await requestCode(side, `${uname}@example.com`);

    // 5 wrong codes: 401s, not locked yet (mirrors login's threshold).
    for (let i = 0; i < 5; i++) {
      const r = await call(side.url, '/api/auth/reset-password', {
        method: 'POST',
        body: { code: '000000', password: 'Strong!Pass1' },
      });
      assert.strictEqual(r.status, 401, `${side === sqlite ? 'sqlite' : 'npmfree'} wrong guess ${i + 1} is a 401`);
    }
    // The 6th wrong code crosses the threshold (still 401 for THIS request),
    // and the 7th is throttled with 429 on both backends.
    const breach = await call(side.url, '/api/auth/reset-password', {
      method: 'POST',
      body: { code: '000000', password: 'Strong!Pass1' },
    });
    assert.strictEqual(breach.status, 401, 'crossing request is a plain 401');
    const locked = await call(side.url, '/api/auth/reset-password', {
      method: 'POST',
      body: { code: '000000', password: 'Strong!Pass1' },
    });
    assert.strictEqual(locked.status, 429, `${side === sqlite ? 'sqlite' : 'npmfree'} must 429 once throttled`);
    assert.strictEqual(typeof locked.json.retryAfterSeconds, 'number');
    assert.ok(locked.json.retryAfterSeconds >= 1);
    assert.match(locked.json.error, /Too many reset attempts/);

    // Even a CORRECT code is refused while the IP is throttled — the check
    // runs before any code lookup, so the quota can't be bypassed by guessing
    // the real code.
    const code = await requestCode(side, `${uname}@example.com`);
    const during = await call(side.url, '/api/auth/reset-password', {
      method: 'POST',
      body: { code, password: 'StillLocked!1' },
    });
    assert.strictEqual(during.status, 429, 'correct code still blocked while throttled');
  }
});

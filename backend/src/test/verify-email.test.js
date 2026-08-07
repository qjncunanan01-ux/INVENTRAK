// Signup email/SMS verification: register REQUIRES a mobile number, starts the
// account UNVERIFIED, emails/SMS's a 6-digit single-use code, and
// verify-email / resend-verification drive the account to verified. Driven
// against BOTH backends (SQLite + npm-free) via the harness.
//
// The per-IP quotas (shared login lockout) throttle the new endpoints, so this
// functional suite raises the threshold out of the way; the reset-lockout
// suite already covers brute-force 429 behavior with real defaults.
process.env.LOGIN_LOCKOUT_MAX_FAILURES = '1000';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { sqlite, npmfree, bootBoth, teardown, call, both, shapeOf } = require('./harness');

function extractCode(line) {
  const idx = line && line.indexOf(' :: ');
  if (!line || idx < 0) return null;
  try {
    const payload = JSON.parse(line.slice(idx + 4));
    const text = String(payload.text || payload.html || '');
    const m = text.match(/\n\s+(\d{6})\s*\n/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Registers a user and returns { res, code } where code came from the email.
async function registerCapturing(side, body) {
  let lines = [];
  const orig = console.log;
  console.log = (...args) => {
    const line = args.join(' ');
    if (line.includes('verification code')) lines.push(line);
    orig(...args);
  };
  let res;
  try {
    res = await call(side.url, '/api/auth/register', { method: 'POST', body });
  } finally {
    console.log = orig;
  }
  return { res, code: extractCode(lines[0]) };
}

let user;

before(async () => {
  await bootBoth();
  user = `verify_${Date.now().toString(36)}`;
});

after(() => {
  teardown();
});

test('verify: phone is REQUIRED at registration (400 without it) on both backends', async () => {
  const { a, b } = await both('register without phone', '/api/auth/register', {
    method: 'POST',
    body: { username: `nophone_${Date.now()}`, password: 'Test123!', email: 'x@y.com' },
  });
  assert.strictEqual(a.status, 400);
  assert.strictEqual(b.status, 400);
  assert.ok(Array.isArray(a.json.details) && Array.isArray(b.json.details));
});

test('verify: an invalid mobile number is rejected with 400 on both backends', async () => {
  const { a, b } = await both('register bad phone', '/api/auth/register', {
    method: 'POST',
    body: { username: `badphone_${Date.now()}`, password: 'Test123!', email: 'x@y.com', phone: 'not-a-number' },
  });
  assert.strictEqual(a.status, 400);
  assert.strictEqual(b.status, 400);
  assert.ok(Array.isArray(a.json.details) && Array.isArray(b.json.details));
});

test('verify: registering emails a 6-digit code and starts the account UNVERIFIED (both backends, parity)', async () => {
  for (const side of [sqlite, npmfree]) {
    const uname = `${user}_${side === sqlite ? 's' : 'n'}`;
    const { res, code } = await registerCapturing(side, {
      username: uname,
      password: 'Test123!',
      email: `${uname}@example.com`,
      phone: '09171234567',
    });
    assert.strictEqual(res.status, 200, `${side === sqlite ? 'sqlite' : 'npmfree'} register`);
    assert.strictEqual(res.json.user.email_verified, false, 'new account is unverified');
    assert.ok(/^\d{6}$/.test(code || ''), `${side === sqlite ? 'sqlite' : 'npmfree'} verification code emailed (got ${code})`);
    // The response never contains the code.
    assert.ok(!JSON.stringify(res.json).includes(code), 'code must not be in the response');

    // Login reports the account as unverified (flag rides on the user object).
    const login = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: uname, password: 'Test123!' },
    });
    assert.strictEqual(login.status, 200);
    assert.strictEqual(login.json.user.email_verified, false);
  }
});

test('verify: wrong code is 401 and the real code verifies the account on BOTH backends', async () => {
  for (const side of [sqlite, npmfree]) {
    const uname = `${user}_ok_${side === sqlite ? 's' : 'n'}`;
    const { res, code } = await registerCapturing(side, {
      username: uname,
      password: 'Test123!',
      email: `${uname}@example.com`,
      phone: '09171234567',
    });
    assert.strictEqual(res.status, 200);

    const wrong = await call(side.url, '/api/auth/verify-email', {
      method: 'POST',
      body: { code: '000000' },
    });
    assert.strictEqual(wrong.status, 401, `${side === sqlite ? 'sqlite' : 'npmfree'} wrong code rejected`);

    const ok = await call(side.url, '/api/auth/verify-email', {
      method: 'POST',
      body: { code },
    });
    assert.strictEqual(ok.status, 200, `${side === sqlite ? 'sqlite' : 'npmfree'} correct code verifies`);
    assert.strictEqual(ok.json.ok, true);

    // Now login reports verified.
    const login = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: uname, password: 'Test123!' },
    });
    assert.strictEqual(login.status, 200);
    assert.strictEqual(login.json.user.email_verified, true, 'login reflects verification');

    // The code is single-use: replaying it fails.
    const replay = await call(side.url, '/api/auth/verify-email', {
      method: 'POST',
      body: { code },
    });
    assert.strictEqual(replay.status, 401, `${side === sqlite ? 'sqlite' : 'npmfree'} replay rejected`);
  }
});

test('verify: resend-verification mails a NEW code redeemable on both backends', async () => {
  for (const side of [sqlite, npmfree]) {
    const uname = `${user}_resend_${side === sqlite ? 's' : 'n'}`;
    await registerCapturing(side, {
      username: uname,
      password: 'Test123!',
      email: `${uname}@example.com`,
      phone: '09171234567',
    });

    let lines = [];
    const orig = console.log;
    console.log = (...args) => {
      const line = args.join(' ');
      if (line.includes('verification code')) lines.push(line);
      orig(...args);
    };
    let res;
    try {
      res = await call(side.url, '/api/auth/resend-verification', {
        method: 'POST',
        body: { email: `${uname}@example.com` },
      });
    } finally {
      console.log = orig;
    }
    assert.strictEqual(res.status, 200);
    const newCode = extractCode(lines[0]);
    assert.ok(/^\d{6}$/.test(newCode || ''), `${side === sqlite ? 'sqlite' : 'npmfree'} resend emitted a code`);

    const ok = await call(side.url, '/api/auth/verify-email', {
      method: 'POST',
      body: { code: newCode },
    });
    assert.strictEqual(ok.status, 200, 'the resent code verifies the account');
  }
});

test('verify: resend for a VERIFIED (or unknown) email sends nothing but still 200 (no oracle)', async () => {
  for (const side of [sqlite, npmfree]) {
    let lines = [];
    const orig = console.log;
    console.log = (...args) => {
      const line = args.join(' ');
      if (line.includes('verification code')) lines.push(line);
      orig(...args);
    };
    try {
      // Unknown email -> 200, no email.
      const unknown = await call(side.url, '/api/auth/resend-verification', {
        method: 'POST',
        body: { email: 'nobody@nowhere.invalid' },
      });
      assert.strictEqual(unknown.status, 200);
      // Seeded verified account (customer) -> 200, no email.
      const verified = await call(side.url, '/api/auth/resend-verification', {
        method: 'POST',
        body: { email: 'customer@example.com' },
      });
      assert.strictEqual(verified.status, 200);
    } finally {
      console.log = orig;
    }
    assert.strictEqual(lines.length, 0, 'no code sent for unknown or verified emails');
  }
});

test('verify: /api/auth/me exposes email_verified on both backends', async () => {
  for (const side of [sqlite, npmfree]) {
    const me = await call(side.url, '/api/auth/me', { token: side.token.admin });
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.json.email_verified, true, 'seeded admin is verified');
  }
});

test('verify: /api/users includes email_verified on both backends (shape parity)', async () => {
  const a = await call(sqlite.url, '/api/users', { token: sqlite.token.admin });
  const b = await call(npmfree.url, '/api/users', { token: npmfree.token.admin });
  assert.strictEqual(a.status, 200);
  assert.strictEqual(b.status, 200);
  assert.deepStrictEqual(shapeOf(a.json), shapeOf(b.json));
  assert.strictEqual(typeof a.json[0].email_verified, 'boolean');
  assert.strictEqual(typeof b.json[0].email_verified, 'boolean');
});

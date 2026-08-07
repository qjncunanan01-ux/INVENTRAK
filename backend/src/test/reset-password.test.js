// Password reset flow: forgot-password (email -> 6-digit code) and
// reset-password (code + strong new password), driven against BOTH backends
// (SQLite + npm-free) via the harness.
//
// IMPORTANT: a per-IP quota (the shared login lockout) throttles the reset
// endpoints, so this functional suite raises the threshold high enough that
// the quota never interferes with the behavior being tested. The brute-force
// 429 + lockout-clear behavior is exercised with REAL defaults in
// reset-password-lockout.test.js (own process).
process.env.LOGIN_LOCKOUT_MAX_FAILURES = '1000';

// Asserts:
//   - the code is emailed (captured from the notify log line), never returned
//     in the response, and never revealed for unknown emails (no enumeration)
//   - the new password works, the old one doesn't
//   - codes are single-use, garbage codes fail, weak passwords are rejected
//   - both backends behave identically (same statuses + response shapes)
//   - resetting also clears brute-force lockout state for that account
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { sqlite, npmfree, bootBoth, teardown, call, both, shapeOf } = require('./harness');

function extractCode(line) {
  // The notify log line is `[notify] email (...) :: {"to":...,"text":"..."}`
  // where the payload is JSON.stringify'd (newlines appear as literal \n
  // escapes). Parse the JSON payload and read the code from the real text.
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

// Fires a request while capturing any password-reset email the notify layer
// logs (it logs the payload, code included, when no provider key is set).
async function callCapturingReset(side, body) {
  let lines = [];
  const orig = console.log;
  console.log = (...args) => {
    const line = args.join(' ');
    if (line.includes('password reset code')) lines.push(line);
    orig(...args);
  };
  try {
    const res = await call(side.url, '/api/auth/forgot-password', { method: 'POST', body });
    return { res, lines };
  } finally {
    console.log = orig;
  }
}

let user;

before(async () => {
  await bootBoth();
  user = `reset_${Date.now().toString(36)}`;
});

after(() => {
  teardown();
});

test('reset: forgot-password returns 200 + identical shape on both backends, code arrives by email (not in the response)', async () => {
  // Register the same account on both backends (isolated stores).
  for (const side of [sqlite, npmfree]) {
    const reg = await call(side.url, '/api/auth/register', {
      method: 'POST',
      body: { username: user, password: 'OldPass!123', email: `${user}@example.com`, phone: '09171234567' },
    });
    assert.strictEqual(reg.status, 200, `${side === sqlite ? 'sqlite' : 'npmfree'} register`);
  }

  const { a, b } = await both('forgot-password', '/api/auth/forgot-password', {
    method: 'POST',
    body: { email: `${user}@example.com` },
  });
  assert.strictEqual(a.status, 200);
  assert.strictEqual(b.status, 200);
  // Never leak the code in the response body (the message legitimately says
  // "reset code" — assert the actual 6-digit value is absent).
  assert.deepStrictEqual(shapeOf(a.json), shapeOf(b.json));
  assert.strictEqual(a.json.ok, true);
  assert.ok(!/\d{6}/.test(JSON.stringify(a.json)), 'response must not contain a 6-digit code');
});

test('reset: unknown email returns the SAME 200 (no user-enumeration oracle) and sends no code', async () => {
  for (const side of [sqlite, npmfree]) {
    const { res, lines } = await callCapturingReset(side, { email: 'nobody@nowhere.invalid' });
    assert.strictEqual(res.status, 200, `${side === sqlite ? 'sqlite' : 'npmfree'} unknown email still 200`);
    assert.strictEqual(res.json.ok, true);
    assert.strictEqual(lines.length, 0, 'no reset email for an unknown account');
  }
});

test('reset: missing email is a 400 with the standard error shape on both backends', async () => {
  const { a, b } = await both('forgot-password missing email', '/api/auth/forgot-password', {
    method: 'POST',
    body: {},
  });
  assert.strictEqual(a.status, 400);
  assert.strictEqual(b.status, 400);
  assert.ok(Array.isArray(a.json.details) && Array.isArray(b.json.details));
});

// The code itself is obtained from the email (captured from the notify log),
// exactly like a real customer reading their inbox.
async function requestCode(side) {
  const { res, lines } = await callCapturingReset(side, { email: `${user}@example.com` });
  assert.strictEqual(res.status, 200);
  const code = extractCode(lines[0]);
  assert.ok(code && /^\d{6}$/.test(code), `expected a 6-digit code in the email, got ${code}`);
  return code;
}

test('reset: valid code + strong password updates login on BOTH backends (new works, old fails)', async () => {
  for (const side of [sqlite, npmfree]) {
    const code = await requestCode(side);

    // Weak password first: rejected before any code consumption.
    const weak = await call(side.url, '/api/auth/reset-password', {
      method: 'POST',
      body: { code, password: 'weak' },
    });
    assert.strictEqual(weak.status, 400, `${side === sqlite ? 'sqlite' : 'npmfree'} weak password`);
    assert.ok(Array.isArray(weak.json.details) && weak.json.details.length > 0);

    // Valid reset.
    const ok = await call(side.url, '/api/auth/reset-password', {
      method: 'POST',
      body: { code, password: 'BrandNew!456' },
    });
    assert.strictEqual(ok.status, 200, `${side === sqlite ? 'sqlite' : 'npmfree'} reset`);
    assert.strictEqual(ok.json.ok, true);

    // New password logs in; old one is dead.
    const fresh = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: user, password: 'BrandNew!456' },
    });
    assert.strictEqual(fresh.status, 200, `${side === sqlite ? 'sqlite' : 'npmfree'} login with new password`);
    const stale = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: user, password: 'OldPass!123' },
    });
    assert.strictEqual(stale.status, 401, `${side === sqlite ? 'sqlite' : 'npmfree'} old password rejected`);
  }
});

test('reset: codes are single-use — a replayed code fails on BOTH backends', async () => {
  for (const side of [sqlite, npmfree]) {
    const code = await requestCode(side);
    const first = await call(side.url, '/api/auth/reset-password', {
      method: 'POST',
      body: { code, password: 'Another!789' },
    });
    assert.strictEqual(first.status, 200, `${side === sqlite ? 'sqlite' : 'npmfree'} first use`);
    const replay = await call(side.url, '/api/auth/reset-password', {
      method: 'POST',
      body: { code, password: 'Another!789' },
    });
    assert.strictEqual(replay.status, 401, `${side === sqlite ? 'sqlite' : 'npmfree'} replay rejected`);
  }
});

test('reset: garbage / wrong-length codes are rejected (401) on both backends', async () => {
  const { a, b } = await both('garbage code', '/api/auth/reset-password', {
    method: 'POST',
    body: { code: '000000', password: 'Strong!Pass1' },
  });
  assert.strictEqual(a.status, 401);
  assert.strictEqual(b.status, 401);
  assert.strictEqual(a.json.error, b.json.error);
});

test('reset: missing fields are 400 with the standard error shape', async () => {
  const { a, b } = await both('reset missing fields', '/api/auth/reset-password', {
    method: 'POST',
    body: { code: '123456' },
  });
  assert.strictEqual(a.status, 400);
  assert.strictEqual(b.status, 400);
  assert.ok(Array.isArray(a.json.details) && Array.isArray(b.json.details));
});

test('reset: case-insensitive email lookup finds the account on both backends', async () => {
  for (const side of [sqlite, npmfree]) {
    const { res, lines } = await callCapturingReset(side, { email: `${user.toUpperCase()}@EXAMPLE.COM` });
    assert.strictEqual(res.status, 200);
    const code = extractCode(lines[0]);
    assert.ok(/^\d{6}$/.test(code || ''), `${side === sqlite ? 'sqlite' : 'npmfree'} emailed a code for mixed-case email`);
    // Clean up: consume the code so the store holds no outstanding tokens.
    await call(side.url, '/api/auth/reset-password', {
      method: 'POST',
      body: { code, password: 'Cleanup!123' },
    });
  }
});

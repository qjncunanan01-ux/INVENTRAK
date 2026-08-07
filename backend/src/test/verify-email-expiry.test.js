// Verification-code expiry: boots BOTH backends with VERIFICATION_CODE_TTL_MS=1
// so the 30-minute expiry is exercised in milliseconds. Own process (the TTL
// is read at module load, so the env must be set before the harness imports
// the backend modules).
process.env.VERIFICATION_CODE_TTL_MS = '1';
process.env.LOGIN_LOCKOUT_MAX_FAILURES = '1000';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

let user;

before(async () => {
  await bootBoth();
  user = `verify_exp_${Date.now().toString(36)}`;
});

after(() => {
  teardown();
});

test('verify: a code older than the TTL is rejected as expired on BOTH backends', async () => {
  for (const side of [sqlite, npmfree]) {
    const uname = `${user}_${side === sqlite ? 's' : 'n'}`;
    let lines = [];
    const orig = console.log;
    console.log = (...args) => {
      const line = args.join(' ');
      if (line.includes('verification code')) lines.push(line);
      orig(...args);
    };
    let res;
    try {
      res = await call(side.url, '/api/auth/register', {
        method: 'POST',
        body: { username: uname, password: 'Test123!', email: `${uname}@example.com`, phone: '09171234567' },
      });
    } finally {
      console.log = orig;
    }
    assert.strictEqual(res.status, 200);
    const code = extractCode(lines[0]);
    assert.ok(/^\d{6}$/.test(code || ''), `${side === sqlite ? 'sqlite' : 'npmfree'} captured a code`);

    // Let the 1ms TTL lapse, then try to redeem.
    await sleep(15);

    const verify = await call(side.url, '/api/auth/verify-email', {
      method: 'POST',
      body: { code },
    });
    assert.strictEqual(verify.status, 401, `${side === sqlite ? 'sqlite' : 'npmfree'} expired code rejected`);
    assert.match(verify.json.error, /expired/i);

    // The account is still unverified.
    const login = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: uname, password: 'Test123!' },
    });
    assert.strictEqual(login.json.user.email_verified, false, 'account stays unverified after expiry');
  }
});

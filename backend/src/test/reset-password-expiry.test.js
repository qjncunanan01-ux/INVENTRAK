// Reset-code expiry: boots BOTH backends with RESET_CODE_TTL_MS=1 so the
// 30-minute expiry is exercised in milliseconds. Must run in its OWN process
// (it is listed separately in the npm test script) because the TTL is read at
// module load — a fresh env is required before the harness imports the
// backend modules.
process.env.RESET_CODE_TTL_MS = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The notify log line is `[notify] email (...) :: {"to":...,"text":"..."}`
// with the payload JSON.stringify'd (newlines as literal \n escapes). Parse
// the JSON and pull the 6-digit code out of the real text.
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
  user = `reset_exp_${Date.now().toString(36)}`;
});

after(() => {
  teardown();
});

test('reset: a code older than the TTL is rejected as expired on BOTH backends', async () => {
  for (const side of [sqlite, npmfree]) {
    await call(side.url, '/api/auth/register', {
      method: 'POST',
      body: { username: user, password: 'OldPass!123', email: `${user}@example.com`, phone: '09171234567' },
    });

    let lines = [];
    const orig = console.log;
    console.log = (...args) => {
      const line = args.join(' ');
      if (line.includes('password reset code')) lines.push(line);
      orig(...args);
    };
    let res;
    try {
      res = await call(side.url, '/api/auth/forgot-password', {
        method: 'POST',
        body: { email: `${user}@example.com` },
      });
    } finally {
      console.log = orig;
    }
    assert.strictEqual(res.status, 200);

    const code = extractCode(lines[0]);
    assert.ok(/^\d{6}$/.test(code || ''), `${side === sqlite ? 'sqlite' : 'npmfree'} captured a code`);

    // Let the 1ms TTL lapse, then try to redeem.
    await sleep(15);

    const reset = await call(side.url, '/api/auth/reset-password', {
      method: 'POST',
      body: { code, password: 'BrandNew!456' },
    });
    assert.strictEqual(reset.status, 401, `${side === sqlite ? 'sqlite' : 'npmfree'} expired code rejected`);
    assert.match(reset.json.error, /expired/i);

    // The account's password is untouched — the old one still works.
    const login = await call(side.url, '/api/auth/login', {
      method: 'POST',
      body: { username: user, password: 'OldPass!123' },
    });
    assert.strictEqual(login.status, 200, `${side === sqlite ? 'sqlite' : 'npmfree'} original password intact after expiry`);
  }
});

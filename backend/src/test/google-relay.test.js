// Tests for the server-side Google OAuth relay (/api/auth/google/start +
// /api/auth/google/callback). The relay exists because Expo Go deep links
// (exp://…) can't be registered as Google OAuth redirect URIs — the backend
// holds the web client's secret and exchanges the code itself.
//
// Two layers:
//   1. Unit tests for the pure helpers in google-auth.js (state, URL building,
//      code exchange with a fake fetch, return-URL allowlist).
//   2. End-to-end tests against BOTH backends (harness), with global.fetch
//      stubbed to a fake Google (JWKS for id-token verification, token
//      endpoint for the code exchange) so the full happy path runs locally.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const {
  isAllowedReturnUrl,
  createRelayState,
  consumeRelayState,
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  relayCallbackUrl,
  resetJwksCache,
} = require('../google-auth');

const { sqlite, npmfree, bootBoth, teardown, call, both } = require('./harness');

// --- Fake Google: RSA keypair, JWKS, and a minting helper (mirrors the
// --- google-auth.test.js pattern). The id_token's `aud` must be the
// --- allow-listed client id used in the relay env below.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
const JWKS = { keys: [{ kty: 'RSA', kid: 'relay-test-key', alg: 'RS256', n: publicJwk.n, e: publicJwk.e }] };

function mintGoogleIdToken(overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'relay-test-key', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'accounts.google.com',
    aud: 'test-client',
    sub: 'google-relay-sub-42',
    email: 'relay.user@gmail.com',
    email_verified: true,
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${header}.${body}`;
  const sig = crypto.createSign('RSA-SHA256').update(signingInput).end().sign(privateKey, 'base64url');
  return `${signingInput}.${sig}`;
}

// Config the servers need (read at request time from process.env).
const RELAY_ENV = { GOOGLE_CLIENT_IDS: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' };

function setRelayEnv() {
  process.env.GOOGLE_CLIENT_IDS = RELAY_ENV.GOOGLE_CLIENT_IDS;
  process.env.GOOGLE_CLIENT_SECRET = RELAY_ENV.GOOGLE_CLIENT_SECRET;
}
function clearRelayEnv() {
  delete process.env.GOOGLE_CLIENT_IDS;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_CALLBACK_URL;
}

// Stub global.fetch so the servers' real code paths hit a fake Google:
// - https://www.googleapis.com/oauth2/v3/certs   -> JWKS (id-token signature)
// - https://oauth2.googleapis.com/token          -> code exchange returns a
//   freshly minted id_token.
// Returns a restore function.
function stubGoogleFetch() {
  const original = global.fetch;
  global.fetch = async (input, init) => {
    const u = String(input);
    if (u.includes('/oauth2/v3/certs')) return { ok: true, json: async () => JWKS };
    if (u.includes('oauth2.googleapis.com/token')) {
      return { ok: true, text: async () => JSON.stringify({ id_token: mintGoogleIdToken() }) };
    }
    return original(input, init);
  };
  return () => {
    global.fetch = original;
  };
}

// Non-redirect-following GET so we can inspect 302 Locations.
async function rawGet(url, pathname) {
  const res = await fetch(`${url}${pathname}`, { redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location') || '', text };
}

test.before(bootBoth);
test.after(() => {
  clearRelayEnv();
  teardown();
});
test.beforeEach(() => resetJwksCache());

// ================= Unit: return-URL allowlist =================

test('isAllowedReturnUrl accepts app deep links and localhost, rejects everything else', () => {
  assert.strictEqual(isAllowedReturnUrl('exp://kizpk_s-patrickcuevas-8081.exp.direct/--/google-auth'), true);
  assert.strictEqual(isAllowedReturnUrl('exp://192.168.1.5:8081/--/x'), true);
  assert.strictEqual(isAllowedReturnUrl('inventrak://google-auth'), true);
  assert.strictEqual(isAllowedReturnUrl('http://localhost:4001/cb'), true);
  assert.strictEqual(isAllowedReturnUrl('http://127.0.0.1:4001/cb'), true);
  assert.strictEqual(isAllowedReturnUrl('https://evil.example.com/phish'), false);
  assert.strictEqual(isAllowedReturnUrl('https://inventrak-api.onrender.com/x'), false);
  assert.strictEqual(isAllowedReturnUrl('exp:'), false);
  assert.strictEqual(isAllowedReturnUrl(''), false);
  assert.strictEqual(isAllowedReturnUrl('x'.repeat(501)), false);
  assert.strictEqual(isAllowedReturnUrl(null), false);
  assert.strictEqual(isAllowedReturnUrl(42), false);
});

// ================= Unit: relay CSRF state =================

test('relay state is single-use and expires', () => {
  const state = createRelayState('exp://host/--/auth', 1000);
  const first = consumeRelayState(state, 2000);
  assert.deepStrictEqual(first, { ok: true, returnUrl: 'exp://host/--/auth' });
  // Second consumption of the same state must fail (single-use).
  assert.deepStrictEqual(consumeRelayState(state, 3000), { ok: false, reason: 'unknown-or-expired' });
  // Unknown state.
  assert.deepStrictEqual(consumeRelayState('nope', 3000), { ok: false, reason: 'unknown-or-expired' });
  assert.deepStrictEqual(consumeRelayState(null, 3000), { ok: false, reason: 'unknown-or-expired' });
});

test('relay state expires after the TTL', () => {
  const state = createRelayState('exp://host/--/auth', 1000); // TTL 10min -> expires 601000
  assert.deepStrictEqual(consumeRelayState(state, 601001), { ok: false, reason: 'unknown-or-expired' });
});

// ================= Unit: auth URL + callback URL =================

test('buildGoogleAuthUrl carries the code flow params and state', () => {
  const url = buildGoogleAuthUrl({ clientId: 'client-1', redirectUri: 'https://api.example/cb', state: 's3cret' });
  const u = new URL(url);
  assert.strictEqual(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.strictEqual(u.searchParams.get('client_id'), 'client-1');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://api.example/cb');
  assert.strictEqual(u.searchParams.get('response_type'), 'code');
  assert.strictEqual(u.searchParams.get('state'), 's3cret');
  assert.strictEqual(u.searchParams.get('prompt'), 'select_account');
  assert.ok(u.searchParams.get('scope').includes('openid'));
  assert.ok(u.searchParams.get('scope').includes('email'));
});

test('relayCallbackUrl honors the env override and request-derived https', () => {
  const req = { headers: { host: 'inventrak-api.onrender.com', 'x-forwarded-proto': 'https' } };
  assert.strictEqual(
    relayCallbackUrl(req),
    'https://inventrak-api.onrender.com/api/auth/google/callback'
  );
  // Forwarded proto wins even on a non-render host.
  assert.strictEqual(
    relayCallbackUrl({ headers: { host: 'api.example.com', 'x-forwarded-proto': 'https' } }),
    'https://api.example.com/api/auth/google/callback'
  );
  // Local dev (no forward header) stays http.
  assert.strictEqual(
    relayCallbackUrl({ headers: { host: 'localhost:4001' } }),
    'http://localhost:4001/api/auth/google/callback'
  );
  // Explicit override beats everything (deploy docs).
  assert.strictEqual(
    relayCallbackUrl(req, { GOOGLE_OAUTH_CALLBACK_URL: 'https://fixed.example/cb' }),
    'https://fixed.example/cb'
  );
});

// ================= Unit: code exchange (fake fetch) =================

test('exchangeCodeForTokens succeeds and reports failures precisely', async () => {
  const ok = await exchangeCodeForTokens('the-code', {
    clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost:4001/cb',
    fetchImpl: async (u, init) => {
      assert.ok(u.includes('oauth2.googleapis.com/token'));
      assert.strictEqual(init.method, 'POST');
      assert.ok(init.body.includes('grant_type=authorization_code'));
      assert.ok(init.body.includes('code=the-code'));
      assert.ok(init.body.includes('client_secret=s'));
      return { ok: true, text: async () => JSON.stringify({ id_token: 'jwt-1', access_token: 'at' }) };
    },
  });
  assert.deepStrictEqual(ok, { ok: true, tokens: { id_token: 'jwt-1', access_token: 'at' } });

  const httpErr = await exchangeCodeForTokens('code', {
    clientId: 'c', clientSecret: 's', redirectUri: 'cb',
    fetchImpl: async () => ({ ok: false, status: 400, text: async () => '{"error":"invalid_grant","error_description":"bad code"}' }),
  });
  assert.deepStrictEqual(httpErr, { ok: false, reason: 'http_400', detail: 'bad code' });

  const noToken = await exchangeCodeForTokens('code', {
    clientId: 'c', clientSecret: 's', redirectUri: 'cb',
    fetchImpl: async () => ({ ok: true, text: async () => '{}' }),
  });
  assert.deepStrictEqual(noToken, { ok: false, reason: 'no-id-token' });

  const netFail = await exchangeCodeForTokens('code', {
    clientId: 'c', clientSecret: 's', redirectUri: 'cb',
    fetchImpl: async () => { throw new Error('boom'); },
  });
  assert.strictEqual(netFail.ok, false);
  assert.strictEqual(netFail.reason, 'network');

  const missing = await exchangeCodeForTokens('', { clientId: 'c', clientSecret: 's', redirectUri: 'cb' });
  assert.deepStrictEqual(missing, { ok: false, reason: 'missing-params' });
});

test('exchangeCodeForTokens with the DEFAULT fetch forwards POST + body (regression: http_404 live bug)', async () => {
  // The default fetchImpl must forward init — an earlier version only passed
  // the URL, so the live server sent a plain GET to Google's token endpoint,
  // which answers 404 (POST only). Inject via global.fetch, exactly like the
  // server code paths do, and assert the request that actually leaves.
  const original = global.fetch;
  let seenMethod = null;
  let seenBody = null;
  global.fetch = async (u, init) => {
    seenMethod = init && init.method;
    seenBody = init && init.body;
    return { ok: true, text: async () => JSON.stringify({ id_token: 'jwt-x' }) };
  };
  try {
    const res = await exchangeCodeForTokens('the-code', {
      clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost:4001/cb',
    });
    assert.deepStrictEqual(res, { ok: true, tokens: { id_token: 'jwt-x' } });
    assert.strictEqual(seenMethod, 'POST', 'default fetchImpl must send POST');
    assert.ok(seenBody && seenBody.includes('grant_type=authorization_code'), 'default fetchImpl must send the form body');
  } finally {
    global.fetch = original;
  }
});

// ================= Server-level: both backends =================

test('start returns 501 when the relay is not configured (both backends)', async () => {
  clearRelayEnv();
  const { a, b } = await both('start-unconfigured', '/api/auth/google/start?returnUrl=' + encodeURIComponent('exp://host/--/auth'), {
    method: 'GET',
  });
  assert.strictEqual(a.status, 501);
  assert.strictEqual(b.status, 501);
});

test('start rejects disallowed return urls (both backends)', async () => {
  setRelayEnv();
  const { a, b } = await both('start-bad-return', '/api/auth/google/start?returnUrl=' + encodeURIComponent('https://evil.example.com/phish'), {
    method: 'GET',
  });
  assert.strictEqual(a.status, 400);
  assert.strictEqual(b.status, 400);
  assert.strictEqual(a.json.error, 'Validation failed');
  assert.strictEqual(b.json.error, 'Validation failed');
  clearRelayEnv();
});

test('callback rejects a missing/unknown state (both backends)', async () => {
  setRelayEnv();
  const { a, b } = await both('callback-no-state', '/api/auth/google/callback?code=abc', { method: 'GET' });
  assert.strictEqual(a.status, 400);
  assert.strictEqual(b.status, 400);
  assert.strictEqual(a.json.error, 'Invalid Google sign-in state');
  clearRelayEnv();
});

test('start redirects to Google with a state + the backend callback (both backends)', async () => {
  setRelayEnv();
  const restore = stubGoogleFetch();
  try {
    for (const side of [sqlite, npmfree]) {
      const r = await rawGet(side.url, '/api/auth/google/start?returnUrl=' + encodeURIComponent('exp://host/--/auth'));
      assert.strictEqual(r.status, 302);
      const u = new URL(r.location);
      assert.strictEqual(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
      assert.strictEqual(u.searchParams.get('response_type'), 'code');
      assert.ok(u.searchParams.get('state'), 'state present');
      assert.strictEqual(u.searchParams.get('redirect_uri'), `${side.url}/api/auth/google/callback`);
    }
  } finally {
    restore();
    clearRelayEnv();
  }
});

test('callback relays a Google denial to the app deep link (both backends)', async () => {
  setRelayEnv();
  try {
    for (const side of [sqlite, npmfree]) {
      // Mint a state the way the app flow does (start -> extract state).
      const start = await rawGet(side.url, '/api/auth/google/start?returnUrl=' + encodeURIComponent('exp://host/--/auth'));
      const state = new URL(start.location).searchParams.get('state');
      const cb = await rawGet(side.url, `/api/auth/google/callback?state=${state}&error=access_denied`);
      assert.strictEqual(cb.status, 302);
      const loc = new URL(cb.location);
      // exp: is a non-special scheme, so origin is null — compare the parts.
      assert.strictEqual(`${loc.protocol}//${loc.host}${loc.pathname}`, 'exp://host/--/auth');
      assert.strictEqual(loc.searchParams.get('error'), 'access_denied');
    }
  } finally {
    clearRelayEnv();
  }
});

test('full relay happy path creates the account and returns a working token (both backends)', async () => {
  setRelayEnv();
  const restore = stubGoogleFetch();
  try {
    for (const side of [sqlite, npmfree]) {
      const returnUrl = 'exp://host/--/auth';
      const start = await rawGet(side.url, '/api/auth/google/start?returnUrl=' + encodeURIComponent(returnUrl));
      const state = new URL(start.location).searchParams.get('state');

      const cb = await rawGet(side.url, `/api/auth/google/callback?state=${state}&code=auth-code-123`);
      assert.strictEqual(cb.status, 302, `${side.url}: callback should redirect`);
      const loc = new URL(cb.location);
      assert.strictEqual(`${loc.protocol}//${loc.host}${loc.pathname}`, 'exp://host/--/auth');
      const token = loc.searchParams.get('token');
      assert.ok(token, 'session token in the deep link');
      assert.strictEqual(loc.searchParams.get('email'), 'relay.user@gmail.com');
      assert.strictEqual(loc.searchParams.get('role'), 'customer');
      assert.strictEqual(loc.searchParams.get('email_verified'), '1');

      // The session is real: the token works against /api/auth/me.
      const me = await call(side.url, '/api/auth/me', { token });
      assert.strictEqual(me.status, 200);
      assert.strictEqual(me.json.email, 'relay.user@gmail.com');
      assert.strictEqual(me.json.username, 'relay.user');

      // The account row exists (admin list) — the google_sub link is stored
      // (the list endpoint deliberately hides google_sub itself).
      const users = await call(side.url, '/api/users', { token: side.token.admin });
      assert.ok(users.json.some((u) => u.email === 'relay.user@gmail.com'), 'google account row present');

      // State is single-use: replaying the callback is rejected.
      const replay = await rawGet(side.url, `/api/auth/google/callback?state=${state}&code=again`);
      assert.strictEqual(replay.status, 400, 'replayed state must be rejected');
    }
  } finally {
    restore();
    clearRelayEnv();
  }
});

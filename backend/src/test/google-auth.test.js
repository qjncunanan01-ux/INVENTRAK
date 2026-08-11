const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { verifyGoogleIdToken, googleClientIds, isConfigured, resetJwksCache } = require('../google-auth');

test.beforeEach(() => resetJwksCache());

// Build a realistic test setup: an RSA keypair standing in for Google's
// signing key, a JWKS document served by a fake fetch, and a helper that
// mints RS256 JWTs with arbitrary claims.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
const JWKS = { keys: [{ kty: 'RSA', kid: 'test-key', alg: 'RS256', n: publicJwk.n, e: publicJwk.e }] };

function makeToken(overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'accounts.google.com',
    aud: 'test-client',
    sub: '1234567890',
    email: 'google.user@gmail.com',
    email_verified: true,
    name: 'Google User',
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${header}.${body}`;
  const sig = crypto.createSign('RSA-SHA256').update(signingInput).end().sign(privateKey, 'base64url');
  return `${signingInput}.${sig}`;
}

const fetchJwks = async () => ({ ok: true, json: async () => JWKS });

test('googleClientIds parses the comma-separated env var and ignores empties', () => {
  assert.deepStrictEqual(googleClientIds({ GOOGLE_CLIENT_IDS: ' a ,,b ' }), ['a', 'b']);
  assert.deepStrictEqual(googleClientIds({}), []);
  assert.strictEqual(isConfigured({ GOOGLE_CLIENT_IDS: 'x' }), true);
  assert.strictEqual(isConfigured({}), false);
});

test('verifyGoogleIdToken accepts a valid token from a known client', async () => {
  const res = await verifyGoogleIdToken(makeToken(), { clientIds: ['test-client'], fetchImpl: fetchJwks });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.payload.email, 'google.user@gmail.com');
  assert.strictEqual(res.payload.email_verified, true);
  assert.strictEqual(res.payload.sub, '1234567890');
});

test('verifyGoogleIdToken returns unconfigured when no client IDs are set', async () => {
  const res = await verifyGoogleIdToken(makeToken(), { clientIds: [], fetchImpl: fetchJwks });
  assert.deepStrictEqual(res, { ok: false, reason: 'unconfigured' });
});

test('verifyGoogleIdToken rejects a token minted for a different client', async () => {
  const res = await verifyGoogleIdToken(makeToken({ aud: 'some-other-app' }), {
    clientIds: ['test-client'],
    fetchImpl: fetchJwks,
  });
  assert.strictEqual(res.reason, 'audience');
});

test('verifyGoogleIdToken rejects expired tokens (and honors nbf)', async () => {
  const expired = await verifyGoogleIdToken(makeToken({ exp: Math.floor(Date.now() / 1000) - 600 }), {
    clientIds: ['test-client'],
    fetchImpl: fetchJwks,
  });
  assert.strictEqual(expired.reason, 'expired');
  const future = await verifyGoogleIdToken(makeToken({ nbf: Math.floor(Date.now() / 1000) + 600 }), {
    clientIds: ['test-client'],
    fetchImpl: fetchJwks,
  });
  assert.strictEqual(future.reason, 'expired');
});

test('verifyGoogleIdToken rejects a tampered signature', async () => {
  const token = makeToken();
  const parts = token.split('.');
  const forged = `${parts[0]}.${parts[1]}.${Buffer.from('forged').toString('base64url')}`;
  const res = await verifyGoogleIdToken(forged, { clientIds: ['test-client'], fetchImpl: fetchJwks });
  assert.strictEqual(res.reason, 'signature');
});

test('verifyGoogleIdToken rejects tokens not issued by Google', async () => {
  const res = await verifyGoogleIdToken(makeToken({ iss: 'evil.example.com' }), {
    clientIds: ['test-client'],
    fetchImpl: fetchJwks,
  });
  assert.strictEqual(res.reason, 'issuer');
});

test('verifyGoogleIdToken rejects malformed and non-RS256 tokens', async () => {
  assert.strictEqual((await verifyGoogleIdToken('not.a.jwt', { clientIds: ['x'] })).reason, 'malformed');
  const hs256 = makeToken();
  const parts = hs256.split('.');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'test-key' })).toString('base64url');
  const res = await verifyGoogleIdToken(`${header}.${parts[1]}.${parts[2]}`, {
    clientIds: ['test-client'],
    fetchImpl: fetchJwks,
  });
  assert.strictEqual(res.reason, 'signature');
});

test('verifyGoogleIdToken reports unavailable when the JWKS fetch fails', async () => {
  const failFetch = async () => { throw new Error('network down'); };
  const res = await verifyGoogleIdToken(makeToken(), { clientIds: ['test-client'], fetchImpl: failFetch });
  assert.strictEqual(res.reason, 'unavailable');
});

test('verifyGoogleIdToken caches the JWKS across calls (single fetch)', async () => {
  let calls = 0;
  const countingFetch = async () => {
    calls += 1;
    return { ok: true, json: async () => JWKS };
  };
  await verifyGoogleIdToken(makeToken(), { clientIds: ['test-client'], fetchImpl: countingFetch });
  await verifyGoogleIdToken(makeToken(), { clientIds: ['test-client'], fetchImpl: countingFetch });
  assert.strictEqual(calls, 1, 'the keyset should be fetched only once within the cache window');
});

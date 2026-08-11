// Google OAuth ID-token verification — shared by BOTH backends (SQLite and
// the npm-free fallback), so it must be pure Node with zero dependencies:
// JWT signature check via node:crypto against Google's published JWKS
// (https://www.googleapis.com/oauth2/v3/certs), with the keyset cached in
// memory (24h, matching Google's rotation cadence).
//
// Flow: the mobile app runs the Google sign-in flow (expo-auth-session) and
// sends back the resulting `id_token`; this module verifies it and returns
// the verified claims (email, sub, ...) so each backend can find-or-create
// the customer account. `GOOGLE_CLIENT_IDS` (comma-separated) lists the OAuth
// client IDs allowed in the token's `aud` — without it the endpoint answers
// 501 (not configured) so local dev keeps working with zero setup.
//
// Testability: `verifyGoogleIdToken` accepts an injected `fetchImpl` and
// `now` so unit tests can hand it a fake JWKS and a clock without touching
// the network.

const crypto = require('node:crypto');

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const JWKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOWED_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

// Comma-separated OAuth client IDs allowed in the token's `aud` claim.
function googleClientIds(env = process.env) {
  return (env.GOOGLE_CLIENT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isConfigured(env = process.env) {
  return googleClientIds(env).length > 0;
}

// --- JWT helpers (pure Node) ---

function base64UrlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function parseJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'));
    const payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'));
    const signature = base64UrlDecode(parts[2]);
    return { header, payload, signature, signingInput: `${parts[0]}.${parts[1]}` };
  } catch {
    return null;
  }
}

// --- JWKS fetching + caching ---

let jwksCache = { keys: null, fetchedAt: 0 };
let jwksFetchPromise = null;

async function fetchJwks(fetchImpl) {
  const now = Date.now();
  if (jwksCache.keys && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }
  if (!jwksFetchPromise) {
    jwksFetchPromise = (async () => {
      const res = await fetchImpl(GOOGLE_JWKS_URL);
      if (!res.ok) throw new Error(`Google JWKS request failed: HTTP ${res.status}`);
      const body = await res.json();
      const keys = Array.isArray(body && body.keys) ? body.keys : [];
      jwksCache = { keys, fetchedAt: Date.now() };
      return keys;
    })().finally(() => {
      jwksFetchPromise = null;
    });
  }
  return jwksFetchPromise;
}

// --- Verification ---

// Verifies a Google-issued ID token. Returns the payload claims on success,
// or a tagged error:
//   { ok: true, payload }                      valid token
//   { ok: false, reason: 'unconfigured' }      no GOOGLE_CLIENT_IDS set
//   { ok: false, reason: 'malformed' }         not a 3-part JWT / bad JSON
//   { ok: false, reason: 'signature' }         RS256 signature did not verify
//   { ok: false, reason: 'audience' }          `aud` not in GOOGLE_CLIENT_IDS
//   { ok: false, reason: 'issuer' }            `iss` not Google
//   { ok: false, reason: 'expired' }           token past `exp` (or before nbf)
//   { ok: false, reason: 'unavailable' }       JWKS fetch failed (network/5xx)
async function verifyGoogleIdToken(idToken, {
  clientIds = googleClientIds(),
  fetchImpl = (u) => fetch(u),
  now = Date.now(),
} = {}) {
  if (!clientIds || clientIds.length === 0) {
    return { ok: false, reason: 'unconfigured' };
  }
  const jwt = parseJwt(idToken);
  if (!jwt) return { ok: false, reason: 'malformed' };
  if (jwt.header.alg !== 'RS256') return { ok: false, reason: 'signature' };

  const payload = jwt.payload;
  // Issuer must be Google (both spellings Google uses).
  if (!ALLOWED_ISSUERS.has(payload.iss)) return { ok: false, reason: 'issuer' };
  // Audience must be one of our OAuth client IDs.
  if (!clientIds.includes(payload.aud)) return { ok: false, reason: 'audience' };
  // Lifetime window (clock-skew tolerant: 2 minutes).
  const nowSec = Math.floor(now / 1000);
  if (payload.exp && payload.exp < nowSec - 120) return { ok: false, reason: 'expired' };
  if (payload.nbf && payload.nbf > nowSec + 120) return { ok: false, reason: 'expired' };

  let keys;
  try {
    keys = await fetchJwks(fetchImpl);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  const key = keys.find((k) => k.kid === jwt.header.kid && k.alg === 'RS256');
  if (!key) return { ok: false, reason: 'signature' };
  const { n, e } = key;
  if (!n || !e) return { ok: false, reason: 'signature' };
  try {
    // Google's JWKS already ships n/e as base64urlUInt — hand them to Node's
    // JWK importer as-is (converting to decimal would corrupt the key).
    const publicKey = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n,
        e,
      },
      format: 'jwk',
    });
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(jwt.signingInput);
    verifier.end();
    if (!verifier.verify(publicKey, jwt.signature)) {
      return { ok: false, reason: 'signature' };
    }
  } catch {
    return { ok: false, reason: 'signature' };
  }

  return {
    ok: true,
    payload: {
      sub: payload.sub,
      email: payload.email,
      email_verified: payload.email_verified === true || payload.email_verified === 'true',
      name: payload.name || payload.given_name || '',
      picture: payload.picture || '',
    },
  };
}

// Test-only: clears the in-memory JWKS cache so tests can inject their own
// fetch and observe a fresh fetch count (module state would otherwise leak
// across tests in the same process).
function resetJwksCache() {
  jwksCache = { keys: null, fetchedAt: 0 };
  jwksFetchPromise = null;
}

module.exports = { verifyGoogleIdToken, googleClientIds, isConfigured, resetJwksCache };

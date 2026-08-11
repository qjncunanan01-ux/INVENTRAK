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

// ===== Server-side Google OAuth relay (code exchange) =====
// Expo Go deep links (exp://…) cannot be registered as OAuth redirect URIs
// (Google only accepts https for web clients) and the old auth.expo.io proxy
// is deprecated — so the app signs in THROUGH the backend: GET
// /api/auth/google/start redirects to Google's consent page with the
// backend's own callback URL as redirect_uri; GET /api/auth/google/callback
// exchanges the code with the web client's secret (kept server-side, the
// pattern Google's "OAuth 2.0 policy for keeping apps secure" requires) and
// deep-links back into the app with a normal INVENTRAK session token.

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const RELAY_STATE_TTL_MS = 10 * 60 * 1000;

// Short-lived CSRF state (per-instance; the callback arrives seconds later on
// the same instance). Keyed by a random token, mapped to the app return URL.
const relayStates = new Map();

// The relay is live only when an allow-listed client AND its secret exist.
function relayConfigured(env = process.env) {
  return isConfigured(env) && Boolean(env.GOOGLE_CLIENT_SECRET);
}

// The web OAuth client that owns the secret used for the code exchange.
function webClientId(env = process.env) {
  return googleClientIds(env)[0] || '';
}

function pruneRelayStates(now = Date.now()) {
  for (const [k, v] of relayStates) {
    if (v.expiresAt < now) relayStates.delete(k);
  }
}

function createRelayState(returnUrl, now = Date.now()) {
  pruneRelayStates(now);
  const state = crypto.randomBytes(18).toString('hex');
  relayStates.set(state, { returnUrl, expiresAt: now + RELAY_STATE_TTL_MS });
  return state;
}

// Single-use: consuming a state removes it even when it was valid.
function consumeRelayState(state, now = Date.now()) {
  pruneRelayStates(now);
  const entry = state ? relayStates.get(state) : undefined;
  if (!entry) return { ok: false, reason: 'unknown-or-expired' };
  relayStates.delete(state);
  return { ok: true, returnUrl: entry.returnUrl };
}

// Only app deep links may carry the session token back: Expo Go (exp://), the
// standalone app scheme (inventrak://), and localhost http for local dev.
// Everything else (e.g. https://evil.example) is rejected so a forged state
// cannot redirect a signed-in session to an attacker's site.
function isAllowedReturnUrl(returnUrl) {
  if (typeof returnUrl !== 'string' || returnUrl.length === 0 || returnUrl.length > 500) {
    return false;
  }
  let u;
  try {
    u = new URL(returnUrl);
  } catch {
    return false;
  }
  if (!u.host) return false;
  if (u.protocol === 'exp:' || u.protocol === 'inventrak:') return true;
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
    return true;
  }
  return false;
}

function buildGoogleAuthUrl({ clientId, redirectUri, state, scope = 'openid email profile' }) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    state,
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${q.toString()}`;
}

// Exchanges the one-time authorization code for tokens using the web client's
// secret. Injectable fetch so tests never touch the network.
async function exchangeCodeForTokens(code, { clientId, clientSecret, redirectUri, fetchImpl = (u, init) => fetch(u, init) }) {
  if (!code || !clientId || !clientSecret) {
    return { ok: false, reason: 'missing-params' };
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  try {
    const res = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {}
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}`, detail: data.error_description || data.error || text.slice(0, 200) };
    }
    if (!data.id_token) return { ok: false, reason: 'no-id-token' };
    return { ok: true, tokens: data };
  } catch (e) {
    return { ok: false, reason: 'network', detail: String(e.message || e) };
  }
}

// The callback URL Google must redirect to: an explicit env override wins
// (deploy docs), otherwise derived from the request (https behind Render's
// proxy, http://localhost in local dev — which Google allows unregistered).
function relayCallbackUrl(req, env = process.env) {
  if (env.GOOGLE_OAUTH_CALLBACK_URL) return env.GOOGLE_OAUTH_CALLBACK_URL;
  const host = (req && req.headers && req.headers.host) || '';
  const fwd = (req && req.headers && req.headers['x-forwarded-proto']) || '';
  const proto = fwd.split(',')[0] || (host.includes('onrender.com') ? 'https' : 'http');
  return `${proto}://${host}/api/auth/google/callback`;
}

module.exports = {
  verifyGoogleIdToken,
  googleClientIds,
  isConfigured,
  resetJwksCache,
  relayConfigured,
  webClientId,
  createRelayState,
  consumeRelayState,
  isAllowedReturnUrl,
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  relayCallbackUrl,
};

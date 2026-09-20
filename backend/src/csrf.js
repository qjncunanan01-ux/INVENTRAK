/**
 * CSRF protection — generates and validates tokens for state-changing requests.
 * Uses a double-submit cookie pattern (no server-side session store needed).
 *
 * NOT CURRENTLY MOUNTED, deliberately. The API authenticates with Bearer
 * tokens in the Authorization header (never cookies), and a cross-site form
 * cannot set that header — so there is no cookie-authenticated surface for
 * CSRF to defend. Keep this module (and its test) correct and available for a
 * future cookie-based deployment; delete it rather than mount it half-fixed.
 *
 * Hardening notes for whenever it IS mounted:
 *   - Secure is set only when the request actually arrived over TLS
 *     (Render terminates HTTPS and sets X-Forwarded-Proto), because a Secure
 *     cookie is simply dropped by a plaintext local dev server.
 *   - Every comparison length-checks first: crypto.timingSafeEqual THROWS on
 *     a length mismatch, so a malformed cookie would otherwise surface as a
 *     500 instead of a clean 403.
 */

const crypto = require('crypto');

const CSRF_SECRET = process.env.CSRF_SECRET || crypto.randomBytes(32).toString('hex');
const CSRF_TOKEN_LENGTH = 32;
const CSRF_COOKIE_NAME = '__csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * Generate a new CSRF token.
 * Returns { token, cookie } where cookie is the signed value to set.
 */
function generateToken() {
  const token = crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
  const signature = crypto.createHmac('sha256', CSRF_SECRET).update(token).digest('hex');
  return { token, cookie: `${token}.${signature}` };
}

/**
 * Constant-time comparison of two hex strings that can never throw.
 * crypto.timingSafeEqual raises RangeError when the buffers differ in length,
 * and non-hex input decodes to a shorter (or empty) buffer — so both the
 * length and the decoded byte count are checked before comparing.
 */
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length === 0) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Validate a CSRF token from the header against the cookie value.
 * Returns true if valid, false for anything malformed (never throws).
 */
function validateToken(headerToken, cookieValue) {
  if (!headerToken || !cookieValue) return false;

  const [cookieToken, cookieSig] = String(cookieValue).split('.');
  if (!cookieToken || !cookieSig) return false;

  // Verify the cookie signature
  const expectedSig = crypto.createHmac('sha256', CSRF_SECRET).update(cookieToken).digest('hex');
  if (!safeEqualHex(cookieSig, expectedSig)) {
    return false;
  }

  // Verify the header token matches the cookie token
  return safeEqualHex(headerToken, cookieToken);
}

/**
 * Express/Connect middleware that:
 * 1. Sets a CSRF cookie on GET requests
 * 2. Validates the token on POST/PUT/DELETE requests
 */
function csrfMiddleware(req, res, next) {
  const method = (req.method || '').toUpperCase();

  // Always set a fresh CSRF token cookie if one doesn't exist
  const existingCookie = req.headers.cookie
    ?.split(';')
    .map(c => c.trim().split('='))
    .find(([name]) => name === CSRF_COOKIE_NAME)?.[1];

  if (!existingCookie) {
    const { cookie } = generateToken();
    // Secure only over real TLS — a Secure cookie set on a plaintext dev
    // server is silently dropped by the browser.
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `${CSRF_COOKIE_NAME}=${cookie}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=3600`
    );
  }

  // Skip validation for safe methods
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  // Validate CSRF token for state-changing requests
  const headerToken = req.headers[CSRF_HEADER_NAME];
  const cookieValue = existingCookie;

  if (cookieValue && !validateToken(headerToken || '', cookieValue)) {
    return res
      .writeHead(403, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: 'Invalid CSRF token' }));
  }

  next();
}

module.exports = { generateToken, validateToken, csrfMiddleware, safeEqualHex, CSRF_HEADER_NAME, CSRF_COOKIE_NAME };

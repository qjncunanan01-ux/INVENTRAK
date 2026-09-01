/**
 * CSRF protection — generates and validates tokens for state-changing requests.
 * Uses a double-submit cookie pattern (no server-side session store needed).
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
 * Validate a CSRF token from the header against the cookie value.
 * Returns true if valid.
 */
function validateToken(headerToken, cookieValue) {
  if (!headerToken || !cookieValue) return false;

  const [cookieToken, cookieSig] = cookieValue.split('.');
  if (!cookieToken || !cookieSig) return false;

  // Verify the cookie signature
  const expectedSig = crypto.createHmac('sha256', CSRF_SECRET).update(cookieToken).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(cookieSig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
    return false;
  }

  // Verify the header token matches the cookie token
  return crypto.timingSafeEqual(
    Buffer.from(headerToken, 'hex'),
    Buffer.from(cookieToken, 'hex')
  );
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
    res.setHeader('Set-Cookie', `${CSRF_COOKIE_NAME}=${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`);
  }

  // Skip validation for safe methods
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  // Validate CSRF token for state-changing requests
  const headerToken = req.headers[CSRF_HEADER_NAME];
  const cookieValue = existingCookie;

  if (cookieValue && !validateToken(headerToken || '', cookieValue)) {
    return res.writeHead(403, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: 'Invalid CSRF token' }));
  }

  next();
}

module.exports = { generateToken, validateToken, csrfMiddleware, CSRF_HEADER_NAME, CSRF_COOKIE_NAME };

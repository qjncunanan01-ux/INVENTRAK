const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const settings = require('./settings');

const JWT_SECRET = process.env.JWT_SECRET || 'inventrak-secret-key-2024';

if (!process.env.JWT_SECRET) {
  console.warn('[security] JWT_SECRET is not set — using the PUBLIC fallback secret. Set JWT_SECRET on the deployed server, or anyone who reads this repo can forge admin tokens.');
  if (process.env.NODE_ENV === 'production') {
    console.error('[security] FATAL: JWT_SECRET must be set in production');
    process.exit(1);
  }
}

const MFA_TOKEN_TTL_MS = 10 * 60 * 1000;
const RESET_CODE_TTL_MS = Number(process.env.RESET_CODE_TTL_MS) || 30 * 60 * 1000;
const VERIFICATION_CODE_TTL_MS = Number(process.env.VERIFICATION_CODE_TTL_MS) || 30 * 60 * 1000;

const revokedTokens = new Map();

function pruneRevokedTokens() {
  const now = Date.now();
  for (const [jti, exp] of revokedTokens) {
    if (exp <= now) revokedTokens.delete(jti);
  }
}

function signToken(payload, expiresIn = '24h') {
  const resolved = expiresIn === '24h' ? `${settings.getSessionTokenTtlMs() / 3600000}h` : expiresIn;
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn: resolved });
}

function hashCode(code) {
  return crypto.createHmac('sha256', JWT_SECRET).update(String(code)).digest('hex');
}

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    if (user.jti) {
      pruneRevokedTokens();
      if (revokedTokens.has(user.jti)) return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    req.tokenJti = user.jti || null;
    next();
  });
}

module.exports = {
  JWT_SECRET,
  MFA_TOKEN_TTL_MS,
  RESET_CODE_TTL_MS,
  VERIFICATION_CODE_TTL_MS,
  revokedTokens,
  pruneRevokedTokens,
  signToken,
  hashCode,
  generateCode,
  authenticateToken,
};
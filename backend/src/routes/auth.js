const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const { passwordError } = require('../password-policy');
const { hashPassword, verifyPassword, consumeComparisonTime } = require('../password-hash');
const { notifyVerificationCode, notifyWelcome, notifyPasswordReset } = require('../notify');
const { generateSecret, verifyTOTP, otpauthUrl, generateRecoveryCodes, normalizeRecoveryCode, matchRecoveryCode } = require('../totp');
const { isDemoAccountBlocked } = require('../demo-accounts');
const { createLoginLockout } = require('../login-lockout');
const { sanitizeObject } = require('../sanitize');
const { validate } = require('../validation');
const { signToken, JWT_SECRET, RESET_CODE_TTL_MS, VERIFICATION_CODE_TTL_MS, MFA_TOKEN_TTL_MS, revokedTokens, pruneRevokedTokens } = require('../auth-core');
const {
  ADMIN_TIER,
  STAFF_TIER,
  MANAGEMENT_TIER,
  ASSIGNABLE_BY_ADMIN,
  ASSIGNABLE_BY_MANAGEMENT,
  isKnownRole,
  canAccessAdminPortal,
  canAccessStaffPortal,
  isManagement,
} = require('../roles');
const {
  verifyGoogleIdToken,
  isConfigured: googleAuthConfigured,
  relayConfigured,
  webClientId,
  createRelayState,
  consumeRelayState,
  isAllowedReturnUrl,
  hashifyWebReturnUrl,
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  relayCallbackUrl,
  googleUsername,
} = require('../google-auth');
const { audit } = require('../audit');
const { hashCode } = require('../auth-core');

function isDemoBlocked(username) {
  return require('../settings').getDemoAccountsDisabled() || isDemoAccountBlocked(username);
}

const loginLockout = createLoginLockout();

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    if (user.jti) {
      pruneRevokedTokens();
      if (revokedTokens.has(user.jti)) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }
    }

    req.user = user;
    req.tokenJti = user.jti || null;
    next();
  });
}

function adminOnly(req, res, next) {
  if (!ADMIN_TIER.includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function staffOrAdmin(req, res, next) {
  if (!STAFF_TIER.includes(req.user.role)) {
    return res.status(403).json({ error: 'Staff or admin access required' });
  }
  next();
}

function managementOnly(req, res, next) {
  if (!MANAGEMENT_TIER.includes(req.user.role)) {
    return res.status(403).json({ error: 'Owner or Super Admin access required' });
  }
  next();
}

// POST /api/auth/register
router.post(
  '/register',
  validate({
    username: { required: true, maxLength: 50 },
    password: { required: true, maxLength: 100 },
    email: { required: true, maxLength: 100 },
    phone: { required: true, maxLength: 20 },
  }),
  async (req, res) => {
    if (req.body.website) {
      return res.status(400).json({ error: 'Validation failed', details: ['Unexpected field: website'] });
    }
    const { username, password, email, phone } = req.body;

    if (!/^(\+63|63|0)?9\d{9}$/.test(String(phone).trim())) {
      return res.status(400).json({
        error: 'Validation failed',
        details: ['phone must be a valid PH mobile number (e.g. 09171234567 or +639171234567)'],
      });
    }

    const pwError = passwordError(password);
    if (pwError) {
      return res.status(400).json({ error: 'Validation failed', details: [pwError] });
    }

    const cleanUsername = sanitizeObject(username);
    const cleanEmail = sanitizeObject(email);
    if (!cleanUsername || cleanUsername.length === 0) {
      return res.status(400).json({ error: 'Validation failed', details: ['username must contain valid characters'] });
    }
    if (!cleanEmail || cleanEmail.length === 0) {
      return res.status(400).json({ error: 'Validation failed', details: ['email must contain valid characters'] });
    }

    const db = require('../db').db;
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const hashedPw = hashPassword(password);
    const result = db.prepare('INSERT INTO users (username, password, role, email, phone, email_verified) VALUES (?, ?, ?, ?, ?, 0)')
      .run(cleanUsername, hashedPw, 'customer', sanitizeObject(email), phone || null);

    audit('auth.register', { userId: result.lastInsertRowid, username });

    const token = signToken({ id: result.lastInsertRowid, username, role: 'customer' });

    const code = generateCode();
    db.prepare('INSERT INTO verification_codes (code_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hashCode(code), result.lastInsertRowid, new Date(Date.now() + VERIFICATION_CODE_TTL_MS).toISOString());

    const delivery = await notifyVerificationCode({
      email,
      username,
      code,
      phone: phone || null,
      ttlMinutes: Math.max(1, Math.round(VERIFICATION_CODE_TTL_MS / 60000)),
    });

    res.json({
      token,
      user: { id: result.lastInsertRowid, username, role: 'customer', email, email_verified: false },
      notify: {
        email: !!(delivery && delivery[0] && delivery[0].sent),
        sms: !!(delivery && delivery[1] && delivery[1].sent),
      },
    });
  }
);

// POST /api/auth/verify-email
router.post('/verify-email', validate({ code: { required: true, maxLength: 10 } }), (req, res) => {
  const { code } = req.body;
  const sourceIp = req.socket?.remoteAddress || req.ip || '';
  const lock = loginLockout.check('verify-email', sourceIp);
  if (lock.locked) {
    return res.status(429).json({ error: 'Too many verification attempts. Try again later.', retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000) });
  }

  const db = require('../db').db;
  const row = db.prepare('SELECT * FROM verification_codes WHERE code_hash = ?').get(hashCode(code));
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    loginLockout.recordFailure('verify-email', sourceIp);
    return res.status(401).json({ error: 'Invalid or expired verification code' });
  }

  db.prepare('DELETE FROM verification_codes WHERE code_hash = ?').run(row.code_hash);
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.user_id);

  const owner = db.prepare('SELECT username, email FROM users WHERE id = ?').get(row.user_id);
  if (owner) notifyWelcome(owner.email, owner.username);

  loginLockout.recordSuccess('verify-email', sourceIp);
  if (owner) audit('auth.email_verified', { userId: row.user_id, username: owner.username });

  res.json({ ok: true, message: 'Email verified' });
});

// POST /api/auth/resend-verification
router.post('/resend-verification', validate({ email: { required: true, maxLength: 100 } }), async (req, res) => {
  const { email } = req.body;
  const sourceIp = req.socket?.remoteAddress || req.ip || '';
  const lock = loginLockout.check('resend-verification', sourceIp);
  if (lock.locked) {
    return res.status(429).json({ error: 'Too many verification requests. Try again later.', retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000) });
  }
  loginLockout.recordFailure('resend-verification', sourceIp);

  const db = require('../db').db;
  const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND email_verified = 0').get(email);

  let notifyDelivery = null;
  if (user) {
    const code = generateCode();
    db.prepare('DELETE FROM verification_codes WHERE user_id = ? OR expires_at < ?').run(user.id, new Date().toISOString());
    db.prepare('INSERT INTO verification_codes (code_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hashCode(code), user.id, new Date(Date.now() + VERIFICATION_CODE_TTL_MS).toISOString());
    const delivery = await notifyVerificationCode({
      email: user.email,
      username: user.username,
      code,
      phone: user.phone || null,
      ttlMinutes: Math.max(1, Math.round(VERIFICATION_CODE_TTL_MS / 60000)),
    });
    notifyDelivery = { email: !!(delivery && delivery[0] && delivery[0].sent), sms: !!(delivery && delivery[1] && delivery[1].sent) };
  }

  res.json({
    ok: true,
    message: 'If an unverified account exists for that email, a new code has been sent.',
    ...(notifyDelivery ? { notify: notifyDelivery } : {}),
  });
});

// POST /api/auth/login
router.post('/login', validate({ username: { required: true }, password: { required: true } }), (req, res) => {
  if (req.body.website) {
    return res.status(400).json({ error: 'Validation failed', details: ['Unexpected field: website'] });
  }
  const { username, password } = req.body;
  const sourceIp = req.socket?.remoteAddress || req.ip || '';
  const lock = loginLockout.check(username, sourceIp);
  if (lock.locked) {
    return res.status(429).json({ error: 'Too many failed login attempts. Try again later.', retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000) });
  }

  const db = require('../db').db;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    consumeComparisonTime(password);
    loginLockout.recordFailure(username, sourceIp);
    audit('auth.login.failed', { username, ip: sourceIp });
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const verified = verifyPassword(password, user.password);
  if (!verified.ok) {
    loginLockout.recordFailure(username, sourceIp);
    audit('auth.login.failed', { username, ip: sourceIp });
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  loginLockout.recordSuccess(username, sourceIp);

  if (verified.needsRehash) {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(password), user.id);
  }

  if (isDemoBlocked(user.username)) {
    loginLockout.recordFailure(username, sourceIp);
    audit('auth.demo_account_blocked', { username, ip: sourceIp });
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  if (req.body.portal === 'admin' && !canAccessAdminPortal(user.role)) {
    audit('auth.login.portal_denied', { userId: user.id, username: user.username, ip: sourceIp });
    return res.status(403).json({
      error: 'Inventory Staff accounts are mobile-only. Use the INVENTRAK mobile app to scan QR tags and submit counts.',
      code: 'portal_mobile_only',
    });
  }

  if (req.body.portal === 'staff' && !canAccessStaffPortal(user.role)) {
    audit('auth.login.staff_portal_denied', { userId: user.id, username: user.username, ip: sourceIp });
    return res.status(403).json({
      error: 'The staff app is exclusively for Inventory Staff. Admins and owners use the web admin dashboard.',
      code: 'staff_app_exclusive',
    });
  }

  if (ADMIN_TIER.includes(user.role) && user.mfa_enabled) {
    audit('auth.login.mfa_required', { userId: user.id, username: user.username });
    return res.json({ mfa_required: true, mfaToken: signToken({ id: user.id, username: user.username, role: user.role, scope: 'mfa' }, `${Math.floor(MFA_TOKEN_TTL_MS / 1000)}s`) });
  }

  audit('auth.login.success', { userId: user.id, username: user.username, ip: sourceIp });

  const token = signToken({ id: user.id, username: user.username, role: user.role });
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, email: user.email, email_verified: !!user.email_verified },
  });
});

// POST /api/auth/google
router.post('/google', validate({ idToken: { required: true } }), async (req, res) => {
  if (!googleAuthConfigured()) {
    return res.status(501).json({ error: 'Google sign-in is not configured', details: ['Set GOOGLE_CLIENT_IDS (comma-separated OAuth client IDs) on this server'] });
  }

  const result = await verifyGoogleIdToken(req.body.idToken);
  if (!result.ok) return res.status(401).json({ error: 'Invalid Google token' });
  const { sub, email } = result.payload;
  if (!email) return res.status(401).json({ error: 'Invalid Google token' });
  const lowerEmail = email.toLowerCase();

  const db = require('../db').db;
  let user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(lowerEmail);
  if (!user) {
    let base = googleUsername(result.payload.name, email);
    let username = base;
    let n = 1;
    while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) username = `${base}${n++}`;
    const info = db.prepare('INSERT INTO users (username, password, role, email, phone, email_verified, google_sub) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run(username, hashPassword(crypto.randomBytes(24).toString('hex')), 'customer', lowerEmail, null, sub);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  } else if (!user.google_sub) {
    db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(sub, user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }

  if (ADMIN_TIER.includes(user.role) && user.mfa_enabled) {
    audit('auth.login.mfa_required', { userId: user.id, username: user.username });
    return res.json({ mfa_required: true, mfaToken: signToken({ id: user.id, username: user.username, role: user.role, scope: 'mfa' }, `${Math.floor(MFA_TOKEN_TTL_MS / 1000)}s`) });
  }

  audit('auth.login.success', { userId: user.id, username: user.username });
  const token = signToken({ id: user.id, username: user.username, role: user.role });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, email: user.email, email_verified: !!user.email_verified } });
});

// POST /api/auth/mfa/verify
router.post('/mfa/verify', validate({ mfaToken: { required: true }, code: { required: true } }), (req, res) => {
  const sourceIp = req.socket?.remoteAddress || req.ip || '';
  const lock = loginLockout.check('mfa', sourceIp);
  if (lock.locked) {
    return res.status(429).json({ error: 'Too many verification attempts. Try again later.', retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000) });
  }

  let decoded;
  try { decoded = jwt.verify(req.body.mfaToken, JWT_SECRET); } catch { return res.status(401).json({ error: 'Invalid or expired MFA session' }); }
  if (decoded.scope !== 'mfa') return res.status(401).json({ error: 'Invalid or expired MFA session' });

  const db = require('../db').db;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
  if (!user || !ADMIN_TIER.includes(user.role) || !user.mfa_secret) return res.status(401).json({ error: 'Invalid or expired MFA session' });

  let recoveryHashes = [];
  try { recoveryHashes = JSON.parse(user.mfa_recovery || '[]'); } catch {}
  let usedRecovery = false;
  let codeOk = verifyTOTP(user.mfa_secret, req.body.code);
  if (!codeOk && matchRecoveryCode(recoveryHashes, req.body.code, hashCode)) {
    codeOk = true; usedRecovery = true;
    const usedHash = hashCode(normalizeRecoveryCode(req.body.code));
    recoveryHashes = recoveryHashes.filter(h => h !== usedHash);
    db.prepare('UPDATE users SET mfa_recovery = ? WHERE id = ?').run(JSON.stringify(recoveryHashes), user.id);
  }
  if (!codeOk) {
    loginLockout.recordFailure('mfa', sourceIp);
    audit('auth.mfa.failed', { userId: user.id, username: user.username, ip: sourceIp });
    return res.status(401).json({ error: 'Invalid verification code' });
  }
  loginLockout.recordSuccess('mfa', sourceIp);
  audit(usedRecovery ? 'auth.mfa.recovery_used' : 'auth.mfa.verified', { userId: user.id, username: user.username });

  const token = signToken({ id: user.id, username: user.username, role: user.role });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, email: user.email, email_verified: !!user.email_verified } });
});

// POST /api/auth/mfa/setup
router.post('/mfa/setup', authenticateToken, adminOnly, (req, res) => {
  const db = require('../db').db;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.mfa_enabled) return res.status(409).json({ error: 'MFA is already enabled' });
  const secret = generateSecret();
  db.prepare('UPDATE users SET mfa_secret = ? WHERE id = ?').run(secret, user.id);
  audit('auth.mfa.setup', { userId: user.id, username: user.username });
  res.json({ secret, otpauth_url: otpauthUrl(secret, user.username) });
});

// POST /api/auth/mfa/confirm
router.post('/mfa/confirm', authenticateToken, adminOnly, validate({ code: { required: true } }), (req, res) => {
  const db = require('../db').db;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user.mfa_secret) return res.status(409).json({ error: 'Start MFA setup first' });
  if (!verifyTOTP(user.mfa_secret, req.body.code)) return res.status(401).json({ error: 'Invalid verification code' });
  const recoveryCodes = generateRecoveryCodes(10);
  const recoveryHashes = recoveryCodes.map(c => hashCode(normalizeRecoveryCode(c)));
  db.prepare('UPDATE users SET mfa_enabled = 1, mfa_recovery = ? WHERE id = ?').run(JSON.stringify(recoveryHashes), user.id);
  audit('auth.mfa.enabled', { userId: user.id, username: user.username });
  res.json({ ok: true, message: 'MFA enabled', recovery_codes: recoveryCodes });
});

// POST /api/auth/mfa/recovery-codes
router.post('/mfa/recovery-codes', authenticateToken, adminOnly, (req, res) => {
  const db = require('../db').db;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user.mfa_enabled || !user.mfa_secret) return res.status(409).json({ error: 'MFA is not enabled' });
  const recoveryCodes = generateRecoveryCodes(10);
  const recoveryHashes = recoveryCodes.map(c => hashCode(normalizeRecoveryCode(c)));
  db.prepare('UPDATE users SET mfa_recovery = ? WHERE id = ?').run(JSON.stringify(recoveryHashes), user.id);
  audit('auth.mfa.recovery_regenerated', { userId: user.id, username: user.username });
  res.json({ recovery_codes: recoveryCodes });
});

// POST /api/auth/mfa/disable
router.post('/mfa/disable', authenticateToken, adminOnly, validate({ code: { required: true } }), (req, res) => {
  const db = require('../db').db;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user.mfa_enabled || !user.mfa_secret) return res.status(409).json({ error: 'MFA is not enabled' });
  if (!verifyTOTP(user.mfa_secret, req.body.code)) return res.status(401).json({ error: 'Invalid verification code' });
  db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_recovery = NULL WHERE id = ?').run(user.id);
  audit('auth.mfa.disabled', { userId: user.id, username: user.username });
  res.json({ ok: true, message: 'MFA disabled' });
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, (req, res) => {
  if (req.tokenJti) revokedTokens.set(req.tokenJti, Date.now() + 24 * 60 * 60 * 1000);
  audit('auth.logout', { userId: req.user.id, username: req.user.username });
  res.json({ ok: true });
});

// GET /api/auth/google/start
router.get('/google/start', (req, res) => {
  const returnUrl = String(req.query.returnUrl || '');
  if (!isAllowedReturnUrl(returnUrl)) {
    return res.status(400).json({ error: 'Validation failed', details: ['returnUrl must be an app deep link (exp:// or the app scheme)'] });
  }
  if (!relayConfigured()) {
    return res.status(501).json({ error: 'Google sign-in is not configured', details: ['Set GOOGLE_CLIENT_IDS and GOOGLE_CLIENT_SECRET on this server'] });
  }
  const state = createRelayState(returnUrl);
  res.redirect(buildGoogleAuthUrl({ clientId: webClientId(), redirectUri: relayCallbackUrl(req), state }));
});

// GET /api/auth/google/callback
router.get('/google/callback', async (req, res) => {
  const consumed = consumeRelayState(req.query.state);
  if (!consumed.ok) {
    return res.status(400).json({ error: 'Invalid Google sign-in state', details: ['state missing, expired, or already used'] });
  }
  const { returnUrl } = consumed;
  const webReturn = hashifyWebReturnUrl(returnUrl);
  if (req.query.error) return res.redirect(`${webReturn}?error=${encodeURIComponent(String(req.query.error))}`);
  const code = String(req.query.code || '');
  if (!code) return res.status(400).json({ error: 'Validation failed', details: ['code is required'] });
  const exchanged = await exchangeCodeForTokens(code, { clientId: webClientId(), clientSecret: process.env.GOOGLE_CLIENT_SECRET, redirectUri: relayCallbackUrl(req) });
  if (!exchanged.ok) return res.status(502).json({ error: 'Google token exchange failed', details: [exchanged.reason, exchanged.detail].filter(Boolean) });
  const result = await verifyGoogleIdToken(exchanged.tokens.id_token);
  if (!result.ok) return res.status(401).json({ error: 'Invalid Google token' });
  const { sub, email } = result.payload;
  if (!email) return res.status(401).json({ error: 'Invalid Google token' });
  const lowerEmail = email.toLowerCase();

  const db = require('../db').db;
  let user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(lowerEmail);
  if (!user) {
    let base = googleUsername(result.payload.name, email);
    let username = base;
    let n = 1;
    while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) username = `${base}${n++}`;
    const info = db.prepare('INSERT INTO users (username, password, role, email, phone, email_verified, google_sub) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run(username, hashPassword(crypto.randomBytes(24).toString('hex')), 'customer', lowerEmail, null, sub);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  } else if (!user.google_sub) {
    db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(sub, user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }

  const token = signToken({ id: user.id, username: user.username, role: user.role });
  const q = new URLSearchParams({ token, username: user.username, role: user.role, email: user.email, email_verified: user.email_verified ? '1' : '0' });
  res.redirect(`${webReturn}?${q.toString()}`);
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req, res) => {
  const db = require('../db').db;
  const user = db.prepare('SELECT id, username, role, email, email_verified, phone, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ ...user, email_verified: !!user.email_verified, phone: user.phone === '' ? null : user.phone });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', validate({ email: { required: true, maxLength: 100 } }), (req, res) => {
  const { email } = req.body;
  const sourceIp = req.socket?.remoteAddress || req.ip || '';
  const lock = loginLockout.check('forgot-password', sourceIp);
  if (lock.locked) return res.status(429).json({ error: 'Too many reset requests. Try again later.', retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000) });
  loginLockout.recordFailure('forgot-password', sourceIp);

  const db = require('../db').db;
  const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
  if (user) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codeHash = hashCode(code);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS).toISOString();
    db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(user.id, nowIso);
    db.prepare('INSERT INTO password_resets (code_hash, user_id, expires_at) VALUES (?, ?, ?)').run(codeHash, user.id, expiresAt);
    notifyPasswordReset(user.email, user.username, code, Math.max(1, Math.round(RESET_CODE_TTL_MS / 60000)));
  }
  res.json({ ok: true, message: 'If an account exists for that email, a reset code has been sent.' });
});

// POST /api/auth/reset-password
router.post('/reset-password', validate({ code: { required: true, maxLength: 10 }, password: { required: true, maxLength: 100 } }), (req, res) => {
  const { code, password } = req.body;
  const pwError = passwordError(password);
  if (pwError) return res.status(400).json({ error: 'Validation failed', details: [pwError] });

  const sourceIp = req.socket?.remoteAddress || req.ip || '';
  const lock = loginLockout.check('reset-password', sourceIp);
  if (lock.locked) return res.status(429).json({ error: 'Too many reset attempts. Try again later.', retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000) });

  const db = require('../db').db;
  const codeHash = hashCode(code);
  const row = db.prepare('SELECT * FROM password_resets WHERE code_hash = ?').get(codeHash);
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    loginLockout.recordFailure('reset-password', sourceIp);
    return res.status(401).json({ error: 'Invalid or expired reset code' });
  }

  db.prepare('DELETE FROM password_resets WHERE code_hash = ?').run(codeHash);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(password), row.user_id);

  loginLockout.recordSuccess('reset-password', sourceIp);
  const owner = db.prepare('SELECT username FROM users WHERE id = ?').get(row.user_id);
  if (owner) loginLockout.clearAccount(owner.username);

  res.json({ ok: true, message: 'Password updated' });
});

module.exports = router;
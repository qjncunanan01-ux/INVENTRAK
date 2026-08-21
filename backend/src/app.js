const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { db } = require('./db');
const { passwordError } = require('./password-policy');
const { hashPassword, verifyPassword, consumeComparisonTime } = require('./password-hash');
const { notifyInquiryStatus, notifyWelcome, notifyPasswordReset, notifyVerificationCode } = require('./notify');
const { generateSecret, verifyTOTP, otpauthUrl, generateRecoveryCodes, normalizeRecoveryCode, matchRecoveryCode } = require('./totp');
const { audit } = require('./audit');
const { isDemoAccountBlocked } = require('./demo-accounts');
const { DEMO_SEED, SEED_EPOCH, mulberry32, DEMO_LOCATIONS, DEMO_CUSTOMERS } = require('./prng');
const { createLoginLockout } = require('./login-lockout');
const { buildPaymentStep } = require('./payments');
const { handleOcr, handleOcrStock } = require('./ocr');
const { normalizeLines, summarizeLines } = require('./product-lines');
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
} = require('./google-auth');

// Attach a parsed, normalized `products_detail` array to every inquiry row so
// clients (admin + mobile) can render per-line prices without re-parsing the
// products JSON themselves. Resilient to legacy/malformed payloads.
function enrichInquiryRows(rows) {
  return rows.map((row) => {
    let parsed = [];
    try {
      const raw = JSON.parse(row.products || '[]');
      if (Array.isArray(raw)) parsed = raw;
    } catch {}
    return { ...row, products_detail: parsed };
  });
}

// Brute-force throttling shared with the npm-free fallback (same module, same
// semantics): failed logins per (username, IP) lock the account with an
// exponentially growing wait.
const loginLockout = createLoginLockout();

// Password reset codes are single-use and expire after this long (env-tunable
// so tests can exercise expiry without sleeping for 30 minutes). The raw code
// is never stored — only its SHA-256 hash, so a database leak can't be used
// to reset accounts.
const RESET_CODE_TTL_MS = Number(process.env.RESET_CODE_TTL_MS) || 30 * 60 * 1000;

// Signup verification codes: same single-use hashed-at-rest model, same
// default lifetime (env-tunable so tests can exercise expiry quickly).
const VERIFICATION_CODE_TTL_MS = Number(process.env.VERIFICATION_CODE_TTL_MS) || 30 * 60 * 1000;

// Shared code-generation helpers for reset + verification codes: 6 random
// digits, hashed at rest with an HMAC-SHA256 keyed by the token secret
// (JWT_SECRET below) so a leaked database can't be replayed or brute-forced
// offline (plain SHA-256 of a 6-digit space is recoverable in seconds).
function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
function hashCode(code) {
  return crypto.createHmac('sha256', JWT_SECRET).update(String(code)).digest('hex');
}

const JWT_SECRET = process.env.JWT_SECRET || 'inventrak-secret-key-2024';

if (!process.env.JWT_SECRET) {
  // The fallback is PUBLIC (it lives in this repo): on a server running
  // without the env var, anyone who reads the source can forge admin tokens.
  // Deployed servers must set JWT_SECRET (see DEPLOY.md).
  console.warn(
    '[security] JWT_SECRET is not set — using the PUBLIC fallback secret. ' +
    'Set JWT_SECRET on the deployed server, or anyone who reads this repo ' +
    'can forge admin tokens.'
  );
}

const dataDir = path.join(__dirname, '..', 'data');
const productsFile = path.join(dataDir, 'products.json');

// MFA challenge tokens are short-lived (10 min) so a leaked challenge can't
// become a session later.
const MFA_TOKEN_TTL_MS = 10 * 60 * 1000;

// Every session token carries a unique jti so logout can revoke it server-
// side; revoked jtis are rejected until the token's natural expiry.
const revokedTokens = new Map(); // jti -> expiresAtMs (pruned lazily)

function pruneRevokedTokens() {
  const now = Date.now();
  for (const [jti, exp] of revokedTokens) {
    if (exp <= now) revokedTokens.delete(jti);
  }
}

function signToken(payload, expiresIn = '24h') {
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn });
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// --- Auth Middleware ---

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'Access token required',
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        error: 'Invalid or expired token',
      });
    }

    // A logged-out (revoked) jti is rejected exactly like an expired token.
    if (user.jti) {
      pruneRevokedTokens();
      if (revokedTokens.has(user.jti)) {
        return res.status(403).json({
          error: 'Invalid or expired token',
        });
      }
    }

    req.user = user;
    req.tokenJti = user.jti || null;
    next();
  });
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Admin access required',
    });
  }

  next();
}

// Staff-or-admin guard: staff accounts may propose stock adjustments and
// transfers, scan for stock levels, and view reports — but every write that
// changes real data (approvals, products, orders, locations, sales) stays
// admin-only. Role-based access control per OWASP: staff get the minimum
// permissions their daily inventory work needs, nothing more.
function staffOrAdmin(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'staff') {
    return res.status(403).json({
      error: 'Staff or admin access required',
    });
  }

  next();
}

// --- Validation Helpers ---

function validate(schema) {
  return (req, res, next) => {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      if (
        rules.required &&
        (value === undefined || value === null || value === '')
      ) {
        errors.push(`${field} is required`);
      }

      if (value !== undefined && value !== null && value !== '') {
        // Number.isFinite (not isNaN) so 1e999/Infinity is rejected too —
        // binding Infinity into SQLite throws, and a NaN total would corrupt
        // sales records. Matches the npm-free fallback's Number.isFinite checks.
        if (rules.type === 'number' && !Number.isFinite(Number(value))) {
          errors.push(`${field} must be a number`);
        }

        if (rules.min !== undefined) {
          const belowMin =
            rules.type === 'number'
              ? Number(value) < rules.min
              : String(value).length < rules.min;

          if (belowMin) {
            errors.push(
              rules.type === 'number'
                ? `${field} must be at least ${rules.min}`
                : `${field} must be at least ${rules.min} characters`
            );
          }
        }

        if (
          rules.maxLength &&
          String(value).length > rules.maxLength
        ) {
          errors.push(
            `${field} must be at most ${rules.maxLength} characters`
          );
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    next();
  };
}

// --- Seed Database ---

function seedDatabase() {
  // Ensure default users exist even if products were already seeded
  // (keeps admin/admin123 + customer/customer123 logins working on re-runs).
  const adminExists = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get('admin');

  if (!adminExists) {
    const hashedPw = hashPassword('admin123');

    db.prepare(
      'INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)'
    ).run(
      'admin',
      hashedPw,
      'admin',
      'admin@inventrak.com'
    );
  }

  const custExists = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get('customer');

  if (!custExists) {
    const hashedPw = hashPassword('customer123');

    db.prepare(
      'INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)'
    ).run(
      'customer',
      hashedPw,
      'customer',
      'customer@example.com'
    );
  }

  // Demo staff account: can propose stock adjustments/transfers, scan for
  // stock, and view reports — but cannot approve anything (admin-only).
  const staffExists = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get('staff');

  if (!staffExists) {
    const hashedPw = hashPassword('staff123');

    db.prepare(
      'INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)'
    ).run(
      'staff',
      hashedPw,
      'staff',
      'staff@inventrak.com'
    );
  }

  const existing = db
    .prepare('SELECT COUNT(*) as count FROM products')
    .get();

  if (existing.count > 0) {
    return;
  }

  const products = readJSON(productsFile) || [];

  if (!products.length) {
    return;
  }

  const insertProduct = db.prepare(
    'INSERT INTO products (name, category, brand, description, size, unit, price, status, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const getLocation = db.prepare(
    'SELECT id FROM locations WHERE name = ?'
  );

  const insertLocation = db.prepare(
    'INSERT INTO locations (name) VALUES (?)'
  );

  const insertStock = db.prepare(
    'INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)'
  );

  const insertLot = db.prepare(
    'INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)'
  );

  const insertSales = db.prepare(
    'INSERT INTO sales_transactions (product_id, qty, unit_price, total_amount, transaction_date, customer_name) VALUES (?, ?, ?, ?, ?, ?)'
  );

  // Low-stock alerts for seeded locations below the 80-unit threshold, so a
  // fresh boot has real active alerts (matching the npm-free seeder's alert
  // set exactly — same PRNG stock, same order). Without this the dashboard
  // shows 0 active alerts while 200+ location entries sit below threshold.
  const insertAlert = db.prepare(
    "INSERT INTO inventory_alerts (product_id, location_id, alert_type, threshold, current_qty, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))"
  );

  // Deterministic demo data: the same fixed-seed PRNG and draw order as the
  // npm-free fallback and seed.js, so fresh boots of either backend produce
  // identical stock AND sales (cross-backend value parity).
  const locations = DEMO_LOCATIONS;
  const customers = DEMO_CUSTOMERS;

  db.transaction(() => {
    for (const name of locations) {
      if (!getLocation.get(name)) {
        insertLocation.run(name);
      }
    }

    const rand = mulberry32(DEMO_SEED);

    for (const p of products) {
      const result = insertProduct.run(
        p['Product Name'] || p.name,
        p['Category'] || p.category,
        p['Brand'] || p.brand || '',
        p['Description'] || '',
        p['Size'] || p.size || '',
        p['Unit'] || p.unit || 'pcs',
        p['Price'] || p.price || 0,
        'active',
        p['Image'] || p.image || null
      );

      const pid = result.lastInsertRowid;

      // Draws 1-3: location stock.
      for (const name of locations) {
        const locId = getLocation.get(name).id;
        const qty = Math.floor(rand() * 160) + 20;

        insertStock.run(pid, locId, qty);

        insertLot.run(
          pid,
          locId,
          qty,
          new Date().toISOString()
        );

        // Mirror the event-driven upsert rule: any location below the
        // threshold is an active low-stock alert.
        if (qty < 80) {
          insertAlert.run(pid, locId, 'low_stock', 80, qty);
        }
      }

      // Draws 4-9: sales history (2 draws per customer).
      const price = p['Price'] || p.price || 1;

      for (const cust of customers) {
        const saleQty = Math.floor(rand() * 15) + 1;
        const daysAgo = Math.floor(rand() * 90);

        const date = new Date(
          SEED_EPOCH - daysAgo * 86400000
        ).toISOString();

        insertSales.run(
          pid,
          saleQty,
          price,
          saleQty * price,
          date,
          cust
        );
      }
    }
  })();
}

const app = express();

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: ALLOWED_ORIGINS.length > 0 ? (origin, cb) => {
    // Allow requests with no origin (curl, server-to-server) or listed origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else cb(null, false);
  } : undefined, // undefined = allow all (local dev)
  credentials: true,
}));
app.use(bodyParser.json());

// --- Security headers (defense-in-depth). HSTS is only sent when the request
// actually arrived over TLS (Render terminates HTTPS and sets
// X-Forwarded-Proto) — never on a local plaintext dev server. JSON API
// responses get the strict default-src 'none' CSP; the Swagger UI page loads
// unpkg scripts, so it only gets frame-ancestors.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'microphone=(), geolocation=()');
  if (req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader(
    'Content-Security-Policy',
    req.path.startsWith('/api/docs')
      ? "frame-ancestors 'none'"
      : "default-src 'none'; frame-ancestors 'none'"
  );
  next();
});

// Force HTTPS behind the Render/Cloud proxy: a plaintext request is
// redirected before any route logic runs. Local dev has no X-Forwarded-Proto,
// so nothing changes there.
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
});

// Product photos: /images/<file> serves the supplier image library committed
// under backend/images (the product `image` field holds '/images/...'). This
// is middleware (not a route) so the route<->spec audit doesn't require an
// OpenAPI entry for a static file server.
app.use('/images', express.static(path.join(__dirname, '..', 'images')));

// ================= AUTH ROUTES =================

app.post(
  '/api/auth/register',
  validate({
    username: {
      required: true,
      maxLength: 50,
    },
    password: {
      required: true,
      maxLength: 100,
    },
    email: {
      required: true,
      maxLength: 100,
    },
    phone: {
      required: true,
      maxLength: 20,
    },
  }),
  async (req, res) => {
    // Bot honeypot: real clients never send `website`; bots that fill every
    // field trip this and get rejected before any account work.
    if (req.body.website) {
      return res.status(400).json({ error: 'Validation failed', details: ['Unexpected field: website'] });
    }
    const {
      username,
      password,
      email,
      phone,
    } = req.body;

    // Mobile number is REQUIRED (used for SMS verification + order updates).
    // Mirrors the npm-free fallback's pattern exactly.
    if (!/^(\+63|63|0)?9\d{9}$/.test(String(phone).trim())) {
      return res.status(400).json({
        error: 'Validation failed',
        details: ['phone must be a valid PH mobile number (e.g. 09171234567 or +639171234567)'],
      });
    }

    // Strong password policy (shared with the npm-free fallback).
    const pwError = passwordError(password);
    if (pwError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: [pwError],
      });
    }

    const existing = db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(username);

    if (existing) {
      return res.status(409).json({
        error: 'Username already exists',
      });
    }

    const hashedPw = hashPassword(password);

    // New accounts start UNVERIFIED (email_verified = 0) — the customer must
    // redeem the verification code emailed/SMS'd below before the welcome
    // email is sent. The token is still issued so the app can walk them
    // through verification immediately after signup.
    const result = db.prepare(
      'INSERT INTO users (username, password, role, email, phone, email_verified) VALUES (?, ?, ?, ?, ?, 0)'
    ).run(
      username,
      hashedPw,
      'customer',
      email,
      phone || null
    );

    audit('auth.register', { userId: result.lastInsertRowid, username });

    const token = signToken({
      id: result.lastInsertRowid,
      username,
      role: 'customer',
    });

    // Verification code (email always; SMS when a phone was provided).
    // Fire-and-forget; the welcome email is sent only after verification.
    const code = generateCode();
    db.prepare('INSERT INTO verification_codes (code_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(
        hashCode(code),
        result.lastInsertRowid,
        new Date(Date.now() + VERIFICATION_CODE_TTL_MS).toISOString()
      );
    // Await so the response can tell the app whether the code actually went
    // out (email always, SMS when a phone was provided) — a failed send is
    // visible instead of a silent dead-end.
    const delivery = await notifyVerificationCode({
      email,
      username,
      code,
      phone: phone || null,
      ttlMinutes: Math.max(1, Math.round(VERIFICATION_CODE_TTL_MS / 60000)),
    });

    res.json({
      token,
      user: {
        id: result.lastInsertRowid,
        username,
        role: 'customer',
        email,
        email_verified: false,
      },
      notify: {
        email: !!(delivery && delivery[0] && delivery[0].sent),
        sms: !!(delivery && delivery[1] && delivery[1].sent),
      },
    });
  }
);

app.post(
  '/api/auth/verify-email',
  validate({
    code: {
      required: true,
      maxLength: 10,
    },
  }),
  (req, res) => {
    const { code } = req.body;

    // Brute-force protection: a 6-digit code has only 1M combinations, so
    // wrong guesses are throttled per IP (shared lockout module, reserved
    // account key — no enumeration oracle).
    const sourceIp = req.socket?.remoteAddress || req.ip || '';
    const lock = loginLockout.check('verify-email', sourceIp);
    if (lock.locked) {
      return res.status(429).json({
        error: 'Too many verification attempts. Try again later.',
        retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000),
      });
    }

    const row = db
      .prepare('SELECT * FROM verification_codes WHERE code_hash = ?')
      .get(hashCode(code));

    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      loginLockout.recordFailure('verify-email', sourceIp);
      return res.status(401).json({
        error: 'Invalid or expired verification code',
      });
    }

    // Single-use: consume the code BEFORE flipping the flag.
    db.prepare('DELETE FROM verification_codes WHERE code_hash = ?').run(row.code_hash);
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.user_id);

    // Now that the address is proven, the welcome lands (fire-and-forget).
    const owner = db
      .prepare('SELECT username, email FROM users WHERE id = ?')
      .get(row.user_id);
    if (owner) notifyWelcome(owner.email, owner.username);

    loginLockout.recordSuccess('verify-email', sourceIp);
    if (owner) audit('auth.email_verified', { userId: row.user_id, username: owner.username });

    res.json({
      ok: true,
      message: 'Email verified',
    });
  }
);

app.post(
  '/api/auth/resend-verification',
  validate({
    email: {
      required: true,
      maxLength: 100,
    },
  }),
  async (req, res) => {
    const { email } = req.body;

    // Per-IP quota (identical for every email, so no enumeration oracle).
    const sourceIp = req.socket?.remoteAddress || req.ip || '';
    const lock = loginLockout.check('resend-verification', sourceIp);
    if (lock.locked) {
      return res.status(429).json({
        error: 'Too many verification requests. Try again later.',
        retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000),
      });
    }
    loginLockout.recordFailure('resend-verification', sourceIp);

    // Case-insensitive lookup; only UNVERIFIED accounts get a new code
    // (verified accounts get nothing — still 200, still no oracle).
    const user = db
      .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND email_verified = 0')
      .get(email);

    let notifyDelivery = null;
    if (user) {
      const code = generateCode();
      db.prepare('DELETE FROM verification_codes WHERE user_id = ? OR expires_at < ?')
        .run(user.id, new Date().toISOString());
      db.prepare('INSERT INTO verification_codes (code_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .run(
          hashCode(code),
          user.id,
          new Date(Date.now() + VERIFICATION_CODE_TTL_MS).toISOString()
        );
      const delivery = await notifyVerificationCode({
        email: user.email,
        username: user.username,
        code,
        phone: user.phone || null,
        ttlMinutes: Math.max(1, Math.round(VERIFICATION_CODE_TTL_MS / 60000)),
      });
      // Delivery status is only included when a code was actually generated
      // (the response never reveals whether the email has an account).
      notifyDelivery = {
        email: !!(delivery && delivery[0] && delivery[0].sent),
        sms: !!(delivery && delivery[1] && delivery[1].sent),
      };
    }

    res.json({
      ok: true,
      message: 'If an unverified account exists for that email, a new code has been sent.',
      ...(notifyDelivery ? { notify: notifyDelivery } : {}),
    });
  }
);

app.post(
  '/api/auth/login',
  validate({
    username: {
      required: true,
    },
    password: {
      required: true,
    },
  }),
  (req, res) => {
    // Bot honeypot: real clients never send `website`; bots that fill every
    // field trip this and get rejected before any credential work.
    if (req.body.website) {
      return res.status(400).json({ error: 'Validation failed', details: ['Unexpected field: website'] });
    }
    const {
      username,
      password,
    } = req.body;

    // Same IP source as the npm-free fallback (raw socket address) so the two
    // backends key lockout buckets identically — Express req.ip would diverge
    // behind a proxy once `trust proxy` is enabled.
    const sourceIp = req.socket?.remoteAddress || req.ip || '';

    // Locked out? Reject before doing any credential work (fast + cheap for
    // the attacker, no bcrypt burn for us).
    const lock = loginLockout.check(username, sourceIp);
    if (lock.locked) {
      return res.status(429).json({
        error: 'Too many failed login attempts. Try again later.',
        retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000),
      });
    }

    const user = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username);

    if (!user) {
      // Equalize response time with the bcrypt-compare path so timing does
      // not reveal which usernames are registered.
      consumeComparisonTime(password);
      // Failed attempts count toward the lockout even for unknown usernames
      // (no username oracle: attackers can't probe which accounts exist).
      loginLockout.recordFailure(username, sourceIp);
      audit('auth.login.failed', { username, ip: sourceIp });
      return res.status(401).json({
        error: 'Invalid username or password',
      });
    }

    const verified = verifyPassword(password, user.password);

    if (!verified.ok) {
      loginLockout.recordFailure(username, sourceIp);
      audit('auth.login.failed', { username, ip: sourceIp });
      return res.status(401).json({
        error: 'Invalid username or password',
      });
    }

    // Successful login clears the failure counter.
    loginLockout.recordSuccess(username, sourceIp);

    // Legacy plaintext row (pre-hashing era): upgrade it in place so the
    // plaintext is never left in storage after a successful login.
    if (verified.needsRehash) {
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(
        hashPassword(password),
        user.id
      );
    }

    // Seeded demo credentials can be switched off in production (OWASP: no
    // default/test accounts in a live system). Rejected with the generic
    // error so the response doesn't reveal the account exists.
    if (isDemoAccountBlocked(user.username)) {
      loginLockout.recordFailure(username, sourceIp);
      audit('auth.demo_account_blocked', { username, ip: sourceIp });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Admin MFA: once the administrator enrolls, the password alone yields
    // only a short-lived challenge token, never a session.
    if (user.role === 'admin' && user.mfa_enabled) {
      audit('auth.login.mfa_required', { userId: user.id, username: user.username });
      return res.json({
        mfa_required: true,
        mfaToken: signToken(
          { id: user.id, username: user.username, role: user.role, scope: 'mfa' },
          `${Math.floor(MFA_TOKEN_TTL_MS / 1000)}s`
        ),
      });
    }

    audit('auth.login.success', { userId: user.id, username: user.username, ip: sourceIp });

    const token = signToken({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
        email_verified: !!user.email_verified,
      },
    });
  }
);

app.post(
  '/api/auth/google',
  validate({
    idToken: {
      required: true,
    },
  }),
  async (req, res) => {
    if (!googleAuthConfigured()) {
      return res.status(501).json({
        error: 'Google sign-in is not configured',
        details: ['Set GOOGLE_CLIENT_IDS (comma-separated OAuth client IDs) on this server'],
      });
    }

    const result = await verifyGoogleIdToken(req.body.idToken);
    if (!result.ok) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }
    const { sub, email } = result.payload;
    if (!email) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }
    const lowerEmail = email.toLowerCase();

    // Find an existing account by email; link google_sub to it (a customer
    // who registered by password can sign in with Google afterwards — same
    // identity, no duplicate account).
    let user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(lowerEmail);
    if (!user) {
      // New account: username from Google's verified profile name (friendly,
      // e.g. "Jerico Cunanan" not the email prefix), deduped against existing
      // usernames; random password so the account can never be
      // password-logged-in (Google owns the identity); email pre-verified.
      let base = googleUsername(result.payload.name, email);
      let username = base;
      let n = 1;
      while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
        username = `${base}${n++}`;
      }
      const info = db
        .prepare(
          'INSERT INTO users (username, password, role, email, phone, email_verified, google_sub) VALUES (?, ?, ?, ?, ?, 1, ?)'
        )
        .run(username, hashPassword(crypto.randomBytes(24).toString('hex')), 'customer', lowerEmail, null, sub);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    } else if (!user.google_sub) {
      db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(sub, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }

    // Admin MFA applies to Google sign-in too: an enrolled admin must
    // complete the second factor regardless of the first factor used.
    if (user.role === 'admin' && user.mfa_enabled) {
      audit('auth.login.mfa_required', { userId: user.id, username: user.username });
      return res.json({
        mfa_required: true,
        mfaToken: signToken(
          { id: user.id, username: user.username, role: user.role, scope: 'mfa' },
          `${Math.floor(MFA_TOKEN_TTL_MS / 1000)}s`
        ),
      });
    }

    audit('auth.login.success', { userId: user.id, username: user.username });

    const token = signToken({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
        email_verified: !!user.email_verified,
      },
    });
  }
);

// ---- MFA + session lifecycle (admin) ----

// Second factor: exchange the short-lived MFA challenge for a real session.
app.post(
  '/api/auth/mfa/verify',
  validate({
    mfaToken: { required: true },
    code: { required: true },
  }),
  (req, res) => {
    // A 6-digit code is a small space — wrong guesses are throttled per IP
    // with the same lockout module the login path uses.
    const sourceIp = req.socket?.remoteAddress || req.ip || '';
    const lock = loginLockout.check('mfa', sourceIp);
    if (lock.locked) {
      return res.status(429).json({
        error: 'Too many verification attempts. Try again later.',
        retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000),
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(req.body.mfaToken, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired MFA session' });
    }
    if (decoded.scope !== 'mfa') {
      return res.status(401).json({ error: 'Invalid or expired MFA session' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
    if (!user || user.role !== 'admin' || !user.mfa_secret) {
      return res.status(401).json({ error: 'Invalid or expired MFA session' });
    }
    // Second factor = TOTP code OR one of the single-use recovery codes
    // (backup for a lost authenticator app). Recovery codes are hashed at
    // rest and consumed on use.
    let recoveryHashes = [];
    try { recoveryHashes = JSON.parse(user.mfa_recovery || '[]'); } catch {}
    let usedRecovery = false;
    let codeOk = verifyTOTP(user.mfa_secret, req.body.code);
    if (!codeOk && matchRecoveryCode(recoveryHashes, req.body.code, hashCode)) {
      codeOk = true;
      usedRecovery = true;
      const usedHash = hashCode(normalizeRecoveryCode(req.body.code));
      recoveryHashes = recoveryHashes.filter((h) => h !== usedHash);
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
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
        email_verified: !!user.email_verified,
      },
    });
  }
);

// Admin-only: generate a fresh TOTP secret (not enabled until confirmed).
app.post('/api/auth/mfa/setup', authenticateToken, adminOnly, (req, res) => {
  if (req.user.mfa_enabled) {
    return res.status(409).json({ error: 'MFA is already enabled' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const secret = generateSecret();
  db.prepare('UPDATE users SET mfa_secret = ? WHERE id = ?').run(secret, user.id);
  audit('auth.mfa.setup', { userId: user.id, username: user.username });
  res.json({ secret, otpauth_url: otpauthUrl(secret, user.username) });
});

// Admin-only: prove possession of the secret with a live code, then enabled.
app.post(
  '/api/auth/mfa/confirm',
  authenticateToken,
  adminOnly,
  validate({ code: { required: true } }),
  (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user.mfa_secret) {
      return res.status(409).json({ error: 'Start MFA setup first' });
    }
    if (!verifyTOTP(user.mfa_secret, req.body.code)) {
      return res.status(401).json({ error: 'Invalid verification code' });
    }
    // Issue one-time recovery codes at enrollment: plaintext returned EXACTLY
    // once, only hashes stored at rest.
    const recoveryCodes = generateRecoveryCodes(10);
    // Hash the NORMALIZED form (no dashes) — the verify path normalizes user
    // input before hashing, so storage must match or codes never match.
    const recoveryHashes = recoveryCodes.map((c) => hashCode(normalizeRecoveryCode(c)));
    db.prepare('UPDATE users SET mfa_enabled = 1, mfa_recovery = ? WHERE id = ?')
      .run(JSON.stringify(recoveryHashes), user.id);
    audit('auth.mfa.enabled', { userId: user.id, username: user.username });
    res.json({ ok: true, message: 'MFA enabled', recovery_codes: recoveryCodes });
  }
);

// Admin-only: regenerate the one-time recovery codes (invalidates the old
// set). Requires MFA already enabled; plaintext returned exactly once.
app.post('/api/auth/mfa/recovery-codes', authenticateToken, adminOnly, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user.mfa_enabled || !user.mfa_secret) {
    return res.status(409).json({ error: 'MFA is not enabled' });
  }
  const recoveryCodes = generateRecoveryCodes(10);
  const recoveryHashes = recoveryCodes.map((c) => hashCode(normalizeRecoveryCode(c)));
  db.prepare('UPDATE users SET mfa_recovery = ? WHERE id = ?')
    .run(JSON.stringify(recoveryHashes), user.id);
  audit('auth.mfa.recovery_regenerated', { userId: user.id, username: user.username });
  res.json({ recovery_codes: recoveryCodes });
});

// Admin-only: disable MFA — requires the current authenticator code.
app.post(
  '/api/auth/mfa/disable',
  authenticateToken,
  adminOnly,
  validate({ code: { required: true } }),
  (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user.mfa_enabled || !user.mfa_secret) {
      return res.status(409).json({ error: 'MFA is not enabled' });
    }
    if (!verifyTOTP(user.mfa_secret, req.body.code)) {
      return res.status(401).json({ error: 'Invalid verification code' });
    }
    db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_recovery = NULL WHERE id = ?').run(user.id);
    audit('auth.mfa.disabled', { userId: user.id, username: user.username });
    res.json({ ok: true, message: 'MFA disabled' });
  }
);

// Logout destroys the session server-side: the presented token's jti goes on
// the revocation list, so a stolen/replayed token can't be reused.
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  if (req.tokenJti) {
    revokedTokens.set(req.tokenJti, Date.now() + 24 * 60 * 60 * 1000);
  }
  audit('auth.logout', { userId: req.user.id, username: req.user.username });
  res.json({ ok: true });
});

// ---- Google OAuth relay (server-side code exchange) ----
// Expo Go deep links can't be OAuth redirect URIs, so the app opens
// /start in a browser; Google redirects here; we exchange the code with the
// web client's secret and deep-link back into the app with a session token.
app.get('/api/auth/google/start', (req, res) => {
  const returnUrl = String(req.query.returnUrl || '');
  if (!isAllowedReturnUrl(returnUrl)) {
    return res.status(400).json({
      error: 'Validation failed',
      details: ['returnUrl must be an app deep link (exp:// or the app scheme)'],
    });
  }
  if (!relayConfigured()) {
    return res.status(501).json({
      error: 'Google sign-in is not configured',
      details: ['Set GOOGLE_CLIENT_IDS and GOOGLE_CLIENT_SECRET on this server'],
    });
  }
  const state = createRelayState(returnUrl);
  res.redirect(buildGoogleAuthUrl({ clientId: webClientId(), redirectUri: relayCallbackUrl(req), state }));
});

app.get('/api/auth/google/callback', async (req, res) => {
  const consumed = consumeRelayState(req.query.state);
  if (!consumed.ok) {
    return res.status(400).json({
      error: 'Invalid Google sign-in state',
      details: ['state missing, expired, or already used'],
    });
  }
  const { returnUrl } = consumed;
  // Hash-form redirect: a cached browser bundle may have sent a real path
  // (https://host/google-auth) which a static host 404s; moving the path
  // into the fragment makes the return always load index.html.
  const webReturn = hashifyWebReturnUrl(returnUrl);
  if (req.query.error) {
    // Google declined (e.g. user denied consent) — relay the error to the app.
    return res.redirect(`${webReturn}?error=${encodeURIComponent(String(req.query.error))}`);
  }
  const code = String(req.query.code || '');
  if (!code) {
    return res.status(400).json({ error: 'Validation failed', details: ['code is required'] });
  }
  const exchanged = await exchangeCodeForTokens(code, {
    clientId: webClientId(),
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: relayCallbackUrl(req),
  });
  if (!exchanged.ok) {
    return res.status(502).json({
      error: 'Google token exchange failed',
      details: [exchanged.reason, exchanged.detail].filter(Boolean),
    });
  }
  const result = await verifyGoogleIdToken(exchanged.tokens.id_token);
  if (!result.ok) {
    return res.status(401).json({ error: 'Invalid Google token' });
  }
  const { sub, email } = result.payload;
  if (!email) {
    return res.status(401).json({ error: 'Invalid Google token' });
  }
  const lowerEmail = email.toLowerCase();

  // Mirror the POST /api/auth/google find-or-create: link google_sub to an
  // existing password account, otherwise create a fresh OAuth account.
  let user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(lowerEmail);
  if (!user) {
    let base = googleUsername(result.payload.name, email);
    let username = base;
    let n = 1;
    while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      username = `${base}${n++}`;
    }
    const info = db
      .prepare(
        'INSERT INTO users (username, password, role, email, phone, email_verified, google_sub) VALUES (?, ?, ?, ?, ?, 1, ?)'
      )
      .run(username, hashPassword(crypto.randomBytes(24).toString('hex')), 'customer', lowerEmail, null, sub);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  } else if (!user.google_sub) {
    db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(sub, user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }

  const token = signToken({ id: user.id, username: user.username, role: user.role });
  const q = new URLSearchParams({
    token,
    username: user.username,
    role: user.role,
    email: user.email,
    email_verified: user.email_verified ? '1' : '0',
  });
  res.redirect(`${webReturn}?${q.toString()}`);
});

app.get(
  '/api/auth/me',
  authenticateToken,
  (req, res) => {
    const user = db
      .prepare(
        'SELECT id, username, role, email, email_verified, phone, created_at FROM users WHERE id = ?'
      )
      .get(req.user.id);

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
      });
    }

    res.json({
      ...user,
      email_verified: !!user.email_verified,
      // Firestore maps null → '' in storage; normalize back for parity.
      phone: user.phone === '' ? null : user.phone,
    });
  }
);

app.post(
  '/api/auth/forgot-password',
  validate({
    email: {
      required: true,
      maxLength: 100,
    },
  }),
  (req, res) => {
    const { email } = req.body;

    // Per-IP quota so a victim's inbox can't be flooded with reset emails
    // (keyed on a reserved account name; identical for every email, so it
    // cannot act as an enumeration oracle).
    const sourceIp = req.socket?.remoteAddress || req.ip || '';
    const lock = loginLockout.check('forgot-password', sourceIp);
    if (lock.locked) {
      return res.status(429).json({
        error: 'Too many reset requests. Try again later.',
        retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000),
      });
    }
    // Every request consumes quota (the action IS sending an email).
    loginLockout.recordFailure('forgot-password', sourceIp);

    // Case-insensitive lookup (the npm-free fallback compares lowercased).
    const user = db
      .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
      .get(email);

    if (user) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const codeHash = hashCode(code);
      const nowIso = new Date().toISOString();
      const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS).toISOString();

      // Prune this user's previous codes and anything already expired, then
      // store the new code (hash at rest, single-use).
      db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?')
        .run(user.id, nowIso);
      db.prepare('INSERT INTO password_resets (code_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .run(codeHash, user.id, expiresAt);

      notifyPasswordReset(
        user.email,
        user.username,
        code,
        Math.max(1, Math.round(RESET_CODE_TTL_MS / 60000))
      );
    }

    // Always 200 — never reveal whether the email belongs to an account
    // (no user-enumeration oracle, same as the npm-free fallback).
    res.json({
      ok: true,
      message: 'If an account exists for that email, a reset code has been sent.',
    });
  }
);

app.post(
  '/api/auth/reset-password',
  validate({
    code: {
      required: true,
      maxLength: 10,
    },
    password: {
      required: true,
      maxLength: 100,
    },
  }),
  (req, res) => {
    const { code, password } = req.body;

    // Same strong-password policy as registration.
    const pwError = passwordError(password);
    if (pwError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: [pwError],
      });
    }

    // A 6-digit code has only 1M combinations, so wrong guesses must be
    // throttled per IP — otherwise anyone could brute-force a victim's code
    // inside its TTL window. Same shared lockout module as login (exponential
    // backoff, IP-scoped); keyed on a reserved account name so an attacker
    // cannot tell WHOSE code they are guessing.
    const sourceIp = req.socket?.remoteAddress || req.ip || '';
    const lock = loginLockout.check('reset-password', sourceIp);
    if (lock.locked) {
      return res.status(429).json({
        error: 'Too many reset attempts. Try again later.',
        retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000),
      });
    }

    const codeHash = hashCode(code);
    const row = db
      .prepare('SELECT * FROM password_resets WHERE code_hash = ?')
      .get(codeHash);

    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      loginLockout.recordFailure('reset-password', sourceIp);
      return res.status(401).json({
        error: 'Invalid or expired reset code',
      });
    }

    // Single-use: consume the code BEFORE applying the new hash, so a replayed
    // request can never reset the password twice.
    db.prepare('DELETE FROM password_resets WHERE code_hash = ?').run(codeHash);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(
      hashPassword(password),
      row.user_id
    );

    // A successful reset proves account ownership: clear the per-IP reset
    // quota and lift any login lockout on the account (otherwise a locked-out
    // owner couldn't get back in even with their new password).
    loginLockout.recordSuccess('reset-password', sourceIp);
    const owner = db
      .prepare('SELECT username FROM users WHERE id = ?')
      .get(row.user_id);
    if (owner) loginLockout.clearAccount(owner.username);

    res.json({
      ok: true,
      message: 'Password updated',
    });
  }
);

// ================= PRODUCT ROUTES =================

app.get('/api/products', (req, res) => {
  const {
    page = 1,
    limit = 50,
    search,
    category,
    status = 'active',
  } = req.query;

  const pageNum = Math.max(
    1,
    parseInt(page) || 1
  );

  const limitNum = Math.min(
    100,
    Math.max(
      1,
      parseInt(limit) || 50
    )
  );

  const offset =
    (pageNum - 1) * limitNum;

  let where = 'WHERE status = ?';
  const params = [status];

  if (search) {
    where +=
      ' AND (name LIKE ? OR category LIKE ? OR brand LIKE ?)';

    const s = `%${search}%`;

    params.push(s, s, s);
  }

  if (category) {
    where += ' AND category = ?';
    params.push(category);
  }

  // Match the npm-free fallback: no page/limit params means the FULL list —
  // not a default-50 window. With a 192-product catalog a hidden LIMIT here
  // would silently truncate the order-inquiry picker and any unpaginated
  // client fetch on this backend while the other returns everything.
  if (!req.query.page && !req.query.limit) {
    const rows = db
      .prepare(
        `SELECT * FROM products ${where} ORDER BY name ASC`
      )
      .all(...params);
    return res.json(rows);
  }

  const countRow = db
    .prepare(
      `SELECT COUNT(*) as total FROM products ${where}`
    )
    .get(...params);

  const rows = db
    .prepare(
      `SELECT * FROM products ${where} ORDER BY name ASC LIMIT ? OFFSET ?`
    )
    .all(
      ...params,
      limitNum,
      offset
    );

  res.json({
    data: rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: countRow.total,
      totalPages: Math.ceil(
        countRow.total / limitNum
      ),
    },
  });
});

app.get(
  '/api/products/categories',
  (req, res) => {
    const rows = db
      .prepare(
        'SELECT DISTINCT category FROM products WHERE status = ? ORDER BY category'
      )
      .all('active');

    res.json(
      rows.map((r) => r.category)
    );
  }
);

app.get('/api/products/:id', (req, res) => {
  const row = db
    .prepare('SELECT * FROM products WHERE id = ?')
    .get(req.params.id);

  if (!row) {
    return res.status(404).json({
      error: 'Product not found',
    });
  }

  res.json(row);
});

app.post(
  '/api/products',
  authenticateToken,
  adminOnly,
  validate({
    name: {
      required: true,
      maxLength: 200,
    },
    category: {
      required: true,
      maxLength: 100,
    },
    price: {
      required: true,
      type: 'number',
      min: 0,
    },
    image: {
      maxLength: 300,
    },
  }),
  (req, res) => {
    const {
      name,
      category,
      brand,
      description,
      size,
      unit,
      price,
      status,
      image,
    } = req.body;

    const info = db.prepare(
      'INSERT INTO products (name, category, brand, description, size, unit, price, status, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      name,
      category,
      brand || '',
      description || '',
      size || '',
      unit || 'pcs',
      price,
      status || 'active',
      image || null
    );

    res.status(201).json({
      id: info.lastInsertRowid,
    });
  }
);

app.put(
  '/api/products/:id',
  authenticateToken,
  adminOnly,
  (req, res) => {
    const existing = db
      .prepare('SELECT id FROM products WHERE id = ?')
      .get(req.params.id);

    if (!existing) {
      return res.status(404).json({
        error: 'Product not found',
      });
    }

    const {
      name,
      category,
      brand,
      description,
      size,
      unit,
      price,
      status,
      image,
    } = req.body;

    db.prepare(
      "UPDATE products SET name=?, category=?, brand=?, description=?, size=?, unit=?, price=?, status=?, image=?, updated_at=datetime('now') WHERE id=?"
    ).run(
      name,
      category,
      brand,
      description,
      size,
      unit,
      price,
      status,
      image || null,
      req.params.id
    );

    res.json({
      ok: true,
    });
  }
);

app.delete(
  '/api/products/:id',
  authenticateToken,
  adminOnly,
  (req, res) => {
    const existing = db
      .prepare('SELECT id FROM products WHERE id = ?')
      .get(req.params.id);

    if (!existing) {
      return res.status(404).json({
        error: 'Product not found',
      });
    }

    db.prepare(
      "UPDATE products SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(
      'inactive',
      req.params.id
    );

    res.json({
      ok: true,
      message: 'Product deactivated',
    });
  }
);

// Bulk price update: one request sets prices for many products (the admin
// price-list CSV import). Mirrors the npm-free fallback exactly:
//   - body: { prices: [{ id?, name, price }] } — an entry matches by numeric
//     id first, then by exact (case-insensitive, trimmed) name
//   - a price must be a finite number >= 0, else the entry is skipped with a
//     reason (a bad row never aborts the rest of the batch)
//   - response: { ok, total, updated, skipped: [{ name, reason }] } with the
//     same key set on both backends (contract parity)
const MAX_BULK_PRICES = 2000;

app.post(
  '/api/products/bulk-prices',
  authenticateToken,
  adminOnly,
  (req, res) => {
    const { prices } = req.body || {};

    if (!Array.isArray(prices)) {
      return res.status(400).json({
        error: 'Validation failed',
        details: ['prices must be an array of { name, price } entries'],
      });
    }
    if (prices.length === 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: ['prices must not be empty'],
      });
    }
    if (prices.length > MAX_BULK_PRICES) {
      return res.status(400).json({
        error: 'Validation failed',
        details: [`prices must not exceed ${MAX_BULK_PRICES} entries`],
      });
    }

    const skipped = [];
    // Prepared once (not per row — a 2000-row batch would otherwise re-prepare
    // 4000 statements). Arrow-wrapped so `this` stays bound to the statement
    // (better-sqlite3's .get() requires the statement as receiver).
    const stmtUpdate = db.prepare(
      "UPDATE products SET price = ?, updated_at = datetime('now') WHERE id = ?"
    );
    const stmtById = db.prepare('SELECT id FROM products WHERE id = ?');
    // TRIM() on the stored column too: the npm-free fallback trims both sides,
    // so a product created with a padded name (e.g. "  Widget  ") must match on
    // both backends, not just one.
    const stmtByName = db.prepare('SELECT id FROM products WHERE TRIM(LOWER(name)) = LOWER(?)');

    let updated = 0;

    for (const entry of prices) {
      const name = entry && typeof entry.name === 'string' ? entry.name.trim() : null;
      const price = entry && entry.price;

      // A row with no usable price is skipped (never aborts the batch).
      // String(price).trim() catches whitespace-only strings that Number()
      // would silently coerce to 0 (e.g. '   ').
      if (price === undefined || price === null || price === '' || (typeof price === 'string' && price.trim() === '') || !Number.isFinite(Number(price)) || Number(price) < 0) {
        skipped.push({ name: name || '(unnamed)', reason: 'invalid price' });
        continue;
      }
      // Mirrors the single-product validate() cap (name maxLength 200).
      if (name && name.length > 200) {
        skipped.push({ name: name.slice(0, 60) + '…', reason: 'name too long' });
        continue;
      }

      const priceNum = Number(price);
      let row = null;

      // Numeric id wins when provided (stable AUTOINCREMENT ids).
      if (entry.id !== undefined && entry.id !== null && entry.id !== '') {
        const idNum = Number(entry.id);
        if (Number.isInteger(idNum) && idNum >= 1) {
          row = stmtById.get(idNum);
        }
      }
      if (!row && name) {
        row = stmtByName.get(name);
      }

      if (!row) {
        skipped.push({ name: name || '(unnamed)', reason: 'not found' });
        continue;
      }

      stmtUpdate.run(priceNum, row.id);
      updated += 1;
    }

    res.json({
      ok: true,
      total: prices.length,
      updated,
      skipped,
    });
  }
);

// ================= INVENTORY ROUTES =================

app.get('/api/inventory', (req, res) => {
  const {
    location,
    low_stock,
  } = req.query;

  const products = db
    .prepare(
      'SELECT * FROM products WHERE status = ?'
    )
    .all('active');

  const locations = db
    .prepare('SELECT * FROM locations')
    .all();

  let items = products.map((p) => {
    let stocks;

    if (location) {
      const locId = resolveLocation(location);

      stocks = db.prepare(
        'SELECT l.name, s.quantity FROM stock s JOIN locations l ON s.location_id = l.id WHERE s.product_id = ? AND s.location_id = ?'
      ).all(
        p.id,
        locId
      );
    } else {
      stocks = db.prepare(
        'SELECT l.name, s.quantity FROM stock s JOIN locations l ON s.location_id = l.id WHERE s.product_id = ?'
      ).all(p.id);
    }

    const total = stocks.reduce(
      (acc, item) =>
        acc + item.quantity,
      0
    );

    const detail = {};

    stocks.forEach((stock) => {
      detail[stock.name] = stock.quantity;
    });

    return {
      product: p,
      locations: detail,
      total,
    };
  });

  if (low_stock === 'true') {
    items = items.filter(
      (item) => item.total < 80
    );
  }

  res.json({
    locations,
    items,
  });
});

// ================= STOCK MOVEMENT ROUTES =================

function resolveLocation(value) {
  if (!value && value !== 0) {
    return null;
  }

  const numeric = Number(value);

  if (
    !Number.isNaN(numeric) &&
    Number.isInteger(numeric)
  ) {
    return numeric;
  }

  const row = db
    .prepare(
      'SELECT id FROM locations WHERE name = ?'
    )
    .get(value);

  return row ? row.id : null;
}

// Applies a movement's stock effect (stock rows, FIFO lots, low-stock alert)
// to the database. Shared by the approval endpoints: approving a pending
// stock adjustment or transfer performs exactly the same stock math as the
// immediate POST /api/stock-movement handler, so an approved transaction
// moves stock identically to a manually recorded one.
function applyMovementEffect({
  product_id,
  qty,
  type,
  srcId,
  dstId,
  now,
}) {
  const ensureStockRow = db.prepare(
    'INSERT OR IGNORE INTO stock (product_id, location_id, quantity) VALUES (?, ?, 0)'
  );

  if (srcId) ensureStockRow.run(product_id, srcId);
  if (dstId) ensureStockRow.run(product_id, dstId);

  if (type === 'stock-in' && dstId) {
    db.prepare(
      'UPDATE stock SET quantity = quantity + ? WHERE product_id = ? AND location_id = ?'
    ).run(qty, product_id, dstId);
    db.prepare(
      'INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)'
    ).run(product_id, dstId, qty, now);
  } else if (type === 'stock-out' && srcId) {
    consumeStockLots(product_id, srcId, qty);
    db.prepare(
      'UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?'
    ).run(qty, product_id, srcId);
  } else if (type === 'transfer' && srcId && dstId) {
    consumeStockLots(product_id, srcId, qty);
    db.prepare(
      'UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?'
    ).run(qty, product_id, srcId);
    db.prepare(
      'UPDATE stock SET quantity = quantity + ? WHERE product_id = ? AND location_id = ?'
    ).run(qty, product_id, dstId);
    db.prepare(
      'INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)'
    ).run(product_id, dstId, qty, now);
  } else if (type === 'adjustment' && (srcId || dstId)) {
    const loc = dstId || srcId;
    db.prepare(
      'UPDATE stock SET quantity = ? WHERE product_id = ? AND location_id = ?'
    ).run(qty, product_id, loc);
    // Keep FIFO lots consistent with the adjusted quantity: replace the
    // product's lots at this location with a single lot of the new qty.
    db.prepare('DELETE FROM stock_lots WHERE product_id = ? AND location_id = ?').run(product_id, loc);
    db.prepare(
      'INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)'
    ).run(product_id, loc, qty, now);
  }

  const threshold = 80;
  if (srcId) {
    const updated = db
      .prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?')
      .get(product_id, srcId);
    if (updated && updated.quantity < threshold) {
      const existingAlert = db
        .prepare(
          'SELECT id FROM inventory_alerts WHERE product_id = ? AND location_id = ? AND alert_type = ? AND status = ?'
        )
        .get(product_id, srcId, 'low_stock', 'active');
      if (!existingAlert) {
        db.prepare(
          'INSERT INTO inventory_alerts (product_id, location_id, alert_type, threshold, current_qty, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(product_id, srcId, 'low_stock', threshold, updated.quantity, 'active');
      } else {
        db.prepare('UPDATE inventory_alerts SET current_qty = ? WHERE id = ?').run(updated.quantity, existingAlert.id);
      }
    }
  }
}

function consumeStockLots(
  productId,
  locationId,
  quantity
) {
  let remaining = quantity;

  const lots = db
    .prepare(
      'SELECT id, qty FROM stock_lots WHERE product_id = ? AND location_id = ? AND qty > 0 ORDER BY received_at ASC'
    )
    .all(
      productId,
      locationId
    );

  for (const lot of lots) {
    if (remaining <= 0) {
      break;
    }

    const consume = Math.min(
      lot.qty,
      remaining
    );

    db.prepare(
      'UPDATE stock_lots SET qty = qty - ? WHERE id = ?'
    ).run(
      consume,
      lot.id
    );

    remaining -= consume;
  }

  if (remaining > 0) {
    db.prepare(
      'UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?'
    ).run(
      remaining,
      productId,
      locationId
    );
  }
}

app.post(
  '/api/stock-movement',
  authenticateToken,
  adminOnly,
  validate({
    product_id: {
      required: true,
      type: 'number',
      min: 1,
    },
    qty: {
      required: true,
      type: 'number',
      min: 0.01,
    },
    type: {
      required: true,
      maxLength: 20,
    },
  }),
  (req, res) => {
    const {
      product_id,
      qty,
      type,
      src_location,
      dst_location,
      notes,
      user,
    } = req.body;

    const validTypes = [
      'stock-in',
      'stock-out',
      'transfer',
      'adjustment',
    ];

    if (!validTypes.includes(type)) {
      return res.status(400).json({
        error:
          `Invalid type. Must be one of: ${validTypes.join(', ')}`,
      });
    }

    const product = db
      .prepare(
        'SELECT id FROM products WHERE id = ? AND status = ?'
      )
      .get(
        product_id,
        'active'
      );

    if (!product) {
      return res.status(404).json({
        error: 'Product not found or inactive',
      });
    }

    const now = new Date().toISOString();
    const srcId = resolveLocation(src_location);
    const dstId = resolveLocation(dst_location);

    // Pre-flight stock availability so a rejected movement leaves no trace
    // in the movement ledger.
    if ((type === 'stock-out' || type === 'transfer') && srcId) {
      const preflightStock = db
        .prepare(
          'SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?'
        )
        .get(product_id, srcId);

      if (!preflightStock || preflightStock.quantity < qty) {
        return res.status(400).json({
          error: 'Insufficient stock at source location',
        });
      }
    }

    db.prepare(
      'INSERT INTO stock_movements (product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      product_id,
      qty,
      type,
      srcId || null,
      dstId || null,
      notes || '',
      now,
      user ||
        req.user?.username ||
        'system'
    );

    const ensureStockRow = db.prepare(
      'INSERT OR IGNORE INTO stock (product_id, location_id, quantity) VALUES (?, ?, 0)'
    );

    if (srcId) {
      ensureStockRow.run(
        product_id,
        srcId
      );
    }

    if (dstId) {
      ensureStockRow.run(
        product_id,
        dstId
      );
    }

    if (
      type === 'stock-in' &&
      dstId
    ) {
      db.prepare(
        'UPDATE stock SET quantity = quantity + ? WHERE product_id = ? AND location_id = ?'
      ).run(
        qty,
        product_id,
        dstId
      );

      db.prepare(
        'INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)'
      ).run(
        product_id,
        dstId,
        qty,
        now
      );
    } else if (
      type === 'stock-out' &&
      srcId
    ) {
      consumeStockLots(
        product_id,
        srcId,
        qty
      );

      db.prepare(
        'UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?'
      ).run(
        qty,
        product_id,
        srcId
      );
    } else if (
      type === 'transfer' &&
      srcId &&
      dstId
    ) {
      consumeStockLots(
        product_id,
        srcId,
        qty
      );

      db.prepare(
        'UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?'
      ).run(
        qty,
        product_id,
        srcId
      );

      db.prepare(
        'UPDATE stock SET quantity = quantity + ? WHERE product_id = ? AND location_id = ?'
      ).run(
        qty,
        product_id,
        dstId
      );

      db.prepare(
        'INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)'
      ).run(
        product_id,
        dstId,
        qty,
        now
      );
    } else if (
      type === 'adjustment' &&
      (srcId || dstId)
    ) {
      const loc = dstId || srcId;

      db.prepare(
        'UPDATE stock SET quantity = ? WHERE product_id = ? AND location_id = ?'
      ).run(
        qty,
        product_id,
        loc
      );

      // Keep FIFO lots consistent with the adjusted quantity: replace the
      // product's lots at this location with a single lot of the new qty.
      // Without this, lots drift from stock after an adjustment and the
      // overflow path in consumeStockLots() can double-decrement stock.
      db.prepare(
        'DELETE FROM stock_lots WHERE product_id = ? AND location_id = ?'
      ).run(product_id, loc);
      db.prepare(
        'INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)'
      ).run(product_id, loc, qty, now);
    }

    const threshold = 80;

    if (srcId) {
      const updated = db
        .prepare(
          'SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?'
        )
        .get(
          product_id,
          srcId
        );

      if (
        updated &&
        updated.quantity < threshold
      ) {
        const existingAlert = db
          .prepare(
            'SELECT id FROM inventory_alerts WHERE product_id = ? AND location_id = ? AND alert_type = ? AND status = ?'
          )
          .get(
            product_id,
            srcId,
            'low_stock',
            'active'
          );

        if (!existingAlert) {
          db.prepare(
            'INSERT INTO inventory_alerts (product_id, location_id, alert_type, threshold, current_qty, status) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(
            product_id,
            srcId,
            'low_stock',
            threshold,
            updated.quantity,
            'active'
          );
        } else {
          db.prepare(
            'UPDATE inventory_alerts SET current_qty = ? WHERE id = ?'
          ).run(
            updated.quantity,
            existingAlert.id
          );
        }
      }
    }

    res.json({
      ok: true,
      message: `Stock ${type} recorded successfully`,
    });
  }
);

app.get(
  '/api/stock-movements',
  (req, res) => {
    const {
      page = 1,
      limit = 50,
      type,
      product_id,
    } = req.query;

    const pageNum = Math.max(
      1,
      parseInt(page) || 1
    );

    const limitNum = Math.min(
      100,
      Math.max(
        1,
        parseInt(limit) || 50
      )
    );

    const offset =
      (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params = [];

    if (type) {
      where += ' AND type = ?';
      params.push(type);
    }

    if (product_id) {
      where += ' AND product_id = ?';
      params.push(product_id);
    }

    const countRow = db
      .prepare(
        `SELECT COUNT(*) as total FROM stock_movements ${where}`
      )
      .get(...params);

    const rows = db
      .prepare(
        `SELECT * FROM stock_movements ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(
        ...params,
        limitNum,
        offset
      );

    if (
      !req.query.page &&
      !req.query.limit
    ) {
      return res.json(rows);
    }

    res.json({
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countRow.total,
        totalPages: Math.ceil(
          countRow.total / limitNum
        ),
      },
    });
  }
);

app.get('/api/stock-lots', (req, res) => {
  const {
    product_id,
    location_id,
  } = req.query;

  let query =
    'SELECT sl.id, sl.product_id, sl.location_id, sl.qty, sl.received_at, p.name as product_name, l.name as location_name FROM stock_lots sl JOIN products p ON sl.product_id = p.id JOIN locations l ON sl.location_id = l.id WHERE sl.qty > 0';

  const params = [];

  if (product_id) {
    query += ' AND sl.product_id = ?';
    params.push(product_id);
  }

  if (location_id) {
    query += ' AND sl.location_id = ?';
    params.push(location_id);
  }

  query += ' ORDER BY sl.received_at ASC';

  const rows = db
    .prepare(query)
    .all(...params);

  res.json(rows);
});

// ================= STOCK ADJUSTMENT / TRANSFER + APPROVAL ROUTES =================
//
// Dedicated modules for the reviewer checklist:
//   - Stock adjustment: propose a corrected quantity at a location (count,
//     damage, shrinkage) with a reason. Created PENDING; only an APPROVED
//     adjustment changes stock (the 'approval of important transactions'
//     workflow).
//   - Stock transfer: propose moving qty between two locations. PENDING until
//     approved; approval performs the move and records a 'transfer' movement.
//   - Approvals: one queue of pending adjustments + transfers.

function listAdjustments(dbRef, status) {
  const where = status ? ' WHERE a.status = ?' : '';
  const params = status ? [status] : [];
  return dbRef
    .prepare(
      `SELECT a.id, a.product_id, p.name as product_name, a.location_id, l.name as location_name,
              a.new_qty, a.reason, a.status, a.created_at, a.decided_at, a.decided_by,
              COALESCE(s.quantity, 0) as current_qty
       FROM stock_adjustments a
       JOIN products p ON p.id = a.product_id
       JOIN locations l ON l.id = a.location_id
       LEFT JOIN stock s ON s.product_id = a.product_id AND s.location_id = a.location_id
       ${where}
       ORDER BY a.created_at DESC`
    )
    .all(...params);
}

function listTransfers(dbRef, status) {
  const where = status ? ' WHERE t.status = ?' : '';
  const params = status ? [status] : [];
  return dbRef
    .prepare(
      `SELECT t.id, t.product_id, p.name as product_name,
              t.src_location, s.name as src_location_name,
              t.dst_location, d.name as dst_location_name,
              t.qty, t.reason, t.status, t.created_at, t.decided_at, t.decided_by
       FROM stock_transfers t
       JOIN products p ON p.id = t.product_id
       JOIN locations s ON s.id = t.src_location
       JOIN locations d ON d.id = t.dst_location
       ${where}
       ORDER BY t.created_at DESC`
    )
    .all(...params);
}

app.get('/api/stock-adjustments', authenticateToken, staffOrAdmin, (req, res) => {
  res.json(listAdjustments(db, req.query.status || null));
});

app.post(
  '/api/stock-adjustments',
  authenticateToken,
  staffOrAdmin,
  validate({
    product_id: { required: true, type: 'number', min: 1 },
    location_id: { required: true, type: 'number', min: 1 },
    new_qty: { required: true, type: 'number', min: 0 },
    reason: { maxLength: 300 },
  }),
  (req, res) => {
    const { product_id, location_id, new_qty, reason } = req.body;
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND status = ?').get(product_id, 'active');
    if (!product) return res.status(404).json({ error: 'Product not found or inactive' });
    const loc = db.prepare('SELECT id FROM locations WHERE id = ?').get(location_id);
    if (!loc) return res.status(404).json({ error: 'Location not found' });

    const info = db
      .prepare(
        'INSERT INTO stock_adjustments (product_id, location_id, new_qty, reason, status) VALUES (?, ?, ?, ?, ?)'
      )
      .run(product_id, location_id, new_qty, reason || '', 'pending');

    res.status(201).json({ ok: true, id: info.lastInsertRowid, message: 'Adjustment created (pending approval)' });
  }
);

function decideAdjustment(req, res, action) {
  const row = db.prepare('SELECT * FROM stock_adjustments WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Adjustment not found' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Adjustment already decided' });

  const now = new Date().toISOString();
  const actor = req.user?.username || 'admin';

  if (action === 'approve') {
    // The product may have been soft-deleted since the request was created —
    // never change stock for an inactive product.
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND status = ?').get(row.product_id, 'active');
    if (!product) return res.status(400).json({ error: 'Product is no longer active' });
    const loc = db.prepare('SELECT id FROM locations WHERE id = ?').get(row.location_id);
    if (!loc) return res.status(400).json({ error: 'Location no longer exists' });
  }

  if (action === 'approve') {
    // Atomic apply: stock change + ledger movement + status flip happen in ONE
    // transaction. Without it, a failure between the statements could leave
    // stock moved but the request still pending — and a retry would then
    // apply the adjustment a second time. The status flip also re-filters on
    // status='pending' inside the transaction (not just in the pre-check
    // above), so a second concurrent approve can never double-apply even if
    // this handler is later refactored to async.
    const applied = db.transaction(() => {
      applyMovementEffect({
        product_id: row.product_id,
        qty: row.new_qty,
        type: 'adjustment',
        srcId: null,
        dstId: row.location_id,
        now,
      });
      db.prepare(
        'INSERT INTO stock_movements (product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(row.product_id, row.new_qty, 'adjustment', null, row.location_id, `Adjustment #${row.id}: ${row.reason || 'approved correction'}`, now, actor);
      return db.prepare(
        "UPDATE stock_adjustments SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'"
      ).run(now, actor, row.id);
    })();
    if (applied.changes === 0) return res.status(400).json({ error: 'Adjustment already decided' });
    return res.json({ ok: true, message: 'Adjustment approved and applied to stock' });
  }

  db.prepare(
    "UPDATE stock_adjustments SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ?"
  ).run(now, actor, row.id);
  res.json({ ok: true, message: 'Adjustment rejected (stock unchanged)' });
}

app.post('/api/stock-adjustments/:id/approve', authenticateToken, adminOnly, (req, res) => decideAdjustment(req, res, 'approve'));
app.post('/api/stock-adjustments/:id/reject', authenticateToken, adminOnly, (req, res) => decideAdjustment(req, res, 'reject'));

app.get('/api/stock-transfers', authenticateToken, staffOrAdmin, (req, res) => {
  res.json(listTransfers(db, req.query.status || null));
});

app.post(
  '/api/stock-transfers',
  authenticateToken,
  staffOrAdmin,
  validate({
    product_id: { required: true, type: 'number', min: 1 },
    src_location: { required: true, type: 'number', min: 1 },
    dst_location: { required: true, type: 'number', min: 1 },
    qty: { required: true, type: 'number', min: 0.01 },
    reason: { maxLength: 300 },
  }),
  (req, res) => {
    const { product_id, src_location, dst_location, qty, reason } = req.body;
    if (Number(src_location) === Number(dst_location)) {
      return res.status(400).json({ error: 'Source and destination must differ' });
    }
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND status = ?').get(product_id, 'active');
    if (!product) return res.status(404).json({ error: 'Product not found or inactive' });
    const src = db.prepare('SELECT id FROM locations WHERE id = ?').get(src_location);
    const dst = db.prepare('SELECT id FROM locations WHERE id = ?').get(dst_location);
    if (!src || !dst) return res.status(404).json({ error: 'Location not found' });

    const info = db
      .prepare(
        'INSERT INTO stock_transfers (product_id, src_location, dst_location, qty, reason, status) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(product_id, src_location, dst_location, qty, reason || '', 'pending');

    res.status(201).json({ ok: true, id: info.lastInsertRowid, message: 'Transfer created (pending approval)' });
  }
);

function decideTransfer(req, res, action) {
  const row = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Transfer not found' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Transfer already decided' });

  const now = new Date().toISOString();
  const actor = req.user?.username || 'admin';

  if (action === 'approve') {
    // Same staleness guards as adjustments: the product or the locations may
    // have changed since the request was created.
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND status = ?').get(row.product_id, 'active');
    if (!product) return res.status(400).json({ error: 'Product is no longer active' });
    const src = db.prepare('SELECT id FROM locations WHERE id = ?').get(row.src_location);
    const dst = db.prepare('SELECT id FROM locations WHERE id = ?').get(row.dst_location);
    if (!src || !dst) return res.status(400).json({ error: 'Location no longer exists' });
    // Pre-flight availability exactly like the immediate movement handler.
    const srcStock = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(row.product_id, row.src_location);
    if (!srcStock || srcStock.quantity < row.qty) {
      return res.status(400).json({ error: 'Insufficient stock at source location' });
    }
    // Atomic apply (see decideAdjustment — same double-apply hazard). The
    // status flip re-filters on status='pending' inside the transaction.
    const applied = db.transaction(() => {
      applyMovementEffect({
        product_id: row.product_id,
        qty: row.qty,
        type: 'transfer',
        srcId: row.src_location,
        dstId: row.dst_location,
        now,
      });
      db.prepare(
        'INSERT INTO stock_movements (product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(row.product_id, row.qty, 'transfer', row.src_location, row.dst_location, `Transfer #${row.id}: ${row.reason || 'approved transfer'}`, now, actor);
      return db.prepare(
        "UPDATE stock_transfers SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'"
      ).run(now, actor, row.id);
    })();
    if (applied.changes === 0) return res.status(400).json({ error: 'Transfer already decided' });
    return res.json({ ok: true, message: 'Transfer approved and applied to stock' });
  }

  db.prepare(
    "UPDATE stock_transfers SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ?"
  ).run(now, actor, row.id);
  res.json({ ok: true, message: 'Transfer rejected (stock unchanged)' });
}

app.post('/api/stock-transfers/:id/approve', authenticateToken, adminOnly, (req, res) => decideTransfer(req, res, 'approve'));
app.post('/api/stock-transfers/:id/reject', authenticateToken, adminOnly, (req, res) => decideTransfer(req, res, 'reject'));

// Combined pending queue for the Approvals page.
app.get('/api/approvals', authenticateToken, adminOnly, (req, res) => {
  res.json({
    adjustments: listAdjustments(db, 'pending'),
    transfers: listTransfers(db, 'pending'),
  });
});

// Printable report data for the Report Viewing module.
app.get('/api/reports', authenticateToken, staffOrAdmin, (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 14));
  const generated_at = new Date().toISOString();

  const dailySales = db
    .prepare(
      `SELECT substr(transaction_date, 1, 10) as date, COUNT(*) as transactions, SUM(total_amount) as value
       FROM sales_transactions WHERE transaction_date >= datetime('now', ?)
       GROUP BY date ORDER BY date ASC`
    )
    .all(`-${days} days`);

  const stockByLocation = db
    .prepare(
      `SELECT l.name as location, COALESCE(SUM(s.quantity), 0) as total
       FROM locations l LEFT JOIN stock s ON s.location_id = l.id GROUP BY l.id ORDER BY l.id`
    )
    .all();

  const statusRows = db.prepare('SELECT status, COUNT(*) as count FROM order_inquiries GROUP BY status').all();
  const orderStatusSummary = { pending: 0, approved: 0, rejected: 0, fulfilled: 0, delivered: 0 };
  statusRows.forEach((r) => { if (orderStatusSummary[r.status] !== undefined) orderStatusSummary[r.status] = r.count; });

  const lowStock = db
    .prepare(
      `SELECT p.id, p.name, SUM(s.quantity) as total
       FROM stock s JOIN products p ON s.product_id = p.id
       WHERE p.status = ? GROUP BY p.id HAVING SUM(s.quantity) < 80 ORDER BY total ASC`
    )
    .all('active');

  const fastMovers = db
    .prepare(
      `SELECT p.name, SUM(t.qty) as qty_sold, SUM(t.total_amount) as value
       FROM sales_transactions t JOIN products p ON t.product_id = p.id
       WHERE p.status = ? GROUP BY t.product_id ORDER BY qty_sold DESC LIMIT 10`
    )
    .all('active');

  const slowMovers = db
    .prepare(
      `SELECT p.name, COALESCE(SUM(t.qty), 0) as qty_sold
       FROM products p LEFT JOIN sales_transactions t ON t.product_id = p.id
       WHERE p.status = ? GROUP BY p.id ORDER BY qty_sold ASC, p.name ASC LIMIT 10`
    )
    .all('active');

  const summary = {
    total_products: db.prepare("SELECT COUNT(*) as c FROM products WHERE status = 'active'").get().c,
    total_stock: db.prepare('SELECT COALESCE(SUM(quantity), 0) as t FROM stock').get().t,
    total_sales: db.prepare('SELECT COALESCE(SUM(total_amount), 0) as t FROM sales_transactions').get().t,
    transactions: db.prepare('SELECT COUNT(*) as c FROM sales_transactions').get().c,
    customers_served: db.prepare('SELECT COUNT(DISTINCT customer_name) as c FROM sales_transactions').get().c,
    pending_approvals:
      db.prepare("SELECT COUNT(*) as c FROM stock_adjustments WHERE status = 'pending'").get().c +
      db.prepare("SELECT COUNT(*) as c FROM stock_transfers WHERE status = 'pending'").get().c,
  };

  res.json({ generated_at, days, dailySales, stockByLocation, orderStatusSummary, lowStock, fastMovers, slowMovers, summary });
});

// ================= LOCATION ROUTES =================

app.get('/api/locations', (req, res) => {
  const rows = db
    .prepare(
      'SELECT id, name FROM locations ORDER BY id'
    )
    .all();

  res.json(rows);
});

app.post(
  '/api/locations',
  authenticateToken,
  adminOnly,
  validate({
    name: {
      required: true,
      maxLength: 100,
    },
  }),
  (req, res) => {
    const { name } = req.body;

    const existing = db
      .prepare(
        'SELECT id FROM locations WHERE name = ?'
      )
      .get(name);

    if (existing) {
      return res.status(409).json({
        error: 'Location already exists',
      });
    }

    const info = db
      .prepare(
        'INSERT INTO locations (name) VALUES (?)'
      )
      .run(name);

    res.status(201).json({
      id: info.lastInsertRowid,
      name,
    });
  }
);

app.delete(
  '/api/locations/:id',
  authenticateToken,
  adminOnly,
  (req, res) => {
    const id = req.params.id;

    const existing = db
      .prepare(
        'SELECT id FROM locations WHERE id = ?'
      )
      .get(id);

    if (!existing) {
      return res.status(404).json({
        error: 'Location not found',
      });
    }

    const stockCount = db
      .prepare(
        'SELECT COUNT(*) as count FROM stock WHERE location_id = ? AND quantity > 0'
      )
      .get(id);

    if (stockCount.count > 0) {
      return res.status(400).json({
        error:
          'Cannot delete location with existing stock. Transfer stock first.',
      });
    }

    // Referential integrity for the approval-workflow modules: a location
    // referenced by any pending adjustment or transfer cannot be deleted (the
    // FK would orphan the request and make its approve/reject confusing).
    const adjRefs = db
      .prepare('SELECT COUNT(*) as count FROM stock_adjustments WHERE location_id = ?')
      .get(id).count;
    const trfRefs = db
      .prepare('SELECT COUNT(*) as count FROM stock_transfers WHERE src_location = ? OR dst_location = ?')
      .get(id, id).count;
    if (adjRefs > 0 || trfRefs > 0) {
      return res.status(400).json({
        error:
          'Cannot delete location referenced by stock adjustments or transfers. Resolve them first.',
      });
    }

    db.prepare(
      'DELETE FROM locations WHERE id = ?'
    ).run(id);

    res.json({
      ok: true,
      message: 'Location deleted',
    });
  }
);

// ================= OPTIMIZATION ROUTES =================

app.get(
  '/api/optimization/:productId',
  (req, res) => {
    const pid = req.params.productId;

    if (pid === 'abc') {
      const products = db
        .prepare(
          'SELECT id, name, price FROM products WHERE status = ?'
        )
        .all('active');

      const salesData = db
        .prepare(
          'SELECT product_id, SUM(qty) as total_qty, SUM(total_amount) as total_value FROM sales_transactions GROUP BY product_id'
        )
        .all();

      const salesMap = {};

      salesData.forEach((sale) => {
        salesMap[sale.product_id] = {
          qty: sale.total_qty,
          value: sale.total_value,
        };
      });

      const arr = products.map((product) => {
        const sales =
          salesMap[product.id] || {
            qty: 0,
            value: 0,
          };

        const annualValue =
          sales.value > 0
            ? sales.value
            : (product.price || 1) * 12;

        return {
          id: product.id,
          name: product.name,
          value: annualValue,
          annualQty: sales.qty,
        };
      });

      arr.sort(
        (a, b) => b.value - a.value
      );

      const total = arr.reduce(
        (sum, item) =>
          sum + item.value,
        0
      );

      let cum = 0;

      const result = arr.map((item) => {
        cum += item.value;

        const pct =
          total > 0
            ? (cum / total) * 100
            : 0;

        let classification = 'C';

        if (pct <= 70) {
          classification = 'A';
        } else if (pct <= 90) {
          classification = 'B';
        }

        return {
          ...item,
          classification,
        };
      });

      return res.json(result);
    }

    const product = db
      .prepare(
        'SELECT * FROM products WHERE id = ?'
      )
      .get(pid);

    if (!product) {
      return res.status(404).json({
        error: 'Product not found',
      });
    }

    const salesData = db
      .prepare(
        'SELECT SUM(qty) as total_qty FROM sales_transactions WHERE product_id = ?'
      )
      .get(pid);

    const annualDemand =
      salesData?.total_qty > 0
        ? salesData.total_qty
        : 1000;

    const orderingCost = 50;
    const holdingCostRate = 0.2;
    const C = product.price || 1;
    const H = holdingCostRate * C;
    const D = annualDemand;
    const S = orderingCost;

    const EOQ = Math.sqrt(
      (2 * D * S) / H
    );

    const leadTimeDays = 7;
    const dailyDemand = D / 365;

    const ROP = Math.ceil(
      dailyDemand * leadTimeDays
    );

    const safetyStock = Math.ceil(
      Math.sqrt(D) * 0.1
    );

    const currentStock = db
      .prepare(
        'SELECT SUM(quantity) as total FROM stock WHERE product_id = ?'
      )
      .get(pid);

    const avgInventory =
      currentStock?.total || 1;

    const turnover =
      annualDemand / avgInventory;

    res.json({
      EOQ: Math.round(EOQ),
      ROP,
      safetyStock,
      annualDemand,
      turnoverRatio:
        Math.round(turnover * 100) / 100,
      avgInventory:
        Math.round(avgInventory),
    });
  }
);

app.get('/api/optimization', (req, res) => {
  const products = db
    .prepare(
      'SELECT id, name, price FROM products WHERE status = ?'
    )
    .all('active');

  const results = products.map((product) => {
    const salesData = db
      .prepare(
        'SELECT SUM(qty) as total_qty FROM sales_transactions WHERE product_id = ?'
      )
      .get(product.id);

    const annualDemand =
      salesData?.total_qty > 0
        ? salesData.total_qty
        : 100;

    const C = product.price || 1;
    const H = 0.2 * C;

    const EOQ = Math.sqrt(
      (2 * annualDemand * 50) / H
    );

    const currentStock = db
      .prepare(
        'SELECT SUM(quantity) as total FROM stock WHERE product_id = ?'
      )
      .get(product.id);

    const avgInv =
      currentStock?.total || 1;

    return {
      productId: product.id,
      productName: product.name,
      eoq: Math.round(EOQ),
      annualDemand,
      turnoverRatio:
        Math.round(
          (annualDemand / avgInv) * 100
        ) / 100,
    };
  });

  res.json(results);
});

// ================= ORDER INQUIRY ROUTES =================

app.get(
  '/api/order-inquiries',
  authenticateToken,
  (req, res) => {
    const {
      page = 1,
      limit = 50,
      status,
    } = req.query;

    const pageNum = Math.max(
      1,
      parseInt(page) || 1
    );

    const limitNum = Math.min(
      100,
      Math.max(
        1,
        parseInt(limit) || 50
      )
    );

    const offset =
      (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params = [];

    if (status) {
      where += ' AND status = ?';
      params.push(status);
    }

    // Per-account scoping: admins see every inquiry; customers only their own
    // (user_id match, with a legacy fallback to the account's email so orders
    // placed before ownership was stamped still appear in history).
    if (req.user.role !== 'admin') {
      const owner = db
        .prepare('SELECT email FROM users WHERE id = ?')
        .get(req.user.id);
      where += ' AND (user_id = ? OR customer_email = ? COLLATE NOCASE)';
      params.push(req.user.id, (owner && owner.email) || '');
    }

    const countRow = db
      .prepare(
        `SELECT COUNT(*) as total FROM order_inquiries ${where}`
      )
      .get(...params);

    const rows = db
      .prepare(
        `SELECT * FROM order_inquiries ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(
        ...params,
        limitNum,
        offset
      );

    if (
      !req.query.page &&
      !req.query.limit
    ) {
      return res.json(enrichInquiryRows(rows));
    }

    res.json({
      data: enrichInquiryRows(rows),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countRow.total,
        totalPages: Math.ceil(
          countRow.total / limitNum
        ),
      },
    });
  }
);

app.put(
  '/api/order-inquiries/:id',
  authenticateToken,
  adminOnly,
  (req, res) => {
    const { status } = req.body;

    const validStatuses = [
      'pending',
      'approved',
      'rejected',
      'fulfilled',
      'delivered',
    ];

    if (
      status &&
      !validStatuses.includes(status)
    ) {
      return res.status(400).json({
        error:
          `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const existing = db
      .prepare(
        'SELECT * FROM order_inquiries WHERE id = ?'
      )
      .get(req.params.id);

    if (!existing) {
      return res.status(404).json({
        error: 'Order inquiry not found',
      });
    }

    const updatedStatus =
      status || existing.status;

    // Progress timeline (Shopee-style): append the new status with a
    // timestamp; seed the 'placed' event from created_at when the row
    // predates status tracking so the mobile card never shows a gap.
    let history = [];
    try {
      const parsed = JSON.parse(existing.status_history || '[]');
      if (Array.isArray(parsed)) history = parsed;
    } catch {}
    if (history.length === 0) {
      history.push({ status: existing.status, at: existing.created_at });
    }
    if (updatedStatus !== (history[history.length - 1] || {}).status) {
      history.push({ status: updatedStatus, at: new Date().toISOString() });
    }

    db.prepare(
      'UPDATE order_inquiries SET status = ?, status_history = ? WHERE id = ?'
    ).run(
      updatedStatus,
      JSON.stringify(history),
      req.params.id
    );

    // Notify the customer (email + SMS) when the status changes to a
    // terminal/actionable state. Fire-and-forget: never blocks the response.
    if (updatedStatus !== 'pending') {
      notifyInquiryStatus(existing, updatedStatus);
    }

    res.json({
      ok: true,
      message: `Inquiry ${updatedStatus}`,
    });
  }
);

app.post(
  '/api/order-inquiries',
  validate({
    customer_name: {
      required: true,
      maxLength: 100,
    },
    customer_email: {
      required: true,
      maxLength: 100,
    },
  }),
  async (req, res) => {
    const {
      customer_name,
      customer_email,
      customer_phone,
      products,
      estimated_cost,
      notes,
      delivery_address,
      payment_method,
    } = req.body;

    // Checkout fields (optional, but validated when present): the delivery
    // address the customer typed and the payment method they picked
    // (cod | gcash | card | other). Mirrors the npm-free fallback exactly.
    const validPayments = ['cod', 'gcash', 'card', 'other'];
    if (delivery_address !== undefined && String(delivery_address).length > 500) {
      return res.status(400).json({
        error: 'Validation failed',
        details: ['delivery_address must be at most 500 characters'],
      });
    }
    if (payment_method !== undefined && !validPayments.includes(payment_method)) {
      return res.status(400).json({
        error: 'Validation failed',
        details: ['payment_method must be one of cod, gcash, card, other'],
      });
    }

    const now = new Date().toISOString();

    // Optional auth: the app sends the customer's token at checkout, so the
    // inquiry can be stamped with its owner for per-account history. A missing
    // or invalid token still submits (legacy guest orders) with user_id null.
    let userId = null;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded && decoded.id) userId = decoded.id;
      } catch {}
    }

    // Line items are normalized to a canonical shape (see product-lines.js):
    // structured entries from the mobile checkout (with the DEAL unit price
    // the customer actually pays + the pre-discount original price) and
    // legacy string entries alike. When any line carries a price, the stored
    // estimated_cost is recomputed from the line subtotals so the record
    // always matches what the customer was charged.
    const { lines, total } = normalizeLines(products);
    const storedCost = total !== null ? total : (estimated_cost || 0);

    const inquiryId = db.prepare(
      'INSERT INTO order_inquiries (customer_name, customer_email, customer_phone, products, estimated_cost, notes, delivery_address, payment_method, user_id, status_history, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      customer_name,
      customer_email,
      customer_phone || null,
      JSON.stringify(lines),
      storedCost,
      notes || '',
      delivery_address || null,
      payment_method || 'cod',
      userId,
      JSON.stringify([{ status: 'pending', at: now }]),
      'pending',
      now
    ).lastInsertRowid;

    // GCash/Card checkout: build the payment step (PayMongo session when a
    // key is configured, else the QR demo fallback) and persist it on the
    // inquiry so the customer can pay right after placing the order. The
    // payment builder is internally guarded, but a belt-and-braces catch
    // keeps checkout alive even if a future provider integration throws.
    let payment = null;
    try {
      payment = await buildPaymentStep({
        id: inquiryId,
        amount: storedCost,
        description: `INVENTRAK order ${inquiryId} — ${customer_name}`,
        email: customer_email,
        paymentMethod: payment_method || 'cod',
      });
    } catch (err) {
      console.error('[payments] buildPaymentStep failed:', err && err.message);
    }
    if (payment) {
      db.prepare(
        "UPDATE order_inquiries SET payment_method = ?, payment_status = ?, payment_reference = ?, payment_url = ?, payment_qr = ?, payment_provider = ? WHERE id = ?"
      ).run(
        payment.payment_method,
        payment.payment_status,
        payment.payment_reference,
        payment.payment_url,
        payment.payment_qr,
        payment.payment_provider,
        inquiryId
      );
    }

    res.status(201).json({
      ok: true,
      message: 'Inquiry submitted',
      id: inquiryId,
      ...(payment ? {
        payment: {
          payment_method: payment.payment_method,
          payment_status: payment.payment_status,
          payment_reference: payment.payment_reference,
          payment_url: payment.payment_url,
          payment_qr: payment.payment_qr,
        },
      } : {}),
    });
  }
);

// ================= OCR ROUTE =================
//
// Scan a product photo (mobile OCR module): upload a base64 image, get the
// extracted text + fuzzy-matched catalog products. Public like /api/products
// so guests can scan before creating an account.
app.post('/api/ocr', bodyParser.json({ limit: '12mb' }), async (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE status = ?').all('active');
  await handleOcr(req, res, (r, code, body) => r.status(code).json(body), products);
});

// Stock check: scan a product label and get the current stock snapshot per
// location — the "how much is left?" answer for daily manual inventory.
// Staff-or-admin (staff do the daily counting; reveals live stock levels);
// shares the OCR pipeline with the public /api/ocr but attaches stock to
// every match.
app.post('/api/ocr/stock', bodyParser.json({ limit: '12mb' }), authenticateToken, staffOrAdmin, async (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE status = ?').all('active');
  const stockLookup = (productId) => {
    const rows = db
      .prepare('SELECT l.name, s.quantity FROM stock s JOIN locations l ON s.location_id = l.id WHERE s.product_id = ?')
      .all(productId);
    const locations = {};
    let total = 0;
    for (const r of rows) {
      locations[r.name] = Number(r.quantity) || 0;
      total += Number(r.quantity) || 0;
    }
    return { locations, total };
  };
  await handleOcrStock(req, res, (r, code, body) => r.status(code).json(body), products, stockLookup);
});

// Mark an inquiry as paid (customer confirms after the GCash step).
app.put('/api/order-inquiries/:id/payment', authenticateToken, (req, res) => {
  const { payment_status } = req.body;
  if (!['paid', 'unpaid', 'failed'].includes(payment_status)) {
    return res.status(400).json({ error: 'payment_status must be one of paid, unpaid, failed' });
  }
  const existing = db.prepare('SELECT * FROM order_inquiries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order inquiry not found' });
  // Customers may only mark their own inquiry paid; admins any.
  if (req.user.role !== 'admin') {
    const owner = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
    const mine = Number(existing.user_id) === Number(req.user.id) ||
      (owner && String(existing.customer_email || '').toLowerCase() === String(owner.email || '').toLowerCase());
    if (!mine) return res.status(403).json({ error: 'Not your inquiry' });
  }
  db.prepare('UPDATE order_inquiries SET payment_status = ? WHERE id = ?').run(payment_status, req.params.id);
  res.json({ ok: true, payment_status });
});

// ================= ANALYTICS/REPORT ROUTES =================

app.get(
  '/api/analytics/summary',
  (req, res) => {
    const totalProducts = db
      .prepare(
        'SELECT COUNT(*) as count FROM products WHERE status = ?'
      )
      .get('active').count;

    const totalStock =
      db.prepare(
        'SELECT SUM(quantity) as total FROM stock'
      ).get().total || 0;

    // Per-PRODUCT total below the 80-unit threshold — matches the
    // npm-free backend so the contract test passes.
    const lowStockItems = db
      .prepare(
        'SELECT COUNT(*) as count FROM (SELECT p.id FROM stock s JOIN products p ON s.product_id = p.id WHERE p.status = ? GROUP BY p.id HAVING SUM(s.quantity) < 80)'
      )
      .get('active').count;

    const totalLocations = db
      .prepare(
        'SELECT COUNT(*) as count FROM locations'
      )
      .get().count;

    const pendingInquiries = db
      .prepare(
        "SELECT COUNT(*) as count FROM order_inquiries WHERE status = 'pending'"
      )
      .get().count;

    const totalSales =
      db.prepare(
        'SELECT SUM(total_amount) as total FROM sales_transactions'
      ).get().total || 0;

    const totalMovements = db
      .prepare(
        'SELECT COUNT(*) as count FROM stock_movements'
      )
      .get().count;

    const activeAlerts = db
      .prepare(
        "SELECT COUNT(*) as count FROM inventory_alerts WHERE status = 'active'"
      )
      .get().count;

    const topProducts = db
      .prepare(
        'SELECT p.id, p.name, SUM(s.quantity * p.price) as stock_value FROM stock s JOIN products p ON s.product_id = p.id WHERE p.status = ? GROUP BY p.id ORDER BY stock_value DESC LIMIT 5'
      )
      .all('active');

    const monthlyMovements = db
      .prepare(
        "SELECT strftime('%Y-%m', created_at) as month, type, COUNT(*) as count FROM stock_movements GROUP BY month, type ORDER BY month DESC LIMIT 12"
      )
      .all();

    // ---- Reviewer-required dashboard data (low stock list, stock per
    // location, fast/slow movers, daily sales, transactions, customers
    // served, order status summary) ----

    // 1. Low-stock items: name + total, sorted ascending.
    const lowStockList = db
      .prepare(
        `SELECT p.id, p.name, SUM(s.quantity) as total
         FROM stock s JOIN products p ON s.product_id = p.id
         WHERE p.status = ?
         GROUP BY p.id HAVING SUM(s.quantity) < 80
         ORDER BY total ASC LIMIT 20`
      )
      .all('active');

    // 2. Available stocks per location.
    const stockByLocation = db
      .prepare(
        `SELECT l.name as location, COALESCE(SUM(s.quantity), 0) as total
         FROM locations l LEFT JOIN stock s ON s.location_id = l.id
         GROUP BY l.id ORDER BY total DESC`
      )
      .all();

    // 3. Fast-moving products: top by quantity sold.
    const fastMovingProducts = db
      .prepare(
        `SELECT p.id, p.name, SUM(t.qty) as qty_sold, SUM(t.total_amount) as value
         FROM sales_transactions t JOIN products p ON t.product_id = p.id
         WHERE p.status = ?
         GROUP BY t.product_id ORDER BY qty_sold DESC LIMIT 5`
      )
      .all('active');

    // 4. Slow-moving products: bottom by quantity sold (products with sales).
    const slowMovingProducts = db
      .prepare(
        `SELECT p.id, p.name, COALESCE(SUM(t.qty), 0) as qty_sold
         FROM products p LEFT JOIN sales_transactions t ON t.product_id = p.id
         WHERE p.status = ?
         GROUP BY p.id ORDER BY qty_sold ASC, p.name ASC LIMIT 5`
      )
      .all('active');

    // 5. Daily sales value, last 7 days.
    const dailySalesValue = db
      .prepare(
        `SELECT substr(transaction_date, 1, 10) as date, SUM(total_amount) as value
         FROM sales_transactions
         WHERE transaction_date >= datetime('now', '-7 days')
         GROUP BY date ORDER BY date ASC`
      )
      .all();

    // 6. Number of transactions (sales) and customers served (distinct names).
    const transactionCount = db
      .prepare('SELECT COUNT(*) as count FROM sales_transactions')
      .get().count;
    const customersServed = db
      .prepare('SELECT COUNT(DISTINCT customer_name) as count FROM sales_transactions')
      .get().count;

    // 7. Order status summary (incl. the new 'delivered' state).
    const statusRows = db
      .prepare('SELECT status, COUNT(*) as count FROM order_inquiries GROUP BY status')
      .all();
    const orderStatusSummary = { pending: 0, approved: 0, rejected: 0, fulfilled: 0, delivered: 0 };
    statusRows.forEach((r) => { if (orderStatusSummary[r.status] !== undefined) orderStatusSummary[r.status] = r.count; });

    // 8. This-month aggregates so the dashboard KPI cards render without
    // needing the raw /api/sales (which is admin-only).
    const thisMonth = new Date().toISOString().substring(0, 7);
    const monthlySalesValue = db
      .prepare(
        `SELECT COALESCE(SUM(total_amount), 0) as total FROM sales_transactions WHERE transaction_date LIKE ? || '%'`
      )
      .get(thisMonth).total;
    const monthlyTransactions = db
      .prepare(
        `SELECT COUNT(*) as count FROM sales_transactions WHERE transaction_date LIKE ? || '%'`
      )
      .get(thisMonth).count;

    // 9. Alias orderStatusCounts so the dashboard can read either key.
    const orderStatusCounts = { ...orderStatusSummary };

    res.json({
      totalProducts,
      totalStock,
      lowStockItems,
      totalLocations,
      pendingInquiries,
      totalSales,
      totalMovements,
      activeAlerts,
      topProducts,
      monthlyMovements,
      lowStockList,
      stockByLocation,
      fastMovingProducts,
      slowMovingProducts,
      dailySalesValue,
      transactionCount,
      customersServed,
      orderStatusSummary,
      monthlySalesValue,
      monthlyTransactions,
      orderStatusCounts,
    });
  }
);

app.get(
  '/api/analytics/export/:type',
  authenticateToken,
  staffOrAdmin,
  (req, res) => {
    const { type } = req.params;
    const format = req.query.format || 'json';

    let data;

    switch (type) {
      case 'products':
        data = db
          .prepare(
            'SELECT * FROM products WHERE status = ?'
          )
          .all('active');
        break;

      case 'inventory':
        data = db
          .prepare(
            'SELECT p.name as product, l.name as location, s.quantity FROM stock s JOIN products p ON s.product_id = p.id JOIN locations l ON s.location_id = l.id WHERE p.status = ? ORDER BY p.name, l.name'
          )
          .all('active');
        break;

      case 'movements':
        data = db
          .prepare(
            'SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 1000'
          )
          .all();
        break;

      default:
        return res.status(404).json({
          error:
            'Export type not found. Use: products, inventory, movements',
        });
    }

    if (format === 'csv') {
      const headers = Object.keys(
        data[0] || {}
      ).join(',');

      const rows = data
        .map((row) =>
          Object.values(row)
            .map((value) => `"${value}"`)
            .join(',')
        )
        .join('\n');

      res.setHeader(
        'Content-Type',
        'text/csv'
      );

      res.setHeader(
        'Content-Disposition',
        `attachment; filename=${type}-${Date.now()}.csv`
      );

      return res.send(
        `${headers}\n${rows}`
      );
    }

    res.json(data);
  }
);

// ================= ALERT ROUTES =================

app.get(
  '/api/alerts',
  authenticateToken,
  adminOnly,
  (req, res) => {
    const {
      status = 'active',
    } = req.query;

    const rows = db
      .prepare(
        'SELECT a.*, p.name as product_name, l.name as location_name FROM inventory_alerts a JOIN products p ON a.product_id = p.id JOIN locations l ON a.location_id = l.id WHERE a.status = ? ORDER BY a.created_at DESC'
      )
      .all(status);

    res.json(rows);
  }
);

app.put(
  '/api/alerts/:id/resolve',
  authenticateToken,
  adminOnly,
  (req, res) => {
    const existing = db
      .prepare(
        'SELECT id FROM inventory_alerts WHERE id = ? AND status = ?'
      )
      .get(
        req.params.id,
        'active'
      );

    if (!existing) {
      return res.status(404).json({
        error:
          'Alert not found or already resolved',
      });
    }

    db.prepare(
      "UPDATE inventory_alerts SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?"
    ).run(req.params.id);

    res.json({
      ok: true,
      message: 'Alert resolved',
    });
  }
);

// ================= SALES TRANSACTION ROUTES =================

app.post(
  '/api/sales',
  authenticateToken,
  adminOnly,
  validate({
    product_id: {
      required: true,
      type: 'number',
      min: 1,
    },
    qty: {
      required: true,
      type: 'number',
      min: 0.01,
    },
  }),
  (req, res) => {
    const {
      product_id,
      qty,
      customer_name,
    } = req.body;

    const product = db
      .prepare(
        'SELECT id, price FROM products WHERE id = ? AND status = ?'
      )
      .get(
        product_id,
        'active'
      );

    if (!product) {
      return res.status(404).json({
        error: 'Product not found or inactive',
      });
    }

    const total =
      qty * product.price;

    db.prepare(
      'INSERT INTO sales_transactions (product_id, qty, unit_price, total_amount, customer_name) VALUES (?, ?, ?, ?, ?)'
    ).run(
      product_id,
      qty,
      product.price,
      total,
      customer_name ||
        req.user?.username ||
        'anonymous'
    );

    res.status(201).json({
      ok: true,
      total,
    });
  }
);

app.get(
  '/api/sales',
  authenticateToken,
  adminOnly,
  (req, res) => {
    const {
      page = 1,
      limit = 50,
    } = req.query;

    const pageNum = Math.max(
      1,
      parseInt(page) || 1
    );

    const limitNum = Math.min(
      100,
      Math.max(
        1,
        parseInt(limit) || 50
      )
    );

    const offset =
      (pageNum - 1) * limitNum;

    const countRow = db
      .prepare(
        'SELECT COUNT(*) as total FROM sales_transactions'
      )
      .get();

    // Match the npm-free fallback: no page/limit params means the FULL list
    // (not a default-50 window) — with a catalog of 193 products the seeded
    // sales ledger far exceeds 50 rows, so a hidden LIMIT here would silently
    // truncate the ledger on one backend but not the other.
    if (!req.query.page && !req.query.limit) {
      const rows = db
        .prepare(
          'SELECT s.*, p.name as product_name FROM sales_transactions s JOIN products p ON s.product_id = p.id ORDER BY s.transaction_date DESC'
        )
        .all();
      return res.json(rows);
    }

    const rows = db
      .prepare(
        'SELECT s.*, p.name as product_name FROM sales_transactions s JOIN products p ON s.product_id = p.id ORDER BY s.transaction_date DESC LIMIT ? OFFSET ?'
      )
      .all(
        limitNum,
        offset
      );

    res.json({
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countRow.total,
        totalPages: Math.ceil(
          countRow.total / limitNum
        ),
      },
    });
  }
);

// ================= USER MANAGEMENT =================

app.get(
  '/api/users',
  authenticateToken,
  adminOnly,
  (req, res) => {
    const users = db
      .prepare(
        'SELECT id, username, role, email, email_verified, google_sub, created_at FROM users ORDER BY id'
      )
      .all()
      .map((u) => ({ ...u, email_verified: !!u.email_verified, google_sub: u.google_sub || null }));

    res.json(users);
  }
);

// Promote a customer to admin (admin-only). This is the only way to create
// admins — the public register endpoint hardcodes role 'customer', so a
// customer can never self-promote (Firebase-console style role management).
app.post(
  '/api/admin/promote',
  authenticateToken,
  adminOnly,
  validate({
    username: {
      required: true,
      maxLength: 50,
    },
  }),
  (req, res) => {
    const { username } = req.body;
    const result = db
      .prepare('UPDATE users SET role = ? WHERE username = ? AND role = ?')
      .run('admin', username, 'customer');
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Customer not found or already an admin' });
    }
    const user = db
      .prepare('SELECT id, username, role, email FROM users WHERE username = ?')
      .get(username);
    res.json({ ok: true, user });
  }
);

// ================= HEALTH =================

// Public liveness probe (Render/UptimeRobot ping this; returns 200 so
// uptime monitors never see the admin-only integrity endpoint's 401/404).
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    status: 'ok',
    driver: 'sqlite',
    time: new Date().toISOString(),
  });
});

// ================= INTEGRITY =================

app.get(
  '/api/health/integrity',
  authenticateToken,
  adminOnly,
  (req, res) => {
    const errors = [];

    // No duplicate (product, location) stock rows.
    const dups = db
      .prepare(
        'SELECT product_id, location_id, COUNT(*) as c FROM stock GROUP BY product_id, location_id HAVING c > 1'
      )
      .all();
    dups.forEach((d) =>
      errors.push(`duplicate stock row: product ${d.product_id}, location ${d.location_id} (x${d.c})`)
    );

    // No negative stock.
    db.prepare(
      'SELECT product_id, location_id, quantity FROM stock WHERE quantity < 0'
    ).all().forEach((r) =>
      errors.push(`negative stock: product ${r.product_id}, location ${r.location_id} = ${r.quantity}`)
    );

    // FIFO lots must reconcile with the stock ledger at each (product, location).
    const lots = db
      .prepare(
        'SELECT product_id, location_id, SUM(qty) as s FROM stock_lots GROUP BY product_id, location_id'
      )
      .all();
    lots.forEach((l) => {
      const st = db
        .prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?')
        .get(l.product_id, l.location_id);
      if (!st) {
        errors.push(`FIFO lots exist for product ${l.product_id}, location ${l.location_id} with no stock row`);
      } else if (Math.abs(st.quantity - l.s) > 1e-6) {
        errors.push(`FIFO lots (${l.s}) != stock (${st.quantity}) for product ${l.product_id}, location ${l.location_id}`);
      }
    });

    // Movements must reference existing, active products.
    db.prepare('SELECT DISTINCT product_id FROM stock_movements').all().forEach((m) => {
      const p = db.prepare('SELECT id, status FROM products WHERE id = ?').get(m.product_id);
      if (!p || p.status !== 'active') {
        errors.push(`movement references inactive/missing product ${m.product_id}`);
      }
    });

    res.json({
      ok: errors.length === 0,
      errors,
      checkedAt: new Date().toISOString(),
    });
  }
);

// ================= API DOCUMENTATION =================

const openapiFile = path.join(__dirname, '..', 'openapi.json');

const swaggerUiHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>INVENTRAK API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body style="margin:0">
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: '/api/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
      });
    };
  </script>
</body>
</html>`;

app.get('/api/openapi.json', (req, res) => {
  const spec = readJSON(openapiFile);
  if (!spec) {
    return res.status(500).json({ error: 'openapi.json not found' });
  }
  res.json(spec);
});

app.get('/api/docs', (req, res) => {
  res.type('html').send(swaggerUiHtml);
});

// JSON 404 fallback (matches the npm-free backend's response shape).

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware must be last.

app.use((err, req, res, next) => {
  // body-parser reports client errors (malformed JSON, oversized body) via
  // err.status; surface those as-is instead of masking them as 500s, matching
  // the npm-free fallback's error responses.
  if (err && err.status === 400) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (err && err.status === 413) {
    return res.status(413).json({ error: 'Payload Too Large' });
  }

  console.error(
    'Unhandled error:',
    err
  );

  res.status(500).json({
    error: 'Internal server error',
  });
});

module.exports = {
  app,
  seedDatabase,
};
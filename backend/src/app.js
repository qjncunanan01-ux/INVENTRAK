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
const { DEMO_SEED, SEED_EPOCH, mulberry32, DEMO_LOCATIONS, DEMO_CUSTOMERS } = require('./prng');
const { createLoginLockout } = require('./login-lockout');

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
// digits, hashed at rest (SHA-256) so a leaked database can't be replayed.
function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

const JWT_SECRET = process.env.JWT_SECRET || 'inventrak-secret-key-2024';
const dataDir = path.join(__dirname, '..', 'data');
const productsFile = path.join(dataDir, 'products.json');

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

    req.user = user;
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
    'INSERT INTO products (name, category, brand, description, size, unit, price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
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
        'active'
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

app.use(cors());
app.use(bodyParser.json());

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

    const token = jwt.sign(
      {
        id: result.lastInsertRowid,
        username,
        role: 'customer',
      },
      JWT_SECRET,
      {
        expiresIn: '24h',
      }
    );

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
      return res.status(401).json({
        error: 'Invalid username or password',
      });
    }

    const verified = verifyPassword(password, user.password);

    if (!verified.ok) {
      loginLockout.recordFailure(username, sourceIp);
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

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      JWT_SECRET,
      {
        expiresIn: '24h',
      }
    );

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

app.get(
  '/api/auth/me',
  authenticateToken,
  (req, res) => {
    const user = db
      .prepare(
        'SELECT id, username, role, email, email_verified, created_at FROM users WHERE id = ?'
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
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');
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

    const codeHash = crypto.createHash('sha256').update(String(code)).digest('hex');
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
    } = req.body;

    const info = db.prepare(
      'INSERT INTO products (name, category, brand, description, size, unit, price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      name,
      category,
      brand || '',
      description || '',
      size || '',
      unit || 'pcs',
      price,
      status || 'active'
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
    } = req.body;

    db.prepare(
      "UPDATE products SET name=?, category=?, brand=?, description=?, size=?, unit=?, price=?, status=?, updated_at=datetime('now') WHERE id=?"
    ).run(
      name,
      category,
      brand,
      description,
      size,
      unit,
      price,
      status,
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

    db.prepare(
      'UPDATE order_inquiries SET status = ? WHERE id = ?'
    ).run(
      updatedStatus,
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
  (req, res) => {
    const {
      customer_name,
      customer_email,
      customer_phone,
      products,
      estimated_cost,
      notes,
    } = req.body;

    const now = new Date().toISOString();

    db.prepare(
      'INSERT INTO order_inquiries (customer_name, customer_email, customer_phone, products, estimated_cost, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      customer_name,
      customer_email,
      customer_phone || null,
      JSON.stringify(products || []),
      estimated_cost || 0,
      notes || '',
      'pending',
      now
    );

    res.status(201).json({
      ok: true,
      message: 'Inquiry submitted',
    });
  }
);

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

    const lowStockItems = db
      .prepare(
        'SELECT COUNT(*) as count FROM stock WHERE quantity < 80'
      )
      .get().count;

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
    });
  }
);

app.get(
  '/api/analytics/export/:type',
  authenticateToken,
  adminOnly,
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

    const rows = db
      .prepare(
        'SELECT s.*, p.name as product_name FROM sales_transactions s JOIN products p ON s.product_id = p.id ORDER BY s.transaction_date DESC LIMIT ? OFFSET ?'
      )
      .all(
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

// ================= USER MANAGEMENT =================

app.get(
  '/api/users',
  authenticateToken,
  adminOnly,
  (req, res) => {
    const users = db
      .prepare(
        'SELECT id, username, role, email, email_verified, created_at FROM users ORDER BY id'
      )
      .all()
      .map((u) => ({ ...u, email_verified: !!u.email_verified }));

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
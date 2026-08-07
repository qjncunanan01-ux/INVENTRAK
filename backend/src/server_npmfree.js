const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { passwordError } = require('./password-policy');
const { hashPassword, verifyPassword, consumeComparisonTime } = require('./password-hash');
const { notifyInquiryStatus, notifyWelcome, notifyPasswordReset, notifyVerificationCode } = require('./notify');
const { DEMO_SEED, SEED_EPOCH, mulberry32, DEMO_LOCATIONS, DEMO_CUSTOMERS } = require('./prng');
const { createLoginLockout } = require('./login-lockout');
const { buildPaymentStep } = require('./payments');
const { handleOcr } = require('./ocr');

// Brute-force throttling shared with the SQLite backend (same module, same
// semantics): failed logins per (username, IP) lock the account with an
// exponentially growing wait.
const loginLockout = createLoginLockout();

// Password reset codes are single-use and expire after this long (env-tunable
// so tests can exercise expiry without sleeping for 30 minutes). The raw code
// is never stored — only its SHA-256 hash, so a database leak can't be used
// to reset accounts. Mirrors the SQLite backend's constant exactly.
const RESET_CODE_TTL_MS = Number(process.env.RESET_CODE_TTL_MS) || 30 * 60 * 1000;

// Signup verification codes: same model as reset codes (single-use, hashed at
// rest, env-tunable TTL). Mirrors the SQLite backend's constant.
const VERIFICATION_CODE_TTL_MS = Number(process.env.VERIFICATION_CODE_TTL_MS) || 30 * 60 * 1000;

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

// --- Storage driver selection: 'json' (default, zero-dep) or 'firestore' ---
// The REST API surface is identical either way; only where the data lives
// changes. Selection precedence (resolveDriver is a pure function so tests
// exercise the full matrix without touching process state):
//   1. `--firestore` CLI flag forces Firestore
//   2. DB_DRIVER=json|firestore is an explicit pin (escape hatch)
//   3. Otherwise, if Firebase credentials are configured, Firestore is
//      auto-selected — "Firebase as the database of it all" — so deploying
//      with the Firebase env vars (or docker-compose) just works, while
//      local dev without them keeps using the JSON files.
//   The Firestore EMULATOR (FIRESTORE_EMULATOR_HOST) also counts as
//   "configured": the driver runs the full cloud code path against a local
//   emulator with zero credentials.
function firestoreConfigured({ env = process.env } = {}) {
  if (env.FIRESTORE_EMULATOR_HOST) return true;
  return Boolean(
    env.FIREBASE_PROJECT_ID &&
    (env.FIREBASE_SERVICE_ACCOUNT_JSON || env.GOOGLE_APPLICATION_CREDENTIALS)
  );
}

function resolveDriver({ env = process.env, argv = process.argv } = {}) {
  if (argv.includes('--firestore')) return 'firestore';
  const explicit = env.DB_DRIVER;
  if (explicit === 'json' || explicit === 'firestore') return explicit;
  return firestoreConfigured({ env }) ? 'firestore' : 'json';
}

const DB_DRIVER = resolveDriver();
const useFirestore = DB_DRIVER === 'firestore';
const store = useFirestore ? require('./store-firestore') : require('./store-json');

// Allow tests to point the fallback at an isolated data directory.
const dataDir = process.env.INVENTRAK_DATA_DIR || path.join(__dirname, '..', 'data');
const productsFile = path.join(dataDir, 'products.json');
const inventoryFile = path.join(dataDir, 'inventory.json');
const movementsFile = path.join(dataDir, 'stock_movements.json');
const orderFile = path.join(dataDir, 'order_inquiries.json');
const adjustmentsFile = path.join(dataDir, 'stock_adjustments.json');
const transfersFile = path.join(dataDir, 'stock_transfers.json');
const openapiFile = path.join(__dirname, '..', 'openapi.json');

// In-memory datasets. The JSON driver keeps users/sales/alerts in memory (as
// it always has); the Firestore driver hydrates them from the cloud at boot
// and persists every mutation, so they survive restarts.
// Demo users are seeded as bcrypt hashes (never plaintext). In Firestore mode
// these are the fallback until the cloud '@users' dataset is hydrated; legacy
// PLAINTEXT rows (old registrations, pre-hashing migrations) are upgraded on
// successful login via verifyPassword().needsRehash.
let users = [
  { id: 1, username: 'admin', password: hashPassword('admin123'), role: 'admin', email: 'admin@inventrak.com', phone: null, email_verified: true, created_at: new Date().toISOString() },
  { id: 2, username: 'customer', password: hashPassword('customer123'), role: 'customer', email: 'customer@example.com', phone: null, email_verified: true, created_at: new Date().toISOString() },
];
let nextUserId = 3;
let salesTransactions = [];
let nextSaleId = 1;
let alerts = [];
let nextAlertId = 1;

// Signup verification codes: code SHA-256 hash -> { user_id, expires_at }.
// Persisted as '@verificationCodes' in Firestore mode (single-use, hash at
// rest, expiry pruned on read). Mirrors the SQLite verification_codes table.
let verificationCodes = new Map();

function persistVerificationCodes() {
  if (!useFirestore) return;
  writeJSON('@verificationCodes', [...verificationCodes.entries()].map(([codeHash, t]) => ({
    code_hash: codeHash,
    user_id: t.user_id,
    expires_at: t.expires_at
  })));
}

// Password reset codes: code SHA-256 hash -> { user_id, expires_at }. In
// Firestore mode this map is persisted as the '@resetTokens' dataset so an
// issued code survives a backend restart (single-use, hash at rest, expiry
// pruned on read). Mirrors the SQLite backend's password_resets table.
let resetTokens = new Map();

function persistResetTokens() {
  if (!useFirestore) return;
  writeJSON('@resetTokens', [...resetTokens.entries()].map(([codeHash, t]) => ({
    code_hash: codeHash,
    user_id: t.user_id,
    expires_at: t.expires_at
  })));
}

// --- Demo-token auth: HMAC-signed so a token cannot be forged. The SQLite
// backend signs JWTs with a secret; this mirrors that with zero dependencies.
const TOKEN_SECRET = process.env.NPMFREE_TOKEN_SECRET || 'inventrak-npmfree-token-secret';

function signToken(userId) {
  const payload = String(userId);
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `demo-token-${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.startsWith('demo-token-')) return null;
  const body = token.slice('demo-token-'.length);
  const dot = body.lastIndexOf('.');
  if (dot <= 0) return null;
  const idStr = body.slice(0, dot);
  const sig = body.slice(dot + 1);
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 1) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(idStr).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return users.find(u => u.id === id) || null;
}

// All persistence flows through the active store driver. The store keys on
// the basename (products.json, inventory.json, ...) plus the virtual datasets
// ('@users', '@sales', '@alerts') that only the Firestore driver persists.
function readJSON(file) {
  return store.read(path.basename(file));
}

function writeJSON(file, obj) {
  store.write(path.basename(file), obj);
}

// The OpenAPI spec is a static file in the backend root (not a dataset in the
// data dir), so it bypasses the store driver.
function readOpenapi() {
  try {
    return JSON.parse(fs.readFileSync(openapiFile, 'utf8'));
  } catch {
    return null;
  }
}

// First-boot seeding. Deterministic demo data: same fixed-seed PRNG and draw
// order as the SQLite seeder, so fresh boots of either backend produce
// IDENTICAL stock and sales. In JSON mode this runs synchronously at module
// load (as it always has); in Firestore mode it runs inside start() after the
// cloud cache is loaded, so it only seeds what is genuinely absent.
function bootstrap() {
  if (useFirestore) {
    // Hydrate the in-memory datasets from Firestore so registrations, sales
    // and alerts accumulate across restarts instead of resetting.
    const persistedUsers = readJSON('@users');
    const persistedSales = readJSON('@sales');
    const persistedAlerts = readJSON('@alerts');
    if (Array.isArray(persistedUsers) && persistedUsers.length) {
      users = persistedUsers;
      nextUserId = Math.max(...persistedUsers.map(u => u.id)) + 1;
    }
    if (Array.isArray(persistedSales) && persistedSales.length) {
      salesTransactions = persistedSales;
      nextSaleId = Math.max(...persistedSales.map(s => s.id)) + 1;
    }
    if (Array.isArray(persistedAlerts) && persistedAlerts.length) {
      alerts = persistedAlerts;
      nextAlertId = Math.max(...persistedAlerts.map(a => a.id)) + 1;
    }
    // Hydrated users may predate verification (or come from a plaintext-era
    // migration) — treat any row that isn't explicitly false as verified, so
    // existing accounts are never locked out by the new signup gate.
    users = users.map(u => ({ ...u, email_verified: u.email_verified !== false, phone: u.phone == null ? null : u.phone }));
    const persistedResets = readJSON('@resetTokens');
    if (Array.isArray(persistedResets)) {
      resetTokens = new Map(persistedResets.map(t => [t.code_hash, { user_id: t.user_id, expires_at: t.expires_at }]));
    }
    const persistedVerifications = readJSON('@verificationCodes');
    if (Array.isArray(persistedVerifications)) {
      verificationCodes = new Map(persistedVerifications.map(t => [t.code_hash, { user_id: t.user_id, expires_at: t.expires_at }]));
    }
  }

  if (!readJSON(inventoryFile)) {
    const products = readJSON(productsFile) || [];
    const rand = mulberry32(DEMO_SEED);
    const items = products.map((p, idx) => {
      const stocks = {};
      let total = 0;
      // Draws 1-3: location stock (same formula as the SQLite seeder).
      DEMO_LOCATIONS.forEach(l => { const q = Math.floor(rand() * 160) + 20; stocks[l] = q; total += q; });
      // Draws 4-9 belong to the sales stream; consume them so the next
      // product's stock draws line up with the SQLite seeder's stream.
      for (let i = 0; i < 6; i++) rand();
      return {
        product: formatProduct(p, idx),
        locations: stocks,
        total
      };
    });
    writeJSON(inventoryFile, { locations: DEMO_LOCATIONS, items });
  }

  seedSales();

  if (!readJSON(movementsFile)) writeJSON(movementsFile, []);
  if (!readJSON(orderFile)) writeJSON(orderFile, []);
  if (!readJSON(adjustmentsFile)) writeJSON(adjustmentsFile, []);
  if (!readJSON(transfersFile)) writeJSON(transfersFile, []);

  // Firestore mode: persist the demo users/sales/alerts so registrations and
  // sales accumulate on them across restarts.
  if (useFirestore) {
    writeJSON('@users', users);
    writeJSON('@sales', salesTransactions);
    writeJSON('@alerts', alerts);
  }
}

if (!useFirestore) bootstrap();

// Seed the in-memory sales history from the same stream (draws 4-9 per
// product: 2 per customer), mirroring the SQLite seeder exactly.
function seedSales() {
  if (salesTransactions.length > 0) return;
  const products = readJSON(productsFile) || [];
  if (!products.length) return;
  const rand = mulberry32(DEMO_SEED);
  products.forEach((p, idx) => {
    // Draws 1-3 belong to location stock; consume them to keep the stream
    // aligned with the SQLite seeder's per-product draw order.
    DEMO_LOCATIONS.forEach(() => rand());
    const price = p['Price'] || p.price || 1;
    DEMO_CUSTOMERS.forEach(cust => {
      const saleQty = Math.floor(rand() * 15) + 1;
      const daysAgo = Math.floor(rand() * 90);
      salesTransactions.push({
        id: nextSaleId++,
        product_id: idx + 1,
        qty: saleQty,
        unit_price: price,
        total_amount: saleQty * price,
        transaction_date: new Date(SEED_EPOCH - daysAgo * 86400000).toISOString(),
        customer_name: cust
      });
    });
  });
}
// (seeding moved into bootstrap() above)

// Mirrors the SQLite backend: empty/absent seed fields map to '' and an
// explicit null (e.g. a partial PUT that nulls a column) stays null.
function formatProduct(p, idx) {
  const now = new Date().toISOString();
  const pick = (a, b, fallback) => (a !== undefined ? a : (b !== undefined ? b : fallback));
  return {
    id: idx + 1,
    name: pick(p['Product Name'], p.name, ''),
    category: pick(p['Category'], p.category, ''),
    brand: pick(p['Brand'], p.brand, ''),
    description: pick(p['Description'], p.description, ''),
    size: pick(p['Size'], p.size, ''),
    unit: pick(p['Unit'], p.unit, ''),
    // Preserve an explicit null (partial PUT nulls the column) to match SQLite.
    price: pick(p['Price'], p.price, 0),
    status: pick(p['status'], p.status, 'active'),
    // Firestore maps null -> ''; normalize back to null for SQLite parity.
    image: pick(p['Image'], p.image, '') || null,
    created_at: p.created_at || now,
    updated_at: p.updated_at || now
  };
}

// Seeded products.json rows carry no status field (treated as active); active
// is the only status that may be sold or stocked (mirrors the SQLite
// `WHERE status = 'active'` checks — a nulled status counts as inactive).
function isProductActive(p) {
  return p && (p['status'] === undefined || p['status'] === 'active');
}

// Exact-path matcher for the parametrized routes (e.g. /api/products/1):
// requires exactly `segments` path parts with a numeric final segment, so
// deeper paths 404 exactly like Express routes do.
function isParamPath(url, prefix, segments) {
  const parts = url.split('?')[0].split('/').filter(Boolean);
  return parts.length === segments && parts.slice(0, segments - 1).join('/') === prefix && /^\d+$/.test(parts[parts.length - 1]);
}

// Dynamic demand: actual sales volume, mirroring the SQLite backend's
// sales-transaction SUM(qty) with the same fallbacks (100 bulk / 1000 single).
function computeDemand(productId, fallback = 100) {
  const qty = salesTransactions
    .filter(s => Number(s.product_id) === Number(productId))
    .reduce((sum, s) => sum + (Number(s.qty) || 0), 0);
  return qty > 0 ? qty : fallback;
}

function getInventory() {
  const inv = readJSON(inventoryFile) || { locations: [], items: [] };
  return inv;
}

// Alerts mirror the SQLite backend: they are created when a movement drops a
// location below the threshold (not auto-derived on every read), and persist
// until resolved. (Declared at the top so bootstrap() can hydrate them.)

function upsertLowStockAlert(productId, locationId, qty) {
  if (qty >= 80) return;
  const existing = alerts.find(a => a.product_id === Number(productId) && a.location_id === Number(locationId) && a.status === 'active');
  if (existing) {
    existing.current_qty = qty;
    if (useFirestore) writeJSON('@alerts', alerts);
    return;
  }
  const inv = getInventory();
  const item = inv.items.find(i => i.product && Number(i.product.id) === Number(productId));
  alerts.push({
    id: nextAlertId++,
    product_id: Number(productId),
    location_id: Number(locationId),
    product_name: (item && item.product && item.product.name) || `Product ${productId}`,
    location_name: inv.locations[Number(locationId) - 1] || 'All',
    alert_type: 'low_stock',
    threshold: 80,
    current_qty: qty,
    status: 'active',
    created_at: new Date().toISOString(),
    resolved_at: null
  });
  if (useFirestore) writeJSON('@alerts', alerts);
}

function computeAlerts() {
  return alerts.filter(a => a.status === 'active');
}

// Mirror Express/body-parser: cap request bodies at 100 KB so a client cannot
// exhaust memory with a giant payload (the SQLite backend rejects these too).
const MAX_BODY_BYTES = 100 * 1024;

function bodyError(res, err) {
  if (err && err.status === 413) return sendJson(res, 413, { error: 'Payload Too Large' });
  return sendJson(res, 400, { error: 'Invalid JSON' });
}

function parseBody(req, callback) {
  return parseBodyWithLimit(req, MAX_BODY_BYTES, callback);
}

// Large-body variant for the OCR endpoint (uploaded photos are base64 and can
// reach several MB). Deliberately separate from parseBody so the 100 KB cap
// on every other JSON endpoint stays intact.
function parseBodyLarge(req, callback) {
  return parseBodyWithLimit(req, 12 * 1024 * 1024, callback);
}

function parseBodyWithLimit(req, limitBytes, callback) {
  let body = '';
  let tooLarge = false;
  req.on('data', chunk => {
    if (tooLarge) return;
    body += chunk;
    // Count raw bytes (not chars) so multibyte UTF-8 bodies are capped at the
    // same limit Express/body-parser applies.
    if (Buffer.byteLength(body) > limitBytes) {
      tooLarge = true;
      body = '';
    }
  });
  req.on('end', () => {
    if (tooLarge) return callback({ status: 413 });
    try { callback(null, JSON.parse(body || '{}')); }
    catch (err) { callback(err); }
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// --- Demo-token auth (mirrors the SQLite backend's protected routes) ---
function authUser(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return { missing: true };
  const user = verifyToken(token);
  return user ? { user } : { invalid: true };
}

function requireAuth(req, res, adminOnly = false, next) {
  const result = authUser(req);
  if (result.missing) return sendJson(res, 401, { error: 'Access token required' });
  if (result.invalid) return sendJson(res, 403, { error: 'Invalid or expired token' });
  if (adminOnly && result.user.role !== 'admin') return sendJson(res, 403, { error: 'Admin access required' });
  req.user = result.user;
  return next(req, res);
}

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

const server = http.createServer((req, res) => {
  const url = req.url;
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // ================= INTEGRITY =================

  if (req.method === 'GET' && url.split('?')[0] === '/api/health/integrity') {
    return requireAuth(req, res, true, (req, res) => {
      const errors = [];
      const inv = getInventory();
      const products = readJSON(productsFile) || [];
      inv.items.forEach(item => {
        const sum = Object.values(item.locations).reduce((a, b) => a + b, 0);
        if (Math.abs(sum - item.total) > 1e-6) {
          errors.push(`locations sum != total for product ${item.product.id}`);
        }
        Object.entries(item.locations).forEach(([loc, q]) => {
          if (q < 0) errors.push(`negative stock: product ${item.product.id}, ${loc} = ${q}`);
        });
      });
      const movements = readJSON(movementsFile) || [];
      movements.forEach(m => {
        const p = products[m.product_id - 1];
        if (!p || !isProductActive(p)) {
          errors.push(`movement references inactive/missing product ${m.product_id}`);
        }
      });
      return sendJson(res, 200, {
        ok: errors.length === 0,
        errors,
        checkedAt: new Date().toISOString()
      });
    });
  }

  // ================= API DOCS =================

  if (req.method === 'GET' && url.split('?')[0] === '/api/openapi.json') {
    const spec = readOpenapi() || { error: 'openapi.json not found' };
    return sendJson(res, 200, spec);
  }

  if (req.method === 'GET' && url.split('?')[0] === '/api/docs') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(swaggerUiHtml);
  }

  // ================= AUTH =================

  if (req.method === 'POST' && url.split('?')[0] === '/api/auth/login') {
    return parseBody(req, (err, obj) => {
      if (err) return bodyError(res, err);
      if (!obj.username || !obj.password) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['username and password are required'] });
      }
      const sourceIp = req.socket?.remoteAddress || '';
      // Locked out? Reject before doing any credential work (parity with the
      // SQLite backend, which checks after its field-validation middleware).
      const lock = loginLockout.check(obj.username, sourceIp);
      if (lock.locked) {
        return sendJson(res, 429, {
          error: 'Too many failed login attempts. Try again later.',
          retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000),
        });
      }
      const user = users.find(u => u.username === obj.username);
      if (!user) {
        // Equalize response time with the bcrypt path (username enumeration).
        consumeComparisonTime(obj.password);
        // Failed attempts count toward the lockout even for unknown usernames
        // (no username oracle).
        loginLockout.recordFailure(obj.username, sourceIp);
        return sendJson(res, 401, { error: 'Invalid username or password' });
      }
      const verified = verifyPassword(obj.password, user.password);
      if (!verified.ok) {
        loginLockout.recordFailure(obj.username, sourceIp);
        return sendJson(res, 401, { error: 'Invalid username or password' });
      }
      // Successful login clears the failure counter.
      loginLockout.recordSuccess(obj.username, sourceIp);
      // Legacy plaintext row: upgrade in place so storage is never left with
      // a plaintext password after a successful login (persisted to the cloud
      // in Firestore mode).
      if (verified.needsRehash) {
        user.password = hashPassword(obj.password);
        if (useFirestore) writeJSON('@users', users);
      }
      return sendJson(res, 200, {
        token: signToken(user.id),
        user: { id: user.id, username: user.username, role: user.role, email: user.email, email_verified: user.email_verified !== false }
      });
    });
  }

  if (req.method === 'POST' && url.split('?')[0] === '/api/auth/register') {
    return parseBody(req, async (err, obj) => {
      if (err) return bodyError(res, err);
      if (!obj.username || !obj.password || !obj.email || !obj.phone) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['username, password, email and phone are required'] });
      }
      // Mirror the SQLite backend's register validation: maxLength on
      // password/email/username (SQLite rejects >100-char passwords, so must
      // this server), then the shared strong-password policy. Note: for a
      // request that fails BOTH maxLength and the password policy, SQLite
      // reports maxLength first (validate() runs before the handler) while
      // this server reports the password error first — both are 400 with a
      // details array, so shape parity holds; the messages differ. Accepted.
      if (String(obj.password).length > 100) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['password must be at most 100 characters'] });
      }
      if (String(obj.email).length > 100) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['email must be at most 100 characters'] });
      }
      if (String(obj.username).length > 50) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['username must be at most 50 characters'] });
      }
      if (String(obj.phone).length > 20 || !/^(\+63|63|0)?9\d{9}$/.test(String(obj.phone).trim())) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['phone must be a valid PH mobile number (e.g. 09171234567 or +639171234567)'] });
      }
      const pwError = passwordError(obj.password);
      if (pwError) {
        return sendJson(res, 400, { error: 'Validation failed', details: [pwError] });
      }
      if (users.some(u => u.username === obj.username)) return sendJson(res, 409, { error: 'Username already exists' });
      // New accounts start UNVERIFIED — the customer must redeem the
      // verification code emailed/SMS'd below; the welcome email waits.
      const user = { id: nextUserId++, username: obj.username, password: hashPassword(obj.password), role: 'customer', email: obj.email, phone: obj.phone, email_verified: false, created_at: new Date().toISOString() };
      users.push(user);
      if (useFirestore) writeJSON('@users', users);
      const code = generateCode();
      verificationCodes.set(hashCode(code), { user_id: user.id, expires_at: new Date(Date.now() + VERIFICATION_CODE_TTL_MS).toISOString() });
      persistVerificationCodes();
      // Await so the response can tell the app whether the code actually went
      // out (email always, SMS when a phone was provided).
      const delivery = await notifyVerificationCode({
        email: obj.email,
        username: obj.username,
        code,
        phone: obj.phone,
        ttlMinutes: Math.max(1, Math.round(VERIFICATION_CODE_TTL_MS / 60000)),
      });
      return sendJson(res, 200, {
        token: signToken(user.id),
        user: { id: user.id, username: user.username, role: user.role, email: user.email, email_verified: false },
        notify: {
          email: !!(delivery && delivery[0] && delivery[0].sent),
          sms: !!(delivery && delivery[1] && delivery[1].sent),
        }
      });
    });
  }

  if (req.method === 'POST' && url.split('?')[0] === '/api/auth/verify-email') {
    return parseBody(req, (err, obj) => {
      if (err) return bodyError(res, err);
      if (!obj.code) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['code is required'] });
      }
      if (String(obj.code).length > 10) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['code must be at most 10 characters'] });
      }
      // Brute-force protection: a 6-digit code has only 1M combinations, so
      // wrong guesses are throttled per IP (parity with the SQLite backend).
      const sourceIp = req.socket?.remoteAddress || '';
      const lock = loginLockout.check('verify-email', sourceIp);
      if (lock.locked) {
        return sendJson(res, 429, {
          error: 'Too many verification attempts. Try again later.',
          retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000),
        });
      }
      const token = verificationCodes.get(hashCode(obj.code));
      if (!token || new Date(token.expires_at).getTime() < Date.now()) {
        loginLockout.recordFailure('verify-email', sourceIp);
        return sendJson(res, 401, { error: 'Invalid or expired verification code' });
      }
      // Single-use: consume the code BEFORE flipping the flag.
      verificationCodes.delete(hashCode(obj.code));
      const user = users.find(u => u.id === token.user_id);
      if (!user) {
        persistVerificationCodes();
        return sendJson(res, 401, { error: 'Invalid or expired verification code' });
      }
      user.email_verified = true;
      persistVerificationCodes();
      if (useFirestore) writeJSON('@users', users);
      // Now that the address is proven, the welcome lands (fire-and-forget).
      notifyWelcome(user.email, user.username);
      loginLockout.recordSuccess('verify-email', sourceIp);
      return sendJson(res, 200, { ok: true, message: 'Email verified' });
    });
  }

  if (req.method === 'POST' && url.split('?')[0] === '/api/auth/resend-verification') {
    return parseBody(req, async (err, obj) => {
      if (err) return bodyError(res, err);
      if (!obj.email) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['email is required'] });
      }
      if (String(obj.email).length > 100) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['email must be at most 100 characters'] });
      }
      // Per-IP quota (identical for every email, so no enumeration oracle).
      const sourceIp = req.socket?.remoteAddress || '';
      const lock = loginLockout.check('resend-verification', sourceIp);
      if (lock.locked) {
        return sendJson(res, 429, {
          error: 'Too many verification requests. Try again later.',
          retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000),
        });
      }
      loginLockout.recordFailure('resend-verification', sourceIp);
      // Only UNVERIFIED accounts get a new code (still 200 either way).
      const user = users.find(u => u.email && u.email.toLowerCase() === String(obj.email).toLowerCase() && u.email_verified === false);
      let notifyDelivery = null;
      if (user) {
        const code = generateCode();
        const now = Date.now();
        for (const [h, t] of [...verificationCodes]) {
          if (t.user_id === user.id || new Date(t.expires_at).getTime() < now) verificationCodes.delete(h);
        }
        verificationCodes.set(hashCode(code), { user_id: user.id, expires_at: new Date(now + VERIFICATION_CODE_TTL_MS).toISOString() });
        persistVerificationCodes();
        const delivery = await notifyVerificationCode({
          email: user.email,
          username: user.username,
          code,
          phone: user.phone,
          ttlMinutes: Math.max(1, Math.round(VERIFICATION_CODE_TTL_MS / 60000)),
        });
        // Delivery status only when a code was actually generated (the
        // response never reveals whether the email has an account).
        notifyDelivery = {
          email: !!(delivery && delivery[0] && delivery[0].sent),
          sms: !!(delivery && delivery[1] && delivery[1].sent),
        };
      }
      return sendJson(res, 200, {
        ok: true,
        message: 'If an unverified account exists for that email, a new code has been sent.',
        ...(notifyDelivery ? { notify: notifyDelivery } : {}),
      });
    });
  }

  if (req.method === 'POST' && url.split('?')[0] === '/api/auth/forgot-password') {
    return parseBody(req, (err, obj) => {
      if (err) return bodyError(res, err);
      if (!obj.email) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['email is required'] });
      }
      // Mirror the SQLite validate(): maxLength on email before anything else.
      if (String(obj.email).length > 100) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['email must be at most 100 characters'] });
      }
      // Per-IP quota so a victim's inbox can't be flooded with reset emails
      // (keyed on a reserved account name; identical for every email, so it
      // cannot act as an enumeration oracle). Parity with the SQLite backend.
      const sourceIp = req.socket?.remoteAddress || '';
      const lock = loginLockout.check('forgot-password', sourceIp);
      if (lock.locked) {
        return sendJson(res, 429, {
          error: 'Too many reset requests. Try again later.',
          retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000),
        });
      }
      // Every request consumes quota (the action IS sending an email).
      loginLockout.recordFailure('forgot-password', sourceIp);
      const user = users.find(u => u.email && u.email.toLowerCase() === String(obj.email).toLowerCase());
      if (user) {
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const codeHash = crypto.createHash('sha256').update(code).digest('hex');
        const now = Date.now();
        const expiresAt = new Date(now + RESET_CODE_TTL_MS).toISOString();
        // Prune this user's previous codes and anything already expired, then
        // store the new code (hash at rest, single-use).
        for (const [h, t] of [...resetTokens]) {
          if (t.user_id === user.id || new Date(t.expires_at).getTime() < now) resetTokens.delete(h);
        }
        resetTokens.set(codeHash, { user_id: user.id, expires_at: expiresAt });
        persistResetTokens();
        notifyPasswordReset(
          user.email,
          user.username,
          code,
          Math.max(1, Math.round(RESET_CODE_TTL_MS / 60000))
        );
      }
      // Always 200 — never reveal whether the email belongs to an account
      // (no user-enumeration oracle, same as the SQLite backend).
      return sendJson(res, 200, { ok: true, message: 'If an account exists for that email, a reset code has been sent.' });
    });
  }

  if (req.method === 'POST' && url.split('?')[0] === '/api/auth/reset-password') {
    return parseBody(req, (err, obj) => {
      if (err) return bodyError(res, err);
      if (!obj.code || !obj.password) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['code and password are required'] });
      }
      // Mirror the SQLite validate(): maxLength on password before the policy.
      if (String(obj.password).length > 100) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['password must be at most 100 characters'] });
      }
      const pwError = passwordError(obj.password);
      if (pwError) {
        return sendJson(res, 400, { error: 'Validation failed', details: [pwError] });
      }
      // A 6-digit code has only 1M combinations, so wrong guesses must be
      // throttled per IP (parity with the SQLite backend) — otherwise anyone
      // could brute-force a victim's code inside its TTL window. Keyed on a
      // reserved account name so an attacker cannot tell WHOSE code they are
      // guessing.
      const sourceIp = req.socket?.remoteAddress || '';
      const lock = loginLockout.check('reset-password', sourceIp);
      if (lock.locked) {
        return sendJson(res, 429, {
          error: 'Too many reset attempts. Try again later.',
          retryAfterSeconds: Math.ceil(lock.retryAfterMs / 1000),
        });
      }
      const codeHash = crypto.createHash('sha256').update(String(obj.code)).digest('hex');
      const token = resetTokens.get(codeHash);
      if (!token || new Date(token.expires_at).getTime() < Date.now()) {
        loginLockout.recordFailure('reset-password', sourceIp);
        return sendJson(res, 401, { error: 'Invalid or expired reset code' });
      }
      // Single-use: consume the code BEFORE applying the new hash, so a
      // replayed request can never reset the password twice.
      resetTokens.delete(codeHash);
      const user = users.find(u => u.id === token.user_id);
      if (!user) {
        persistResetTokens();
        return sendJson(res, 401, { error: 'Invalid or expired reset code' });
      }
      user.password = hashPassword(obj.password);
      persistResetTokens();
      if (useFirestore) writeJSON('@users', users);
      // A successful reset proves account ownership: clear the per-IP reset
      // quota and lift any login lockout on the account.
      loginLockout.recordSuccess('reset-password', sourceIp);
      loginLockout.clearAccount(user.username);
      return sendJson(res, 200, { ok: true, message: 'Password updated' });
    });
  }

  if (req.method === 'GET' && url.split('?')[0] === '/api/auth/me') {
    return requireAuth(req, res, false, (req, res) => {
      return sendJson(res, 200, {
        id: req.user.id, username: req.user.username, role: req.user.role, email: req.user.email,
        email_verified: req.user.email_verified !== false,
        phone: req.user.phone === undefined || req.user.phone === '' ? null : req.user.phone,
        created_at: req.user.created_at,
      });
    });
  }

  // ================= PRODUCTS =================

  if (req.method === 'GET' && url.split('?')[0] === '/api/products/categories') {
    const products = readJSON(productsFile) || [];
    const cats = [...new Set(products.filter(isProductActive).map(p => p['Category'] || p.category).filter(Boolean))].sort();
    return sendJson(res, 200, cats);
  }

  if (req.method === 'GET' && url.split('?')[0] === '/api/products') {
    const parsed = new URL(url, 'http://localhost');
    const page = parsed.searchParams.get('page');
    const limit = parsed.searchParams.get('limit');
    const search = parsed.searchParams.get('search');
    const category = parsed.searchParams.get('category');
    const products = readJSON(productsFile) || [];
    const statusParam = parsed.searchParams.get('status');
    const want = statusParam || 'active';
    // Format the FULL array with original indices first so ids stay stable
    // (SQLite keeps stable AUTOINCREMENT ids), then filter on status. Sort by
    // name to mirror the SQLite backend's `ORDER BY name ASC`.
    let formatted = products
      .map(formatProduct)
      .filter(f => want === 'active' ? isProductActive(f) : f.status === want)
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));

    if (search) {
      const s = search.toLowerCase();
      formatted = formatted.filter(p => (p.name + ' ' + p.category + ' ' + p.brand).toLowerCase().includes(s));
    }
    if (category) {
      formatted = formatted.filter(p => p.category === category);
    }

    if (page !== null || limit !== null) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const offset = (pageNum - 1) * limitNum;
      return sendJson(res, 200, {
        data: formatted.slice(offset, offset + limitNum),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: formatted.length,
          totalPages: Math.ceil(formatted.length / limitNum)
        }
      });
    }
    return sendJson(res, 200, formatted);
  }

  if (req.method === 'GET' && isParamPath(url, 'api/products', 3)) {
    const id = parseInt(url.split('?')[0].split('/').pop(), 10);
    const products = readJSON(productsFile) || [];
    if (!products[id - 1]) return sendJson(res, 404, { error: 'Product not found' });
    // Match the SQLite backend: the row is returned regardless of status.
    return sendJson(res, 200, formatProduct(products[id - 1], id - 1));
  }

  if (req.method === 'POST' && url.split('?')[0] === '/api/products') {
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
        if (!obj.name || !obj.category) return sendJson(res, 400, { error: 'Validation failed', details: ['name and category are required'] });
        // Mirror the SQLite validate() schema: price is required and numeric >= 0.
        const priceNum = Number(obj.price);
        if (obj.price === undefined || obj.price === null || obj.price === '' || !Number.isFinite(priceNum) || priceNum < 0) {
          return sendJson(res, 400, { error: 'Validation failed', details: ['price is required and must be a number >= 0'] });
        }
        const products = readJSON(productsFile) || [];
        const newProduct = {
          'Product Name': obj.name,
          'Category': obj.category,
          'Brand': obj.brand || '',
          'Description': obj.description || '',
          'Size': obj.size || '',
          'Unit': obj.unit || 'pcs',
          'Price': priceNum,
          'status': 'active',
          'Image': obj.image || ''
        };
        products.push(newProduct);
        writeJSON(productsFile, products);
        return sendJson(res, 201, { id: products.length });
      });
    });
  }

  if (req.method === 'PUT' && isParamPath(url, 'api/products', 3)) {
    const id = parseInt(url.split('?')[0].split('/').pop(), 10);
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
        const products = readJSON(productsFile) || [];
        if (!products[id - 1]) return sendJson(res, 404, { error: 'Product not found' });
        const p = products[id - 1];
        // Mirror the SQLite backend: a partial PUT nulls the unspecified columns.
        p['Product Name'] = obj.name ?? null;
        p['Category'] = obj.category ?? null;
        p['Brand'] = obj.brand ?? null;
        p['Description'] = obj.description ?? null;
        p['Size'] = obj.size ?? null;
        p['Unit'] = obj.unit ?? null;
        p['Price'] = obj.price !== undefined ? Number(obj.price) : null;
        p['status'] = obj.status ?? null;
        p['Image'] = obj.image ?? null;
        writeJSON(productsFile, products);
        return sendJson(res, 200, { ok: true });
      });
    });
  }

  // INVARIANT: product ids are array positions + 1, so the products array must
  // NEVER be spliced — only soft-deactivated (status = 'inactive'). Splicing
  // would silently reindex every downstream id (by-id lookups `products[id-1]`,
  // POST `{ id: products.length }`, the integrity check, inventory merges).
  if (req.method === 'DELETE' && isParamPath(url, 'api/products', 3)) {
    const id = parseInt(url.split('?')[0].split('/').pop(), 10);
    return requireAuth(req, res, true, (req, res) => {
      const products = readJSON(productsFile) || [];
      if (!products[id - 1]) return sendJson(res, 404, { error: 'Product not found' });
      products[id - 1]['status'] = 'inactive';
      writeJSON(productsFile, products);
      return sendJson(res, 200, { ok: true, message: 'Product deactivated' });
    });
  }

  // ================= INVENTORY =================

  if (req.method === 'GET' && url.split('?')[0] === '/api/inventory') {
    const inv = getInventory();
    const parsed = new URL(url, 'http://localhost');
    const lowStock = parsed.searchParams.get('low_stock') === 'true';
    const location = parsed.searchParams.get('location');
    const products = readJSON(productsFile) || [];
    // Match the SQLite backend: every ACTIVE product appears, including ones
    // created after the inventory snapshot (those simply have no stock yet).
    const byId = new Map(inv.items.map(i => [Number(i.product && i.product.id), i]));
    // Always format the product from the LIVE products file (stable ids + live
    // status); reuse only the snapshot's stock so deactivated products drop
    // out exactly like the SQLite `WHERE status='active'` inventory query.
    let items = products
      .map((p, idx) => {
        const existing = byId.get(idx + 1);
        return {
          product: formatProduct(p, idx),
          locations: existing ? existing.locations : {},
          total: existing ? existing.total : 0
        };
      })
      .filter(item => item.product && isProductActive(item.product));
    if (location) {
      // Accept a numeric location id or a name, mirroring the SQLite
      // resolveLocation() helper (the numeric form is used by the UI).
      const locId = Number(location);
      const locName = Number.isInteger(locId) && locId >= 1 && locId <= inv.locations.length
        ? inv.locations[locId - 1]
        : location;
      items = items.map(item => ({
        ...item,
        locations: item.locations[locName] !== undefined ? { [locName]: item.locations[locName] } : {},
        total: item.locations[locName] || 0
      }));
    }
    if (lowStock) items = items.filter(item => item.total < 80);
    const locations = inv.locations.map((name, index) => ({ id: index + 1, name }));
    return sendJson(res, 200, { locations, items });
  }

  // ================= LOCATIONS =================

  if (req.method === 'GET' && url.split('?')[0] === '/api/locations') {
    const inv = getInventory();
    return sendJson(res, 200, inv.locations.map((name, index) => ({ id: index + 1, name })));
  }

  if (req.method === 'POST' && url.split('?')[0] === '/api/locations') {
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
        const inv = getInventory();
        if (!obj.name) return sendJson(res, 400, { error: 'Validation failed', details: ['name is required'] });
        if (inv.locations.includes(obj.name)) return sendJson(res, 409, { error: 'Location already exists' });
        inv.locations.push(obj.name);
        writeJSON(inventoryFile, inv);
        return sendJson(res, 201, { id: inv.locations.length, name: obj.name });
      });
    });
  }

  if (req.method === 'DELETE' && isParamPath(url, 'api/locations', 3)) {
    const id = Number(url.split('?')[0].split('/').pop());
    return requireAuth(req, res, true, (req, res) => {
      const inv = getInventory();
      if (Number.isNaN(id) || id <= 0 || id > inv.locations.length) return sendJson(res, 404, { error: 'Location not found' });
      const removedName = inv.locations[id - 1];
      const hasStock = inv.items.some(item => (item.locations[removedName] || 0) > 0);
      if (hasStock) {
        return sendJson(res, 400, { error: 'Cannot delete location with existing stock. Transfer stock first.' });
      }
      inv.locations.splice(id - 1, 1);
      inv.items.forEach(item => { delete item.locations[removedName]; });
      writeJSON(inventoryFile, inv);
      return sendJson(res, 200, { ok: true, message: 'Location deleted' });
    });
  }

  // ================= STOCK MOVEMENTS =================

  if (req.method === 'GET' && url.split('?')[0] === '/api/stock-movements') {
    const parsed = new URL(url, 'http://localhost');
    const page = parsed.searchParams.get('page');
    const limit = parsed.searchParams.get('limit');
    const type = parsed.searchParams.get('type');
    const productId = parsed.searchParams.get('product_id');
    let movements = readJSON(movementsFile) || [];
    // Firestore cannot store null, so the store driver maps it to '' — fold
    // both representations back to null so JSON and Firestore modes (and the
    // SQLite backend) return byte-identical values.
    movements = movements.map(m => ({
      ...m,
      src_location: m.src_location === undefined || m.src_location === '' ? null : m.src_location,
      dst_location: m.dst_location === undefined || m.dst_location === '' ? null : m.dst_location
    }));
    if (type) movements = movements.filter(m => m.type === type);
    if (productId) movements = movements.filter(m => Number(m.product_id) === Number(productId));
    if (page !== null || limit !== null) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const offset = (pageNum - 1) * limitNum;
      return sendJson(res, 200, {
        data: movements.slice(offset, offset + limitNum),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: movements.length,
          totalPages: Math.ceil(movements.length / limitNum)
        }
      });
    }
    return sendJson(res, 200, movements);
  }

  if (req.method === 'GET' && url.split('?')[0] === '/api/stock-lots') {
    const parsed = new URL(url, 'http://localhost');
    const productId = parsed.searchParams.get('product_id');
    const locationId = parsed.searchParams.get('location_id');
    const inv = getInventory();
    const lots = [];
    inv.items.forEach(item => {
      inv.locations.forEach(loc => {
        const qty = item.locations[loc] || 0;
        if (qty > 0) {
          const lot = { id: lots.length + 1, product_id: item.product.id, product_name: item.product.name, location_id: inv.locations.indexOf(loc) + 1, location_name: loc, qty, received_at: new Date().toISOString() };
          if (productId && Number(lot.product_id) !== Number(productId)) return;
          if (locationId && Number(lot.location_id) !== Number(locationId)) return;
          lots.push(lot);
        }
      });
    });
    return sendJson(res, 200, lots);
  }

  if (req.method === 'POST' && url.split('?')[0] === '/api/stock-movement') {
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
        if (!obj.product_id || !obj.qty || !obj.type) {
          return sendJson(res, 400, { error: 'Validation failed', details: ['product_id, qty and type are required'] });
        }
        if (!['stock-in', 'stock-out', 'transfer', 'adjustment'].includes(obj.type)) {
          return sendJson(res, 400, { error: 'Invalid type. Must be one of: stock-in, stock-out, transfer, adjustment' });
        }
        // Mirror the SQLite validate() schema: qty must be a positive number
        // and product_id a positive integer. A negative qty stock-out would
        // otherwise ADD stock, and a non-numeric qty would string-concatenate
        // into the inventory totals.
        const qty = Number(obj.qty);
        const pid = Number(obj.product_id);
        if (!Number.isFinite(qty) || qty <= 0) {
          return sendJson(res, 400, { error: 'Validation failed', details: ['qty must be a positive number'] });
        }
        // Mirror the SQLite validate(): reject non-numeric ids with 400, but
        // let fractional ids fall through to the product lookup (which 404s,
        // exactly like SQLite's `WHERE id = ?` with no matching row).
        if (Number.isNaN(pid) || pid < 1) {
          return sendJson(res, 400, { error: 'Validation failed', details: ['product_id must be a positive number'] });
        }
        const products = readJSON(productsFile) || [];
        if (!products[pid - 1] || !isProductActive(products[pid - 1])) {
          return sendJson(res, 404, { error: 'Product not found or inactive' });
        }
        // Pre-flight stock availability so a rejected movement leaves no trace
        // in the movement ledger (mirrors the SQLite backend).
        const inv = getInventory();
        const item = inv.items.find(i => i.product.id === pid);
        const locFor = (loc) => typeof loc === 'string' ? loc : (inv.locations[Number(loc) - 1]);
        if ((obj.type === 'stock-out' || obj.type === 'transfer') && obj.src_location) {
          const available = item ? (item.locations[locFor(obj.src_location)] || 0) : 0;
          if (available < qty) return sendJson(res, 400, { error: 'Insufficient stock at source location' });
        }
        const movements = readJSON(movementsFile) || [];
        const newMovement = {
          id: movements.length + 1,
          product_id: pid,
          qty,
          type: obj.type,
          src_location: obj.src_location || null,
          dst_location: obj.dst_location || null,
          notes: obj.notes || '',
          created_at: new Date().toISOString(),
          user: obj.user || (req.user && req.user.username) || 'system'
        };
        movements.unshift(newMovement);
        writeJSON(movementsFile, movements);

        if (item) {
          if (obj.type === 'stock-in' && obj.dst_location) {
            const loc = locFor(obj.dst_location);
            item.locations[loc] = (item.locations[loc] || 0) + qty;
          } else if (obj.type === 'stock-out' && obj.src_location) {
            const loc = locFor(obj.src_location);
            item.locations[loc] = item.locations[loc] - qty;
          } else if (obj.type === 'transfer' && obj.src_location && obj.dst_location) {
            const src = locFor(obj.src_location);
            const dst = locFor(obj.dst_location);
            item.locations[src] = item.locations[src] - qty;
            item.locations[dst] = (item.locations[dst] || 0) + qty;
          } else if (obj.type === 'adjustment' && (obj.dst_location || obj.src_location)) {
            const loc = locFor(obj.dst_location || obj.src_location);
            item.locations[loc] = qty;
          }
          item.total = Object.values(item.locations).reduce((sum, q) => sum + q, 0);
          writeJSON(inventoryFile, inv);
          // Mirror the SQLite backend: create/update a low-stock alert when a
          // source location drops below the threshold after a movement.
          if (obj.src_location) {
            const srcName = locFor(obj.src_location);
            const srcId = typeof obj.src_location === 'number' ? obj.src_location : inv.locations.indexOf(srcName) + 1;
            upsertLowStockAlert(item.product.id, srcId, item.locations[srcName] || 0);
          }
        }

        return sendJson(res, 200, { ok: true, message: `Stock ${obj.type} recorded successfully` });
      });
    });
  }

  // ================= STOCK ADJUSTMENT / TRANSFER + APPROVAL ROUTES =================
  //
  // Mirrors the SQLite backend's dedicated modules (same shapes, same flow):
  // adjustments and transfers are created PENDING and only change stock once
  // an admin approves them — the 'approval of important transactions' workflow.

  // Rich row builders: SQLite joins product/location names at read time, so
  // the npm-free store snapshots the same fields onto each row.
  function adjustmentRow(a, inv, products) {
    const product = products[Number(a.product_id) - 1] || null;
    const locationName = a.location_name || (inv.locations[Number(a.location_id) - 1]) || `Location ${a.location_id}`;
    let currentQty = 0;
    const item = inv.items.find(i => i.product && Number(i.product.id) === Number(a.product_id));
    if (item) currentQty = item.locations[locationName] || 0;
    return {
      id: Number(a.id),
      product_id: Number(a.product_id),
      product_name: (product && (product['Product Name'] || product.name)) || `Product ${a.product_id}`,
      location_id: Number(a.location_id),
      location_name: locationName,
      new_qty: Number(a.new_qty),
      reason: a.reason || '',
      status: a.status || 'pending',
      created_at: a.created_at,
      decided_at: a.decided_at === undefined || a.decided_at === '' ? null : a.decided_at,
      decided_by: a.decided_by === undefined || a.decided_by === '' ? null : a.decided_by,
      current_qty: currentQty,
    };
  }

  function transferRow(t, inv, products) {
    const product = products[Number(t.product_id) - 1] || null;
    const srcName = t.src_location_name || (inv.locations[Number(t.src_location) - 1]) || `Location ${t.src_location}`;
    const dstName = t.dst_location_name || (inv.locations[Number(t.dst_location) - 1]) || `Location ${t.dst_location}`;
    return {
      id: Number(t.id),
      product_id: Number(t.product_id),
      product_name: (product && (product['Product Name'] || product.name)) || `Product ${t.product_id}`,
      src_location: Number(t.src_location),
      src_location_name: srcName,
      dst_location: Number(t.dst_location),
      dst_location_name: dstName,
      qty: Number(t.qty),
      reason: t.reason || '',
      status: t.status || 'pending',
      created_at: t.created_at,
      decided_at: t.decided_at === undefined || t.decided_at === '' ? null : t.decided_at,
      decided_by: t.decided_by === undefined || t.decided_by === '' ? null : t.decided_by,
    };
  }

  function loadRows(kind, status) {
    const raw = readJSON(kind === 'adjustment' ? adjustmentsFile : transfersFile) || [];
    const inv = getInventory();
    const products = readJSON(productsFile) || [];
    let rows = raw.map(r => (kind === 'adjustment' ? adjustmentRow(r, inv, products) : transferRow(r, inv, products)));
    if (status) rows = rows.filter(r => r.status === status);
    return rows;
  }

  const pathPart = url.split('?')[0];

  if (req.method === 'GET' && pathPart === '/api/stock-adjustments') {
    return requireAuth(req, res, true, (req, res) => {
      const parsed = new URL(url, 'http://localhost');
      return sendJson(res, 200, loadRows('adjustment', parsed.searchParams.get('status')));
    });
  }

  if (req.method === 'POST' && url.split('?')[0] === '/api/stock-adjustments') {
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
        const productId = Number(obj.product_id);
        const locationId = Number(obj.location_id);
        const newQty = Number(obj.new_qty);
        if (!Number.isFinite(productId) || productId < 1) return sendJson(res, 400, { error: 'Validation failed', details: ['product_id must be a positive number'] });
        if (!Number.isFinite(locationId) || locationId < 1) return sendJson(res, 400, { error: 'Validation failed', details: ['location_id must be a positive number'] });
        if (!Number.isFinite(newQty) || newQty < 0) return sendJson(res, 400, { error: 'Validation failed', details: ['new_qty must be a number >= 0'] });
        const products = readJSON(productsFile) || [];
        if (!products[productId - 1] || !isProductActive(products[productId - 1])) return sendJson(res, 404, { error: 'Product not found or inactive' });
        const inv = getInventory();
        if (!inv.locations[locationId - 1]) return sendJson(res, 404, { error: 'Location not found' });
        const rows = readJSON(adjustmentsFile) || [];
        const row = {
          id: rows.length + 1,
          product_id: productId,
          location_id: locationId,
          location_name: inv.locations[locationId - 1],
          new_qty: newQty,
          reason: obj.reason || '',
          status: 'pending',
          created_at: new Date().toISOString(),
          decided_at: null,
          decided_by: null,
        };
        rows.unshift(row);
        writeJSON(adjustmentsFile, rows);
        return sendJson(res, 201, { ok: true, id: row.id, message: 'Adjustment created (pending approval)' });
      });
    });
  }

  // /api/stock-adjustments/{id}/approve | /reject (admin only)
  if (req.method === 'POST' && url.startsWith('/api/stock-adjustments/') && /^\/api\/stock-adjustments\/\d+\/(approve|reject)$/.test(pathPart)) {
    return requireAuth(req, res, true, (req, res) => {
      const id = Number(pathPart.split('/')[3]);
      const action = pathPart.split('/')[4];
      const rows = readJSON(adjustmentsFile) || [];
      const row = rows.find(r => Number(r.id) === id);
      if (!row) return sendJson(res, 404, { error: 'Adjustment not found' });
      if (row.status !== 'pending') return sendJson(res, 400, { error: 'Adjustment already decided' });

      const now = new Date().toISOString();
      const actor = (req.user && req.user.username) || 'admin';

      if (action === 'approve') {
        // Apply the correction: set the location's stock to the proposed qty.
        const inv = getInventory();
        const item = inv.items.find(i => i.product && Number(i.product.id) === Number(row.product_id));
        if (item) {
          const locName = row.location_name || inv.locations[Number(row.location_id) - 1];
          item.locations[locName] = Number(row.new_qty);
          item.total = Object.values(item.locations).reduce((sum, q) => sum + q, 0);
          writeJSON(inventoryFile, inv);
        }
        // Record the movement in the ledger (mirrors SQLite).
        const movements = readJSON(movementsFile) || [];
        movements.unshift({
          id: movements.length + 1,
          product_id: Number(row.product_id),
          qty: Number(row.new_qty),
          type: 'adjustment',
          src_location: null,
          dst_location: Number(row.location_id),
          notes: `Adjustment #${row.id}: ${row.reason || 'approved correction'}`,
          created_at: now,
          user: actor,
        });
        writeJSON(movementsFile, movements);
        row.status = 'approved';
        row.decided_at = now;
        row.decided_by = actor;
        writeJSON(adjustmentsFile, rows);
        return sendJson(res, 200, { ok: true, message: 'Adjustment approved and applied to stock' });
      }

      row.status = 'rejected';
      row.decided_at = now;
      row.decided_by = actor;
      writeJSON(adjustmentsFile, rows);
      return sendJson(res, 200, { ok: true, message: 'Adjustment rejected (stock unchanged)' });
    });
  }

  if (req.method === 'GET' && pathPart === '/api/stock-transfers') {
    return requireAuth(req, res, true, (req, res) => {
      const parsed = new URL(url, 'http://localhost');
      return sendJson(res, 200, loadRows('transfer', parsed.searchParams.get('status')));
    });
  }

  if (req.method === 'POST' && url.split('?')[0] === '/api/stock-transfers') {
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
        const productId = Number(obj.product_id);
        const srcId = Number(obj.src_location);
        const dstId = Number(obj.dst_location);
        const qty = Number(obj.qty);
        if (!Number.isFinite(productId) || productId < 1) return sendJson(res, 400, { error: 'Validation failed', details: ['product_id must be a positive number'] });
        if (!Number.isFinite(srcId) || srcId < 1) return sendJson(res, 400, { error: 'Validation failed', details: ['src_location must be a positive number'] });
        if (!Number.isFinite(dstId) || dstId < 1) return sendJson(res, 400, { error: 'Validation failed', details: ['dst_location must be a positive number'] });
        if (!Number.isFinite(qty) || qty <= 0) return sendJson(res, 400, { error: 'Validation failed', details: ['qty must be a positive number'] });
        if (srcId === dstId) return sendJson(res, 400, { error: 'Source and destination must differ' });
        const products = readJSON(productsFile) || [];
        if (!products[productId - 1] || !isProductActive(products[productId - 1])) return sendJson(res, 404, { error: 'Product not found or inactive' });
        const inv = getInventory();
        if (!inv.locations[srcId - 1] || !inv.locations[dstId - 1]) return sendJson(res, 404, { error: 'Location not found' });
        const rows = readJSON(transfersFile) || [];
        const row = {
          id: rows.length + 1,
          product_id: productId,
          src_location: srcId,
          src_location_name: inv.locations[srcId - 1],
          dst_location: dstId,
          dst_location_name: inv.locations[dstId - 1],
          qty,
          reason: obj.reason || '',
          status: 'pending',
          created_at: new Date().toISOString(),
          decided_at: null,
          decided_by: null,
        };
        rows.unshift(row);
        writeJSON(transfersFile, rows);
        return sendJson(res, 201, { ok: true, id: row.id, message: 'Transfer created (pending approval)' });
      });
    });
  }

  // /api/stock-transfers/{id}/approve | /reject (admin only)
  if (req.method === 'POST' && url.startsWith('/api/stock-transfers/') && /^\/api\/stock-transfers\/\d+\/(approve|reject)$/.test(pathPart)) {
    return requireAuth(req, res, true, (req, res) => {
      const id = Number(pathPart.split('/')[3]);
      const action = pathPart.split('/')[4];
      const rows = readJSON(transfersFile) || [];
      const row = rows.find(r => Number(r.id) === id);
      if (!row) return sendJson(res, 404, { error: 'Transfer not found' });
      if (row.status !== 'pending') return sendJson(res, 400, { error: 'Transfer already decided' });

      const now = new Date().toISOString();
      const actor = (req.user && req.user.username) || 'admin';

      if (action === 'approve') {
        const inv = getInventory();
        const item = inv.items.find(i => i.product && Number(i.product.id) === Number(row.product_id));
        const srcName = row.src_location_name || inv.locations[Number(row.src_location) - 1];
        const dstName = row.dst_location_name || inv.locations[Number(row.dst_location) - 1];
        const available = item ? (item.locations[srcName] || 0) : 0;
        if (available < Number(row.qty)) return sendJson(res, 400, { error: 'Insufficient stock at source location' });
        if (item) {
          item.locations[srcName] = (item.locations[srcName] || 0) - Number(row.qty);
          item.locations[dstName] = (item.locations[dstName] || 0) + Number(row.qty);
          item.total = Object.values(item.locations).reduce((sum, q) => sum + q, 0);
          writeJSON(inventoryFile, inv);
          upsertLowStockAlert(item.product.id, Number(row.src_location), item.locations[srcName] || 0);
        }
        const movements = readJSON(movementsFile) || [];
        movements.unshift({
          id: movements.length + 1,
          product_id: Number(row.product_id),
          qty: Number(row.qty),
          type: 'transfer',
          src_location: Number(row.src_location),
          dst_location: Number(row.dst_location),
          notes: `Transfer #${row.id}: ${row.reason || 'approved transfer'}`,
          created_at: now,
          user: actor,
        });
        writeJSON(movementsFile, movements);
        row.status = 'approved';
        row.decided_at = now;
        row.decided_by = actor;
        writeJSON(transfersFile, rows);
        return sendJson(res, 200, { ok: true, message: 'Transfer approved and applied to stock' });
      }

      row.status = 'rejected';
      row.decided_at = now;
      row.decided_by = actor;
      writeJSON(transfersFile, rows);
      return sendJson(res, 200, { ok: true, message: 'Transfer rejected (stock unchanged)' });
    });
  }

  // Combined pending queue (Approvals page).
  if (req.method === 'GET' && url.split('?')[0] === '/api/approvals') {
    return requireAuth(req, res, true, (req, res) => {
      return sendJson(res, 200, {
        adjustments: loadRows('adjustment', 'pending'),
        transfers: loadRows('transfer', 'pending'),
      });
    });
  }

  // Printable report data (Report Viewing module).
  if (req.method === 'GET' && url.split('?')[0] === '/api/reports') {
    return requireAuth(req, res, true, (req, res) => {
      const parsed = new URL(url, 'http://localhost');
      const days = Math.min(90, Math.max(1, parseInt(parsed.searchParams.get('days'), 10) || 14));
      const generated_at = new Date().toISOString();
      const cutoff = Date.now() - days * 86400000;
      const sales = salesTransactions.length ? salesTransactions : (readJSON('@sales') || []);

      const dateKey = (iso) => (iso || '').slice(0, 10);
      const dailyMap = {};
      sales.forEach(s => {
        if (new Date(s.transaction_date).getTime() < cutoff) return;
        const d = dateKey(s.transaction_date);
        dailyMap[d] = dailyMap[d] || { date: d, transactions: 0, value: 0 };
        dailyMap[d].transactions += 1;
        dailyMap[d].value += Number(s.total_amount) || 0;
      });
      const dailySales = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

      const inv = getInventory();
      const stockByLocation = (inv.locations || []).map(name => ({
        location: name,
        total: (inv.items || []).reduce((sum, it) => sum + (it.locations[name] || 0), 0),
      }));

      const orders = readJSON(orderFile) || [];
      const orderStatusSummary = { pending: 0, approved: 0, rejected: 0, fulfilled: 0, delivered: 0 };
      orders.forEach(o => { const s = o.status || 'pending'; if (orderStatusSummary[s] !== undefined) orderStatusSummary[s] += 1; });

      const products = readJSON(productsFile) || [];
      const lowStock = (inv.items || [])
        .filter(it => it.total < 80)
        .map(it => ({ id: it.product.id, name: it.product.name, total: it.total }))
        .sort((a, b) => a.total - b.total);

      const qtyByProduct = {};
      const valueByProduct = {};
      sales.forEach(s => {
        const pid = Number(s.product_id);
        qtyByProduct[pid] = (qtyByProduct[pid] || 0) + (Number(s.qty) || 0);
        valueByProduct[pid] = (valueByProduct[pid] || 0) + (Number(s.total_amount) || 0);
      });
      const moverRows = products.map((p, idx) => ({
        name: p['Product Name'] || p.name || '',
        qty_sold: qtyByProduct[idx + 1] || 0,
        value: valueByProduct[idx + 1] || 0,
      }));
      const fastMovers = moverRows.filter(r => r.qty_sold > 0).sort((a, b) => b.qty_sold - a.qty_sold).slice(0, 10);
      // SQLite's slow-mover rows carry only name + qty_sold — strip the value
      // key here so the report shapes stay byte-identical across backends.
      const slowMovers = moverRows
        .sort((a, b) => a.qty_sold - b.qty_sold || a.name.localeCompare(b.name))
        .slice(0, 10)
        .map(({ name, qty_sold }) => ({ name, qty_sold }));

      const summary = {
        total_products: products.filter(isProductActive).length,
        total_stock: (inv.items || []).reduce((sum, it) => sum + (it.total || 0), 0),
        total_sales: sales.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0),
        transactions: sales.length,
        customers_served: new Set(sales.map(s => s.customer_name)).size,
        pending_approvals: loadRows('adjustment', 'pending').length + loadRows('transfer', 'pending').length,
      };

      return sendJson(res, 200, { generated_at, days, dailySales, stockByLocation, orderStatusSummary, lowStock, fastMovers, slowMovers, summary });
    });
  }

  // ================= ORDER INQUIRIES =================

  if (req.method === 'GET' && url.split('?')[0] === '/api/order-inquiries') {
    return requireAuth(req, res, false, (req, res) => {
    const parsed = new URL(url, 'http://localhost');
    const page = parsed.searchParams.get('page');
    const limit = parsed.searchParams.get('limit');
    const status = parsed.searchParams.get('status');
    let orders = readJSON(orderFile) || [];
    // Normalize so every row carries customer_phone (null when absent) — the
    // SQLite backend always returns the column, and the contract suites assert
    // identical shapes, so an old row without the key would break parity.
    orders = orders.map(o => ({
      ...o,
      customer_phone: o.customer_phone === undefined || o.customer_phone === '' ? null : o.customer_phone,
      // Firestore stores null as '' — normalize back; payment_method defaults to
      // 'cod' for rows created before checkout existed (SQLite parity).
      delivery_address: o.delivery_address === undefined || o.delivery_address === '' ? null : o.delivery_address,
      payment_method: o.payment_method === undefined || o.payment_method === '' ? 'cod' : o.payment_method,
      // Payment step (SQLite parity): status defaults to 'unpaid' for rows
      // created before checkout payment existed; reference/url/qr are null.
      payment_status: o.payment_status === undefined || o.payment_status === '' ? 'unpaid' : o.payment_status,
      payment_reference: o.payment_reference === undefined || o.payment_reference === '' ? null : o.payment_reference,
      payment_url: o.payment_url === undefined || o.payment_url === '' ? null : o.payment_url,
      payment_qr: o.payment_qr === undefined || o.payment_qr === '' ? null : o.payment_qr,
      payment_provider: o.payment_provider === undefined || o.payment_provider === '' ? null : o.payment_provider,
      // Ownership + progress timeline (SQLite parity): user_id is an integer
      // (null when the order predates account stamping), status_history is the
      // JSON status-timeline string (null when the row predates tracking).
      user_id: o.user_id === undefined || o.user_id === null || o.user_id === '' ? null : Number(o.user_id),
      status_history: o.status_history === undefined || o.status_history === '' ? null : o.status_history,
    }));
    // Per-account scoping: admins see every inquiry; customers only their own
    // (user_id match, with a legacy fallback to the account's email so orders
    // placed before ownership was stamped still appear in history).
    if (req.user.role !== 'admin') {
      const owner = users.find(u => u.id === req.user.id);
      const myEmail = (owner && owner.email || '').toLowerCase();
      orders = orders.filter(o => Number(o.user_id) === req.user.id || (o.customer_email || '').toLowerCase() === myEmail);
    }
    if (status) orders = orders.filter(o => o.status === status);
    if (page !== null || limit !== null) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const offset = (pageNum - 1) * limitNum;
      return sendJson(res, 200, {
        data: orders.slice(offset, offset + limitNum),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: orders.length,
          totalPages: Math.ceil(orders.length / limitNum)
        }
      });
    }
    return sendJson(res, 200, orders);
    });
  }

  if (req.method === 'PUT' && isParamPath(url, 'api/order-inquiries', 3)) {
    const id = Number(url.split('?')[0].split('/').pop());
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
        const orders = readJSON(orderFile) || [];
        const order = orders.find(o => o.id === id);
        if (!order) return sendJson(res, 404, { error: 'Order inquiry not found' });
        if (!['pending', 'approved', 'rejected', 'fulfilled', 'delivered'].includes(obj.status)) {
          return sendJson(res, 400, { error: 'Invalid status. Must be one of: pending, approved, rejected, fulfilled, delivered' });
        }
        const updatedStatus = obj.status || order.status;
        // Progress timeline (Shopee-style): append the new status with a
        // timestamp; seed the 'placed' event from created_at when the row
        // predates status tracking so the mobile card never shows a gap.
        let history = [];
        try {
          const parsed = JSON.parse(order.status_history || '[]');
          if (Array.isArray(parsed)) history = parsed;
        } catch {}
        if (history.length === 0) {
          history.push({ status: order.status, at: order.created_at });
        }
        if (updatedStatus !== (history[history.length - 1] || {}).status) {
          history.push({ status: updatedStatus, at: new Date().toISOString() });
        }
        order.status = updatedStatus;
        order.status_history = JSON.stringify(history);
        writeJSON(orderFile, orders);
        if (order.status !== 'pending') notifyInquiryStatus(order, order.status);
        return sendJson(res, 200, { ok: true, message: `Inquiry ${order.status}` });
      });
    });
  }

  if (req.method === 'POST' && url.split('?')[0] === '/api/order-inquiries') {
    return parseBody(req, async (err, obj) => {
      if (err) return bodyError(res, err);
      if (!obj.customer_name || !obj.customer_email) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['customer_name and customer_email are required'] });
      }
      // Checkout fields (optional but validated when present) — mirrors the
      // SQLite backend: delivery_address <= 500 chars, payment_method enum.
      const validPayments = ['cod', 'gcash', 'card', 'other'];
      if (obj.delivery_address !== undefined && String(obj.delivery_address).length > 500) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['delivery_address must be at most 500 characters'] });
      }
      if (obj.payment_method !== undefined && !validPayments.includes(obj.payment_method)) {
        return sendJson(res, 400, { error: 'Validation failed', details: ['payment_method must be one of cod, gcash, card, other'] });
      }
      const orders = readJSON(orderFile) || [];
      // Optional auth: the app sends the customer's token at checkout, so the
      // inquiry can be stamped with its owner for per-account history. A
      // missing or invalid token still submits (legacy guest orders) with
      // user_id null (matches the SQLite backend).
      const auth = authUser(req);
      const userId = (auth && auth.user && auth.user.id) || null;
      const now = new Date().toISOString();
      const id = orders.length + 1;
      const newOrder = {
        id,
        customer_name: obj.customer_name,
        customer_email: obj.customer_email,
        customer_phone: obj.customer_phone || null,
        products: JSON.stringify(obj.products || []),
        estimated_cost: obj.estimated_cost || 0,
        notes: obj.notes || '',
        delivery_address: obj.delivery_address || null,
        payment_method: obj.payment_method || 'cod',
        payment_status: 'unpaid',
        payment_reference: null,
        payment_url: null,
        payment_qr: null,
        payment_provider: null,
        user_id: userId,
        status_history: JSON.stringify([{ status: 'pending', at: now }]),
        status: 'pending',
        created_at: now
      };
      // GCash/Card checkout: build the payment step (PayMongo when configured,
      // else the QR demo fallback) — identical to the SQLite backend. Guarded
      // so a provider failure can never leave the client hanging.
      let payment = null;
      try {
        payment = await buildPaymentStep({
          id,
          amount: obj.estimated_cost || 0,
          description: `INVENTRAK order ${id} — ${obj.customer_name}`,
          email: obj.customer_email,
          paymentMethod: obj.payment_method || 'cod',
        });
      } catch (err) {
        console.error('[payments] buildPaymentStep failed:', err && err.message);
      }
      if (payment) {
        Object.assign(newOrder, {
          payment_method: payment.payment_method,
          payment_status: payment.payment_status,
          payment_reference: payment.payment_reference,
          payment_url: payment.payment_url,
          payment_qr: payment.payment_qr,
          payment_provider: payment.payment_provider,
        });
      }
      orders.unshift(newOrder);
      writeJSON(orderFile, orders);
      return sendJson(res, 201, {
        ok: true,
        message: 'Inquiry submitted',
        id,
        ...(payment ? { payment: {
          payment_method: payment.payment_method,
          payment_status: payment.payment_status,
          payment_reference: payment.payment_reference,
          payment_url: payment.payment_url,
          payment_qr: payment.payment_qr,
        } } : {}),
      });
    });
  }

  // Mark an inquiry as paid (customer confirms after the GCash step).
  // Matches the SQLite backend: customers may only mark their own inquiry.
  if (req.method === 'PUT' && /^\/api\/order-inquiries\/\d+\/payment$/.test(url.split('?')[0])) {
    const id = Number(url.split('?')[0].split('/')[3]);
    return requireAuth(req, res, false, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
        if (!['paid', 'unpaid', 'failed'].includes(obj.payment_status)) {
          return sendJson(res, 400, { error: 'payment_status must be one of paid, unpaid, failed' });
        }
        const orders = readJSON(orderFile) || [];
        const order = orders.find(o => o.id === id);
        if (!order) return sendJson(res, 404, { error: 'Order inquiry not found' });
        if (req.user.role !== 'admin') {
          const owner = users.find(u => u.id === req.user.id);
          const myEmail = (owner && owner.email || '').toLowerCase();
          const mine = Number(order.user_id) === Number(req.user.id) ||
            (order.customer_email || '').toLowerCase() === myEmail;
          if (!mine) return sendJson(res, 403, { error: 'Not your inquiry' });
        }
        order.payment_status = obj.payment_status;
        writeJSON(orderFile, orders);
        return sendJson(res, 200, { ok: true, payment_status: obj.payment_status });
      });
    });
  }

  // OCR: scan a product photo. Public (guests may scan before creating an
  // account), large body limit, lazy tesseract engine with graceful 503.
  if (req.method === 'POST' && url.split('?')[0] === '/api/ocr') {
    return parseBodyLarge(req, async (err, obj) => {
      if (err) {
        return err.status === 413
          ? sendJson(res, 413, { error: 'Payload too large' })
          : bodyError(res, err);
      }
      const products = readJSON(productsFile) || [];
      // parseBody does not mutate req.body (raw dispatcher); expose the parsed
      // object so the shared OCR handler can read it.
      req.body = obj;
      await handleOcr(req, res, sendJson, products);
    });
  }

  // ================= OPTIMIZATION =================

  if (req.method === 'GET' && url.startsWith('/api/optimization')) {
    const parts = url.split('?')[0].split('/').filter(Boolean);
    // Valid shapes are /api/optimization (bulk), /api/optimization/abc, and
    // /api/optimization/{productId}. Deeper paths must 404 like Express does.
    if (parts.length !== 2 && parts.length !== 3) {
      return sendJson(res, 404, { error: 'Not found' });
    }
    const pid = parts[2];
    const products = readJSON(productsFile) || [];

    if (pid === 'abc') {
      const arr = products.map((p, idx) => ({
        id: idx + 1,
        name: p['Product Name'] || p.name,
        value: ((idx + 1) * 10) * (p['Price'] || p.price || 1),
        annualQty: 0
      }));
      arr.sort((a, b) => b.value - a.value);
      const total = arr.reduce((sum, item) => sum + item.value, 0);
      let cum = 0;
      const result = arr.map(item => {
        cum += item.value;
        const pct = total > 0 ? (cum / total) * 100 : 0;
        let classification = 'C';
        if (pct <= 70) classification = 'A';
        else if (pct <= 90) classification = 'B';
        return { ...item, classification };
      });
      return sendJson(res, 200, result);
    }

    if (!pid) {
      // Bulk optimization metrics for all products
      const results = products.map((p, idx) => {
        const C = p['Price'] || p.price || 1;
        const D = computeDemand(idx + 1);
        const H = 0.2 * C;
        const EOQ = Math.sqrt((2 * D * 50) / H);
        const inv = getInventory();
        const item = inv.items.find(i => i.product.id === idx + 1);
        const avgInv = item?.total || 1;
        return {
          productId: idx + 1,
          productName: p['Product Name'] || p.name,
          eoq: Math.round(EOQ),
          annualDemand: D,
          turnoverRatio: Math.round((D / avgInv) * 100) / 100
        };
      });
      return sendJson(res, 200, results);
    }

    const product = products[pid - 1];
    if (!product) return sendJson(res, 404, { error: 'Product not found' });
    const C = product['Price'] || product.price || 1;
    // Single-product demand falls back to 1000 (SQLite uses 1000 here, 100 bulk).
    const D = computeDemand(pid, 1000);
    const S = 50;
    const H = 0.2 * C;
    const EOQ = Math.sqrt((2 * D * S) / H);
    const leadTimeDays = 7;
    const ROP = Math.ceil((D / 365) * leadTimeDays);
    const safetyStock = Math.ceil(Math.sqrt(D) * 0.1);
    const inv = getInventory();
    const item = inv.items.find(i => i.product.id === Number(pid));
    const avgInventory = Math.round(item?.total || 1);
    return sendJson(res, 200, {
      EOQ: Math.round(EOQ),
      ROP,
      safetyStock,
      annualDemand: D,
      turnoverRatio: Math.round((D / avgInventory) * 100) / 100,
      avgInventory
    });
  }

  // ================= ANALYTICS =================

  if (req.method === 'GET' && url.startsWith('/api/analytics')) {
    const parts = url.split('?')[0].split('/').filter(Boolean);
    // Valid shapes are /api/analytics/summary and /api/analytics/export/{type}.
    const validAnalyticsPath =
      (parts.length === 3 && parts[2] === 'summary') ||
      (parts.length === 4 && parts[2] === 'export');
    if (!validAnalyticsPath) {
      return sendJson(res, 404, { error: 'Not found' });
    }

    if (parts[2] === 'summary') {
      const products = readJSON(productsFile) || [];
      const inv = getInventory();
      const movements = readJSON(movementsFile) || [];
      const orders = readJSON(orderFile) || [];        const totalProducts = products.filter(isProductActive).length;
        const totalStock = inv.items.reduce((sum, i) => sum + i.total, 0);
      // Per-PRODUCT total below the 80-unit threshold — the same definition as
      // the lowStockList table below, so the KPI card and the table agree.
      const lowStockItems = inv.items.filter((i) => i.total < 80).length;
      const totalLocations = inv.locations.length;
      const pendingInquiries = orders.filter(o => o.status === 'pending').length;
      const totalSales = salesTransactions.reduce((sum, s) => sum + s.total_amount, 0);
      const totalMovements = movements.length;
      const activeAlerts = computeAlerts().length;

      const topProducts = inv.items
        .map(i => ({ id: i.product.id, name: i.product.name, stock_value: i.total * (i.product.price || 0) }))
        .sort((a, b) => b.stock_value - a.stock_value)
        .slice(0, 5);

      // Match the SQLite shape: one row per (month, type) with { month, type, count }.
      const monthTypeMap = {};
      movements.forEach(m => {
        const month = (m.created_at || '').substring(0, 7);
        if (!month) return;
        const key = `${month}|${m.type}`;
        if (!monthTypeMap[key]) monthTypeMap[key] = { month, type: m.type, count: 0 };
        monthTypeMap[key].count += 1;
      });
      const monthlyMovements = Object.values(monthTypeMap)
        .sort((a, b) => (b.month + b.type).localeCompare(a.month + a.type))
        .slice(0, 12);

      // ---- Reviewer-required dashboard data (mirrors the SQLite backend
      // exactly so contract parity holds) ----

      // 1. Low-stock items: name + total, sorted ascending.
      const lowStockList = inv.items
        .map(i => ({ id: i.product.id, name: i.product.name, total: i.total }))
        .filter(i => i.total < 80)
        .sort((a, b) => a.total - b.total)
        .slice(0, 20);

      // 2. Available stocks per location.
      const stockByLocation = inv.locations
        .map(loc => ({
          location: loc,
          total: inv.items.reduce((sum, i) => sum + (i.locations[loc] || 0), 0),
        }))
        .sort((a, b) => b.total - a.total);

      // 3. Fast-moving products: top by quantity sold.
      const qtySold = {};
      const valueSold = {};
      salesTransactions.forEach(t => {
        qtySold[t.product_id] = (qtySold[t.product_id] || 0) + t.qty;
        valueSold[t.product_id] = (valueSold[t.product_id] || 0) + t.total_amount;
      });
      const activeProducts = (readJSON(productsFile) || []).filter(isProductActive);
      // Positional ids (idx + 1) — the JSON file has no id column, and the
      // SQLite backend numbers products the same way, so parity holds.
      const fastMovingProducts = activeProducts
        .map((p, idx) => ({ id: idx + 1, name: p['Product Name'] || p.name, qty_sold: qtySold[idx + 1] || 0, value: valueSold[idx + 1] || 0 }))
        .sort((a, b) => b.qty_sold - a.qty_sold)
        .slice(0, 5);

      // 4. Slow-moving products: bottom by quantity sold.
      const slowMovingProducts = activeProducts
        .map((p, idx) => ({ id: idx + 1, name: p['Product Name'] || p.name, qty_sold: qtySold[idx + 1] || 0 }))
        .sort((a, b) => a.qty_sold - b.qty_sold || (a.name || '').localeCompare(b.name || ''))
        .slice(0, 5);

      // 5. Daily sales value, last 7 days (dedup per date, matches SQLite GROUP BY).
      const dayMap = {};
      const sevenDaysAgo = Date.now() - 7 * 86400000;
      salesTransactions
        .filter(t => new Date(t.transaction_date).getTime() >= sevenDaysAgo)
        .forEach(t => {
          const date = (t.transaction_date || '').substring(0, 10);
          if (!date) return;
          if (!dayMap[date]) dayMap[date] = { date, value: 0 };
          dayMap[date].value += t.total_amount;
        });
      const dailySalesValue = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

      // 6. Number of transactions + customers served.
      const transactionCount = salesTransactions.length;
      const customersServed = new Set(salesTransactions.map(t => t.customer_name).filter(Boolean)).size;

      // 7. Order status summary (incl. the new 'delivered' state).
      const orderStatusSummary = { pending: 0, approved: 0, rejected: 0, fulfilled: 0, delivered: 0 };
      orders.forEach(o => { if (orderStatusSummary[o.status] !== undefined) orderStatusSummary[o.status] += 1; });

      return sendJson(res, 200, {
        totalProducts, totalStock, lowStockItems, totalLocations,
        pendingInquiries, totalSales, totalMovements, activeAlerts,
        topProducts, monthlyMovements,
        lowStockList, stockByLocation, fastMovingProducts, slowMovingProducts,
        dailySalesValue, transactionCount, customersServed, orderStatusSummary
      });
    }

    if (parts[2] === 'export') {
      return requireAuth(req, res, true, (req, res) => {
        const type = parts[3];
        const format = new URL(url, 'http://localhost').searchParams.get('format') || 'json';
        let data = [];
        if (type === 'products') data = (readJSON(productsFile) || []).filter(isProductActive).map(formatProduct);
        else if (type === 'inventory') {
          const inv = getInventory();
          inv.items.forEach(item => inv.locations.forEach(loc => {
            data.push({ product: item.product.name, location: loc, quantity: item.locations[loc] || 0 });
          }));
        } else if (type === 'movements') data = readJSON(movementsFile) || [];
        else return sendJson(res, 404, { error: 'Export type not found. Use: products, inventory, movements' });

        if (format === 'csv') {
          const headers = Object.keys(data[0] || {}).join(',');
          const rows = data.map(row => Object.values(row).map(v => `"${v}"`).join(',')).join('\n');
          res.writeHead(200, {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename=${type}-${Date.now()}.csv`
          });
          return res.end(`${headers}\n${rows}`);
        }
        return sendJson(res, 200, data);
      });
    }

    return sendJson(res, 404, { error: 'Not found' });
  }

  // ================= SALES =================

  if (req.method === 'GET' && url.split('?')[0] === '/api/sales') {
    return requireAuth(req, res, false, (req, res) => {
      const parsed = new URL(url, 'http://localhost');
      const page = parsed.searchParams.get('page');
      const limit = parsed.searchParams.get('limit');
      const products = readJSON(productsFile) || [];
      const enriched = salesTransactions.map(s => ({
        ...s,
        product_name: (products[s.product_id - 1] && (products[s.product_id - 1]['Product Name'] || products[s.product_id - 1].name)) || ''
      }));
      if (page !== null || limit !== null) {
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
        const offset = (pageNum - 1) * limitNum;
        return sendJson(res, 200, {
          data: enriched.slice(offset, offset + limitNum),
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: enriched.length,
            totalPages: Math.ceil(enriched.length / limitNum)
          }
        });
      }
      return sendJson(res, 200, enriched);
    });
  }

  if (req.method === 'POST' && url === '/api/sales') {
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
        // Mirror the SQLite validate() schema: qty must be a positive number
        // and product_id a positive integer (a NaN/negative qty would corrupt
        // the recorded total, and inactive products must not be sold).
        const saleQty = Number(obj.qty);
        const salePid = Number(obj.product_id);
        if (!Number.isFinite(saleQty) || saleQty <= 0) {
          return sendJson(res, 400, { error: 'Validation failed', details: ['qty must be a positive number'] });
        }
        // Mirror the SQLite validate(): reject non-numeric ids with 400, but
        // let fractional ids fall through to the product lookup (which 404s,
        // exactly like SQLite's `WHERE id = ?` with no matching row).
        if (Number.isNaN(salePid) || salePid < 1) {
          return sendJson(res, 400, { error: 'Validation failed', details: ['product_id must be a positive number'] });
        }
        const products = readJSON(productsFile) || [];
        const p = products[salePid - 1];
        if (!p || !isProductActive(p)) return sendJson(res, 404, { error: 'Product not found or inactive' });
        const total = saleQty * (p['Price'] || p.price || 0);
        salesTransactions.push({
          id: nextSaleId++,
          product_id: salePid,
          qty: saleQty,
          unit_price: p['Price'] || p.price || 0,
          total_amount: total,
          transaction_date: new Date().toISOString(),
          customer_name: obj.customer_name || 'anonymous'
        });
        if (useFirestore) writeJSON('@sales', salesTransactions);
        return sendJson(res, 201, { ok: true, total });
      });
    });
  }

  // ================= USERS & ALERTS =================

  if (req.method === 'GET' && url.split('?')[0] === '/api/users') {
    return requireAuth(req, res, true, (req, res) => {
      return sendJson(res, 200, users.map(u => ({ id: u.id, username: u.username, role: u.role, email: u.email, email_verified: u.email_verified !== false, created_at: u.created_at })));
    });
  }

  // Promote a customer to admin (admin-only). The public register endpoint
  // hardcodes role 'customer', so a customer can never self-promote.
  if (req.method === 'POST' && url.split('?')[0] === '/api/admin/promote') {
    return requireAuth(req, res, true, (req, res) => {
      return parseBody(req, (err, obj) => {
        if (err) return bodyError(res, err);
        if (!obj.username) return sendJson(res, 400, { error: 'Validation failed', details: ['username is required'] });
        if (String(obj.username).length > 50) return sendJson(res, 400, { error: 'Validation failed', details: ['username must be at most 50 characters'] });
        const user = users.find(u => u.username === obj.username);
        if (!user || user.role !== 'customer') return sendJson(res, 404, { error: 'Customer not found or already an admin' });
        user.role = 'admin';
        if (useFirestore) writeJSON('@users', users);
        return sendJson(res, 200, { ok: true, user: { id: user.id, username: user.username, role: user.role, email: user.email } });
      });
    });
  }

  if (req.method === 'GET' && url.split('?')[0] === '/api/alerts') {
    return requireAuth(req, res, false, (req, res) => {
      const status = new URL(url, 'http://localhost').searchParams.get('status') || 'active';
      // resolved_at is null for open alerts (SQLite returns null); Firestore
      // maps null → '' in storage, so normalize both back to null for parity.
      const list = alerts
        .filter(a => a.status === status)
        .map(a => ({ ...a, resolved_at: a.resolved_at === undefined || a.resolved_at === '' ? null : a.resolved_at }));
      return sendJson(res, 200, list);
    });
  }

  if (req.method === 'PUT' && url.startsWith('/api/alerts/') && url.split('?')[0].endsWith('/resolve') && url.split('?')[0].split('/').length === 5) {
    return requireAuth(req, res, true, (req, res) => {
      const id = Number(url.split('?')[0].split('/')[3]);
      const alert = computeAlerts().find(a => a.id === id);
      if (!alert) return sendJson(res, 404, { error: 'Alert not found or already resolved' });
      alert.status = 'resolved';
      alert.resolved_at = new Date().toISOString();
      if (useFirestore) writeJSON('@alerts', alerts);
      return sendJson(res, 200, { ok: true, message: 'Alert resolved' });
    });
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  // Product photos: /images/<file> serves the image library committed under
  // backend/images (the product `image` field holds '/images/...'). Not an
  // /api path, so the route<->spec audit ignores it; traversal is blocked by
  // resolving within the images directory.
  if (req.method === 'GET' && url.split('?')[0].startsWith('/images/')) {
    const imagesDir = path.join(__dirname, '..', 'images');
    const file = url.split('?')[0].slice('/images/'.length);
    const safe = path.normalize(path.join(imagesDir, file));
    if (!safe.startsWith(imagesDir + path.sep) && safe !== imagesDir) {
      return sendJson(res, 403, { error: 'Forbidden' });
    }
    if (!fs.existsSync(safe) || !fs.statSync(safe).isFile()) {
      return sendJson(res, 404, { error: 'Not found' });
    }
    res.writeHead(200, { 'Content-Type': 'image/' + (path.extname(safe).slice(1) === 'jpg' ? 'jpeg' : path.extname(safe).slice(1)) });
    return fs.createReadStream(safe).pipe(res);
  }

  res.end(JSON.stringify({ error: 'Not found' }));
});

function createServer(port = process.env.PORT || 4001) {
  // In Firestore mode the cloud cache must be loaded (and seeded) before any
  // request can be served — that happens inside start(), so guard against
  // calling createServer() directly and serving an empty cache.
  if (useFirestore && !store.isReady()) {
    throw new Error(
      'Firestore store is not initialized — use start() (which awaits store.init()) instead of createServer().'
    );
  }
  return server.listen(port);
}

// Firestore mode needs an async init (load the cloud cache) before any
// request can be served; JSON mode is fully synchronous as before. In JSON
// mode bootstrap() already ran at module load, so calling start() there is a
// harmless no-op re-seed (every step is guarded).
async function start(port) {
  if (useFirestore) await store.init();
  bootstrap();
  return createServer(port);
}

if (require.main === module) {
  start()
    .then(() => console.log(`[${DB_DRIVER}] npm-free backend running on ${process.env.PORT || 4001}`))
    .catch(err => {
      console.error(`[firestore] failed to start: ${err.message}`);
      console.error('Check your Firebase env vars (see README "Firebase (Firestore)" section).');
      process.exit(1);
    });
}

module.exports = { createServer, start, resolveDriver, firestoreConfigured };

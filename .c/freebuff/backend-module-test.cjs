// Critical-path backend smoke test.
// Starts the npm-free backend on an EPHEMERAL port (0) against an ISOLATED
// temp data dir and exercises only the highest-value endpoints as a real
// HTTP client: public catalog, auth (login + register + logout), per-role
// scoping, admin dashboard feeds. Prints PASS/FAIL per endpoint and a final
// tally. Stops on the first failure so the failing endpoint is easy to spot.
//
// TEST-ONLY SAFETY PROPERTIES:
//  - Never touches backend/data: INVENTRAK_DATA_DIR points at a fresh temp
//    dir (products.json seed is COPIED in read-only); every write the test
//    induces (inquiries, registrations) lands in the temp dir.
//  - The seeded demo credentials only exist inside this in-memory instance;
//    they are rejected on production servers where DISABLE_DEMO_ACCOUNTS=true
//    (see backend/src/demo-accounts.js). The test refuses to run with that
//    guard enabled instead of failing with confusing 401s.
//  - Response bodies are REDACTED before logging (tokens, secrets, PII), so
//    a failure can never leak credentials into CI logs.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------------------------------------------------------------------------
// Server-module resolution (review fix: no more cwd-relative path guesses).
// Order: explicit env override -> walk up from this script's own directory
// (stable regardless of cwd) -> fail with an actionable message.
// ---------------------------------------------------------------------------
function findServerModule() {
  const override = process.env.INVENTRAK_SERVER_MODULE;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`INVENTRAK_SERVER_MODULE is set but the file does not exist: ${override}`);
    }
    return path.resolve(override);
  }
  const tried = [];
  let dir = __dirname;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, 'backend', 'src', 'server_npmfree.js');
    tried.push(candidate);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not locate backend/src/server_npmfree.js. Tried:\n  ' +
    tried.join('\n  ') +
    '\nSet INVENTRAK_SERVER_MODULE to the absolute path of the server module.'
  );
}

const serverModulePath = findServerModule();

// ---------------------------------------------------------------------------
// Test-data isolation (review fix: scope the test to its own data store).
// Must happen BEFORE requiring the server module — store-json.js captures
// INVENTRAK_DATA_DIR at module load. Only products.json (the read-only
// catalog seed) is copied in; everything else starts clean and any writes
// the test induces stay in the temp dir.
// ---------------------------------------------------------------------------
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventrak-smoke-'));
const seedSource = path.join(path.dirname(serverModulePath), '..', 'data', 'products.json');
if (fs.existsSync(seedSource)) {
  fs.copyFileSync(seedSource, path.join(testDataDir, 'products.json'));
} else {
  console.warn('[smoke] no products.json seed found — catalog checks will run against an empty catalog');
}
process.env.INVENTRAK_DATA_DIR = testDataDir;

// Review guard: the seeded demo logins this test depends on are disabled in
// production-like environments — refuse to run rather than fail confusingly.
if (process.env.DISABLE_DEMO_ACCOUNTS === 'true') {
  console.error('[smoke] DISABLE_DEMO_ACCOUNTS=true — the seeded demo logins this test uses are disabled.');
  console.error('[smoke] Run against a test instance without that guard, or seed dedicated test users.');
  process.exit(3);
}

const http = require('http');
const origCreateServer = http.createServer;
let realServer = null;
http.createServer = function(...a) {
  realServer = origCreateServer.apply(this, a);
  return realServer;
};
const { start } = require(serverModulePath);

// ---------------------------------------------------------------------------
// Graceful shutdown (review fix: no abrupt process.exit with live sockets).
// Node >= 19 keeps keep-alive sockets in the global agent; those hold server
// connections open and stall close(). Destroy the agent, drop idle server
// sockets, then close with a hard 3s deadline so the runner can never hang.
// ---------------------------------------------------------------------------
let closing = false;
function shutdown(code) {
  if (closing) return;
  closing = true;
  try { http.globalAgent.destroy(); } catch {}
  try { if (realServer && realServer.closeIdleConnections) realServer.closeIdleConnections(); } catch {}
  try {
    realServer.close(() => process.exit(code));
  } catch {
    process.exit(code);
  }
  setTimeout(() => process.exit(code), 3000).unref();
}

const port = () => realServer.address().port;
const get = (pathname, token) => new Promise((resolve, reject) => {
  const req = http.get('http://localhost:' + port() + pathname, { headers: token ? { Authorization: 'Bearer ' + token } : {} }, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      let body = d;
      try { body = JSON.parse(d); } catch {}
      resolve({ status: res.statusCode, body });
    });
  });
  req.on('error', reject);
  req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
});
const post = (pathname, body, token) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body || {});
  const req = http.request('http://localhost:' + port() + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  }, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      let b = d;
      try { b = JSON.parse(d); } catch {}
      resolve({ status: res.statusCode, body: b });
    });
  });
  req.on('error', reject);
  req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  req.end(data);
});

// Review fix: REDACT sensitive values before anything reaches the console.
// Tokens are bearer credentials, emails/phones are PII, hashes/secrets must
// never appear in persisted CI logs.
const SENSITIVE_KEY = /pass|secret|token|hash|auth|code|email|phone|bearer/i;
function maskValue(v) {
  if (v && typeof v === 'object' && v.username) return v.username + '/' + v.role;
  return '***';
}
function summarize(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body.slice(0, 80);
  if (typeof body !== 'object') return String(body).slice(0, 80);
  const keys = Object.keys(body);
  if (keys.length === 0) return '(empty)';
  const parts = [];
  for (const k of keys.slice(0, 3)) {
    const v = SENSITIVE_KEY.test(k) ? '***' : maskValue(body[k]);
    parts.push(k + '=' + String(v).slice(0, 24));
  }
  return '{' + parts.join(' ') + (keys.length > 3 ? ' ...' : '') + '}';
}

const run = async () => {
  const results = [];
  let failed = false;

  const check = async (label, fn) => {
    if (failed) return;
    try {
      const r = await fn();
      const ok = r.status >= 200 && r.status < 400;
      results.push({ label, status: r.status, ok, body: r.body });
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + ' [' + r.status + '] ' + summarize(r.body));
      if (!ok) failed = true;
    } catch (e) {
      results.push({ label, status: 'ERR', ok: false, body: String(e.message).slice(0, 200) });
      console.log('FAIL ' + label + ' [ERR] ' + String(e.message).slice(0, 200));
      failed = true;
    }
  };

  // --- AUTH: the capstone's gatekeeping surface ---
  console.log('--- AUTH ---');
  let adminToken = null, custToken = null, staffToken = null;

  const login = async (label, username, password) => {
    const r = await post('/api/auth/login', { username, password });
    const ok = r.status >= 200 && r.status < 400;
    results.push({ label, status: r.status, ok, body: r.body });
    console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + ' [' + r.status + '] ' + summarize(r.body));
    if (!ok) failed = true;
    return r;
  };

  const adminLogin = await login('AUTH admin login', 'admin', 'admin123');
  adminToken = (adminLogin.body && adminLogin.body.token) || null;
  const custLogin = await login('AUTH customer login', 'customer', 'customer123');
  custToken = (custLogin.body && custLogin.body.token) || null;
  const staffLogin = await login('AUTH staff login', 'staff', 'staff123');
  staffToken = (staffLogin.body && staffLogin.body.token) || null;

  // Auth error case: must be 401 with the GENERIC message (no oracle about
  // which credential was wrong — an OWASP requirement the API holds).
  const wrongPw = await post('/api/auth/login', { username: 'admin', password: 'WRONG' });
  const genericError = wrongPw.status === 401 &&
    typeof (wrongPw.body && wrongPw.body.error) === 'string' &&
    /invalid username or password/i.test(wrongPw.body.error);
  results.push({ label: 'AUTH wrong password => generic error', status: wrongPw.status, ok: genericError, body: wrongPw.body });
  console.log((genericError ? 'PASS' : 'FAIL') + ' AUTH wrong password => generic error [' + wrongPw.status + '] ' + summarize(wrongPw.body));
  if (!genericError) failed = true;

  // --- PUBLIC: catalog + infra ---
  check('HEALTH /api/health (public liveness probe)', () => get('/api/health'));
  check('DOCS /api/openapi.json (Swagger source)', () => get('/api/openapi.json'));
  check('PRODUCTS list (public catalog)', () => get('/api/products?limit=3'));
  check('PRODUCTS categories (public)', () => get('/api/products/categories'));
  check('LOCATIONS list (public)', () => get('/api/locations'));
  check('INVENTORY levels (public)', () => get('/api/inventory'));

  // --- AUTH: register + logout (full lifecycle) ---
  const register = await post('/api/auth/register', {
    username: 'testr_' + Date.now(),
    password: 'StrongPass1!',
    email: 'testr_' + Date.now() + '@example.com',
    phone: '09171234567',
  });
  results.push({ label: 'AUTH register new user (verification email/log)', status: register.status, ok: register.status >= 200 && register.status < 400, body: register.body });
  console.log((register.status >= 200 && register.status < 400 ? 'PASS' : 'FAIL') + ' AUTH register new user [' + register.status + '] ' + summarize(register.body));
  if (!(register.status >= 200 && register.status < 400)) failed = true;

  // Place a dummy order inquiry as the customer so the notification path
  // (notifyInquiryStatus) has something to send through in a real flow.
  if (custToken) {
    const inquiry = await post('/api/order-inquiries', {
      customer_name: 'Test Customer',
      customer_email: 'testcust@example.com',
      customer_phone: '09171234567',
      product_ids: [1],
      shipping_method: 'pickup',
      payment_method: 'cod',
      shipping_address: 'Test address',
      notes: 'test notification path',
    }, custToken);
    results.push({ label: 'ORDERS create inquiry (customer)', status: inquiry.status, ok: inquiry.status >= 200 && inquiry.status < 400, body: inquiry.body });
    console.log((inquiry.status >= 200 && inquiry.status < 400 ? 'PASS' : 'FAIL') + ' ORDERS create inquiry (customer) [' + inquiry.status + '] ' + summarize(inquiry.body));
    if (!(inquiry.status >= 200 && inquiry.status < 400)) failed = true;
  }

  // --- PER-ROLE SCOPING: the security-critical path ---
  if (adminToken) {
    check('ALERTS list (admin only)', () => get('/api/alerts', adminToken));
    check('ORDER-INQUIRIES list (admin sees all)', () => get('/api/order-inquiries', adminToken));
    check('ANALYTICS summary (admin dashboard)', () => get('/api/analytics/summary', adminToken));
    check('SALES ledger (admin only)', () => get('/api/sales', adminToken));
    check('INTEGRITY /api/health/integrity (admin)', () => get('/api/health/integrity', adminToken));
    check('STOCK-ADJUSTMENTS list (admin)', () => get('/api/stock-adjustments', adminToken));
    check('STOCK-TRANSFERS list (admin)', () => get('/api/stock-transfers', adminToken));
    check('APPROVALS list (admin)', () => get('/api/approvals', adminToken));
    check('REPORTS printable (admin)', () => get('/api/reports', adminToken));
    check('USER MANAGEMENT list (admin only)', () => get('/api/users', adminToken));
    check('CACHE STATS (admin only)', () => get('/api/cache/stats', adminToken));
    const logout = await post('/api/auth/logout', {}, adminToken);
    results.push({ label: 'AUTH logout (admin, session revoked)', status: logout.status, ok: logout.status >= 200 && logout.status < 400, body: logout.body });
    console.log((logout.status >= 200 && logout.status < 400 ? 'PASS' : 'FAIL') + ' AUTH logout (admin) [' + logout.status + '] ' + summarize(logout.body));
    if (!(logout.status >= 200 && logout.status < 400)) failed = true;
    // After logout, the same token should be dead.
    const afterLogout = await get('/api/alerts', adminToken);
    results.push({ label: 'AUTH token dead after logout (403 expected)', status: afterLogout.status, ok: afterLogout.status === 403, body: afterLogout.body });
    console.log((afterLogout.status === 403 ? 'PASS' : 'FAIL') + ' AUTH token dead after logout [' + afterLogout.status + '] ' + summarize(afterLogout.body));
    if (afterLogout.status !== 403) failed = true;
  }

  if (custToken) {
    check('ORDER-INQUIRIES list (customer sees only own)', () => get('/api/order-inquiries', custToken));
    const deniedCache = await get('/api/cache/stats', custToken);
    results.push({ label: 'AUTH customer denied cache stats (403 expected)', status: deniedCache.status, ok: deniedCache.status === 403, body: deniedCache.body });
    console.log((deniedCache.status === 403 ? 'PASS' : 'FAIL') + ' AUTH customer denied cache stats [' + deniedCache.status + '] ' + summarize(deniedCache.body));
    if (deniedCache.status !== 403) failed = true;
    const deniedUsers = await get('/api/users', custToken);
    results.push({ label: 'AUTH customer denied /api/users (403 expected)', status: deniedUsers.status, ok: deniedUsers.status === 403, body: deniedUsers.body });
    console.log((deniedUsers.status === 403 ? 'PASS' : 'FAIL') + ' AUTH customer denied /api/users [' + deniedUsers.status + '] ' + summarize(deniedUsers.body));
    if (deniedUsers.status !== 403) failed = true;
  }

  if (staffToken) {
    // The endpoint validates the payload BEFORE running the OCR engine, so a
    // staff call with an empty image correctly 400s (validation) — proving the
    // ROLE GATE let them through. A customer is role-blocked with 403 before
    // validation ever runs. (Matches backend/test/staff-roles.test.js.)
    const staffScan = await post('/api/ocr/stock', { image: '' }, staffToken);
    const staffGateOk = staffScan.status === 400;
    results.push({ label: 'OCR/stock staff passes role gate (400=validation)', status: staffScan.status, ok: staffGateOk, body: staffScan.body });
    console.log((staffGateOk ? 'PASS' : 'FAIL') + ' OCR/stock staff passes role gate [' + staffScan.status + '] ' + summarize(staffScan.body));
    if (!staffGateOk) failed = true;
    const deniedUsers = await get('/api/users', staffToken);
    results.push({ label: 'AUTH staff denied /api/users (403 expected)', status: deniedUsers.status, ok: deniedUsers.status === 403, body: deniedUsers.body });
    console.log((deniedUsers.status === 403 ? 'PASS' : 'FAIL') + ' AUTH staff denied /api/users [' + deniedUsers.status + '] ' + summarize(deniedUsers.body));
    if (deniedUsers.status !== 403) failed = true;
  }

  // --- FINAL TALLY ---
  const passed = results.filter(r => r.ok).length;
  const total = results.length;
  console.log('\n' + passed + ' passed / ' + (total - passed) + ' failed (out of ' + total + ')');
  shutdown(failed ? 1 : 0);
};

// start(0) binds an ephemeral port — deterministic isolation from anything
// else running on this machine (no hardcoded port to collide with).
start(0).then(() => {
  console.log('Backend listening on ephemeral port', port(), '(module under test)');
  console.log('[smoke] data dir (isolated):', testDataDir);
  run().catch(e => { console.error('test runner failed:', e); shutdown(1); });
}).catch(e => { console.error('start failed:', e.message); process.exit(1); });

// Watchdog: if anything wedges, shut down gracefully instead of hanging CI.
setTimeout(() => { console.error('TIMEOUT'); shutdown(2); }, 60000);

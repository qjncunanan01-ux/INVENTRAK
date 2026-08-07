// End-to-end lock on the hashing guarantee for the CLOUD path: register a
// user on the npm-free server running in Firestore mode (against the strict
// in-process fake Firestore), then verify the '@users' row persisted to the
// cloud store is a bcrypt hash — never the plaintext — and that login
// verifies against that stored hash. The fake Firestore throws on nulls and
// undefined exactly like the real SDK, so a driver bug here would fail loudly
// instead of silently corrupting the cloud.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// --- Isolate BEFORE requiring the server (it reads env at module load) ---
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'inventrak-fs-auth-'));
process.env.INVENTRAK_DATA_DIR = tmpData;
fs.writeFileSync(path.join(tmpData, 'products.json'), JSON.stringify([
  { 'Product Name': 'Demo Sauce', 'Category': 'Sauces', 'Brand': 'Demo', 'Price': 120 },
]));
fs.writeFileSync(path.join(tmpData, 'order_inquiries.json'), '[]');
fs.writeFileSync(path.join(tmpData, 'stock_movements.json'), '[]');
process.env.DB_DRIVER = 'firestore';

const { makeFakeDb } = require('./fake-firestore');
const fsStore = require('../store-firestore');
const { isHashed, verifyPassword } = require('../password-hash');

// Inject the fake cloud BEFORE the server boots, so store.init() hydrates
// from it instead of requiring Firebase credentials.
const fake = makeFakeDb();
fsStore._setDb(fake);

const { start } = require('../server_npmfree');

let server;
let baseUrl;

const PASSWORD = 'Cloud$Pass1';

// Register the shared user once so every test is self-contained (no test
// depends on another having run first) — the login test logs in as this user,
// and the register test registers its OWN user to inspect a fresh row.
before(async () => {
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'cloud_user', password: PASSWORD, email: 'cloud@test.com', phone: '09171234567' }),
  });
  if (res.status !== 200) throw new Error(`shared user registration failed: ${res.status}`);
});

after(() => {
  try { server && server.close(); } catch {}
  fs.rmSync(tmpData, { recursive: true, force: true });
});

// Reads a row straight from the PERSISTED Firestore collection (the cloud
// truth), after letting the store's async write queue settle.
function persistedUser(username) {
  return [...fake._cols.get('users').values()].find((d) => d.username === username);
}

test('register persists a bcrypt hash in the Firestore @users row (never plaintext)', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'cloud_user_reg', password: PASSWORD, email: 'reg@test.com', phone: '09171234567' }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(body.token, 'register issues a token');
  assert.strictEqual(body.user.username, 'cloud_user_reg');
  assert.strictEqual(body.user.role, 'customer');

  await fsStore.flush();
  const stored = persistedUser('cloud_user_reg');
  assert.ok(stored, 'cloud users collection holds the registered row');
  assert.notStrictEqual(stored.password, PASSWORD, 'the plaintext password is never stored');
  assert.ok(!stored.password.includes(PASSWORD), 'the plaintext never appears inside the stored value');
  assert.ok(isHashed(stored.password), 'stored value is a bcrypt hash');
  assert.match(stored.password, /^\$2[aby]\$10\$/, 'bcrypt hash with 10 rounds');
  // The stored hash actually verifies the original password (login depends on this).
  assert.deepStrictEqual(verifyPassword(PASSWORD, stored.password), { ok: true, needsRehash: false });
});

test('login verifies against the bcrypt hash stored in the cloud', async () => {
  // Correct password: verified against the cloud-stored hash, not plaintext.
  const ok = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'cloud_user', password: PASSWORD }),
  });
  assert.strictEqual(ok.status, 200);
  const okBody = await ok.json();
  assert.ok(okBody.token, 'login issues a token');
  assert.strictEqual(okBody.user.username, 'cloud_user');

  // Wrong password: rejected with the standard 401 (one attempt — far below
  // the 5-strike brute-force lockout threshold).
  const bad = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'cloud_user', password: 'WrongPass1!' }),
  });
  assert.strictEqual(bad.status, 401);
  const badBody = await bad.json();
  assert.strictEqual(badBody.error, 'Invalid username or password');
});

test('register is salted per user even with the same password (cloud rows differ)', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'cloud_user_salt', password: PASSWORD, email: 'salt@test.com', phone: '09171234567' }),
  });
  assert.strictEqual(res.status, 200);
  await fsStore.flush();

  const hashes = ['cloud_user', 'cloud_user_reg', 'cloud_user_salt'].map((u) => {
    const row = persistedUser(u);
    assert.ok(row, `${u} exists in the cloud`);
    return row.password;
  });
  assert.ok(new Set(hashes).size === 3, 'each registration gets a distinct salted hash');
  assert.ok(hashes.every((h) => isHashed(h)), 'all cloud rows hold hashes');
});

test('demo users are seeded as bcrypt hashes in Firestore mode (boot path)', async () => {
  await fsStore.flush();
  const admin = persistedUser('admin');
  assert.ok(admin, 'demo admin exists in the cloud users collection');
  assert.notStrictEqual(admin.password, 'admin123');
  assert.ok(isHashed(admin.password), 'demo admin is seeded hashed, never plaintext');
  assert.deepStrictEqual(verifyPassword('admin123', admin.password), { ok: true, needsRehash: false });

  // The server's /api/users endpoint must never leak the hash to the wire.
  const login = await (await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })).json();
  const usersRes = await fetch(`${baseUrl}/api/users`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  assert.strictEqual(usersRes.status, 200);
  const users = await usersRes.json();
  assert.ok(users.every((u) => !('password' in u)), 'password hash never leaves the server');
});

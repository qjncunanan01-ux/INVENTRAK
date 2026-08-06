// Tests for the password re-hash migration (hash-passwords.js) and the
// login-time legacy-plaintext upgrade on BOTH backends:
//   1. migrateSqliteUsers re-hashes plaintext rows (idempotent)
//   2. the SQLite login handler upgrades a legacy row in place
//   3. migrateFirestoreUsers re-hashes the cloud '@users' dataset
//   4. the npm-free server (Firestore mode) upgrades a legacy row on login
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventrak-hash-'));
process.env.INVENTRAK_DB_PATH = path.join(tmpDir, 'legacy.db');

const { isHashed, verifyPassword, hashPassword } = require('../password-hash');
const { migrateSqliteUsers, migrateFirestoreUsers } = require('../hash-passwords');
const { makeFakeDb } = require('./fake-firestore');
const { db } = require('../db');

// Temp SQLite with one legacy plaintext user and one already-hashed user.
db.prepare('INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)')
  .run('legacy', 'plaintextpw', 'customer', 'legacy@example.com');
db.prepare('INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)')
  .run('modern', hashPassword('Modern1!'), 'customer', 'modern@example.com');

after(() => {
  try { db.close(); } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('migrateSqliteUsers re-hashes legacy plaintext and leaves hashes alone', () => {
  const before = db.prepare('SELECT username, password FROM users ORDER BY username').all();
  assert.strictEqual(isHashed(before.find((u) => u.username === 'legacy').password), false);

  const result = migrateSqliteUsers(db);
  assert.strictEqual(result.rehashed, 1);
  assert.strictEqual(result.total, 2);

  const after = db.prepare('SELECT username, password FROM users ORDER BY username').all();
  const legacy = after.find((u) => u.username === 'legacy');
  assert.strictEqual(isHashed(legacy.password), true, 'plaintext became a bcrypt hash');
  assert.strictEqual(verifyPassword('plaintextpw', legacy.password).ok, true, 'original password still works');
  const modern = after.find((u) => u.username === 'modern');
  assert.strictEqual(modern.password, before.find((u) => u.username === 'modern').password, 'already-hashed rows untouched');

  // Idempotent: a second run re-hashes nothing.
  assert.strictEqual(migrateSqliteUsers(db).rehashed, 0);
});

test('SQLite login upgrades a legacy plaintext user in place', async () => {
  db.prepare('INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)')
    .run('late', 'latepw123', 'customer', 'late@example.com');

  const { app } = require('../app');
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'late', password: 'latepw123' }),
    });
    assert.strictEqual(res.status, 200);
  } finally {
    srv.close();
  }

  const row = db.prepare('SELECT password FROM users WHERE username = ?').get('late');
  assert.strictEqual(isHashed(row.password), true, 'login upgraded the legacy row to bcrypt');
  assert.strictEqual(verifyPassword('latepw123', row.password).ok, true);
});

test('seedDatabase creates users as bcrypt hashes (never plaintext)', () => {
  const { seedDatabase } = require('../app');
  // admin/customer do not exist in this temp DB, so seedDatabase inserts them.
  seedDatabase();
  const rows = db
    .prepare("SELECT username, password FROM users WHERE username IN ('admin','customer') ORDER BY username")
    .all();
  assert.strictEqual(rows.length, 2);
  rows.forEach((r) => {
    assert.strictEqual(isHashed(r.password), true, `seeded user ${r.username} is hashed`);
  });
  assert.strictEqual(verifyPassword('admin123', rows[0].password).ok, true);
  assert.strictEqual(verifyPassword('customer123', rows[1].password).ok, true);
});

test('migrateFirestoreUsers re-hashes plaintext rows in the cloud dataset', async () => {
  const store = require('../store-firestore');
  const fake = makeFakeDb();
  store._setDb(fake);
  await store.init();
  store.write('@users', [
    { id: 1, username: 'cloud-legacy', password: 'oldpw', role: 'customer', email: 'a@x.com' },
    { id: 2, username: 'cloud-hashed', password: hashPassword('New1!'), role: 'customer', email: 'b@x.com' },
  ]);
  await store.flush();

  const result = await migrateFirestoreUsers(store);
  assert.strictEqual(result.rehashed, 1);
  const users = store.read('@users');
  const legacy = users.find((u) => u.username === 'cloud-legacy');
  assert.strictEqual(isHashed(legacy.password), true);
  assert.strictEqual(verifyPassword('oldpw', legacy.password).ok, true);
  assert.strictEqual(users.find((u) => u.username === 'cloud-hashed').password.startsWith('$2'), true);
});

test('npm-free server upgrades a legacy plaintext user on login (Firestore mode)', async () => {
  const store = require('../store-firestore');
  const fake = makeFakeDb();
  store._setDb(fake);
  await store.init();
  store.write('@users', [
    { id: 1, username: 'cloud-legacy', password: 'oldpw', role: 'customer', email: 'x@x.com' },
  ]);
  await store.flush();

  process.env.DB_DRIVER = 'firestore';
  const { start } = require('../server_npmfree');
  const srv = await start(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cloud-legacy', password: 'oldpw' }),
    });
    assert.strictEqual(res.status, 200);
  } finally {
    srv.close();
    process.env.DB_DRIVER = 'json';
  }

  const stored = store.read('@users').find((u) => u.username === 'cloud-legacy');
  assert.strictEqual(isHashed(stored.password), true, 'Firestore row upgraded after login');
  assert.strictEqual(verifyPassword('oldpw', stored.password).ok, true);
});

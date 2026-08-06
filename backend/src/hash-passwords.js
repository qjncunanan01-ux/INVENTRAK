// Re-hashes legacy PLAINTEXT user passwords to bcrypt — the "migration that
// re-hashes existing users". Run once after upgrading to the hashed-password
// backends (or any time a store still holds plaintext):
//
//   npm run hash:passwords                 # SQLite backend/data/inventrak.db
//   npm run hash:passwords -- --dry-run    # preview, touch nothing
//   npm run hash:passwords -- --firestore  # the Firebase '@users' dataset
//
// Both stores are also upgraded transparently at login (see password-hash.js),
// so this script is an eager, explicit pass rather than a hard requirement.
// The pure helpers are exported for the unit tests.
const path = require('path');
const { isHashed, hashPassword } = require('./password-hash');

// SQLite: read-hash-update every plaintext user. Returns a summary.
function migrateSqliteUsers(db) {
  const rows = db.prepare('SELECT id, username, password FROM users').all();
  let rehashed = 0;
  const update = db.prepare('UPDATE users SET password = ? WHERE id = ?');
  for (const row of rows) {
    if (!isHashed(row.password)) {
      update.run(hashPassword(row.password), row.id);
      rehashed += 1;
    }
  }
  return { total: rows.length, rehashed };
}

// Firestore: upgrade legacy plaintext rows in the '@users' dataset.
async function migrateFirestoreUsers(store) {
  const users = store.read('@users');
  if (!Array.isArray(users) || users.length === 0) {
    return { total: 0, rehashed: 0 };
  }
  let rehashed = 0;
  const next = users.map((u) => {
    if (u && u.password !== undefined && !isHashed(u.password)) {
      rehashed += 1;
      return { ...u, password: hashPassword(u.password) };
    }
    return u;
  });
  if (rehashed > 0) {
    store.write('@users', next);
    await store.flush();
  }
  return { total: users.length, rehashed };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const useFirestore = argv.includes('--firestore') || process.env.DB_DRIVER === 'firestore';

  if (useFirestore) {
    const store = require('./store-firestore');
    await store.init();
    const before = store.read('@users') || [];
    if (dryRun) {
      const plain = before.filter((u) => u && u.password !== undefined && !isHashed(u.password)).length;
      console.log(`[dry-run] Firestore '@users': ${before.length} total, ${plain} plaintext (would be re-hashed)`);
      return;
    }
    const result = await migrateFirestoreUsers(store);
    console.log(`Firestore '@users': ${result.total} total, ${result.rehashed} re-hashed`);
    return;
  }

  // SQLite mode.
  const dbPath = process.env.INVENTRAK_DB_PATH || path.join(__dirname, '..', 'data', 'inventrak.db');
  const Database = require('better-sqlite3');
  if (!require('fs').existsSync(dbPath)) {
    console.error(`SQLite database not found: ${dbPath}`);
    process.exit(1);
  }
  const db = new Database(dbPath);
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (!table) {
      console.error(`users table not found in ${dbPath} — is this an INVENTRAK database?`);
      process.exit(1);
    }
    if (dryRun) {
      const total = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
      const plaintext = db.prepare('SELECT password FROM users').all().filter((r) => !isHashed(r.password)).length;
      console.log(`[dry-run] ${dbPath}: ${total} users, ${plaintext} plaintext (would be re-hashed)`);
      return;
    }
    const result = migrateSqliteUsers(db);
    console.log(`${dbPath}: ${result.total} users, ${result.rehashed} re-hashed`);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Password migration failed:', err && err.message);
      process.exit(1);
    });
}

module.exports = { migrateSqliteUsers, migrateFirestoreUsers };

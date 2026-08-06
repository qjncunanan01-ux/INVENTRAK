// Shared password hashing for BOTH backends (SQLite app.js and the npm-free
// server) — one module, one scheme, so contract parity is guaranteed by
// construction instead of by convention.
//
// Scheme: bcrypt (bcryptjs, pure JS — no native build, works in the
// dependency-free npm-free fallback and in the Docker/alpine image). The
// SQLite backend has hashed with bcrypt since launch; this module now central
// that logic and adds transparent handling of legacy PLAINTEXT rows.
//
// Legacy plaintext: any stored value that does not look like a bcrypt hash is
// treated as a legacy plaintext password. verifyPassword() returns
// { ok, needsRehash } so callers can upgrade the row in place on a successful
// login — that is how existing databases (SQLite or Firestore) get re-hashed
// without forcing a password reset. `npm run hash:passwords` performs the
// same upgrade eagerly for every user at once.
const bcrypt = require('bcryptjs');

const HASH_ROUNDS = 10;

// bcrypt hashes are "$2a$10$..." / "$2b$..." / "$2y$...". Anything else
// (undefined, '', or a legacy plaintext password) is NOT a hash.
function isHashed(stored) {
  return typeof stored === 'string' && /^\$2[aby]\$\d{2}\$/.test(stored);
}

function hashPassword(password) {
  // Guard against silently hashing the literal string "undefined"/"null" if
  // a future caller skips validation.
  if (password === undefined || password === null) {
    throw new Error('hashPassword requires a password');
  }
  return bcrypt.hashSync(String(password), HASH_ROUNDS);
}

// Fixed bcrypt hash used ONLY to equalize response timing on the
// "username not found" login path (see consumeComparisonTime).
const DUMMY_HASH = bcrypt.hashSync('inventrak-dummy-password', HASH_ROUNDS);

// Burns roughly the same CPU as a real bcrypt comparison so that a login for
// a NON-EXISTENT username takes about as long as one for an existing user —
// otherwise response timing leaks which usernames are registered. Both
// backends call this on the not-found path.
function consumeComparisonTime(password) {
  bcrypt.compareSync(String(password), DUMMY_HASH);
}

// Returns { ok, needsRehash }:
//   - stored is a bcrypt hash: ok = bcrypt.compareSync (needsRehash: false)
//   - stored is legacy plaintext: ok = exact match (needsRehash: true only on
//     success, so the row is upgraded right after a successful login)
function verifyPassword(password, stored) {
  if (isHashed(stored)) {
    return { ok: bcrypt.compareSync(String(password), stored), needsRehash: false };
  }
  const ok = stored === String(password);
  return { ok, needsRehash: ok };
}

module.exports = { HASH_ROUNDS, isHashed, hashPassword, verifyPassword, consumeComparisonTime };

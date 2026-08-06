// Unit tests for the shared password-hash module (bcrypt scheme + legacy
// plaintext upgrade detection). Both backends use this module, so verifying
// it here verifies login/register parity by construction.
const { test } = require('node:test');
const assert = require('node:assert');

const { HASH_ROUNDS, isHashed, hashPassword, verifyPassword, consumeComparisonTime } = require('../password-hash');

test('hashPassword produces a bcrypt hash and never the plaintext', () => {
  const hash = hashPassword('Passw0rd!');
  assert.match(hash, /^\$2[aby]\$10\$/, 'bcrypt hash with 10 rounds');
  assert.ok(!hash.includes('Passw0rd!'), 'plaintext never appears in the hash');
  assert.ok(isHashed(hash));
  assert.strictEqual(HASH_ROUNDS, 10);
});

test('verifyPassword accepts the correct password against a bcrypt hash', () => {
  const hash = hashPassword('Passw0rd!');
  const result = verifyPassword('Passw0rd!', hash);
  assert.deepStrictEqual(result, { ok: true, needsRehash: false });
});

test('verifyPassword rejects a wrong password against a bcrypt hash', () => {
  const hash = hashPassword('Passw0rd!');
  assert.deepStrictEqual(verifyPassword('wrong', hash), { ok: false, needsRehash: false });
});

test('verifyPassword recognizes legacy plaintext and flags needsRehash on success', () => {
  assert.deepStrictEqual(verifyPassword('admin123', 'admin123'), { ok: true, needsRehash: true });
  assert.deepStrictEqual(verifyPassword('nope', 'admin123'), { ok: false, needsRehash: false });
});

test('isHashed distinguishes bcrypt hashes from plaintext and empty values', () => {
  assert.strictEqual(isHashed(hashPassword('x')), true);
  assert.strictEqual(isHashed('$2b$10$abcdefghijklmnopqrstuv'), true);
  assert.strictEqual(isHashed('admin123'), false);
  assert.strictEqual(isHashed(''), false);
  assert.strictEqual(isHashed(undefined), false);
  assert.strictEqual(isHashed(null), false);
});

test('each hash is salted (two hashes of the same password differ)', () => {
  assert.notStrictEqual(hashPassword('Passw0rd!'), hashPassword('Passw0rd!'));
});

test('a hash created by the module verifies with bcrypt semantics (migrated-user path)', () => {
  // Simulates a SQLite→Firestore migrated user: the stored value is a bcrypt
  // hash, and the npm-free login must verify it (no plaintext compare).
  const migrated = hashPassword('customer123');
  assert.strictEqual(verifyPassword('customer123', migrated).ok, true);
  assert.strictEqual(verifyPassword('customer123', migrated).needsRehash, false);
});

test('hashPassword guards against hashing undefined/null', () => {
  assert.throws(() => hashPassword(undefined), /requires a password/);
  assert.throws(() => hashPassword(null), /requires a password/);
});

test('consumeComparisonTime runs a dummy bcrypt compare without throwing', () => {
  assert.doesNotThrow(() => consumeComparisonTime('whatever'));
  assert.doesNotThrow(() => consumeComparisonTime(''));
});

// Unit tests for csrf.js — the double-submit CSRF module. The middleware is
// intentionally NOT mounted (Bearer-token auth means no cookie-authenticated
// surface to attack), but the module stays correct for a future cookie
// deployment. These tests lock the validation contract, especially the
// never-throws guarantee: crypto.timingSafeEqual RAISES on length mismatch,
// so a malformed cookie previously surfaced as a 500 instead of a 403.
const { test } = require('node:test');
const assert = require('node:assert');

const { generateToken, validateToken, safeEqualHex } = require('../csrf');

test('generateToken produces a token and matching signed cookie', () => {
  const { token, cookie } = generateToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  const [cookieToken, cookieSig] = cookie.split('.');
  assert.strictEqual(cookieToken, token);
  assert.match(cookieSig, /^[0-9a-f]{64}$/);
  assert.ok(validateToken(token, cookie), 'valid pair must validate');
});

test('validateToken rejects tampered tokens and signatures', () => {
  const { token, cookie } = generateToken();
  const [cookieToken, cookieSig] = cookie.split('.');
  assert.ok(!validateToken('a'.repeat(64), cookie), 'wrong header token');
  assert.ok(!validateToken(token, `${cookieToken}.${'0'.repeat(64)}`), 'forged signature');
  assert.ok(!validateToken(token, cookie.slice(0, -2)), 'truncated cookie');
});

test('validateToken never throws on malformed input (the 500 regression)', () => {
  const { cookie } = generateToken();
  const garbage = [
    ['', '', cookie, 'x', 'x.y', 'zz', 'zz.zz'],
    ['a', 'a.b', cookie, '', 'g'.repeat(3), 'zz'],
  ].flat();
  for (const [h, c] of garbage.map((v, i) => [v, i % 2 ? cookie : 'not-a-token.x'])) {
    assert.doesNotThrow(() => validateToken(h, c));
    assert.ok(typeof validateToken(h, c) === 'boolean');
  }
  assert.ok(!validateToken(undefined, cookie));
  assert.ok(!validateToken('a'.repeat(64), undefined));
  assert.ok(!validateToken(null, null));
});

test('safeEqualHex is constant-time-safe: no throw on any length pair', () => {
  assert.strictEqual(safeEqualHex('aa', 'aa'), true);
  assert.strictEqual(safeEqualHex('aa', 'aaa'), false);
  assert.strictEqual(safeEqualHex('aa', 'bb'), false);
  assert.strictEqual(safeEqualHex('', 'aa'), false);
  assert.strictEqual(safeEqualHex('zz', 'aa'), false, 'non-hex decodes to empty');
  assert.strictEqual(safeEqualHex(undefined, 'aa'), false);
});

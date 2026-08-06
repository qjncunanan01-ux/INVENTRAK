// Unit tests for the shared strong-password policy (backend/src/password-policy.js).
// Both backends enforce these exact rules with these exact messages, so the
// contract suites never diverge on password validation.
const { test } = require('node:test');
const assert = require('node:assert');
const { passwordError, PASSWORD_MIN_LENGTH } = require('../password-policy');

test('password policy: rejects passwords shorter than the minimum', () => {
  assert.match(passwordError('Ab1!'), /at least 8 characters/);
  assert.match(passwordError('Abc12!'), /at least 8 characters/);
});

test('password policy: requires an uppercase letter', () => {
  assert.strictEqual(passwordError('abcdef1!'), 'password must include an uppercase letter');
});

test('password policy: requires a lowercase letter', () => {
  assert.strictEqual(passwordError('ABCDEF1!'), 'password must include a lowercase letter');
});

test('password policy: requires a number', () => {
  assert.strictEqual(passwordError('Abcdefg!'), 'password must include a number');
});

test('password policy: requires a symbol', () => {
  assert.strictEqual(passwordError('Abcdefg1'), 'password must include a symbol (e.g. !@#$%)');
});

test('password policy: accepts a password meeting every rule', () => {
  assert.strictEqual(passwordError('CorrectHorse9!'), null);
  assert.strictEqual(passwordError('Passw0rd!'), null);
});

test('password policy: non-string input is rejected', () => {
  assert.match(passwordError(12345678), /at least 8 characters/);
  assert.match(passwordError(undefined), /at least 8 characters/);
});

test('password policy: minimum length constant is 8', () => {
  assert.strictEqual(PASSWORD_MIN_LENGTH, 8);
});

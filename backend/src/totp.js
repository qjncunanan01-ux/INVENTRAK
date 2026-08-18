// RFC 6238 TOTP (time-based one-time passwords) with zero dependencies —
// built entirely on Node's crypto module. Used for administrator MFA so a
// leaked password alone can never open the admin dashboard.
//
// Compatible with Google Authenticator, Microsoft Authenticator, Authy and
// every standard TOTP app: 6 digits, 30-second step, HMAC-SHA1, base32 secret.
const crypto = require('node:crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

// RFC 4648 base32 encode (no padding) — matches what authenticator apps
// expect when the user types the secret manually.
function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const cleaned = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// Random 20-byte secret (160 bits — RFC 4226's recommended key length),
// base32-encoded for display and authenticator-app entry.
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

// HMAC-SHA1 counter block per RFC 6238.
function hotp(secretBuf, counter) {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

function currentCounter(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

// The code valid right now (used for live tests and display).
function totp(secret, nowMs = Date.now()) {
  return hotp(base32Decode(secret), currentCounter(nowMs));
}

// Verify a code allowing `window` steps of clock drift in each direction
// (default ±1 step = ±30s). Constant-time comparison.
function verifyTOTP(secret, code, window = 1, nowMs = Date.now()) {
  if (!secret || !code) return false;
  const cleaned = String(code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  let secretBuf;
  try {
    secretBuf = base32Decode(secret);
  } catch {
    return false;
  }
  const counter = currentCounter(nowMs);
  for (let i = -window; i <= window; i++) {
    const candidate = hotp(secretBuf, counter + i);
    const a = Buffer.from(cleaned);
    const b = Buffer.from(candidate);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

// otpauth:// URI — scan this QR (or paste into an authenticator app).
function otpauthUrl(secret, account, issuer = 'INVENTRAK') {
  const label = `${issuer}:${account}`;
  return (
    `otpauth://totp/${encodeURIComponent(label)}` +
    `?secret=${encodeURIComponent(secret)}` +
    `&issuer=${encodeURIComponent(issuer)}` +
    `&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
  );
}

// ---- One-time recovery codes (backup for a lost authenticator app) ----
// 10 single-use codes, each 12 chars in 3 groups of 4, from a 32-char
// alphabet WITHOUT ambiguous characters (no 0/O/1/I) — ~60 bits of entropy
// each, so offline guessing is infeasible even if a hash leaks.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_LENGTH = 12;

function generateRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(RECOVERY_LENGTH);
    let raw = '';
    for (let j = 0; j < RECOVERY_LENGTH; j++) {
      raw += RECOVERY_ALPHABET[bytes[j] & 31];
    }
    codes.push(raw.match(/.{1,4}/g).join('-'));
  }
  return codes;
}

// Canonical form for hashing: uppercase, no dashes/spaces. Entry is forgiving
// (lowercase, missing dashes, pasted with spaces — all normalize identically).
function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
}

// True when `code` matches one of the stored hashes. `hashFn` is the caller's
// keyed hash (HMAC with the token secret) so the same scheme protects
// recovery codes and verification codes at rest.
function matchRecoveryCode(storedHashes, code, hashFn) {
  const norm = normalizeRecoveryCode(code);
  if (norm.length !== RECOVERY_LENGTH) return false;
  const hash = hashFn(norm);
  return Array.isArray(storedHashes) && storedHashes.includes(hash);
}

module.exports = {
  generateSecret, totp, verifyTOTP, otpauthUrl, base32Encode, base32Decode,
  generateRecoveryCodes, normalizeRecoveryCode, matchRecoveryCode,
};

/**
 * @module config
 * @description Centralized configuration constants for INVENTRAK backend.
 * Every magic number in the codebase lives here so it can be found, changed,
 * and understood in one place. Import as:
 *   const { LOW_STOCK_THRESHOLD } = require('./config');
 */

// ================= INVENTORY =================

/** Units below which a location entry is considered "low stock". */
const LOW_STOCK_THRESHOLD = 80;

// ================= AUTH =================

/** HMAC-signed token lifetime (ms). Env-tunable so tests can exercise expiry. */
const TOKEN_TTL_MS = Number(process.env.TOKEN_TTL_MS) || 24 * 60 * 60 * 1000;

/** MFA challenge token lifetime (ms) — short-lived so a leaked challenge
 *  can't be replayed into a session later. */
const MFA_TOKEN_TTL_MS = 10 * 60 * 1000;

/** Password reset code lifetime (ms). Env-tunable. */
const RESET_CODE_TTL_MS = Number(process.env.RESET_CODE_TTL_MS) || 30 * 60 * 1000;

/** Signup verification code lifetime (ms). Env-tunable. */
const VERIFICATION_CODE_TTL_MS = Number(process.env.VERIFICATION_CODE_TTL_MS) || 30 * 60 * 1000;

// ================= RATE LIMITING =================

/** Max failed login attempts before the account is locked out. */
const MAX_LOGIN_ATTEMPTS = 5;

/** Lockout duration after max failed attempts (seconds). */
const LOCKOUT_DURATION_SECONDS = 300;

// ================= HTTP =================

/** Max request body size for normal JSON endpoints (bytes). */
const MAX_BODY_BYTES = 100 * 1024;

/** Max request body size for OCR endpoints (base64 images can be large). */
const MAX_OCR_BODY_BYTES = 12 * 1024 * 1024;

/** Cache-Control header for read-heavy GET endpoints (products, categories, inventory). */
const READ_CACHE_TTL = 'public, max-age=300, stale-while-revalidate=60';

// ================= BULK OPERATIONS =================

/** Max entries allowed in a single bulk price update request. */
const BULK_PRICES_MAX_ENTRIES = 2000;

/** Max product name length (matches SQLite validation schema). */
const PRODUCT_NAME_MAX_LENGTH = 200;

// ================= PAGINATION =================

/** Default page size for paginated endpoints. */
const DEFAULT_PAGE_SIZE = 50;

/** Maximum page size allowed for paginated endpoints. */
const MAX_PAGE_SIZE = 100;

module.exports = {
  LOW_STOCK_THRESHOLD,
  TOKEN_TTL_MS,
  MFA_TOKEN_TTL_MS,
  RESET_CODE_TTL_MS,
  VERIFICATION_CODE_TTL_MS,
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_SECONDS,
  MAX_BODY_BYTES,
  MAX_OCR_BODY_BYTES,
  READ_CACHE_TTL,
  BULK_PRICES_MAX_ENTRIES,
  PRODUCT_NAME_MAX_LENGTH,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
};

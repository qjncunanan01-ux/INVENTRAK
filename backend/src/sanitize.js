/**
 * Input sanitization — prevents XSS and injection in user-generated content.
 * Both backends (SQLite app.js and npm-free server_npmfree.js) import this.
 */

/**
 * Strip HTML tags and dangerous characters from user input.
 * Returns a plain string safe for storage and display.
 */
function stripHtml(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/<[^>]*>/g, '')           // strip all HTML tags
    .replace(/&/g, '&amp;')            // encode ampersands
    .replace(/"/g, '&quot;')           // encode double quotes
    .replace(/'/g, '&#x27;')           // encode single quotes
    .replace(/\//g, '&#x2F;')          // encode forward slashes
    .trim();
}

/**
 * Recursively sanitize all string values in an object or array.
 * Leaves numbers, booleans, and nulls untouched.
 */
function sanitizeObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return stripHtml(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    clean[key] = sanitizeObject(val);
  }
  return clean;
}

/**
 * Validate that a string looks like a reasonable name (no scripts, no special chars).
 */
function isValidName(name) {
  if (typeof name !== 'string') return false;
  // Allow letters, numbers, spaces, hyphens, periods, parentheses, ampersands, slashes, quotes
  return /^[A-Za-z0-9\s\-().&'/À-ÿ]+$/.test(name) && name.length >= 1 && name.length <= 500;
}

/**
 * Validate email format.
 */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/**
 * Validate phone number format (E.164-ish).
 */
function isValidPhone(phone) {
  if (typeof phone !== 'string') return false;
  return /^\+?[0-9\s\-()]{7,20}$/.test(phone);
}

module.exports = { stripHtml, sanitizeObject, isValidName, isValidEmail, isValidPhone };

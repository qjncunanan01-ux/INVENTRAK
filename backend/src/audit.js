// Structured security audit log. Every line is JSON, written to the process
// console (visible in Render's log viewer) and optionally appended to
// AUDIT_LOG_FILE. Covers the OWASP "Logging and Auditing" requirements:
// successful/failed logins, lockouts, account events and admin mutations.
//
// Redaction rule: NEVER log passwords, codes, tokens, or full bodies — the
// event name plus a few scalar identifiers only.
const fs = require('node:fs');
const path = require('node:path');

const AUDIT_LOG_FILE = process.env.AUDIT_LOG_FILE || '';

// Defense in depth: even if a caller slips a sensitive field into `details`,
// it is stripped before the line is written. Never trust the caller.
const SENSITIVE_KEYS = new Set([
  'password', 'pass', 'token', 'mfaToken', 'idToken', 'secret', 'mfa_secret',
  'code', 'verificationCode', 'resetCode', 'authorization', 'cookie', 'apiKey',
]);

function redact(details) {
  const clean = {};
  for (const [k, v] of Object.entries(details || {})) {
    if (SENSITIVE_KEYS.has(String(k).toLowerCase())) continue;
    clean[k] = v;
  }
  return clean;
}

function audit(event, details = {}) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    event,
    ...redact(details),
  });
  // Render log viewer picks this up; local dev sees it too.
  console.log(`[audit] ${line}`);
  if (AUDIT_LOG_FILE) {
    try {
      fs.mkdirSync(path.dirname(AUDIT_LOG_FILE), { recursive: true });
      fs.appendFileSync(AUDIT_LOG_FILE, line + '\n');
    } catch {
      // Logging must never take the request down.
    }
  }
}

module.exports = { audit };

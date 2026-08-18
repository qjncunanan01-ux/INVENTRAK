// Seeded demo credentials (admin/admin123, customer/customer123) exist so a
// fresh deployment is immediately demoable. The OWASP checklist forbids
// leaving default accounts active in production, so production operators set
// DISABLE_DEMO_ACCOUNTS=true and these logins are rejected with the generic
// error (no hint that the account exists).
//
// The check reads the env var at call time so tests can flip it per-run and
// so both backends share one source of truth.
const DEMO_USERNAMES = Object.freeze(['admin', 'customer']);

function demoAccountsDisabled() {
  return process.env.DISABLE_DEMO_ACCOUNTS === 'true';
}

// True when this username is a seeded demo account AND demo accounts are
// disabled by the operator. Regular accounts are never affected.
function isDemoAccountBlocked(username) {
  return demoAccountsDisabled() && DEMO_USERNAMES.includes(String(username).toLowerCase());
}

module.exports = { DEMO_USERNAMES, demoAccountsDisabled, isDemoAccountBlocked };

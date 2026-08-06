// Shared password policy. Both backends (SQLite + npm-free) enforce the SAME
// rules with the SAME error messages, so the contract suites never diverge.
//
// Rules (OWASP-flavored): at least 8 characters, at least one uppercase
// letter, one lowercase letter, one digit, and one symbol. Password hashing is
// bcrypt on the SQLite backend; the npm-free fallback is a demo-mode server.
const PASSWORD_MIN_LENGTH = 8;

// Returns a specific, actionable error message for the FIRST rule the
// password fails, or null when it passes all rules.
function passwordError(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return `password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (!/[A-Z]/.test(password)) {
    return 'password must include an uppercase letter';
  }
  if (!/[a-z]/.test(password)) {
    return 'password must include a lowercase letter';
  }
  if (!/\d/.test(password)) {
    return 'password must include a number';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'password must include a symbol (e.g. !@#$%)';
  }
  return null;
}

module.exports = { passwordError, PASSWORD_MIN_LENGTH };

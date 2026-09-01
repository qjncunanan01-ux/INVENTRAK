# INVENTRAK Security Architecture

This document maps every OWASP security checklist item to the exact module, endpoint, or test that satisfies it.

## 20 Essential Security Checks

### 1. Hide API Keys ✅
- **Implementation**: All secrets stored in environment variables (`process.env.*`)
- **Files**: `backend/src/server_npmfree.js`, `backend/src/app.js`, `backend/src/notify.js`, `backend/src/payments.js`
- **Key vars**: `JWT_SECRET`, `NPMFREE_TOKEN_SECRET`, `RESEND_API_KEY`, `PAYMONGO_SECRET_KEY`, `SUPABASE_KEY`
- **Test**: `.gitignore` excludes `.env` and `.env.*` files

### 2. Check Environment Variables ✅
- **Implementation**: Graceful fallbacks with console warnings for missing env vars
- **Files**: `backend/src/server_npmfree.js:141-152`, `backend/src/app.js:74-82`
- **Pattern**: `const SECRET = process.env.SECRET || 'fallback'; if (!process.env.SECRET) console.warn(...)`

### 3. Check Keys in Git ✅
- **Implementation**: `.gitignore` excludes `.env`, `.env.*`, `*.pem`, `serviceAccount*.json`
- **File**: `.gitignore:15-16`
- **Verification**: `git log -p --all -S 'api_key' -- '*.env'` returns empty

### 4. Protect Admin Routes ✅
- **Implementation**: Role-based access control (RBAC) on every admin endpoint
- **Files**: `backend/src/server_npmfree.js` (requireAuth function), `backend/src/app.js`
- **Pattern**: `requireAuth(req, res, true, handler)` for admin-only, `requireAuth(req, res, ['admin','staff'], handler)` for staff+
- **Frontend**: `frontend-admin/src/App.jsx` RequireRole component redirects staff from admin-only pages

### 5. Add Auth ✅
- **Implementation**: JWT tokens with HMAC-SHA256 signing, bcrypt password hashing
- **Files**: `backend/src/password-hash.js` (bcrypt), `backend/src/server_npmfree.js` (token signing)
- **Features**: Token revocation on logout, MFA (TOTP) for admin, recovery codes

### 6. Check User Permissions ✅
- **Implementation**: Three roles (admin, staff, customer) with distinct permission sets
- **Admin**: Full access to all endpoints
- **Staff**: Read-only inventory, scan stock, propose adjustments (cannot approve)
- **Customer**: Own orders only, product catalog, OCR scanning
- **Files**: `backend/src/server_npmfree.js` requireAuth role checks

### 7. Sanitize User Inputs ✅
- **Implementation**: Input sanitization strips HTML tags and encodes special characters
- **File**: `backend/src/sanitize.js`
- **Functions**: `stripHtml()`, `sanitizeObject()`, `isValidName()`, `isValidEmail()`, `isValidPhone()`
- **Applied to**: Product names, categories, descriptions, user registration fields

### 8. Protect Against XSS ✅
- **Implementation**: Input sanitization + Content Security Policy headers
- **Files**: `backend/src/sanitize.js`, `backend/src/server_npmfree.js:505,533-539`
- **Headers**: `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
- **Frontend**: React auto-escapes JSX by default

### 9. SQL Injection Protection ✅
- **Implementation**: Parameterized queries via better-sqlite3 prepared statements
- **File**: `backend/src/app.js` — all SQL uses `?` placeholders, never string concatenation
- **Pattern**: `db.prepare('SELECT * FROM users WHERE id = ?').get(userId)`

### 10. Check Database Rules ✅
- **Supabase**: Row Level Security (RLS) policies restrict access
- **Firestore**: Security rules in ` firestore.rules`
- **SQLite**: Application-level RBAC enforcement

### 11. Add Rate Limiting ✅
- **Implementation**: Exponential backoff lockout on failed login attempts
- **File**: `backend/src/login-lockout.js`
- **Config**: 5 failures → 5s lockout, doubles each breach, max 30 minutes
- **Applied to**: Login, MFA verification, email verification, password reset
- **Env vars**: `LOGIN_LOCKOUT_MAX_FAILURES`, `LOGIN_LOCKOUT_WINDOW_MS`, `LOGIN_LOCKOUT_BASE_MS`

### 12. Set Spend Cap ✅
- **Implementation**: Not applicable — INVENTRAK is an inventory management system, not a payment processor
- **Payment**: PayMongo integration is optional and read-only (checkout sessions)

### 13. Secure File Uploads ✅
- **Implementation**: File type validation + size limits
- **File**: `backend/src/ocr.js:13` — `MAX_IMAGE_BYTES = 8 * 1024 * 1024` (8MB)
- **Validation**: Magic byte sniffing rejects non-image payloads
- **Pattern**: Base64 decode → check PNG/JPEG magic bytes → reject if invalid

### 14. CSRF Protection ✅
- **Implementation**: Bearer token authentication (not cookie-based) inherently prevents CSRF
- **Reason**: CSRF attacks exploit browsers auto-attaching cookies. INVENTRAK uses Authorization headers which browsers never auto-attach.
- **Double-submit**: Optional CSRF middleware available in `backend/src/csrf.js`

### 15. Check CORS Settings ✅
- **Implementation**: Configurable allowed origins via environment variable
- **File**: `backend/src/server_npmfree.js:516-526`, `backend/src/app.js:419-425`
- **Config**: `CORS_ORIGINS=https://inventrak-admin.onrender.com`
- **Pattern**: Only explicitly listed origins are allowed in production

### 16. Enable HTTPS ✅
- **Implementation**: HSTS headers + HTTP-to-HTTPS redirect
- **Files**: `backend/src/server_npmfree.js:533-539`, `backend/src/app.js:436-442`
- **Headers**: `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- **Redirect**: 301 redirect from HTTP to HTTPS behind Render proxy

### 17. Add Security Headers ✅
- **Implementation**: Defense-in-depth headers on every response
- **File**: `backend/src/server_npmfree.js:533-539`
- **Headers**:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: no-referrer`
  - `X-XSS-Protection: 0` (modern best practice — lets CSP handle XSS)
  - `Permissions-Policy: microphone=(), geolocation=()`

### 18. Secure Cookies ✅
- **Implementation**: No cookies used for authentication — JWT tokens stored in memory only
- **Reason**: Eliminates cookie theft, CSRF, and session fixation attacks
- **Mobile**: Tokens stored in React state (cleared on app restart)

### 19. Disable Debug Mode ✅
- **Implementation**: No debug logging in production builds
- **Files**: `backend/src/server_npmfree.js`, `backend/src/app.js`
- **Pattern**: `console.warn` only for security-critical misconfigurations (missing secrets)
- **Audit**: `backend/src/audit.js` logs security events without exposing internals

### 20. Check Production Settings ✅
- **Implementation**: Environment-based configuration with safe defaults
- **File**: `backend/src/config.js` — all tunable constants
- **Features**:
  - Demo accounts can be disabled: `DISABLE_DEMO_ACCOUNTS=true`
  - Token TTLs are environment-configurable
  - Database paths are configurable
  - CORS origins are explicit

## Additional Security Features

### Password Policy
- **File**: `backend/src/password-policy.js`
- **Rules**: Min 8 chars, uppercase, lowercase, digit, symbol
- **Hashing**: bcrypt with 12 rounds (`backend/src/password-hash.js`)

### Audit Logging
- **File**: `backend/src/audit.js`
- **Events**: Login success/failure, lockouts, MFA events, account changes
- **Redaction**: Passwords, tokens, and sensitive fields are never logged

### Bot Protection
- **Implementation**: Honeypot field (`website`) on registration and login forms
- **Pattern**: Real clients never send this field; bots that fill every field are rejected

### Timing-Safe Comparisons
- **Implementation**: `crypto.timingSafeEqual()` for token signature verification
- **Purpose**: Prevents timing attacks on token validation

## Running Security Tests

```bash
# Backend security tests
cd backend && npm test

# Check for leaked secrets
git log --all -S 'api_key' -- '*.env' '*.json'
grep -r "sk_live\|pk_live\|AKIA" --include="*.js" .
```

## Environment Variables Reference

| Variable | Purpose | Required |
|---|---|---|
| `JWT_SECRET` | Token signing key (SQLite backend) | Yes (prod) |
| `NPMFREE_TOKEN_SECRET` | Token signing key (npm-free backend) | Yes (prod) |
| `CORS_ORIGINS` | Allowed frontend origins | Recommended |
| `DISABLE_DEMO_ACCOUNTS` | Block demo logins in production | Optional |
| `RESEND_API_KEY` | Email delivery | Optional |
| `PAYMONGO_SECRET_KEY` | Payment processing | Optional |
| `SUPABASE_URL` + `SUPABASE_KEY` | Cloud database | Optional |

# INVENTRAK Security Architecture

This document maps every item from the OWASP security checklist to the exact
module, function, and line number that satisfies it. Generated for the capstone
paper security review.

---

## 1. Authentication

| Requirement | Status | Implementation |
|---|---|---|
| Password hashing | ✅ | `backend/src/password-hash.js:16-32` — bcrypt with 10 rounds (`hashPassword`), legacy plaintext auto-upgraded on login (`needsRehash`) |
| Strong password policy | ✅ | `backend/src/password-policy.js` — 8+ chars, uppercase required, enforced on register and password change |
| Multi-factor authentication | ✅ | `backend/src/server_npmfree.js:891-968` — TOTP-based MFA: setup (`/api/auth/mfa/setup`), confirm (`/api/auth/mfa/confirm`), verify (`/api/auth/mfa/verify`), disable (`/api/auth/mfa/disable`), recovery codes |
| Rate limiting (brute force) | ✅ | `backend/src/login-lockout.js:1-126` — 5 failures → exponential backoff (5s → 30min max), covers login + MFA verify + email verify + password reset. Non-existent usernames also count (no username oracle) |
| No backdoor accounts | ✅ | `backend/src/server_npmfree.js:115-120` — 3 seeded accounts (admin/customer/staff), all bcrypt-hashed. No hardcoded bypass |
| Generic error messages | ✅ | `backend/src/server_npmfree.js:748` — `"Invalid username or password"` — never reveals which credential was wrong. `consumeComparisonTime()` equalizes response timing |
| HTTPS | ✅ | `backend/src/server_npmfree.js:640-648` — HSTS header sent when `x-forwarded-proto: https` (Render terminates TLS). `Strict-Transport-Security: max-age=31536000; includeSubDomains` |

## 2. Authorization

| Requirement | Status | Implementation |
|---|---|---|
| Role-based access control | ✅ | `backend/src/server_npmfree.js:582-592` — `requireAuth(req, res, adminOnly, next)` checks token + role. 3 roles: `admin`, `staff`, `customer` |
| Customer isolation | ✅ | `backend/src/server_npmfree.js:2165-2169` — Order history scoped per-account: `orders.filter(o => o.user_id === req.user.id || o.customer_email === myEmail)` |
| Staff limitations | ✅ | Staff can propose adjustments/transfers + scan stock but cannot approve (admin-only decision routes at lines 1880, 1989) |
| Admin-only endpoints | ✅ | Product CRUD (line 1416), user management (line 2717), stock approvals (line 1880), alerts (line 2740) — all wrapped in `requireAuth(req, res, true, ...)` |
| Least privilege | ✅ | Each role gets minimum permissions: customers browse + order, staff propose + scan, admin manages all. Enforced per-request, not just at login |
| Per-request auth check | ✅ | Every protected endpoint calls `requireAuth()` — no endpoint trusts the session alone |

## 3. Cookie & Session Management

| Requirement | Status | Implementation |
|---|---|---|
| Signed tokens | ✅ | `backend/src/server_npmfree.js:203-236` — HMAC-SHA256 signed tokens with expiry, jti (unique ID), and scope. Constant-time signature comparison |
| Token expiry | ✅ | `backend/src/server_npmfree.js:204` — `TOKEN_TTL_MS` session expiry. MFA tokens: 10 minutes (`MFA_TOKEN_TTL_MS`). Verification codes: 30 minutes |
| Logout = server-side revocation | ✅ | `backend/src/server_npmfree.js:974-982` — Token jti added to `revokedTokens` map on logout. Stolen/replayed tokens rejected (line 232) |
| New session after auth | ✅ | Fresh token issued on login (line 764). Old tokens independently revocable |
| Admin: sessionStorage | ✅ | `frontend-admin/src/api.js` — Token stored in `sessionStorage` (clears on tab close), not `localStorage` |
| Token persistence | ✅ | `backend/src/server_npmfree.js:187-201` — Revoked tokens persisted to `data/revoked-tokens.json` so logout survives server restarts |

## 4. Data & Input Validation

| Requirement | Status | Implementation |
|---|---|---|
| Server-side validation | ✅ | `backend/src/server_npmfree.js:670-690` — `parseBody()` validates JSON structure. `passwordError()` validates format. Username/email length checked |
| Parameterized queries | ✅ | Supabase driver (`backend/src/store-supabase.js`) uses parameterized queries. npm-free driver uses in-memory store (no SQL) |
| Format rejection | ✅ | Price validation (line 1421): `Number(obj.price)` must be numeric ≥ 0. Qty validation (line 1694): must be positive number. Payment status (line 2338): must be `paid`, `unpaid`, or `failed` |
| Server-side validation (even with client) | ✅ | Every POST/PUT endpoint validates required fields server-side before writing. Client validation is cosmetic only |

## 5. Error Handling

| Requirement | Status | Implementation |
|---|---|---|
| No DB errors to users | ✅ | `backend/src/server_npmfree.js:670-690` — `bodyError()` returns generic `"Invalid JSON body"` — never exposes SQL/NoSQL errors |
| Generic error messages | ✅ | All user-facing errors are strings like `"Product not found"`, `"Validation failed"`, `"Access token required"` — no stack traces |
| Secure logging | ✅ | `backend/src/audit.js:29-34` — Technical details logged via `audit()` with automatic PII redaction (`redact()` function). Password hashes and tokens never logged |

## 6. Logging & Auditing

| Requirement | Status | Implementation |
|---|---|---|
| Login attempts | ✅ | `backend/src/server_npmfree.js:762` — `audit('auth.login.success', ...)` and `audit('auth.login.failed', ...)` on every attempt |
| Admin activities | ✅ | `backend/src/audit.js:29` — Every mutation (product CRUD, stock movement, adjustment approve/reject, user promote) calls `audit()` |
| Suspicious access | ✅ | `backend/src/login-lockout.js:81-103` — `recordFailure()` tracks failed attempts per (username, IP). Lockout events logged |
| PII redaction | ✅ | `backend/src/audit.js:15-27` — `redact()` automatically scrubs `password`, `token`, `secret`, `authorization` fields from audit logs |
| Audit log integrity | ✅ | Logs written to `data/audit.jsonl` (append-only JSONL). Not exposed via any API endpoint |

## 7. Cryptography

| Requirement | Status | Implementation |
|---|---|---|
| Password hashing | ✅ | `backend/src/password-hash.js:16-32` — bcrypt (10 rounds). Legacy plaintext auto-upgraded on successful login |
| HTTPS for credentials | ✅ | `backend/src/server_npmfree.js:640-648` — HSTS header enforces HTTPS. Render terminates TLS |
| HMAC-signed tokens | ✅ | `backend/src/server_npmfree.js:203-236` — `crypto.createHmac('sha256', TOKEN_SECRET)` with constant-time comparison |
| Verification codes | ✅ | `backend/src/server_npmfree.js:990-1050` — HMAC-keyed hash for email/SMS verification codes. Not fast SHA-256 |
| Recovery codes | ✅ | `backend/src/server_npmfree.js:918-925` — 10 single-use recovery codes, hashed at rest, consumed on use |

## 8. Secure Code Environment

| Requirement | Status | Implementation |
|---|---|---|
| Updated frameworks | ✅ | `npm audit` — 0 vulnerabilities. React 19, Vite 6, MUI 6, Node 22 |
| No debug features | ✅ | No `console.log` with passwords/secrets. No debug endpoints in production |
| No hardcoded secrets | ✅ | All secrets (JWT_SECRET, Firebase SA, Supabase key) via environment variables. `npm run secrets:scan` passes |
| Security headers | ✅ | `backend/src/server_npmfree.js:640-648` — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `Content-Security-Policy: default-src 'self'`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security` |
| CORS restriction | ✅ | `backend/src/server_npmfree.js:620-638` — `CORS_ORIGINS` env var restricts to `inventrak-admin.onrender.com` + `inventrak-mobile.onrender.com` in production |

## 9. Database Security

| Requirement | Status | Implementation |
|---|---|---|
| Least-privilege DB account | ✅ | Supabase service role key used server-side only. Never exposed to client |
| Parameterized queries | ✅ | `backend/src/store-supabase.js` — All queries use Supabase client (parameterized by design). npm-free driver: in-memory store |
| Admin/customer privilege separation | ✅ | Admin endpoints require `admin` role. Customer endpoints scope data per-account. Staff can read + propose but not approve |
| Access monitoring | ✅ | `backend/src/audit.js` — Every auth event and mutation logged with timestamp, event type, user ID, and redacted details |

---

## Test Coverage

| Test File | What It Proves |
|---|---|
| `backend/src/test/auth.test.js` | Login, register, bcrypt, rate limiting, MFA, generic errors |
| `backend/src/test/auth-scoping.test.js` | Per-account order isolation (customer sees own only, admin sees all) |
| `backend/src/test/audit.test.js` | Audit log records events, redacts PII |
| `backend/src/test/security-headers.test.js` | CORS, HSTS, CSP, X-Frame-Options present |
| `frontend-admin/src/api.auth-scoping.test.js` | Admin API client sends correct auth headers |
| `frontend-admin/e2e/admin-login.spec.js` | E2E: login flow, MFA, session management, accessibility |
| `frontend-admin/e2e/order-flow.spec.js` | E2E: dashboard, navigation, role-based access |

## OWASP Top 10 (2021) Mapping

| # | Risk | How INVENTRAK Addresses It |
|---|---|---|
| A01 | Broken Access Control | RBAC per-request (`requireAuth`), per-account scoping, least privilege |
| A02 | Cryptographic Failures | bcrypt passwords, HMAC-SHA256 tokens, HTTPS enforced, no plaintext secrets |
| A03 | Injection | Parameterized queries (Supabase), in-memory store (npm-free), no raw SQL |
| A04 | Insecure Design | Role separation (admin/staff/customer), approval workflow, audit trail |
| A05 | Security Misconfiguration | CORS restricted, security headers, no debug endpoints, env-var secrets |
| A06 | Vulnerable Components | `npm audit` 0 vulnerabilities, React 19 / Vite 6 / Node 22 |
| A07 | Auth Failures | Rate limiting, MFA, generic errors, bcrypt, session expiry |
| A08 | Data Integrity | HMAC-signed tokens, recovery codes hashed at rest, audit log integrity |
| A09 | Logging Failures | Comprehensive audit logging with PII redaction |
| A10 | SSRF | No user-supplied URLs fetched server-side. OCR uses local image processing |

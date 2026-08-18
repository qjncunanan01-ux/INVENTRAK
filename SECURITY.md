# SECURITY.md — OWASP Compliance Mapping for INVENTRAK

Every line of the OWASP-style security checklist (Authentication, Authorization,
Cookie/Session Management, Data & Input Validation, Error Handling, Logging &
Auditing, Cryptography, Secure Code Environment, Database Security) mapped to the
exact INVENTRAK module, endpoint, or test that satisfies it. Use this as the
evidence table for the capstone paper.

## Architecture note (read first)

There are **two backend implementations with an identical API contract**:

- **SQLite backend** — `backend/src/app.js` (Express, better-sqlite3). Local/dev.
- **npm-free backend** — `backend/src/server_npmfree.js` (zero-dependency Node
  `http` server). This is the one deployed to Render; it runs on local JSON files
  or **Firebase Firestore** via `backend/src/store-firestore.js`.

`backend/src/test/contract.test.js` fires every request at BOTH servers and
asserts identical status + response shape, so a security control is only
"done" when it exists in both. `backend/src/test/harness.js` boots both in
isolated temp dirs for the test suites.

Shared hardening modules used by both backends:

| Module | Role |
|---|---|
| `backend/src/password-hash.js` | bcrypt hash/verify + timing equalization |
| `backend/src/password-policy.js` | strong-password rules |
| `backend/src/login-lockout.js` | failed-attempt counters + exponential backoff |
| `backend/src/totp.js` | RFC 6238 TOTP (admin MFA) + one-time recovery codes |
| `backend/src/demo-accounts.js` | demo-credential gate (`DISABLE_DEMO_ACCOUNTS`) |
| `backend/src/audit.js` | structured JSONL security audit log with redaction |
| `backend/src/google-auth.js` | Google OAuth ID-token verify + Expo relay |

---

## 1. Authentication

| OWASP requirement | Implementation (module / endpoint) | Proven by |
|---|---|---|
| Require a valid username/email **and** password | `POST /api/auth/register` and `/api/auth/login` require `username` + `password` (server-side `validate()` in `app.js`; explicit checks in `server_npmfree.js`). Email and PH phone are required at registration. | `contract.test.js`, `server.test.js`, `server_npmfree.test.js` |
| Store passwords using a proper hashing method (never plaintext) | `password-hash.js` — **bcryptjs, 10 rounds** (`$2a$10$…`). Legacy plaintext rows are re-hashed in place on first successful login. Firestore rows stored via the same module. | `password-hash.test.js`, `hash-passwords.test.js`, `firestore-auth-hash.test.js` (asserts the `@users` Firestore row is a bcrypt hash) |
| Require stronger authentication for administrators (MFA) | `totp.js` (RFC 6238, zero-dep) + `POST /api/auth/mfa/setup|confirm|verify|disable` + `POST /api/auth/mfa/recovery-codes`. Once enrolled, admin login returns only a 10-minute challenge token — the session requires a live authenticator code. **Admin Security page** (SecurityPage.jsx) enrolls/regenerates. | `mfa.test.js` (full lifecycle on both backends, wrong-code 401, throttle), `mfa-recovery.test.js` (single-use codes, hashed at rest, regenerate) |
| Limit repeated failed log-in attempts | `login-lockout.js` — 5 failures per (username, IP) in a sliding 15-min window → exponentially growing lockout; applied to **login, verify-email, resend-verification, and MFA** paths. Returns `429` + `retryAfterSeconds`. | `login-lockout.test.js`, `reset-password-lockout.test.js`, `mfa.test.js` (throttle test) |
| No default / test / backdoor accounts in production | `demo-accounts.js` — `DISABLE_DEMO_ACCOUNTS=true` rejects the seeded `admin`/`customer` logins with the generic error (off by default so the demo still works). | `demo-accounts.test.js` (unit + end-to-end on both backends) |
| Generic error messages (don't reveal which credential was wrong) | Both login handlers return exactly `401 { error: "Invalid username or password" }` for unknown user AND wrong password. | `server.test.js`, `demo-accounts.test.js` |
| Transmit credentials only over HTTPS | Render TLS + both servers 301-redirect plaintext (`X-Forwarded-Proto: http` → https) and send `Strict-Transport-Security`. | `security.test.js` ("requests behind an http proxy are redirected to https") |
| *(extra) Username-enumeration resistance* | `consumeComparisonTime()` equalizes the response time of the unknown-user path with the bcrypt path; failures count toward lockout even for unknown usernames. | `security.test.js` (lockout on unknown users), `login-lockout.test.js` |

## 2. Authorization

| OWASP requirement | Implementation | Proven by |
|---|---|---|
| Role-based access control (customers vs administrators) | `users.role` (`customer`/`admin`); `adminOnly()` middleware (`app.js`) / `requireAuth(req,res,true,…)` (`server_npmfree.js`) on every management route. Registration **always** forces `role: 'customer'` server-side. | `security.test.js` ("registration cannot escalate the role") |
| Customers access only their own accounts/orders | Order inquiries, cart, and notifications are scoped by `user_id`; `GET /api/order-inquiries` returns only the caller's rows (admins see all; legacy email fallback). | `order-scoping.test.js` (customer sees own only, admin sees all, cross-account 403), `api.auth-scoping.test.js` (admin dashboard) |
| Administrators manage per assigned responsibility | Admin-only surface: products, inventory, stock movement/adjustments/transfers, order approvals, locations, users, sales, alerts, reports, optimization, OCR stock check. | `api.auth-scoping.test.js` (every admin-only read proven authenticated) |
| Check authorization on **every** protected request | Every protected route goes through `authenticateToken`/`requireAuth` + `adminOnly`; no cached/global "logged in once" state. | `api.auth-scoping.test.js` |
| Least privilege | The mobile client's facade (`mobile-client/src/api.js`) exports **only customer endpoints** — admin-only endpoints were pruned (verified by grep in CI); admin functions live only in the dashboard. | `api.auth-scoping.test.js`, repo CI job for the mobile facade audit |

## 3. Cookie and Session Management

> INVENTRAK uses **stateless bearer tokens** (no cookies) — the controls below
> are implemented for tokens instead.

| OWASP requirement | Implementation | Proven by |
|---|---|---|
| *(no cookies used)* Secure session tokens | SQLite: JWT signed with `JWT_SECRET` (24h). npm-free: HMAC-SHA256-signed `demo-token-<id>.<exp>.<jti>.<scope>.<sig>` — expiry is part of the signed payload. | `security.test.js` (expiry + signature-tamper tests) |
| New session after successful authentication | Every login issues a fresh token with a **new random `jti`**; no session reuse. | `logout.test.js` (asserts a new token after re-login) |
| Automatically expire inactive sessions | `24h` (`TOKEN_TTL_MS` / JWT `expiresIn`); expired tokens are rejected (`403`). | `security.test.js` ("an expired token never authenticates") |
| Destroy the session properly on logout | `POST /api/auth/logout` adds the token's `jti` to a revocation denylist — the same token is then `403`, even though unexpired. Admin app + mobile Account screen call it. | `logout.test.js` (revoked token rejected, double-logout rejected) |
| No session IDs in URLs | Tokens travel in the `Authorization: Bearer` header only. *(Documented exception: the Expo Google OAuth relay passes the token back through a deep-link URL — inherent to the OAuth redirect flow; the return URL is allow-listed and the token is app-only.)* | `google-relay.test.js`, `isAllowedReturnUrl` in `google-auth.js` |

## 4. Data and Input Validation

| OWASP requirement | Implementation | Proven by |
|---|---|---|
| Validate all input (login forms + database requests) | `validate(schema)` middleware (`app.js`) + explicit field checks (`server_npmfree.js`) on every write route; OCR endpoints validate image payloads. | `contract.test.js`, `openapi.test.js` (spec vs reality) |
| Parameterized queries / prepared statements | All SQLite access uses **better-sqlite3 prepared statements** (`db.prepare(...).get/run/all`) — user input is never string-concatenated into SQL. | `server.test.js`, code review (no raw `db.exec` with user input) |
| Reject input that doesn't follow the expected format | Strong-password policy (8+ chars, uppercase, number, symbol), PH mobile regex `^(\+63|63|0)?9\d{9}$`, max lengths, bot honeypot (`website` field). | `password-policy.test.js`, `security.test.js` (honeypot), `contract.test.js` |
| Server-side validation even with client-side validation | Both backends validate independently; clients are convenience only. Malformed JSON → `400`, never `500`. | `contract.test.js` ("malformed JSON body returns 400") |

## 5. Error Handling

| OWASP requirement | Implementation | Proven by |
|---|---|---|
| Never display DB errors / SQL / passwords / connection strings to users | All handlers return the generic OpenAPI error shape (`{ error, details? }`); no stack traces or SQL surface; the OCR path returns only sanitized messages. | `openapi.test.js`, `contract.test.js` |
| Simple user messages + detailed technical info for administrators | Users get `{ error }`; the full picture goes to the **audit log** (see §6) and server console — never to the client. | `audit.test.js` |

## 6. Logging and Auditing

| OWASP requirement | Implementation | Proven by |
|---|---|---|
| Record successful and failed log-in attempts | `audit.js` emits `auth.login.success` / `auth.login.failed` / `auth.lockout` / `auth.demo_account_blocked` as structured JSON to the console (Render → Logs) and optionally `AUDIT_LOG_FILE`. | `audit.test.js` (asserts both events on both backends) |
| Record important administrative database activities | `auth.mfa.setup|enabled|disabled|recovery_regenerated`, `auth.register`, `auth.email_verified`, `auth.logout` events with `userId`/`username`. | `audit.test.js` |
| Record suspicious / repeated unauthorized access attempts | Every lockout (429) and every failed MFA/verification attempt is audited with the source IP. | `login-lockout.test.js`, `audit.test.js` |
| Protect log records from modification | Logs are append-only console/JSONL; audit module **redacts** password/token/code/secret fields even if a caller slips them in. | `audit.test.js` (redaction assertions) |

## 7. Cryptography

| OWASP requirement | Implementation | Proven by |
|---|---|---|
| Protect passwords with secure hashing | bcrypt, 10 rounds (`password-hash.js`). | `password-hash.test.js`, `firestore-auth-hash.test.js` |
| Encrypted connections for credentials | TLS on Render + HSTS + plaintext redirect (both servers). | `security.test.js` |
| Protect sensitive DB data | Verification/reset codes stored as **HMAC-SHA256 keyed by the token secret** (offline brute-force of a 6-digit space is infeasible); MFA secrets never returned after setup; recovery codes stored only as keyed hashes; auth tokens signed. | `verify-email.test.js`, `reset-password.test.js`, `firestore-auth-hash.test.js`, `mfa-recovery.test.js` (at-rest hash proof) |
| No hard-coded credentials in source | All secrets via env vars (`backend/.env.example` has placeholders only): `JWT_SECRET`, `NPMFREE_TOKEN_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `RESEND_API_KEY`, `SEMAPHORE_API_KEY`, `SMTP_*`, `TWILIO_*`, `GOOGLE_CLIENT_SECRET`. Keystores/service-account JSON are gitignored. Boot warnings if the signing secrets are unset. | repo `gitignore`, `backend/.env.example`, DEPLOY.md |

## 8. Secure Code Environment

| OWASP requirement | Implementation | Proven by |
|---|---|---|
| Keep frameworks/libraries updated | Admin migrated from CRA to **Vite** (clears dev-toolchain advisories); dependencies pinned; `npm audit` tracked in CI history. | `frontend-admin/package.json`, CI |
| Remove unused accounts / dev functions / debug features | Bot honeypot rejects scripted fields; no debug endpoints; Swagger `/api/docs` is intentional public API documentation. | `security.test.js` |
| No hard-coded secrets | §7 row above; `npm run verify` + repo scans (`grep` for keys in CI). | CI, DEPLOY.md |

## 9. Database Security

| OWASP requirement | Implementation | Proven by |
|---|---|---|
| Least-privilege DB connection | Firestore is accessed only through the **firebase-admin SDK** using a scoped service account; SQLite runs as a local file for dev. | `backend/firestore.rules`, `store-firestore.js` |
| Restrict direct database access | `backend/firestore.rules` **denies all client access** — apps talk only to the API; the admin SDK bypasses rules by design. | `firestore.rules`, DEPLOY.md (deploy-rules step) |
| Parameterized queries (SQL injection) | §4 — prepared statements everywhere. | `server.test.js` |
| Separate customer vs administrative DB privileges | Single API layer with RBAC (§2); the admin SDK lives only in the backend, never the clients. | `api.auth-scoping.test.js`, `firestore.rules` |
| Monitor unusual access/modification | §6 — audit log + lockout events with source IPs. | `audit.test.js`, `login-lockout.test.js` |

---

## How to reproduce the evidence

```bash
# Backend: OpenAPI validation + route/spec audit + client freshness + 324 tests
cd backend && npm run verify

# Admin dashboard: 20 unit/component tests (incl. auth-scoping)
cd frontend-admin && npm test

# Mobile: bundles cleanly (Metro)
cd mobile-client && npx expo export --platform android
```

**Live deployment:** https://inventrak-api.onrender.com (Firestore, HTTPS only) —
audit events visible in Render → inventrak-api → Logs as `[audit] {…}` JSONL.

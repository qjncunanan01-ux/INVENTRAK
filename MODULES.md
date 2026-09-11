# INVENTRAK — Module Guide

One page per module: what it does, where the code lives, how to run it, how to
test it, and how to demo it. Written for groupmates — copy-paste the commands
and go.

> **Terminology:** two backend *servers* share the same API surface —
> the **SQLite backend** (`backend/src/app.js` + Express) and the **npm-free
> backend** (`backend/src/server_npmfree.js`, zero dependencies). The npm-free
> server picks a **storage driver** at boot: JSON files (default), Firestore,
> or Supabase. Everything below says which one a command runs.

---

## 0. Start everything (the 3 commands that matter)

```bash
# 1. Backend API  → http://localhost:4001  (Swagger UI: /api/docs)
cd backend
node src/server_npmfree.js

# 2. Admin dashboard → http://localhost:5173  (login: admin / admin123)
cd frontend-admin
npm install
npm run dev

# 3. Mobile app (Expo) → scan the QR with Expo Go (login: customer / customer123)
cd mobile-client
npm install
npx expo start
# On another Wi-Fi / for phones: npx expo start --tunnel
```

Prefer the native SQLite backend instead? `cd backend && npm install && npm run
seed && npm start` (same port 4001, same endpoints — pick **one**, not both).

**Run the admin from a built bundle (faster, mirrors production):**

```bash
cd frontend-admin
npm run build
npx vite preview --port 4173
```

**One-shot smoke test of every backend module (no repo data touched):**

```bash
node .c/freebuff/backend-module-test.cjs
# boots the server on an ephemeral port + isolated temp data dir,
# then exercises 30 endpoint checks across every module and prints PASS/FAIL
```

**Detached backend helper (used by the preview tooling):**

```bash
node .c/freebuff/start-backend.cjs             # start on :4001 (INVENTRAK_PORT to change)
node .c/freebuff/start-backend.cjs --kill      # stop the instance it started
node .c/freebuff/start-backend.cjs --kill-port # reap whatever squats on the port
```

---

## 1. Backend API (`backend/`)

**Code:** `src/app.js` (SQLite/Express), `src/server_npmfree.js` (npm-free),
`src/config.js` (tunables), `src/openapi.json` (the API contract — single
source of truth).

**Run:**

```bash
cd backend
npm install
node src/server_npmfree.js          # JSON driver — no setup, http://localhost:4001
npm start                           # SQLite driver (needs better-sqlite3)
npm run start:firestore             # Firestore driver (needs FIREBASE_* env vars)
npm run start:supabase              # Supabase driver (needs SUPABASE_URL + SUPABASE_KEY)
```

**Port / env:** `PORT` (default 4001), `INVENTRAK_DATA_DIR` (override data
folder), `NPMFREE_TOKEN_SECRET` (required in production — see the `[security]`
warning otherwise), `DB_DRIVER=json|firestore|supabase` (pin a driver),
`DISABLE_DEMO_ACCOUNTS=true` (production — rejects the seeded demo logins).

**Demo (browser):** open `http://localhost:4001/api/docs` — the interactive
Swagger UI, every endpoint documented and try-able.

**Test:**

```bash
cd backend
npm test        # 30+ suites, ~330 assertions: contract parity, OpenAPI conformance,
                # scoping, lockout, MFA, OCR, sync, migration drift guard …
npm run verify  # docs:validate + spec:audit + client:check + npm test (CI-equivalent)
```

---

## 2. Storage drivers (`backend/src/store-*.js`)

All three expose the **same read/write interface**, so the server code never
knows which is active. Selection precedence: `--firestore`/`--supabase` flag >
`DB_DRIVER` pin > auto-detect (Firebase creds → Firestore; Supabase creds →
Supabase; else JSON).

| Driver | File | Needs |
|---|---|---|
| JSON files (default) | `store-json.js` | nothing |
| Firestore | `store-firestore.js` | `FIREBASE_PROJECT_ID` + `FIREBASE_SERVICE_ACCOUNT_JSON` |
| Supabase | `store-supabase.js` | `SUPABASE_URL` + `SUPABASE_KEY` (service role) |

**Demo the drivers:** boot with `DB_DRIVER=json`, create a product via
`POST /api/products`, restart, product is still there. Repeat with
`start:firestore` and check the Firebase console — same data, different store.

**Test:** `npm test` runs the same contract suites against fakeFirestore and
temp SQLite/JSON dirs — value parity across drivers is asserted, not assumed.

---

## 3. Authentication & users (`backend/src/` — `password-hash.js`, `password-policy.js`, `login-lockout.js`, `totp.js`, `demo-accounts.js`, `google-auth.js`)

**What's inside:**
- **Password hashing** — bcrypt on both backends (shared `password-hash.js`);
  legacy plaintext rows auto-upgrade on login (`npm run hash:passwords` migrates
  a whole store at once).
- **Strong password policy** — 8+ chars, upper+lower+digit+symbol; identical
  rules/messages on both backends.
- **Brute-force lockout** — 5 failures per (account, IP) locks with exponential
  backoff; unknown usernames count too (no username oracle). Env-tunable:
  `LOGIN_LOCKOUT_*`.
- **Admin MFA (TOTP)** — RFC 6238, works with Google/Microsoft Authenticator;
  10 one-time recovery codes per admin (lost-phone backup).
- **Google sign-in** — server-side OAuth relay (`/api/auth/google/start` +
  `/api/auth/google/callback`) because Expo Go deep links can't be Google
  redirect URIs. Needs `GOOGLE_CLIENT_SECRET` + `GOOGLE_CLIENT_IDS` (DEPLOY.md).
- **Demo accounts** — `admin/admin123`, `staff/staff123`,
  `customer/customer123` (quick-fill buttons on both login screens); rejected
  everywhere when `DISABLE_DEMO_ACCOUNTS=true`.

**Demo (2 min):** sign up with a weak password → rejected with the rule list.
Wrong password 5× → locked with growing wait. Google button → real Gmail
sign-in. (Owner + Authenticator app: Security page → MFA setup → scan QR →
confirm → log out → log in with the 6-digit code.)

**Test:** `npm test` includes password-policy, password-hash, login-lockout,
mfa, mfa-recovery, google-auth, google-relay, demo-accounts, logout,
verify-email suites.

---

## 4. Roles & authorization (maker–approver RBAC)

**Roles:** `admin` (owner — full control + approvals), `staff` (maker — Scan &
Stock, adjustments/transfers, denied user management & approvals), `customer`
(mobile app only — own data only). Enforced per-endpoint on **both** backends;
enrollment-free for staff (they authenticate with the normal login).

**Where:** endpoint gates in `app.js` / `server_npmfree.js`
(`staffOrAdmin`, `requireAuth(req, res, ['admin', 'staff'], …)`), approval
queue on the admin **Approvals** page, staff tooling on mobile
(`OcrScreen.js` count panel, `AccountScreen.js` staff tools).

**Demo (the money shot):** log into the admin as **staff** → the Approvals
page is hidden. Create a stock adjustment (Scan & Stock or Stock Adjustments
page) → status *pending*. Log out, log in as **admin** → Approvals shows the
request → approve → the stock count updates in Firestore. On the phone:
staff account → Account tab → *Staff Tools → Scan & Count Stock* → scan a
label → enter per-location counts → submit → pending adjustment.

**Test:** `backend/src/test/staff-roles.test.js` (+ customer 403s in the
scoping suites) — staff can create but not approve; customers are blocked from
staff endpoints entirely.

---

## 5. Products & catalog (`backend/src/` — `product-lines.js`, `prng.js`)

Public CRUD (`GET` is anonymous), categories, search/filter/pagination,
per-product **brand** field, bulk price update, soft-delete. Deterministic
seed (`prng.js`): a fresh boot of *either* backend produces **identical** stock
and sales — this is what makes cross-backend value-parity tests possible.

**Run/demo:** admin → Products page (create/edit/soft-delete with dialogs);
mobile → Products tab (search, categories, detail). `GET /api/products?search=
matcha&limit=10` in Swagger.

**Test:** `contract.test.js` + `openapi.test.js` assert list shape, pagination
and per-field parity across both backends.

---

## 6. Inventory & multi-location stock

**Code:** schema + stock tables in `backend/src/db.js` / `src/schema.js`
(SQLite) or the storage drivers; locations in `store-*.js` datasets.

**Model:** stock is tracked **per location** (Showroom, Stockroom 1,
Stockroom 2) with totals rolled up; unique (product, location) constraint
prevents duplicate rows.

**Demo:** admin → **Inventory** page = location-matrix with low-stock
highlighting and filters; **Locations** page = CRUD + printable **QR tags**
per storage area (one QR per location, `INVENTRAK:LOC:<id>:<name>` payload —
stick them on the physical shelves). Mobile: product detail shows per-location
quantities; the **Stock Availability** screen can be scoped to one location.

**Test:** inventory/locations endpoints covered by contract + OpenAPI suites.

---

## 7. Stock movements, FIFO/FEFO lots, adjustments & transfers

**What's inside:**
- **Movements** (`POST /api/stock-movement`) — stock-in / stock-out /
  transfer / adjustment with **lot tracking**. Consumption order is **FEFO
  when an expiry date is captured** (soonest-expiring batch ships first),
  falling back to **FIFO** for lots without one — so nothing breaks for
  long-life goods. Optional `expiry_date` on stock-in/transfer; transfers
  carry expiry to the destination lot.
- **Lots visibility** — admin Stock Movement page shows the FEFO lot view
  (expiry chips: expired / ≤30 days / long-life) with an
  "expiring within 30 days" filter; `GET /api/stock-lots?expiring_within=N`.
- **Stock adjustments** — *pending* until the owner approves (RBAC above);
  created by staff via UI or the OCR verify-and-confirm flow.
- **Stock transfers** — dedicated form for moving items between storage rooms,
  also flows through the approval queue.

**Demo:** Stock Movement page → record a stock-in *with an expiry date* →
see the FEFO list (expiring batch on top) → record a stock-out → the
soonest-expiring lot is consumed first. Toggle "expiring within 30 days".
Staff creates an adjustment → owner approves on Approvals → stock updates.
Stock Transfers page → create Showroom→Stockroom-1 transfer → approve →
quantities (and expiry) move.

**Test:** covered by the per-backend suites + `staff-roles.test.js` (staff
create / admin approve separation) + `fefo.test.js` (FEFO order, FIFO
fallback, expiry validation, transfer carry-over — both backends).

---

## 8. Order inquiries (the customer order lifecycle)

Full lifecycle **pending → approved → fulfilled / rejected** with a status
timeline, per-account scoping (a customer can *only* ever see their own —
regression-locked by `order-scoping.test.js`), COD or GCash payment
(see §9), and customer phone for SMS updates.

**Run/demo:** mobile → order inquiry form (multi-product, qty, cost estimate)
→ submit. Admin → Order Inquiries page → approve → the customer's
Notifications tab and email/SMS update automatically.

**Test:** `order-scoping.test.js` (owner-only visibility, admin sees all,
legacy email fallback), contract suites.

---

## 9. Payments — GCash via PayMongo (`backend/src/payments.js`)

**Real gateway mode:** set `PAYMONGO_SECRET_KEY` → creating a GCash inquiry
returns a PayMongo `checkout_url` the customer opens in a browser; the module
is fully stubbed (log-only) when the key is absent, so nothing breaks and
nothing costs money without configuration.

**Demo:** place an order with **GCash** payment method in the app → the
Payment screen shows the checkout URL (or the logged stub in dev).

**Test:** payment path exercised in the order suites; the module degrades to
log-only without the key (by design).

---

## 10. Notifications — email + SMS (`backend/src/notify.js`, `mobile-client/src/screens/NotificationsScreen.js`)

**How it works:** fire-and-forget senders behind env vars — **log-only until
configured**, so the API never blocks and never costs anything by accident.

| Provider | Env vars |
|---|---|
| Email via SMTP (Gmail app-password, Brevo…) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` |
| Email via Resend | `RESEND_API_KEY`, `EMAIL_FROM` |
| SMS via Semaphore (PH) | `SEMAPHORE_API_KEY`, `SEMAPHORE_SENDER_NAME` |
| SMS via Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` |

**Triggers:** signup verification code (email+SMS), welcome email,
order-status changes (approved/rejected/fulfilled → email+SMS), password
reset codes. Optional local test of a full template:

```bash
cd backend && npm run notify:test
```

**The mobile feed:** the Notifications tab is not push — it polls the
customer's inquiries and flattens each order's `status_history` into cards,
newest first, with search. Demo flow: place an order as customer → admin
approves → pull-to-refresh on Notifications → "Order #N is Approved" appears.

**Demo without any provider (log mode):** start the backend, sign up a user,
read the verification code straight from the backend console
(`[notify] email (unconfigured …) :: {"text":"… code is: 123456"}`).

**Test:** `notify.test.js` — provider selection, template composition,
redaction, all providers mocked (no network).

---

## 11. OCR — scan a label, match the catalog (`backend/src/ocr.js`, admin `ScanStockPage.jsx`, mobile `OcrScreen.js`)

**Pipeline:** upload/capture → preprocess (upscale, grayscale, contrast, auto
retry with SPARSE_TEXT) → tesseract.js extracts text → text-filter keeps only
brand/product tokens → fuzzy-match against the catalog → ranked matches with
prices.

- **Mobile (customer):** Scan tab — strong match auto-opens the product;
  otherwise a match list. Guests see the login gate.
- **Mobile (staff/admin):** same screen switches to the **stock-aware**
  endpoint (`/api/ocr/stock`) — matches carry live per-location quantities and
  a **verify-and-confirm panel** lets staff enter the physically counted qty
  per location and submit **pending adjustments** (owner approves).
- **Admin (Scan & Stock page):** upload a label photo or open the device
  camera → same matching + the confirm-and-correct panel.
- **Guardrails:** non-SYLVER images → "No SYLVER product detected"; staff-only
  endpoint returns 400 on a bad payload (validation before the engine), 403
  for customers.

**Demo:** admin → Scan & Stock → upload a product label photo → matches with
prices appear → correct the counts → submit → approve as owner. Phone: Scan
tab → point at a printed label.

**Test:** `ocr.test.js` (matcher), `ocr-preprocess.test.js` (full engine —
downloads traineddata on first run), `staff-roles.test.js` (endpoint gates).

---

## 12. QR & barcode scanning (`mobile-client/src/screens/QrScanScreen.js`, admin `LocationsPage.jsx`)

**Location tags:** the admin Locations page prints a QR per storage area
(payload `INVENTRAK:LOC:<id>:<name>`). **Product tags:** scanning a product QR
opens that product.

**Demo:** print the tags (Locations → QR tags → Print tags) → open the mobile
app → Scan tab → **"Scan a QR / barcode tag"** → scan a location tag → the
scoped stock view for that storage area opens; scan a product tag → the
product page opens. Unrecognized codes get a friendly alert, never a crash.

**Test:** payload parse logic verified in-repo (location / product / bare-id /
foreign-token cases); camera itself needs a physical device.

---

## 13. Decision support — EOQ, ROP, Safety Stock, ABC, FSN (`backend/src/` optimization endpoints, admin `OptimizationPage.jsx`, mobile `RecommendationScreen.js`)

Computed from **real movement/sales data** (not hardcoded): EOQ = √(2DS/H),
Reorder Point from lead-time demand, statistical Safety Stock, Pareto 70/20/10
ABC classification (value-based), **FSN Fast/Slow/Non-moving classification
(movement-based)**, Inventory Turnover Ratio.

**Demo:** admin → Optimization page → ABC table + EOQ/ROP/Safety per product
+ **FSN section** (F/S/N chips, window selector, Non-moving dead stock
surfaced first in red). Mobile → Recommendations tab (ABC-classified
suggestions with badges). Low stock auto-creates alerts (below the reorder
threshold) that appear on the admin dashboard and Inventory page.

**Test:** value parity of optimization outputs asserted across both backends
in `contract.test.js`; FSN unit + parity tests in `fsn.test.js`
(`GET /api/optimization/fsn?window=30|60|90|180`).

---

## 14. Analytics, sales & reports

**Code:** analytics + sales endpoints (`/api/analytics/summary`,
`/api/analytics/export/:type` CSV/JSON, `/api/sales`), admin **Dashboard**
(KPI cards + monthly charts fed by the seeded 576-row sales ledger),
**Reports** page (printable).

**Demo:** Dashboard — counters, charts, low-stock badges. Reports — print a
period report. Export — `curl …/api/analytics/export/products?format=csv`.

**Test:** analytics value-parity in the contract suite; admin tests assert
the dashboard fetches `/api/order-inquiries` (not the retired `/api/inquiries`).

---

## 15. Alerts (`/api/alerts`)

Auto-created when stock hits the reorder threshold; resolve from the admin
Inventory page or `PUT /api/alerts/:id/resolve`. Demo: check the dashboard's
low-stock badge → open Alerts → resolve one. Covered by contract tests.

---

## 16. Admin dashboard app (`frontend-admin/`)

**Stack:** React 18 + Vite, MUI 5, Recharts, React Router 7, anime.js
animations, LiquidGlass shader accents, Playwright E2E + visual tests.

**Run:**

```bash
cd frontend-admin
npm install
npm run dev        # dev server :5173
npm run build      # production bundle → build/
npx vite preview --port 4173   # serve the built bundle
```

**Pages:** Dashboard · Products · Inventory · Stock Movement · Stock
Adjustments · Stock Transfers · Order Inquiries · Approvals (admin-only) ·
Locations (+ QR tags) · Optimization · Scan & Stock (OCR) · Reports ·
Security (MFA, admin-only) · Audit Trail. Role badge in the top bar
(ADMIN/STAFF); quick-fill demo-credential buttons with role chips on login.

**Env:** `REACT_APP_API_BASE_URL` (defaults to `http://localhost:4001`) —
set it at build time to point at the deployed backend.

**Test:**

```bash
npm test           # Vitest: 28 tests (pages + layout)
npx playwright test  # E2E + visual regression snapshots
```

---

## 17. Mobile customer app (`mobile-client/`)

**Stack:** React Native (Expo SDK 54), React Navigation 7, Reanimated,
Lucide icons, expo-camera.

**Run:**

```bash
cd mobile-client
npm install
npx expo start              # QR for Expo Go
npx expo start --tunnel     # phone not on the same Wi-Fi
EXPO_PUBLIC_API_URL=https://inventrak-api.onrender.com npx expo start
                            # talk to the deployed backend from any network
npx expo export --platform web   # static web bundle for a quick browser demo
```

**Screens:** Login (+ Google button, demo quick-fill) · Signup · Verify Email
· Home · Products/Categories/Search · Product detail · Cart · Order Inquiry ·
Payment (GCash) · Inquiry History · Notifications · Recommendations · Account
(+ staff tools) · Scan (OCR) · QR/Barcode scanner · Stock Availability ·
Forgot Password.

**Demo account:** `customer/customer123` (or Google sign-in). Staff features
unlock automatically when a staff/admin account signs in.

**Production APK:** see **[APK-INSTALL.md](APK-INSTALL.md)** — build via EAS
(`eas build -p android --profile production`), download link, transfer, install.

---

## 18. Security, audit & integrity

**Code:** `backend/src/audit.js`, `totp.js`, `csrf.js`, `sanitize.js`,
`cache.js` + the auth stack (§3).

- **Audit log** — structured JSONL (`[audit] {…}`) on the console (Render log
  viewer) and optionally `AUDIT_LOG_FILE`: logins, lockouts, MFA changes,
  admin mutations, logout revocations. Demo: log in wrong once, right once →
  read both lines in the console.
- **CSRF** — double-submit cookie for cookie-based flows.
- **Input sanitization** — stripHtml + validators (`isValidName/Email/Phone`)
  on both backends; parameterized SQL on the SQLite driver.
- **Integrity probe** — `GET /api/health/integrity` (admin) runs the
  cross-collection audit; public liveness is `GET /api/health`.
- **Session revocation** — logout kills the token server-side (both backends).

**The compliance map:** **[SECURITY.md](SECURITY.md)** pins every OWASP
checklist item to the exact module/endpoint/test that satisfies it.

**Test:** `security.test.js`, `audit.test.js`, `logout.test.js`, `mfa*.test.js`
in `npm test`.

---

## 19. Data tooling (migrations, sync, seeding, docs)

```bash
cd backend
npm run seed                    # seed SQLite from the catalog (deterministic)
npm run seed:firestore          # sync the catalog into Firestore (non-destructive)
npm run migrate:firestore -- --dry-run   # preview SQLite→Firestore (then drop --dry-run)
npm run sync:firestore          # bidirectional SQLite↔Firestore merge (conflict policies)
npm run migrate:check           # CI drift guard: transform must reproduce the catalog
npm run hash:passwords          # re-hash any legacy plaintext rows (SQLite)
npm run client:generate         # regenerate both frontends' typed API clients from openapi.json
npm run docs:build              # rebuild the static Swagger site into docs/ (GitHub Pages)
npm run cleanup:demo            # remove demo/test accounts and data
```

**Firestore emulator (local cloud, zero setup):**

```bash
npm run emulators:start               # terminal 1 — Firestore on :8085
npm run start:firestore:emulator      # terminal 2 — backend on the emulator
npm run migrate:firestore:emulator    # push SQLite data into it
```

---

## 20. Deployment (where it lives now)

| Piece | URL | Notes |
|---|---|---|
| Backend API | https://inventrak-api.onrender.com | Render (Firestore driver), Swagger at `/api/docs` |
| Admin dashboard | https://inventrak-admin.onrender.com | Render static site (Vite build) |
| API docs site | https://qjncunanan01-ux.github.io/INVENTRAK/ | GitHub Pages from `docs/` |
| Mobile | APK via EAS (APK-INSTALL.md) | Baked to the Render backend |

Cold starts: the Render free tier sleeps after ~15 min idle — the mobile app
has a built-in wake-and-retry (`wakeBackend()`); hit any endpoint once before
presenting.

Full runbook (Firebase env vars, Supabase, Render blueprint, secrets):
**[DEPLOY.md](DEPLOY.md)** · Demo walkthrough: **[DEMO-SCRIPT.md](DEMO-SCRIPT.md)**
· Security evidence: **[SECURITY.md](SECURITY.md)**.

---

## 21. CI (what runs on every push)

`.github/workflows/test.yml`: backend `npm run verify` (spec validation,
route↔spec audit, client freshness, full suite) + migration-catalog drift
guard + admin Vitest/build + mobile bundle smoke.
`.github/workflows/docs.yml`: rebuilds the GitHub Pages Swagger site.

---

## 22. File map (cheat sheet)

```
backend/src/
  app.js                 # SQLite/Express server (native driver)
  server_npmfree.js      # npm-free server (JSON/Firestore/Supabase drivers)
  store-json|firestore|supabase.js   # storage drivers (same interface)
  schema.js / db.js      # SQLite DDL + connection (migrations inline)
  config.js              # named tunables (auth, inventory, rate limits, HTTP)
  ocr.js                 # OCR + fuzzy matcher + preprocessing
  payments.js            # GCash/PayMongo checkout
  notify.js              # email/SMS providers (log-only when unconfigured)
  google-auth.js         # Google OAuth ID-token verify (JWKS)
  totp.js / login-lockout.js / password-*.js   # auth stack
  audit.js / csrf.js / sanitize.js / cache.js  # security + perf middleware
  product-lines.js       # order-line normalizer (both backends)
  prng.js / seed.js      # deterministic seed data
  fsn.js                 # FSN Fast/Slow/Non-moving classifier (shared)
  migrate-firestore.js / sync-firestore.js / seed-firestore.js  # data tooling

frontend-admin/src/
  api.js / api.generated.js   # typed API client (generated from openapi.json)
  pages/…                     # one page per admin module (see §16)
  components/                 # LiquidGlassCard, AnimatedCounter, …
  *.test.jsx                  # Vitest suites

mobile-client/src/
  api.js / api.generated.js   # client + wakeBackend() cold-start retry
  screens/…                   # one file per screen (see §17)
  theme-context.js / AnimatedEntry.js / BackButton.js  # shared UI
```

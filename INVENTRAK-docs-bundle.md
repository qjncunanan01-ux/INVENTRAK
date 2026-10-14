<!-- This bundle is a convenience copy. The source files at the repo root are the source of truth. -->

<!-- Source files: README.md, AGENTS.md, SECURITY.md, ARCHITECTURE.md, MODULES.md, ALGORITHMS.md, CAPSTONE-PROGRESS.md, DEMO-SCRIPT.md, DEPLOY.md, APK-INSTALL.md -->

---

# INVENTRAK - Inventory Management System

[![CI](https://github.com/qjncunanan01-ux/INVENTRAK/actions/workflows/ci.yml/badge.svg)](https://github.com/qjncunanan01-ux/INVENTRAK/actions/workflows/ci.yml)
[![API Docs Deployment](https://github.com/qjncunanan01-ux/INVENTRAK/actions/workflows/docs.yml/badge.svg)](https://github.com/qjncunanan01-ux/INVENTRAK/actions/workflows/docs.yml)

A full-stack inventory management system with admin dashboard, two mobile apps, and optimization algorithms.

## Documentation

Start here depending on what you need to know:

| Document | What it answers |
|---|---|
| **[AGENTS.md](AGENTS.md)** | How to work in this repo. The rules an agent or contributor must know — the OpenAPI-client contract, verify commands, deploy realities, security and mobile conventions. **Read this before editing.** |
| **[docs/DATABASE-SPEC-MAPPING.md](docs/DATABASE-SPEC-MAPPING.md)** | Maps the 23-table centralized database specification onto what actually runs: which tables exist, which are inlined and why, which are absent, and the build plan for the rest. |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | Full database layout, table-by-table, plus the API surface. |
| **[SECURITY.md](SECURITY.md)** | OWASP Top-10 → module/endpoint/test compliance mapping (the capstone paper's evidence table). |
| **[DEPLOY.md](DEPLOY.md)** | Deployment runbook (Render / Railway / Cloud Run), the Supabase + Firestore setups, and the durable audit trail. |
| **[DEMO-SCRIPT.md](DEMO-SCRIPT.md)** | The live demo walkthrough, with the exact records to show at each step. |
| **[ALGORITHMS.md](ALGORITHMS.md)** | Every algorithm in the system, explained — the rule, why it is that rule, and the numbers it produces. Also holds the rehearsal table ("show it here / what to say") the defence is run from. |
| **[docs/algorithms-deck.html](docs/algorithms-deck.html)** | The defence deck: ALGORITHMS.md generated into 45 projector slides, with each rehearsal-table line printed on the slide it belongs to. One self-contained file — open it from disk, no install, no network. `←`/`→` move, `C` contents, `N` speaker notes, `F` fullscreen, `P` prints to PDF, a number jumps to that slide. Generated, so it cannot drift from the spec: rebuild with `npm run slides`, and `slides:check` (inside `npm run verify`) fails if it ever does. |
| **[MODULES.md](MODULES.md)** | Feature-by-feature module guide — what each capability does and where it lives. |
| **[CAPSTONE-PROGRESS.md](CAPSTONE-PROGRESS.md)** | Delivery status per workstream, including what is intentionally unfinished. |
| **[APK-INSTALL.md](APK-INSTALL.md)** | Building and installing the Android APKs without Expo Go. |
| **[docs/agent-skills/](docs/agent-skills/README.md)** | Vetted agent instruction sets vendored in from four upstream projects (MIT / Apache-2.0, attribution preserved), with a record of what was rejected and why. |

## Architecture

```
INVENTRAK/
├── backend/          # Node.js Express API (SQLite) + npm-free fallback
├── frontend-admin/   # React Admin Dashboard (MUI)
├── staff-client/     # React Native Inventory Staff app (Expo)
├── mobile-client/    # React Native Customer app (Expo)
├── docs/             # Published Swagger UI + project documentation
└── .github/          # CI/CD workflows
```

One backend serves all three apps. `backend/openapi.json` is the single source
of truth for the API contract, and the generated clients in every app are
derived from it — so a route change without a spec update fails CI rather than
drifting silently. Storage is driver-selectable (SQLite, JSON, Firestore or
Supabase) behind one `read`/`write` interface, with the two HTTP backends kept
byte-identical by a contract test.

## Security

Built around the OWASP Top-10 checklist: bcrypt-hashed passwords (10 rounds),
admin two-factor authentication (TOTP + one-time recovery codes), login
brute-force lockout with exponential backoff, generic error messages (no
username enumeration), HMAC-signed 24h session tokens with **server-side
logout revocation**, role-based access control with per-account data scoping,
parameterized SQL, input validation on both backends, and HTTPS-only
transport. Every login attempt, lockout, MFA change and account event is
written to a structured **audit log** (`[audit] {…}` JSONL, live in
[Render → inventrak-api → Logs](https://dashboard.render.com)).

See **[SECURITY.md](SECURITY.md)** for the full OWASP checklist →
module/endpoint/test compliance mapping (the evidence table used in the
capstone paper).

## Features

### Backend API
- **JWT Authentication** - Real token-based auth with password hashing (bcryptjs) on **both** backends (shared `backend/src/password-hash.js` — the npm-free fallback hashed too, so SQLite and Firestore users always store hashes, never plaintext)
- **Strong password policy** - Signup requires 8+ characters with uppercase, lowercase, number, and symbol
- **Brute-force login lockout** - 5 failed logins per (account, IP) lock the account with an **exponentially growing** wait (doubles per breach, capped), tunable via `LOGIN_LOCKOUT_*` env vars; shared module so SQLite and npm-free backends behave identically; unknown usernames count too (no username oracle) and a successful login clears the counter
- **Email + SMS notifications** - Order-inquiry status updates (approved/rejected/fulfilled) and welcome emails; pluggable Resend / Semaphore / Twilio providers, log-only when unconfigured
- **Products CRUD** - Full product catalog with pagination, search, and filtering
- **Inventory Management** - Per-location stock tracking with totals
- **Stock Movements** - FIFO-based stock-in/out/transfer/adjustment with lot tracking
- **Locations CRUD** - Manage stockroom locations
- **Order Inquiries** - Full lifecycle: pending -> approved -> fulfilled/rejected
- **Optimization Algorithms** - EOQ, Reorder Point, Safety Stock, ABC Classification, Turnover Ratio
- **Analytics** - Dashboard summary with top products and movement trends
- **Inventory Alerts** - Automatic low-stock alert creation
- **Sales Transactions** - Dynamic demand data for optimization calculations

### Admin Web Dashboard
Pages live under `frontend-admin/src/pages/`, grouped into the same section
folders the sidebar shows, and each page keeps its test beside it:

| Section folder | Modules |
|---|---|
| `overview/` | Dashboard - Summary cards + bar/pie charts (recharts) + monthly trends |
| `inventory/` | Inventory Levels - Location-matrix view with low-stock highlighting and filters · Shelf vs System · Stocktake Schedule · Locations (+ QR tags) |
| `stock-control/` | Till · Stock Movement - FIFO/FEFO lot visualization · Stock Adjustments · Stock Transfers |
| `catalog-orders/` | Products - Create, edit, soft-delete with confirmation dialogs (+ QR tags) · Scan & Stock (QR) · Order Inquiries - Review/approve/reject/fulfill with confirmation |
| `insights/` | Optimization - ABC classification table + EOQ/ROP/Safety stock + Turnover ratio · Reports |
| `governance/` | Approvals · Audit Trail · System Settings |
| `account/` | Security (MFA) |
| `auth/` | Login |

Plus **snackbar notifications** - success/error feedback on all actions - and
**JWT token management** - automatic auth-header injection via `api.js` helpers.

### Mobile Customer App
- **Login** - JWT-based authentication with validation
- **Home** - Navigation hub with styled menu cards
- **Products** - Searchable list with pull-to-refresh + product detail view
- **Recommendations** - ABC-classified suggestions with color-coded badges + pull-to-refresh
- **Order Inquiry** - Multi-product selection, qty input, cost estimation, submit with validation
- **Order History** - Inquiry list with status badges + pull-to-refresh

### Inventory Optimization
- **Economic Order Quantity (EOQ)** - √(2DS/H) using actual sales/movement data (not hardcoded)
- **Reorder Point (ROP)** - Based on lead-time demand
- **Safety Stock** - Statistical safety buffer
- **ABC Classification** - Pareto-based (70/20/10) cumulative value analysis
- **Inventory Turnover Ratio** - Annual demand / average inventory
- **FIFO Lot Tracking** - Oldest stock consumed first

## Quick Start

### Prerequisites
- Node.js 22+ installed (Node 24 recommended)
- npm or yarn

### Backend

#### Option 1: Native (better-sqlite3)
```bash
cd backend
npm install
node src/seed.js    # Seed sample data
npm start           # Starts on http://localhost:4001
```

#### Option 2: npm-free fallback (no native modules)
```bash
cd backend
node src/server_npmfree.js   # Starts on http://localhost:4001
```

#### Notifications (email + SMS)

The backend sends **email and SMS** when an order inquiry's status changes
(approved / rejected / fulfilled) and a welcome email on signup. Providers are
optional, configured with env vars, and **log-only until configured** — no
provider means no cost and no setup, and nothing ever blocks the API:

```bash
# Email (https://resend.com — free tier)
export RESEND_API_KEY="re_..."                    # + optional EMAIL_FROM

# SMS — Semaphore (Philippine gateway, https://semaphore.co) or Twilio
export SEMAPHORE_API_KEY="..."                   # + optional SEMAPHORE_SENDER_NAME
# or
export TWILIO_ACCOUNT_SID="..." TWILIO_AUTH_TOKEN="..." TWILIO_FROM="+1..."
```

To receive SMS, the customer adds a **phone number** on the order-inquiry form
(optional field — email-only works without it). The message text is composed
in `backend/src/notify.js`; sending is fire-and-forget so a slow/absent
provider never delays an API response.

#### Option 3: Firebase (Firestore) — hosted, deploy-ready

The npm-free server can also persist to **Google Firestore** instead of JSON
files — same REST API, same generated clients, same contract tests, but the
data lives in a hosted, scalable database. See the
[Firebase (Firestore)](#firebase-firestore) section for the 5-minute setup.

```bash
cd backend
npm run start:firestore      # Requires FIREBASE_PROJECT_ID + service account
```

**Firestore is auto-selected** whenever the Firebase env vars are present —
you don't need the flag or `DB_DRIVER=firestore`; the same command, container
and clients work against JSON files or Firestore depending only on the
environment.

#### Option 3b: Firestore emulator (local Firebase, zero cloud setup)

Want the full Firestore driver without creating a Firebase project? The
**Firestore emulator** runs the exact same cloud code path locally — the
firebase-admin SDK auto-routes to `FIRESTORE_EMULATOR_HOST`, so **no service
account is needed** and the auto-selection treats the emulator as
"Firestore configured":

```bash
cd backend
npm run emulators:start               # terminal 1: Firestore emulator on :8085
npm run start:firestore:emulator      # terminal 2: backend on :4001 on Firestore
```

Then migrate your real SQLite data in:

```bash
npm run migrate:firestore:emulator            # push inventrak.db into the emulator
npm run migrate:firestore:emulator -- --dry-run  # preview counts first
npm run emulators:export                      # persist emulator state to .firestore-data
```

(The emulator scripts are cross-platform — they set `FIRESTORE_EMULATOR_HOST`
in JS, so they work on Windows cmd/PowerShell too, unlike a bash-style `VAR=x
npm run` prefix.) Same API, same Swagger UI, same contract tests — the only
difference is where the data lives. This is also the fastest way to try the
deployed architecture end-to-end before going to the cloud.

#### Option 4: Supabase (PostgreSQL) — the live deployment

The production backend on Render persists to **Supabase** (free tier, no
daily quota ceilings). The driver auto-selects whenever `SUPABASE_URL` and
`SUPABASE_KEY` are present, and takes precedence over Firestore when both
are configured (full precedence: CLI flag > `DB_DRIVER` env > Supabase >
Firestore > JSON files).

```bash
# 1. Create the tables (once per Supabase project — SQL Editor):
#    paste backend/src/supabase-schema.sql and run it
# 2. Point the backend at it:
cd backend
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_KEY=<service-role-key> \
npm run start:npmfree
```

The driver caches tables in memory at boot and flushes writes through, so
behavior is identical to the JSON/Firestore drivers — same API, same tests.

The emulator runs in **single-project mode**, and everything shares ONE
namespace: `firebase.json` pins the top-level `"project"` field, and the
Firestore driver requests that same project (env overrides
`FIREBASE_PROJECT_ID` / `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT` first). That
keeps the backend, the emulator UI, and `emulators:export` all on the same
project — no `Multiple projectIds` mismatch warnings, and no data silently
landing in a different project than the one you see in the UI. To move your existing SQLite data over once:

```bash
cd backend
npm run migrate:firestore            # push backend/data/inventrak.db → Firestore
npm run migrate:firestore -- --dry-run   # preview the row counts first
npm run migrate:check                # drift guard: fresh seed → transform must
                                     # reproduce the committed catalog (CI)
```

To keep the two **in sync** from then on (changeset-based, conflict-aware
bidirectional sync — see [Bidirectional sync](#bidirectional-sync)):

```bash
cd backend
npm run sync:firestore                    # merge both ways, apply
npm run sync:firestore -- --dry-run       # preview the changeset, touch nothing
```

### Admin Dashboard
```bash
cd frontend-admin
npm install
REACT_APP_API_BASE_URL=http://localhost:4001 npm start
# Opens on http://localhost:3000
# Login: admin / admin123
```

### Mobile App (Expo)
```bash
cd mobile-client
npm install
npx expo start          # or: npx expo start --tunnel
# Scan QR with Expo Go app (Android/iOS)
# Login: customer / customer123
```

For a **standalone installable APK** (no Expo Go, works on any network,
points at the live Render backend): see [`APK-INSTALL.md`](APK-INSTALL.md)
for the full build → transfer → install → demo checklist.

### Docker (Full Stack)
```bash
docker compose up --build
# Backend: http://localhost:4001
# Admin: http://localhost:3000
```

The container runs the unified server (`server_npmfree.js`) and passes the
`FIREBASE_*` env vars straight through: uncomment them in `docker-compose.yml`
and the backend runs on Firebase; leave them out and it uses the local JSON
files under the `backend_data` volume. The admin dashboard's backend URL is
configurable via `REACT_APP_API_BASE_URL` (see `frontend-admin/.env.example`).

> **Note for existing SQLite data:** the unified container reads the JSON
> catalog (and Firestore when configured) — it does **not** read
> `inventrak.db`. If you have real data accumulated in the SQLite database,
> migrate it to Firestore before switching (`npm run migrate:firestore`), or
> keep the original SQLite image (`CMD ["node", "src/server.js"]`).

### Deploying to production (free hosts)

A one-click **Render blueprint** (`render.yaml`) deploys the backend (running
on **Firebase Firestore** once the two `FIREBASE_*` env vars are set) plus the
admin dashboard static site — then point the mobile app's login-screen API URL
at the deployed backend. Full step-by-step runbook (Firebase setup, migration,
verification, plus Railway / Cloud Run alternates): **see [`DEPLOY.md`](DEPLOY.md)**.

### Running Tests
```bash
cd backend  npm test    # 56 suites, 732 tests, across both backends: SQLite,
            # npm-free, contract parity, OpenAPI conformance, Firestore +
            # Supabase stores, password policy, notifications, driver
            # selection, the SQLite→Firestore migration bridge, password
            # hashing, bidirectional sync, the migration-catalog drift guard,
            # the login lockout suite, security hardening, roles and RBAC,
            # MFA, QR lookup, FIFO/FEFO lots, the staff→admin adjustment loop,
            # the durable audit trail, costing records, customer records, and
            # bulk cost-of-goods entry

cd backend  npm run verify   # OpenAPI validation + route audit + generated-client
                            # freshness + the full suite (what CI runs)
```

### Spec Tooling (OpenAPI as source of truth)

`backend/openapi.json` is the **single source of truth** for the API contract.
Everything below is derived from it or verified against it — so the spec can't
drift from reality, and the clients can't drift from the spec:

```bash
cd backend
npm run docs:validate     # Validate spec against the official OAS 3.0.3 schema
npm run spec:audit        # Assert every code route <-> documented path coverage
npm run client:generate   # Regenerate the frontend API clients from the spec
npm run client:check      # Fail CI if the committed generated clients are stale
npm run docs:build        # Build the static docs site into ../docs (GitHub Pages)
npm run verify            # All of the above + the full test suite
```

**Test suites**
- `backend/src/test/contract.test.js` — boots the SQLite + npm-free servers in
  isolated temp dirs and asserts identical status + body *shapes* per endpoint,
  plus **value parity**: both backends seed from the same fixed-seed PRNG, so
  analytics counters, per-product inventory totals, the sales ledger and
  optimization values are asserted *equal*, not just same-shaped.
- `backend/src/test/openapi.test.js` — boots both servers and validates every
  actual response **and** request body against the OpenAPI schemas with ajv.
  This is the drift guard: even if both backends agree on a shape, a response
  that violates its documented schema (or an undocumented status code) fails.
- Both per-backend suites (`server.test.js`, `server_npmfree.test.js`) run in
  isolated temp data dirs, so the committed tests never touch the repo's real
  data files.
- `backend/src/test/firestore-store.test.js` — Firestore driver against an
  in-process fake Firestore (which rejects `null` exactly like the real SDK,
  so the driver's null→'' sanitization is genuinely exercised).
- `backend/src/test/driver-select.test.js` — the auto-selection matrix:
  Firestore is chosen whenever Firebase creds exist; `DB_DRIVER` pins and the
  `--firestore` flag still override.
- `backend/src/test/migrate-firestore.test.js` — the SQLite→Firestore bridge:
  dumps a **real temp SQLite database**, transforms it, pushes it through the
  fake Firestore, and boots the actual server in Firestore mode against the
  migrated data (login, products, inventory, movements, alerts).
- `backend/src/test/sync-firestore.test.js` — the bidirectional sync engine:
  canonicalizer agreement (SQLite→Firestore→re-read is a no-op), `''`/null
  equivalence, edits on **both** sides converging after two syncs, the three
  conflict policies, both deletions modes (union vs. mirror), stable product
  ids through a soft-delete + mirror, stock cleanup for soft-deleted
  products, the hashed-beats-plaintext `@users` tiebreak, and idempotency.
- `backend/src/test/check-migration-catalog.test.js` + `scripts/check-migration-catalog.js`
  — the migration **catalog drift guard**: seeds a fresh temp SQLite DB from
  the committed catalog and asserts `dumpSnapshot → transformSnapshot`
  (exactly what `migrate:firestore --dry-run` runs) reproduces the committed
  `products.json` / `inventory.json` / movements / inquiries. Fails on any
  drift (tampered stock, a product missing from inventory, a dropped field)
  so a real migration can never push stale data to Firestore.
- `backend/src/test/login-lockout.test.js` — the brute-force lockout shared by
  both backends: unit tests with an injected clock (threshold, exponential
  backoff, sliding window, success-clear, per-IP isolation, bucket pruning)
  plus integration tests that trip the real `/api/auth/login` on BOTH servers
  and assert they lock the same account after the same number of failures.
  The 429 lockout response is also asserted against the OpenAPI `LockoutError`
  schema in `openapi.test.js`.
- `backend/src/test/firestore-auth-hash.test.js` — **cloud-path hashing lock**
  (Firestore mode): boots the npm-free server against the in-process fake
  Firestore, registers a user via HTTP, and asserts the `@users` row
  **persisted to the cloud** is a bcrypt hash (never the plaintext) and that
  login verifies against it — plus per-user salting and a check that
  `/api/users` never leaks the hash.
- `backend/src/test/costing.test.js` — **costing records**: the economics of an
  order frozen at submission, so a catalog repricing cannot rewrite the profit
  of a past order. Covers the exact/imputed/none cost bases, and asserts the
  visibility rule for `products.cost` (stripped from every public read, admin
  sheet the only authenticated exception).
- `backend/src/test/customers.test.js` — **customer records**: the
  resolve-or-create identity rule (user_id → email → name), that two orders
  from one person yield exactly one Customer Record, that an existing row is
  enriched rather than duplicated, that a guest order still gets a record, and
  that the whole customer surface is admin-only.
- `backend/src/test/bulk-costs.test.js` — **bulk cost-of-goods entry**: the
  three-state cost cell (a number sets, `null` clears, an absent key skips) and
  the deliberate asymmetry with the bulk *price* sheet, where a blank is junk.
  Includes the round trip that matters: costing a product must not make it
  readable on the unauthenticated catalog.
- `frontend-admin/src/cost-sheet.test.js` — **the admin cost sheet parser and
  the margin maths**: 48 cases. The parser half pins that a blank cost cell
  means "leave this product alone" and never "clear it" — the rule that stops a
  partial sheet from silently wiping every cost it did not mention. The read
  half pins that an uncosted product has NO margin rather than a 0% one, and
  that the blended margin is value-weighted rather than an average of
  percentages (which would let a ₱200 cup count as much as a ₱1,000 sack).
- `frontend-admin/src/pages/catalog-orders/ProductsPage.costs.test.jsx` — **the cost work
  queue**: coverage, the filter chips, and the deliberate sort rule that sinks
  uncosted products to the bottom in *both* directions, plus inline cost editing
  and the blank-means-leave-alone diff in the sheet preview.

**Generated API clients** — `frontend-admin/src/api.generated.js` and
`mobile-client/src/api.generated.js` are generated from the spec
(`npm run client:generate`). The hand-written fetch calls are gone: both
`src/api.js` facades delegate to the generated client, which exposes the same
`apiGet/apiPost/apiPut/apiDelete` helpers the pages import **plus** one typed
function per OpenAPI operation (e.g. `login`, `listProducts`, `getInventory`).

### API Documentation

There are three ways to read the API docs — all are the same Swagger UI
rendered from `backend/openapi.json`:

**1. Hosted on GitHub Pages (no setup)**

```
https://qjncunanan01-ux.github.io/INVENTRAK/
```

The `docs.yml` workflow rebuilds and deploys the site to GitHub Pages on every
push to `main` (Source must be **GitHub Actions** in repo Settings -> Pages).
The badge at the top of this README shows the deploy status.

**2. In the repository (`docs/` folder)**

The self-contained static site lives in `docs/` — `docs/index.html` (Swagger
UI with the spec inlined) plus `docs/openapi.json` (the raw spec, downloadable
from the site's banner). Open it straight from the repo:

```bash
open docs/index.html
```

Regenerate it any time with:

```bash
cd backend
npm run docs:build
```

**3. Served live by the backends**

Both backends expose the spec and the interactive UI at runtime:

```bash
curl http://localhost:4001/api/openapi.json
# Open the interactive docs in a browser:
open http://localhost:4001/api/docs
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register a new user (strong password required) |
| POST | /api/auth/login | Login and get JWT token |
| GET | /api/auth/me | Get current user profile |
| GET | /api/products | List products (supports ?search=&page=&limit=) |
| GET | /api/products/categories | List product categories |
| GET | /api/products/costs | Cost-of-goods sheet (admin only) |
| POST | /api/products/bulk-costs | Set unit cost on many products (admin only) |
| GET | /api/products/:id | Get single product |
| POST | /api/products | Create product (admin) |
| PUT | /api/products/:id | Update product (admin) |
| DELETE | /api/products/:id | Soft-delete product (admin) |
| GET | /api/inventory | Get inventory per location (?low_stock=&location=) |
| GET | /api/locations | List locations |
| POST | /api/locations | Create location (admin) |
| DELETE | /api/locations/:id | Delete location (admin) |
| POST | /api/stock-movement | Record stock movement |
| GET | /api/stock-movements | List stock movements |
| GET | /api/stock-lots | List stock lots (FIFO) |
| GET | /api/order-inquiries | List order inquiries |
| POST | /api/order-inquiries | Create order inquiry |
| PUT | /api/order-inquiries/:id | Update inquiry status |
| GET | /api/order-inquiries/:id/costing | Immutable costing snapshot frozen at submission |
| GET | /api/customers | Customer Records with aggregates (admin only) |
| GET | /api/customers/:id | One customer's orders and purchase history (admin only) |
| PUT | /api/customers/:id | Edit a Customer Record (admin only) |
| GET | /api/optimization/:id | EOQ/ROP/Safety for a product |
| GET | /api/optimization/abc | ABC classification |
| GET | /api/optimization | Bulk optimization metrics |
| GET | /api/analytics/summary | Dashboard summary data |
| GET | /api/analytics/export/:type | Export products/inventory/movements (CSV or JSON) |
| GET | /api/alerts | Low stock alerts |
| PUT | /api/alerts/:id/resolve | Resolve an alert |
| POST | /api/sales | Record a sale |
| GET | /api/sales | List sales |
| GET | /api/users | List users (admin) |
| GET | /api/health/integrity | Data integrity audit (admin) |
| GET | /api/openapi.json | OpenAPI 3.0.3 specification document |
| GET | /api/docs | Interactive Swagger UI |

> Both the SQLite backend (`src/app.js`) and the npm-free fallback (`src/server_npmfree.js`) expose the same endpoint surface, verified by the contract test suite. The Firestore driver runs the **same** npm-free server with `DB_DRIVER=firestore`, so the endpoint surface is identical there too.

## Firebase (Firestore)

The backend can use **Google Firebase / Firestore** as its database, which is
what you want when you deploy beyond a single machine — hosted, scalable,
replicated data with no server to maintain. The REST API doesn't change at all:
the `json` and `firestore` storage drivers behind `server_npmfree.js` expose
the same `read/write` interface, so every client, test and the OpenAPI contract
works identically on either.

### Firebase as the database of it all

Firestore is the **default database whenever Firebase credentials exist** in
the environment — no flag, no config file, one codebase:

1. Set `FIREBASE_PROJECT_ID` + a service account (below), and the backend runs
   on Firestore automatically. Precedence: `--firestore` flag > `DB_DRIVER`
   pin > auto-select. To force local JSON files despite credentials, set
   `DB_DRIVER=json` (this is what the test suites do).
2. **Migrate your existing data** — one command pushes the live SQLite
   database (`backend/data/inventrak.db`) into Firestore, converting every
   table to the exact dataset shapes the server reads:
   ```bash
   cd backend
   npm run migrate:firestore -- --dry-run   # preview: products/inventory/movements/…
   npm run migrate:firestore                # write it
   ```
   `backend/src/migrate-firestore.js` owns the pure
   `dumpSnapshot → transformSnapshot` pipeline (unit-tested against a real
   temp SQLite DB + fake Firestore, including booting the server in Firestore
   mode against the migrated data). **The migration REPLACES the Firestore
   collections with the SQLite snapshot** — run it once (or re-run only when
   you deliberately want SQLite to win); anything written to Firestore since
   the last migration is overwritten. Passwords migrate as **bcrypt hashes**
   (both backends hash now); if any store still holds legacy plaintext, run
   `npm run hash:passwords` once — and every login auto-upgrades plaintext
   rows to hashes as a safety net.
3. **Keep it in sync** — instead of another one-shot overwrite, run the
   changeset-based **bidirectional sync** (`npm run sync:firestore`, see
   below) whenever you want the local SQLite DB and Firestore to converge:
   it diffs every dataset row-by-row, merges with a per-row conflict policy,
   and reports exactly what would change before writing anything.
4. **Connect everything** — the admin dashboard reads its backend URL from
   `REACT_APP_API_BASE_URL` (see `frontend-admin/.env.example`); the mobile app
   has the editable, device-saved API URL on its login screen. Point both at
   your deployed backend once, and they all talk to the same Firestore.

### Bidirectional sync

`backend/src/sync-firestore.js` (`npm run sync:firestore`) keeps the local
SQLite database and Firestore connected **continuously** instead of a one-shot
migration — per-row changesets, conflict-aware:

```bash
cd backend
npm run sync:firestore                        # merge both ways, then apply
npm run sync:firestore -- --dry-run           # show the changeset, touch nothing
npm run sync:firestore -- --direction=to-firestore   # one-way: SQLite wins
npm run sync:firestore -- --direction=to-sqlite      # one-way: cloud wins
npm run sync:firestore -- --conflict=keep-sqlite      # per-row conflict policy
npm run sync:firestore -- --conflict=keep-firestore
npm run sync:firestore -- --conflict=skip             # never overwrite a conflict
npm run sync:firestore -- --direction=to-firestore --deletions=propagate
```

- **Model** — every dataset is viewed through a common canonical shape on both
  sides (a row is the same row on SQLite and Firestore). A sync computes a
  per-row changeset (added / updated / removed / conflicting) and produces two
  write plans (`toLocal`, `toRemote`). The `''`-vs-`null` unset equivalence
  from the Firestore driver is baked in, so a row that only differs by
  null-handling is **not** a conflict. Passwords are redacted from reports.
- **Conflict resolution** (both sides edited the same row) — `last-write-wins`
  (default, newest `created_at`/`updated_at`), `keep-sqlite`, `keep-firestore`,
  or `skip` (leave both sides as-is, report the conflict).
- **Deletions** — `ignore` (default) is a **union** merge: rows seen on either
  side are kept on both, and presence-only rows are reported as candidates.
  `propagate` requires a one-way `--direction` and makes the plan a mirror
  (absent rows are dropped from the target) — review the `--dry-run` first.
- **Scope** — syncs the default SQLite backend (`backend/data/inventrak.db`)
  ↔ Firestore across products, inventory (per-location stock), movements,
  inquiries, users, sales, and alerts. The npm-free JSON-file mode is an
  ephemeral fallback and is not synced.

### How it works

- `backend/src/store-json.js` — the default driver (zero dependencies).
- `backend/src/store-firestore.js` — Firestore driver: keeps an in-memory cache
  of the collections, loads it at boot, and syncs every mutation to Firestore
  through a serialized write queue. Array-position semantics (product id =
  index + 1, stable ids, etc.) are preserved by storing each row as a
  Firestore document keyed by its id.
- **Null handling** — Firestore rejects `null` field values, and the server
  handlers write `null` for "no value" (e.g. a stock-in movement's
  `src_location`). The driver sanitizes `null → ''` on write (dropping
  `undefined` keys) and the read handlers normalize `'' → null` back, so JSON
  mode and Firestore mode return byte-identical JSON. The fake Firestore used
  by tests throws on `null` like the real SDK, so this can never silently
  regress.
- Users, sales and alerts are persisted to Firestore too, so customer
  registrations and sales survive restarts.
- On a **brand-new** project the server auto-seeds the product catalog and
  inventory from `backend/data/` so first boot just works.

### Setup (one-time, ~5 minutes)

1. **Create a Firebase project** at <https://console.firebase.google.com>.
2. **Enable Firestore** (Build -> Firestore Database -> Create database;
   production mode is fine).
3. **Create a service account**: Project settings -> Service accounts ->
   Generate new private key. You get a `*.json` credentials file.
4. **Set the environment variables** for the backend process:

   ```bash
   export FIREBASE_PROJECT_ID="your-project-id"            # Project settings -> General
   export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat path/to/serviceAccountKey.json)"
   # or, alternatively:
   export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/serviceAccountKey.json"
   ```

   On Windows (PowerShell): `$env:FIREBASE_PROJECT_ID="..."` etc.

5. **Seed (optional** — on a fresh project the server auto-seeds, so this is
   only needed to re-sync the catalog. It always overwrites products +
   inventory from `backend/data/` but **never touches existing movements,
   inquiries, sales, alerts, or user accounts**):

   ```bash
   cd backend
   npm run seed:firestore
   ```

6. **Run**:
   ```bash
   npm run start:firestore
   # Backend on http://localhost:4001 — same API, same Swagger UI at /api/docs
   ```

### Deploying

Because the server is a plain Node.js HTTP server, you can deploy it to any
Node host (Render, Railway, Fly.io, a VPS, or Google Cloud Run) — set the three
Firebase env vars above and start it (`npm start` auto-selects Firestore; no
flag needed). First deploy: run `npm run migrate:firestore` once (locally, with
the same env vars) to push your existing database, then start the server.
The mobile app and admin dashboard connect via their API URL — on the mobile
login screen the API URL is editable and saved on the device, so pointing them
at your deployed backend is a one-time edit.

The Docker image and `docker-compose.yml` are wired for this: the container
runs the unified server and forwards `FIREBASE_*` directly, so the same
compose file runs on JSON files locally and Firestore in production. For
workflows that edit data on both sides (local dev + cloud),
`npm run sync:firestore` converges them with per-row conflict policies — see
[Bidirectional sync](#bidirectional-sync).

**One-click path:** push to GitHub → render.com → New Blueprint → pick the
repo. The included `render.yaml` creates `inventrak-api` (backend) and
`inventrak-admin` (static site); add `FIREBASE_PROJECT_ID` +
`FIREBASE_SERVICE_ACCOUNT_JSON` in the dashboard and everything runs on
Firestore. See [`DEPLOY.md`](DEPLOY.md) for the complete runbook.

## CI/CD

This project includes GitHub Actions for automated testing and docs:
- `.github/workflows/ci.yml` — the single CI workflow, on push to
  main/master/develop and PRs to main/master. One source of truth per gate:
  - `backend` (Node 20 + 22): the whole `npm run verify` chain — OAS 3.0.3
    validation, route <-> spec audit, workflow-file guard, generated-client
    freshness, slides, then the full test suite — plus a check that the
    committed `docs/` output is a clean rebuild
  - `migration-catalog`: seeds a fresh temp SQLite DB from the committed
    catalog and fails if the migration transform output doesn't reproduce it
    (so catalog/seed/transform drift is caught before any Firestore migration)
  - `admin`: Vitest suite, production build, then the Playwright E2E flow
  - `mobile`: screen-structure guard for both Expo apps, then a Metro/Hermes
    Android export that has to produce a bundle
  - `security`: `npm audit --audit-level=high` for backend and admin, plus the
    committed-secret and hardcoded-password scans
- `.github/workflows/docs.yml` — runs the workflow-file guard too, then
  validates the spec and deploys the static Swagger UI site in `docs/` to
  GitHub Pages (enable Pages -> GitHub Actions)
  See [API Documentation](#api-documentation) for the live URL and local
  `docs/` instructions.

## Tech Stack

- **Backend**: Node.js, Express, SQLite (better-sqlite3), JWT, bcryptjs, pluggable storage drivers (JSON files, Firestore, **Supabase — the live deployment**), Resend/Semaphore/Twilio (optional notifications)
- **Admin**: React 18, Material UI 5, Recharts, React Router 7, Vite
- **Mobile**: React Native 0.86 (Expo SDK 57), React Navigation 7, Axios
- **Infrastructure**: Docker, Docker Compose, GitHub Actions

## Repository

https://github.com/qjncunanan01-ux/INVENTRAK


---

# AGENTS.md

Working agreements for AI agents and contributors on INVENTRAK. Read this before
editing. It records the things that are **non-obvious about this repo** — the ones
you would otherwise learn the hard way.

## What this is

A four-app inventory system with a real backend.

| Path | What it is | Runtime driver |
|---|---|---|
| `backend/` | Express API, the only place business rules live | SQLite (default), Supabase, or Firestore |
| `frontend-admin/` | Vite + React admin console, approvals queue | — |
| `staff-client/` | Expo app for warehouse staff | — |
| `mobile-client/` | Expo app for customers | — |

**Business logic goes in `backend/`.** If a rule is enforceable server-side, enforce
it server-side. The phone apps are thin; do not add authorization decisions to them.

## The one rule that bites hardest

**`backend/openapi.json` is the contract, and the clients are generated. Never hand-edit
any `api.generated.js`.**

```
backend/openapi.json  ──npm run client:generate──▶  */src/api.generated.js
```

`npm run verify` runs `client:check`, which fails if the generated clients have drifted
from the spec. So the real workflow when changing an endpoint is:

1. Edit the route in `backend/src/routes/`
2. Update the schema in `backend/openapi.json`
3. `cd backend && npm run client:generate`
4. Run `npm run verify`

Skipping step 2 is the most common way to break this build. `npm run spec:audit` also
flags routes that exist but aren't in the spec.

## Verify before you claim anything

Full detail in [docs/agent-skills/evidence-before-claims.md](docs/agent-skills/evidence-before-claims.md).
The short version: **do not write "tests pass" or "build is green" unless you ran the
command in this same message and read the output.** No "should", no "probably", no
relying on a previous run.

Pick the narrowest command that proves the claim, but run it completely:

```bash
cd backend && npm run verify        # docs:validate + spec:audit + workflows:check + client:check + 732 tests
cd backend && npm test              # just the suite
cd frontend-admin && npm test       # vitest
cd frontend-admin && npm run build  # catches what vitest misses
```

`backend` has no build step — it runs directly on Node. The Expo apps are validated by
Metro export, not a test suite:

```bash
cd staff-client && npx expo export --platform android   # also: mobile-client
```

## Deploy reality

- **EAS cloud Android builds are quota-blocked until 1 Oct 2026.** Don't try to fix a
  cloud build failure; it's the account, not the project. Use the local path in
  [mobile-client/LOCAL-BUILD.md](mobile-client/LOCAL-BUILD.md) instead.
- `mobile-client/android/` is CNG-generated and git-ignored. Build tooling is committed
  as scripts and docs, never as the native directory. Don't try to commit it.
- Backend deploys wipe the container filesystem. **Any state that must survive a deploy
  belongs in Supabase/Firestore, not SQLite.** See `backend/src/audit.js` and
  [DEPLOY.md](DEPLOY.md) — the durable audit sink derives itself from the Supabase driver
  config, so it needs no env vars; only the `audit_log` table has to exist. Check it with
  `GET /api/meta` → `.audit.enabled`.
- Changing a route's shape without redeploying the backend and the clients that consume
  it is the single most expensive mistake available in this repo.

## Writing code

Full detail in [docs/agent-skills/yagni-minimal-change.md](docs/agent-skills/yagni-minimal-change.md).

- **The ladder:** does this need to exist → is it already in this codebase → stdlib →
  native platform → already-installed dependency → one line → only then, the minimum.
- **Root cause, not symptom.** Before editing a function, grep its callers. One guard in
  the shared function beats a guard in every caller. Patching only the path a bug report
  names leaves every sibling caller still broken.
- **Never add a dependency for something a few lines can do.** This repo already runs
  deliberately few third-party packages, and `backend/` has a working npm-free mode.
- **Don't simplify away:** input validation at trust boundaries, auth checks, error
  handling that prevents data loss, accessibility basics, anything explicitly requested.

Two of those root-cause fixes have already paid off in this repo — see the comment
accident in `backend/src/routes/approvals.js` and the early-return/TDZ crashes in the
mobile QR screens. Both looked like single-line fixes and were not.

## Security

Full detail in [docs/agent-skills/security-hardening.md](docs/agent-skills/security-hardening.md),
with [security-checklist.md](docs/agent-skills/security-checklist.md) as the pre-sign-off walk.

- **Authenticate *and* authorize every protected route.** Authentication is not
  authorization: the caller must own or be permitted on the specific resource.
- Role checks are not decorative. `staff` / `admin` / `owner` / `superadmin` have
  distinct capabilities and the tests in `backend/src/test/staff-roles.test.js` and
  `roles.test.js` enforce them.
- **Never commit secrets.** `mobile-client/.keystore/`, `.env*`, and `*.apk` are all
  git-ignored for a reason. A secret that reaches a remote is compromised — rotate it
  first, then purge history.
- Parameterize every query. These are SQLite statements; string-concatenated input is
  injection.
- Before any demo or capstone submission, walk `security-checklist.md` end to end.

## Mobile UI

Full detail in [docs/agent-skills/mobile-design-material3.md](docs/agent-skills/mobile-design-material3.md).
Every rule in that file is tagged, and it names React Native and Expo explicitly.

**Every screen in this repo must work without a working camera.** The demo devices have
a broken camera and the EAS quota is blocked, so the phone camera is not a testable
input. Manual code entry is a first-class path on both phone apps, not a fallback bolted
on afterwards — keep it that way when adding screens.

## Reviews

[docs/agent-skills/code-review-five-axes.md](docs/agent-skills/code-review-five-axes.md)
covers the five axes. Two INVENTRAK-specific ones worth stating outright:

- **Scope small.** Most good changes here touch a handful of files. A change touching
  five directories is usually several changes.
- **Never commit or push without being asked.** Leaving work uncommitted for review is
  the expected end state.

## Third-party skill repositories

[docs/agent-skills/](docs/agent-skills/README.md) holds vetted instruction sets copied in
from four upstream repos (MIT / Apache-2.0, attribution preserved). Read them as
reference — nothing is installed or auto-loaded, and this repo has no plugin loader.
Before adding another, follow the vetting process in that README.

---

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
- **Pattern**: `requireAuth(req, res, true, handler)` for the admin tier, `requireAuth(req, res, STAFF_TIER, handler)` for staff+ — the role lists come from `backend/src/roles.js` rather than being hardcoded per route
- **Frontend**: `frontend-admin/src/App.jsx` RequireRole component redirects a role away from pages it may not open (staff land on `/inventory`, since the dashboard is a money/analytics surface)

### 5. Add Auth ✅
- **Implementation**: JWT tokens with HMAC-SHA256 signing, bcrypt password hashing
- **Files**: `backend/src/password-hash.js` (bcrypt), `backend/src/server_npmfree.js` (token signing)
- **Features**: Token revocation on logout, MFA (TOTP) for admin, recovery codes

### 6. Check User Permissions ✅
- **Implementation**: Five roles (owner, super_admin, admin, staff, customer) with distinct permission sets, resolved through explicit capability tiers
- **Tiers**: `ADMIN_TIER` (admin, super_admin, owner) for every money/pricing/revenue route; `MANAGEMENT_TIER` (super_admin, owner) for account/role/permission management; `STAFF_TIER` (staff + the admin tiers) for daily inventory work
- **Owner**: Full oversight + access decisions
- **Super Admin**: Everything above plus system accounts, roles and permissions
- **Admin**: Products, prices, inventory, inquiries, approvals, reports, analytics — may grant only staff/admin
- **Staff**: Read-only inventory, scan stock, propose adjustments (cannot approve, and is denied every money surface: `/api/analytics/summary`, exports, `/api/reports`, `/api/sales`, `/api/alerts`, `/api/users`)
- **Customer**: Own orders only, product catalog (QR scanning is a member feature on the mobile app)
- **Files**: `backend/src/roles.js` (single source of truth for the tiers), `backend/src/app.js` (`adminOnly`, `managementOnly`, `staffOrAdmin`), `backend/src/server_npmfree.js` (`requireAuth` allowed-roles resolution), `frontend-admin/src/roles.js` + `components/Money.jsx`
- **Money hiding**: the admin UI masks every peso figure (`••••`) for roles without revenue visibility, and the revenue aggregate itself (`/api/analytics/summary`) is now authenticated — an unauthenticated caller gets 401 rather than total sales
- **Role-change audit**: every grant writes an `auth.role_change` audit entry (actor, actor role, target, granted role)
- **Scan audit**: `POST /api/scan-events` records every QR/barcode scan — actor, role, decoded kind/target, storage area, raw payload — as a `scan.qr` audit entry (staff-or-admin)

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

### 13. Secure File Uploads ✅ (upload surface retired with OCR)
- **Implementation**: The OCR image-upload surface was removed with the OCR→QR migration — scanning sends only a short tag string now, so there is no user file upload left to validate
- **QR input surface**: tag payloads are length-capped strings parsed by a strict grammar (`backend/src/qr-codes.js`) — arbitrary payloads (URLs, scripts) never resolve (contract-tested)

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


---

# INVENTRAK Architecture

## System Overview

INVENTRAK is a full-stack inventory management system for Sylver Restaurant and Cafe Supplier, consisting of three independent applications sharing a single API backend.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Mobile App     │     │  Admin Dashboard │     │   Backend API   │
│   (React Native) │────▶│  (React + Vite)  │────▶│  (Node.js)      │
│   Expo / Web     │     │  Material-UI     │     │  Zero-dep core  │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                              ┌──────────▼──────────┐
                                              │   Database Layer     │
                                              │  ┌────────────────┐ │
                                              │  │ JSON Files     │ │
                                              │  │ (local dev)    │ │
                                              │  └────────────────┘ │
                                              │  ┌────────────────┐ │
                                              │  │ Supabase       │ │
                                              │  │ (PostgreSQL)   │ │
                                              │  └────────────────┘ │
                                              │  ┌────────────────┐ │
                                              │  │ Firestore      │ │
                                              │  │ (Cloud NoSQL)  │ │
                                              │  └────────────────┘ │
                                              └─────────────────────┘
```

## File Structure

```
INVENTRAK/
├── backend/                    # API server (Node.js)
│   ├── src/
│   │   ├── server_npmfree.js   # Zero-dependency HTTP server (2800+ lines)
│   │   ├── server.js           # Express-based server (SQLite)
│   │   ├── app.js              # Express routes (SQLite)
│   │   ├── db.js               # SQLite database setup + migrations
│   │   ├── schema.js           # DDL schema (single source of truth)
│   │   ├── store-json.js       # JSON file storage driver
│   │   ├── store-firestore.js  # Firestore storage driver
│   │   ├── store-supabase.js   # Supabase storage driver
│   │   ├── password-hash.js    # bcrypt hashing
│   │   ├── password-policy.js  # Strong password validation
│   │   ├── login-lockout.js    # Rate limiting + brute-force protection
│   │   ├── totp.js             # TOTP MFA implementation
│   │   ├── audit.js            # Security audit logging
│   │   ├── google-auth.js      # Google OAuth relay
│   │   ├── qr-codes.js         # QR tag grammar + product lookup (scan core)
│   │   ├── fsn.js              # FSN (Fast/Slow/Non-moving) inventory classifier
│   │   ├── notify.js           # Email + SMS notifications
│   │   ├── payments.js         # GCash/card payment integration
│   │   ├── prng.js             # Deterministic PRNG for demo data
│   │   └── test/               # 330 test cases
│   ├── openapi.json            # API contract (OpenAPI 3.0)
│   ├── scripts/                # Build + migration scripts
│   └── data/                   # Runtime data (JSON files)
├── frontend-admin/             # Admin dashboard (React + Vite)
│   ├── src/
│   │   ├── App.jsx             # Router + auth guard
│   │   ├── api.js              # API client facade
│   │   ├── api.generated.js    # Auto-generated from OpenAPI
│   │   ├── theme.js            # MUI theme (green brand palette)
│   │   ├── pages/              # page components, grouped by sidebar section (see MODULES.md §16)
│   │   └── e2e/                # 27 Playwright E2E tests
│   ├── vite.config.js          # Vite build config
│   └── index.html              # SPA entry with CSP headers
├── mobile-client/              # Mobile app (Expo + React Native)
│   ├── src/
│   │   ├── App.js              # Navigation + session management
│   │   ├── api.js              # API client with retry logic
│   │   ├── api.generated.js    # Auto-generated from OpenAPI
│   │   ├── screens/<section>/  # screen per navigator section (see MODULES.md §17)
│   │   ├── cart-context.js     # Shopping cart state
│   │   ├── flash-sale.js       # Daily flash deal rotation
│   │   ├── theme-context.js    # Light/dark theme
│   │   └── category-icons.js   # Product category icons
│   └── app.json                # Expo config (splash, icons)
├── scripts/                    # Build + sync scripts
├── SECURITY.md                 # OWASP compliance mapping
├── ARCHITECTURE.md             # This file
├── DEMO-SCRIPT.md              # Presentation walkthrough
├── DEPLOY.md                   # Deployment guide
└── render.yaml                 # Render Blueprint (one-click deploy)
```

## Database Schema

### Users
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| username | TEXT UNIQUE | Login identifier |
| password | TEXT | bcrypt hash (never plaintext) |
| role | TEXT | admin / staff / customer |
| email | TEXT | Verified via code |
| phone | TEXT | PH mobile number |
| email_verified | INTEGER | 0 = unverified, 1 = verified |
| google_sub | TEXT | Google OAuth subject ID |
| mfa_secret | TEXT | TOTP base32 secret |
| mfa_enabled | INTEGER | 0/1 |
| mfa_recovery | TEXT | JSON array of HMAC hashes |
| created_at | TEXT | ISO timestamp |

### Products
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Stable ID |
| name | TEXT | Product name |
| category | TEXT | Category (23 unique) |
| brand | TEXT | Supplier brand |
| description | TEXT | Product description |
| size | TEXT | Package size |
| unit | TEXT | Unit of measure |
| price | REAL | Supplier price (₱) |
| status | TEXT | active / inactive |
| image | TEXT | Photo path |

### Stock
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| product_id | INTEGER FK | |
| location_id | INTEGER FK | |
| quantity | REAL | Units at location |
| UNIQUE | (product_id, location_id) | One row per product-location |

### Customer Records
The business entity behind orders and sales (`backend/src/customers.js`).

Distinct from `users`, which are **accounts** (login, role, password). Guest
checkout is first-class, so a customer does not need an account — `user_id` is
an optional link and is null for walk-ins. Everything else previously lived
smeared across `order_inquiries` (name/email/phone, once per order) and
`sales_transactions` (`customer_name`, free text), which made "this customer's
history" unanswerable.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| name | TEXT | |
| business_name | TEXT | |
| contact_number | TEXT | |
| email | TEXT | Unique when present (case-insensitive partial index) |
| address | TEXT | |
| user_id | INTEGER FK | Optional link to the account; null for walk-ins |
| created_at / updated_at | TEXT | |

**Identity rule (resolve-or-create)**, in strict priority order:
1. `user_id` — an authenticated account is unambiguous and wins outright.
2. `email` — matched case-insensitively; the most stable thing a customer gives.
3. `name` — matched case-insensitively on the trimmed name; the only signal a
   counter sale has.
4. Nothing usable → **no row is created**. An unattributable sale must not
   corrupt customer aggregates.

An existing row is *enriched*, never overwritten: a second order that supplies a
phone fills in what the first one left blank, but a value already on record
wins, because that is the one the business actually took down.

`order_inquiries.customer_id` and `sales_transactions.customer_id` link to it.
Seeded/historical sales carry `customer_id = NULL` by design (they have only a
free-text name); link them with `npm run customers:backfill` (dry run by
default, `-- --apply` to write, idempotent).

Admin-only surface: `GET /api/customers`, `GET /api/customers/:id` (that
person's orders and purchases), `PUT /api/customers/:id`.

### Order Inquiries
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| customer_name | TEXT | |
| customer_email | TEXT | |
| customer_phone | TEXT | |
| products | TEXT | JSON array of items |
| estimated_cost | REAL | What the CUSTOMER PAYS (revenue), recomputed from line subtotals — despite the name, it is not a cost |
| status | TEXT | pending/approved/fulfilled/delivered/rejected |
| user_id | INTEGER FK | Links to account |
| status_history | TEXT | JSON timeline |
| payment_* | TEXT | Payment fields |

### Costing Records
Immutable snapshot of an inquiry's economics, written once at submission
(`backend/src/costing.js`). Because `estimated_cost` is derived from today's
catalog, repricing a product would otherwise rewrite the profit of every past
order.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| inquiry_id | INTEGER FK | UNIQUE — one snapshot per inquiry |
| total_cost | REAL | Null when nothing could be costed |
| total_revenue | REAL | What the customer was charged |
| target_quantity | REAL | Sum of line quantities — one ordered unit is one "cup" |
| cost_per_cup | REAL | total_cost / target_quantity |
| suggested_selling_price | REAL | Revenue needed to hit `margin_percent`: total_cost / (1 - margin) |
| estimated_profit | REAL | total_revenue − total_cost |
| cost_basis | TEXT | `exact` / `imputed` / `none` — how much is real |
| lines_priced / lines_total | INTEGER | How many order lines had a known cost |
| margin_percent | REAL | Target margin (`COSTING_TARGET_MARGIN`, default 30) |
| computed_at | TEXT | Timestamp |

Cost of goods itself lives on `products.cost` (nullable). It is **stripped from
every public product read** — catalog list, single product, QR lookup, public tag
page — because the catalog is served `Cache-Control: public, max-age=300` and the
gap between `cost` and `price` is the business's margin. The one authenticated
read that reveals it is `GET /api/products/costs` (admin tier only); see
`backend/src/product-visibility.js`.

## API Endpoints

### Public
- `GET /api/health` — Liveness probe
- `GET /api/products` — Paginated product catalog
- `GET /api/categories` — Category list
- `GET /api/inventory` — Stock levels
- `POST /api/auth/login` — Username/password login
- `POST /api/auth/register` — New account signup
- `POST /api/auth/google` — Google OAuth sign-in
- `POST /api/auth/verify-email` — Email verification
- `POST /api/auth/forgot-password` — Password reset
- `POST /api/auth/reset-password` — Reset password with code

### Authenticated (any role)
- `GET /api/auth/me` — Current user info
- `POST /api/auth/logout` — Server-side session revocation
- `GET /api/order-inquiries` — Own order history
- `POST /api/order-inquiries` — Place order inquiry
- `GET /api/notifications` — Order status updates
- `GET /api/products/qr/{code}` — Staff QR lookup: scan a tag → product + stock

### Staff
- `GET /api/reports` — Daily sales reports
- `POST /api/stock-adjustments` — Request stock adjustment
- `POST /api/stock-transfers` — Request stock transfer

### Admin Only
- `POST/PUT/DELETE /api/products/*` — Product CRUD
- `POST/DELETE /api/locations/*` — Location management
- `POST /api/stock-movements` — Record stock movements
- `PUT /api/order-inquiries/:id` — Approve/reject orders
- `GET /api/sales` — Full sales ledger
- `GET /api/users` — User management
- `GET /api/alerts` — Low-stock alerts
- `GET /api/analytics/summary` — Dashboard metrics
- `GET /api/audit-trail` — Security audit log entries
- `GET /api/cache/stats` — In-memory cache statistics (npm-free backend serves live data; Express twin reports zeroed counters)
- `POST /api/auth/mfa/*` — MFA enrollment

## Security Architecture

### Authentication
- Passwords hashed with bcrypt (cost factor 10)
- HMAC-signed session tokens (24h TTL, unique JTI)
- Rate limiting: 5 failed attempts → exponential backoff
- Generic error messages ("Invalid username or password")
- Server-side session revocation on logout

### Authorization
- Role-based access control (admin/staff/customer)
- Per-account data scoping (customers see only their orders)
- Backend enforces RBAC on every endpoint
- Frontend hides UI elements by role (defense in depth)

### Data Protection
- CORS restricted to configured origins
- CSP headers on all responses
- HSTS on HTTPS connections
- XSS protection (X-XSS-Protection: 0, modern CSP)
- Frame options (DENY) prevent clickjacking
- Request body size limit (100KB)

### Audit Logging
- All authentication events logged
- Admin mutations logged with user context
- PII redacted from logs (email, phone masked)
- Suspicious access attempts flagged

## Deployment

### Render (Production)
- Backend: Node.js web service (free tier)
- Admin: Static site (Vite build)
- Mobile: Static site (Expo web export)
- Auto-deploy on push to main

### Local Development
```bash
# Backend (JSON mode)
cd backend && npm start

# Admin dashboard
cd frontend-admin && npm run dev

# Mobile app (Expo Go)
cd mobile-client && npm start
```

### Docker
```bash
docker-compose up --build
# Backend: http://localhost:4001
# Admin: http://localhost:3000
```

## Test Coverage

| Suite | Tests | Framework |
|-------|-------|-----------|
| Backend API | 330 | Node.js test runner |
| Admin unit | 28 | Vitest |
| Admin E2E | 27 | Playwright |
| Visual regression | 15 | Playwright screenshots |
| **Total** | **400** | |

## OWASP Compliance

All 40 checklist items verified in `SECURITY.md`:
- Authentication: 6/6 ✅
- Authorization: 5/5 ✅
- Session Management: 5/5 ✅
- Input Validation: 4/4 ✅
- Error Handling: 3/3 ✅
- Logging: 6/6 ✅
- Cryptography: 4/4 ✅
- Secure Code: 4/4 ✅
- Database: 4/4 ✅


---

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
                # scoping, lockout, MFA, QR lookup, sync, migration drift guard …
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
- **Demo accounts** — `owner/owner123`, `superadmin/super123`, `admin/admin123`
  (web portal), `staff/staff123` (MOBILE app only), `customer/customer123`
  (quick-fill buttons on both login screens); rejected everywhere when
  `DISABLE_DEMO_ACCOUNTS=true`.
- **Portal split** — the web admin is a DESKTOP surface for Owner /
  Super Admin / Admin. A staff login sent with `portal: 'admin'` (what the
  web portal sends) is refused with `403 portal_mobile_only`; the same
  account signs in fine on the phone, where the staff tools live.

**Demo (2 min):** sign up with a weak password → rejected with the rule list.
Wrong password 5× → locked with growing wait. Google button → real Gmail
sign-in. (Owner + Authenticator app: Security page → MFA setup → scan QR →
confirm → log out → log in with the 6-digit code.)

**Test:** `npm test` includes password-policy, password-hash, login-lockout,
mfa, mfa-recovery, google-auth, google-relay, demo-accounts, logout,
verify-email suites.

---

## 4. Roles & authorization (four-tier RBAC)

**Roles** — one hierarchy, least → most privileged. The tiers live in ONE file
per side (`backend/src/roles.js`, mirrored by `frontend-admin/src/roles.js`) so
a new role is a one-line change instead of a hunt through 40 guards.

| Role | Login | May do | May NOT do |
|---|---|---|---|
| `owner` | `owner` / `owner123` | Everything: oversight, approvals, access decisions | — |
| `super_admin` | `superadmin` / `super123` | Everything above **plus** account/role/permission management | — |
| `admin` | `admin` / `admin123` | Products, prices, inventory, inquiries, approvals, reports, analytics | Grant privileged roles |
| `staff` | `staff` / `staff123` | Scan & Stock, stock levels, movements, adjustments, transfers | **Sales, prices, customers, orders, reports, analytics** |
| `customer` | `customer` / `customer123` | Mobile app: browse, inquire, track | Anything admin |

**Tiers** (used by every guard):

- `ADMIN_TIER` = `admin`, `super_admin`, `owner` — every money/pricing/revenue
  route. Inventory Staff is deliberately absent.
- `MANAGEMENT_TIER` = `super_admin`, `owner` — account, role and permission
  management. `POST /api/admin/promote` accepts an explicit `role`; a plain
  admin may grant `staff`/`admin`, only management may grant `super_admin`/`owner`.
- `STAFF_TIER` = `staff` + the admin tiers — the daily inventory modules.

**Where:** `adminOnly` / `managementOnly` / `staffOrAdmin` middleware in
`app.js`, the `allowed` resolution in `server_npmfree.js`'s `requireAuth`, the
`roles` arrays in `AdminLayout.jsx`'s `NAV_SECTIONS`, and `RequireRole` in
`App.jsx`. Money figures render through `components/Money.jsx`, which masks the
amount for any role without revenue visibility.

**Inventory Staff are MOBILE-ONLY.** The web admin refuses a staff login
(`403 portal_mobile_only`) — per the role spec, staff work (QR scanning,
physical counts, adjustment requests) happens in the mobile app, and the web
admin is a desktop surface for the admin tier. Staff tools on the phone:
Account tab → *Staff Tools → Scan & Count Stock*, plus the QR tag scanner
(Catalog → Scan a Product → *Scan a QR/barcode tag*).

**Demo (the money shot):** on the phone, log in as **staff** → Scan & Count
Stock → scan a product label → correct the count → submit → it's *pending*.
On the web, log in as **admin** (or **owner**) → Approvals shows the request →
approve → the stock count updates. On the web admin the peso figures show
`••••` for staff-tier eyes; every money page (Dashboard, Optimization,
Reports) belongs to the admin tier.

**Seeding the live database:** the cloud `users` dataset already exists and is
never overwritten, so a deployed instance keeps only the accounts it was seeded
with. After deploying a role change run
`npm run seed:demo-users` (env: `SUPABASE_URL`, `SUPABASE_KEY`; add `--reset` to
restore a demo password/role, `--firestore` for the Firestore driver). It
refuses to run when `DISABLE_DEMO_ACCOUNTS=true`.

**Test:** `backend/src/test/roles.test.js` (tiers, money access, role grants,
scan audit) + `backend/src/test/staff-roles.test.js` + `frontend-admin/src/roles.test.js`.

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
  created by staff via UI or the QR scan verify-and-count flow.
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

## 10. Notifications — email + SMS (`backend/src/notify.js`, `mobile-client/src/screens/orders/NotificationsScreen.js`)

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

## 11. QR product identification (scan a tag, resolve the product) — the project's focus area

**Pipeline:** staff opens the scanner → camera decodes the printed tag →
`GET /api/products/qr/{code}` resolves the tag's identifier server-side →
product + live per-location stock + FIFO/FEFO lots return → staff verifies the
physical count per location and submits → **pending approval** (owner
approves). The QR carries only an identifier (`INVENTRAK:PROD:<id>` or a SKU
like `PRD-000001`) — never quantities, prices or authorization.

- **Backend:** `qr-codes.js` — payload grammar, deterministic SKU
  (`PRD-000001`, UNIQUE index), shared lookup handler used by both backends
  (400 invalid / 404 unregistered / 409 inactive product).
- **Admin (Scan & Stock page):** live QR camera (jsQR) or tag-paste/upload
  fallback → product card with per-location counts → submit → approval queue.
- **Mobile (customer app):** Scan tab — product tag opens the product page
  (members), location tag opens that storage area's stock. Guests see the
  login gate.
- **Mobile (staff app):** Scan Tag module — same lookup feeds the
  verify-and-count card (shared `CountCard`).
- **Guardrails:** staff-or-admin gate on the lookup (403 for customers),
  unknown payloads → explicit "not registered" alert + scan-event audit,
  duplicate-scan lock + cooldown so one tag cannot double-submit.

**Demo:** admin → Scan & Stock → point the camera at a printed product tag →
product identified with live stock → adjust counts → submit → approve as
owner → stock updates. Phone: Scan tab → point at the tag.

**Test:** `qr-lookup.test.js` (grammar + both-backend lookup contract +
security), `staff-roles.test.js` (endpoint gates), `frontend-admin/src/qr.test.js`
(payload builder).

---

## 12. QR & barcode scanning (the project's focus area)

**Where:** tag generation in `frontend-admin/src/qr.js` (shared payload
helpers) + `components/QrTagSheet.jsx`; tags printed from **Locations → Print
tag sheet** and **Products → Product QR tags**; scanning in
`mobile-client/src/screens/catalog/QrScanScreen.js` and the admin's **Products →
Scan / paste QR tag** box; audit in `POST /api/scan-events`.

**Payload contract** (must match on both sides — pinned by
`frontend-admin/src/qr.test.js`):

| Tag | Payload | Scan result |
|---|---|---|
| Location | `INVENTRAK:LOC:<id>:<name>` | stock view scoped to that storage area |
| Product | `INVENTRAK:PROD:<id>` | that product's stock across every location |
| Foreign QR | — | explicit "not an INVENTRAK tag" alert, never a silent miss |

Product tags carry only the id, so a tag printed last week still resolves
after a rename. The admin's scan box accepts exactly what the phone emits and
jumps to `/inventory?product=<id>` (or `?location=<name>`).

**Printing:** both dialogs have a **Print** action; `@media print` rules in
`index.css` hide the rest of the app so only the tag grid lands on paper
(3 across, two-line captions so a printed sheet can be filed by eye).

**Scan audit trail:** every scan — recognized or not — is POSTed to
`/api/scan-events` and appears in **Audit Trail** as a `scan.qr` entry (who,
role, decoded kind/target, storage area, raw payload). The phone's scanner uses
synchronous locking + a 1.5s cooldown so one tag cannot fire a dozen scans, and
logs even when it cannot navigate.

**Demo:** Locations → **Print tag sheet** → print/cut → phone Scan tab → point
at a location tag (scoped stock opens) → point at a product tag (the product's
stock opens) → point at any random QR (friendly "not recognized" alert) →
admin **Audit Trail** now lists every scan with the account that made it.

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

**Date-range filter (Days / Weeks / Months / Quarterly / Annually):** the
**Analysis window** control on the Optimization page is the shared
`components/RangeFilter.jsx`. It maps a preset to an FSN window
(Day/Week → 7, Month → 30, Quarter → 90, Year → 365, All → 730) — the endpoint
accepts any integer in `[7, 730]`, so the four old fixed choices became six
presets with no backend change.

**Test:** value parity of optimization outputs asserted across both backends
in `contract.test.js`; FSN unit + parity tests in `fsn.test.js`
(`GET /api/optimization/fsn?window=<days>`).

---

## 13b. Date-range filter (Days / Weeks / Months / Quarterly / Annually)

**Where:** presets in `frontend-admin/src/dateRange.js`, control in
`components/RangeFilter.jsx`; the backend resolves the same window in the
shared `backend/src/date-range.js`.

| Screen | What the range filters |
|---|---|
| Dashboard | sales + movement analytics (totals, this-month KPIs, velocity and monthly charts). Inventory counts/products/locations are point-in-time and stay unfiltered. |
| Reports | the report window — sent as `?from=&to=` and clamped server-side (`GET /api/reports`) |
| Optimization | the FSN analysis window (see above) |

`parseDateRange` accepts either `?from=YYYY-MM-DD&to=YYYY-MM-DD` or the legacy
`?days=N`, ignores malformed values instead of trusting them, and caps the
window at 5 years so a hostile `from` cannot force an unbounded table scan.

**Test:** `frontend-admin/src/roles.test.js` / `qr.test.js` cover the client
side; the reports range is exercised through `contract.test.js` and
`openapi.test.js` (the response echoes `range: { from, to }`).

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

**Pages — grouped into section folders** under `src/pages/`, mirroring the
sidebar's `NAV_SECTIONS` (`pages/layout/AdminLayout.jsx`). Each page keeps its
Vitest suite beside it:

| Folder | Pages |
|---|---|
| `overview/` | Dashboard |
| `inventory/` | Inventory Levels · Shelf vs System (reconciliation) · Stocktake Schedule · Branch Locations (+ QR tags) |
| `stock-control/` | Till · Stock Movement · Stock Adjustments · Stock Transfers |
| `catalog-orders/` | Products (+ QR tags) · Scan & Stock (QR) · Order Inquiries |
| `insights/` | Optimization · Reports |
| `governance/` | Approvals (admin-only) · Audit Trail · System Settings (management) |
| `account/` | Security (MFA, admin-only) |
| `auth/` | Login (cross-cutting) |
| `layout/` | AdminLayout — the shell every page renders inside |

`NotFoundPage.jsx` and the two source-guard suites (`fieldAccessibility.test.js`,
`layoutOverflow.test.js`) sit at the `pages/` root. Role badge in the top bar
(ADMIN/STAFF); quick-fill demo-credential buttons with role chips on login.

**Env:** `REACT_APP_API_BASE_URL` (defaults to `http://localhost:4001`) —
set it at build time to point at the deployed backend.

**Test:**

```bash
npm test           # Vitest: 267 tests, 23 files (pages + layout)
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
(+ staff tools) · Scan (QR) · QR/Barcode scanner · Stock Availability ·
Forgot Password.

**Layout:** the screen files live under `src/screens/<section>/`, one folder per
navigator surface (`home/ catalog/ cart/ orders/ account/ auth/`) — the same
section-folder rule the admin pages follow (§16), enforced by
`npm run structure:check`.

**Demo account:** `customer/customer123` (or Google sign-in). Staff features
unlock automatically when a staff/admin account signs in.

**Production APK:** see **[APK-INSTALL.md](APK-INSTALL.md)** — build via EAS
(`eas build -p android --profile production`), download link, transfer, install.

---

## 17b. Mobile staff app (`staff-client/`) — QR, counts & adjustment requests ONLY

A **separate, staff-only app** (own APK, package `com.inventrak.staff`, installs
alongside the customer app). It contains **no cart, no catalog, no orders, no
analytics** — only the three on-floor workflows, matching the role spec:
"Inventory Staff may use the mobile application to scan QR codes, check
physical stock, and submit inventory records for approval."

**Run:**

```bash
cd staff-client
npm install
npx expo start              # QR for Expo Go (same-Wi-Fi dev)
EXPO_PUBLIC_API_URL=https://inventrak-api.onrender.com npx expo start
                            # talk to the deployed backend from any network
```

**Build the APK:**

```bash
cd staff-client
npx eas-cli build -p android --profile production    # APK via EAS
```

**Screens (5 separate modules + login — one workflow per module, never merged):**

| Module | What it does |
|---|---|
| Login | **Staff-exclusive gate:** sends `portal: 'staff'`, which the SERVER enforces — admins/owners/customers are refused with `403 staff_app_exclusive` (client-side role gate as defense in depth). Session persists (AsyncStorage) so shift devices stay signed in. |
| **Scan Tag** | Live QR/barcode camera ONLY: location tags → that storage area's stock inline; product tags → count card. Every scan is audited server-side. (The retired Label-Scan OCR module merged into this module.) |
| **Count** | No-camera path: searchable inventory list → tap a product → enter per-location physical counts → submit as PENDING adjustments. |
| **Requests** | The staff member's submitted adjustments with live status (pending / approved / rejected) and decision trail. |
| Account | Shift identity + role badge, dark mode, logout (revokes the token server-side). |

**Layout:** `src/screens/<section>/` — `auth/ qr-scan/ count/ stocktake/`
`requests/ account/`, one folder per tab plus login, enforced by
`npm run structure:check`.

**Same brand palette as the customer app and web admin** — one INVENTRAK look across all three apps (light + dark).

**APIs it may call (the whole surface):** login/logout, `/api/inventory`,
`/api/locations`, `/api/stock-lots`, `GET /api/products/qr/{code}` (QR
product lookup), `GET|POST /api/stock-adjustments`, `POST /api/scan-events`.
Approve/reject endpoints are **not** in the app — approvals live on the web
admin (maker-approver separation).

**Demo:** `staff/staff123`. Admin/owner/customer accounts get "The staff app is
exclusively for Inventory Staff. Admins and owners use the web admin dashboard."

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

`.github/workflows/ci.yml` — the single CI workflow, on push to
main/master/develop and PRs to main/master, one source of truth per gate:
`backend` (Node 20 + 22) runs the whole `npm run verify` chain (spec
validation, route↔spec audit, workflow-file guard — including npm-script
references — client freshness, slides, full suite) plus a check that the
committed `docs/` output is a clean rebuild; `migration-catalog` drift guard;
`admin` Vitest suite + build + Playwright E2E; `mobile` screen-structure
guard for both Expo apps + a Metro/Hermes Android export; `security` audits
(backend + admin, `--audit-level=high`) and the committed-secret /
hardcoded-password scans.
`.github/workflows/docs.yml`: runs the workflow-file guard too (cross-
coverage — a workflow that does not parse never starts its own jobs, so
ci.yml needs a second file to report it), then rebuilds and deploys the
GitHub Pages Swagger site.

---

## 22. File map (cheat sheet)

```
backend/src/
  app.js                 # SQLite/Express server (native driver)
  server_npmfree.js      # npm-free server (JSON/Firestore/Supabase drivers)
  store-json|firestore|supabase.js   # storage drivers (same interface)
  schema.js / db.js      # SQLite DDL + connection (migrations inline)
  config.js              # named tunables (auth, inventory, rate limits, HTTP)
  qr-codes.js            # QR tag grammar + product lookup + SKU rules
  payments.js            # GCash/PayMongo checkout
  notify.js              # email/SMS providers (log-only when unconfigured)
  google-auth.js         # Google OAuth ID-token verify (JWKS)
  totp.js / login-lockout.js / password-*.js   # auth stack
  audit.js / csrf.js / sanitize.js / cache.js  # security + perf middleware
  product-lines.js       # order-line normalizer (both backends)
  prng.js / seed.js      # deterministic seed data
  fsn.js                 # FSN Fast/Slow/Non-moving classifier (shared)
  migrate-firestore.js / sync-firestore.js / seed-firestore.js  # data tooling

backend/scripts/
  audit-routes.js             # route ↔ openapi.json coverage guard
  check-workflows.js          # workflow YAML + npm-script refs guard (§21)
  generate-client.js          # regenerates both api.generated.js clients

frontend-admin/src/
  api.js / api.generated.js   # typed API client (generated from openapi.json)
  pages/<section>/            # one page per admin module, grouped by the
                              # sidebar's sections (overview/ inventory/
                              # stock-control/ catalog-orders/ insights/
                              # governance/ account/ + auth/ login, layout/
                              # shell) — see §16
  pages/*.test.js               # tree-wide source guards (a11y, layout)
  components/                 # LiquidGlassCard, AnimatedCounter, …
  *.test.jsx                  # shared helper suites (roles, qr, cost-sheet, …)

mobile-client/src/
  api.js / api.generated.js   # client + wakeBackend() cold-start retry
  screens/<section>/          # one file per screen, grouped by the navigator
                              # that shows it: home/ catalog/ cart/ orders/
                              # account/ auth/ — see §17
  theme-context.js / AnimatedEntry.js / BackButton.js  # shared UI

staff-client/src/
  screens/<section>/          # one file per screen: auth/ qr-scan/ count/
                              # stocktake/ requests/ account/ — see §17b

scripts/
  demo-launch.js              # one-command demo boot
  check-app-structure.js      # screen-section + orphan guard, both apps (§21)
```


---

# ALGORITHMS.md — Decision-Support & Pricing Algorithms in INVENTRAK

Every calculation the system uses to turn raw inventory, sales and cost data into
decisions — with the **basis**, the **formula as implemented**, a **worked example
from the deterministic seeded dataset**, and **how to show it to a panel without
opening the source**.

Every number below is reproducible from a clean clone:

```bash
cd backend
npm run seed     # deterministic: fixed-seed PRNG -> identical 612-row ledger
npm run verify   # 732/732
```

**The deck:** [`docs/algorithms-deck.html`](docs/algorithms-deck.html) — this whole
document as a slide presentation, with the rehearsal table below printed as the
speaker line on the slide it belongs to. It is one self-contained file: open it
straight from disk with no install and no network. `←`/`→` move, `C` opens the
contents, `N` toggles speaker notes, `F` fullscreen, `P` prints to PDF, and a
number jumps to that slide. Rebuild it from `backend/` with `npm run slides`;
`npm run slides:check` fails if this document and the deck ever drift apart, and
it is wired into `npm run verify` for that reason.

---

## ⚡ How to show this without showing the code

This is the section to rehearse. **None of these algorithms require showing
source.** Each one is visible in the running app — the formula renders *beside*
its own numbers, and the per-product "Why?" tooltip shows the exact inputs that
produced a single classification.

| # | Algorithm | Show it here | What to say |
|---|---|---|---|
| 1 | ABC classification | **Optimization → ABC tab** | "37% of my items make 70% of my value. The banner shows the rule; the tooltip shows this product's exact inputs." |
| 2 | FSN analysis | **Optimization → FSN tab** | "Same product, different question — ABC is *value*, FSN is *movement*." |
| 3 | EOQ | **Optimization → EOQ/ROP panel** | "This is how many cases per order." |
| 4 | ROP + safety stock | Same panel; **stock badges** | "This is when to trigger." |
| 5 | Critical level | **Inventory page**, badges (web + mobile) | "Per-product, not one flat number." |
| 6 | FIFO / FEFO | **Scan & Stock** — pick a dated lot | "The expiring lot leaves first. Watch the batch number change." |
| 7 | Turnover ratio | **Optimization page** | "Capital parked on shelves." |
| 8 | Target-margin pricing | **Products → Margin overview** | "This price buys the 30% target. One click applies it." |
| 9 | Cost normalization | **Products → Bulk sheet → supplier rate** | "Type one supplier rate, fill 102 costs." |
| 10 | Three-state cost parse | **Products → Bulk sheet → Parse preview** | "A blank cell is *not* a clear. Here's why that matters." |
| 11 | Immutable costing snapshot | **Order Inquiries → any submitted order** | "Reprice the catalog; this order's profit did not move." |
| 12 | Customer identity resolution | **Reports → per-customer history** | "612 legacy sales, now grouped into 3 real customers." |
| 13 | RBAC tier wall | Log in as **staff**, then as **admin** | "Same button, different role, different outcome." |
| 14 | Exponential-backoff lockout | Fail a login 5× | "Wait time doubles each breach." |
| 15 | TOTP / MFA | **Security → Enable MFA** | "RFC 6238, server-verified." |
| 16 | The counter sale | **Stock Control → Till** | "One tap writes the revenue row, takes the stock off the shelf — and it shows you WHICH batch, before and after." |
| 17 | Shelf-vs-system reconciliation | **Inventory → Shelf vs System** | "Count the shelf. Here is what the ledger cannot account for." |

**If a panel member asks "prove it"** — the strongest single move is the
**cross-backend contract test**: the SQLite backend and the npm-free/Firestore/
Supabase backend are *different implementations* of these algorithms, and
`npm test` asserts they return **byte-identical numbers**. Same algorithm, two
engines, same answer. That is a correctness argument that no screenshot gives
you.

---

## Algorithm map — how they feed each other

```
sales_transactions ledger
        ▲
        │  POST /api/sales ── the counter sale (§16) writes BOTH sides:
        │  revenue row  +  stock decrement  +  FEFO lot consumed
        │
        ├──► ABC ───────────────── "WHAT matters?"      (value)
        ├──► FSN ───────────────── "WHAT is moving?"    (frequency + recency)
        │         │
        │         └──► Critical Level "WHEN to alert?"  (per-product threshold)
        │
        └──► EOQ ───────────────── "HOW MUCH to order?"  ROP/Safety Stock ── "WHEN?"

stock_lots ──────► FIFO / FEFO ─── "WHICH batch leaves?"  (▲ consumed by the sale too)
product sizes ───► Normalization ─► "COST per 100 ml/g/piece" ─► Target margin ─► Price
```

---

# PART A — Replenishment (the classic inventory algorithms)

## 1. ABC Classification

**Question:** *Which products deserve the tightest monitoring?*

### Basis — the Pareto principle

A classical inventory observation: **a small share of items creates most of the
value**. ABC ranks products by total sales value, walks the ranking accumulating
a share of the total, and cuts at conventional breakpoints. (Named for Vilfredo
Pareto's income distribution; popularised in quality management as the 80/20
rule by Joseph Juran. *If a panel asks for a primary source, cite your textbook —
this doc deliberately does not invent a page number.*)

- **Class A** — inside the first **70%** of cumulative value → the vital few.
  Tight control, frequent counts, priority replenishment.
- **Class B** — 70%–**90%** → normal control.
- **Class C** — the tail → loose control, bulk orders.

### Formula (as implemented — `backend/src/routes/optimization.js`)

```text
annualValue(p) = Σ sales_transactions.total_amount  WHERE product_id = p
sort DESC by annualValue;  total = Σ annualValue
cumShare(p) = (Σ value of 1..p) / total

Class = A if cumShare ≤ 70
      = B if 70 < cumShare ≤ 90
      = C otherwise
```

### Live result — the Pareto shape appears on its own

| Class | Items | Share of catalog | Share of value |
|---|---|---|---|
| **A** | **76** | **37%** | **69.8%** |
| **B** | 53 | 26% | 20.1% |
| **C** | 75 | 37% | 10.2% |

**Thirty-seven percent of the catalog produces seventy percent of the value.**
Nobody was told to make that happen; it is what falls out of the ranking.

### The A-list top 7 (every figure below is the endpoint's own output)

| Rank | Product | Annual value | Units | Cum. share | Class |
|---|---|---|---|---|---|
| #1 | Nutella Ferrero Food Service (3KG) | ₱68,635 | 37 | 2.7% | A |
| #2 | Lotus Biscoff Smooth Spread (3KG) | ₱66,250 | 25 | 5.2% | A |
| #3 | Strawberry Puree 64OZ | ₱60,000 | 30 | 7.6% | A |
| #4 | Torani Strawberry Puree Blend (64OZ) | ₱56,000 | 28 | 9.8% | A |
| #5 | DLA Pistachio Filling (1KG) | ₱54,366 | 26 | 11.9% | A |
| #6 | Da Vinci Caramel Sauce (2L) | ₱44,940 | 42 | 13.6% | A |
| #7 | Da Vinci White Chocolate Sauce (2L) | ₱38,520 | 36 | 15.1% | A |

**Why spreads and fillings outrank milk.** ABC ranks by *value × frequency*, not
by unit price. A café buys chocolate spread and nut filling constantly; the
₱1,855 Nutella is not the top item because it is expensive, but because it sells
**37 cases**. Contrast the tail: **Oatbedient Artisan Oatmilk Barista (₱520,
rank #202)**, **Marie Condensada (₱642, #203)**, **Milklab Oat Milk (₱656, #204)**
— all C.

**The nuance worth saying out loud:** condensed milk is still *milk*, but its
pack and price keep it in C. **ABC ranks by what sells, not by what it is.**

> **Note:** `Milklab Full Cream Milk (12L)` sits at **rank #12, ₱36,450,
> cum. share 22.3%** — A-class, but outside the top 7.

---

## 2. FSN Analysis (Fast / Slow / Non-moving)

**Question:** *Is the product actually moving?*

### Basis — usage-rate classification

Where ABC ranks by **value**, FSN ranks by **movement** — how *often* a product
sells and how *recently* it last sold. A widely-used retail and pharmacy
technique, in the VED/FSN family. *(The classification is standard industry
practice; cite your textbook for the primary source rather than trusting a
specific attribution here.)*

The pair is complementary and the combinations are the actual insight:

| | Fast (F) | Slow (S) | Non-moving (N) |
|---|---|---|---|
| **Class A** | ★ protect — the core business | review price / range | **investigate — high value, dead stock** |
| **Class C** | fine | minor | ignore |

### Formula (as implemented — `backend/src/fsn.js`)

```text
transactions = count of sales inside the window
frequency    = clamp( window / transactions, 1 … window )   // avg days between sales
recency      = today − date of last sale                      // days
ratePerDay   = totalQty / window

N = zero transactions in the window                        → dead stock
F = frequency ≤ 7 days  OR  recency ≤ 7 days
S = everything else
```

**Why 7 days:** café supplies run on a *weekly* replenishment rhythm. An item
that hasn't sold this week, and doesn't average weekly sales, is not flowing.
The `OR` is deliberate — **recency rescues genuinely popular items whose average
interval is skewed by one early sale.** Da Vinci Caramel Sauce below is exactly
that case: average interval 30 days, but it sold 4 days ago, so it is Fast.

The page sorts **N → S → F** so the dead stock the owner must act on surfaces first.

### Live result — 90-day window, measured 2026-10-03

| Class | Products |
|---|---|
| **F** (Fast) | 86 |
| **S** (Slow) | 93 |
| **N** (Non-moving) | 25 |

| Product | Txns | Frequency | Recency | Class | Why |
|---|---|---|---|---|---|
| Da Vinci Caramel Sauce (2L) | 3 | 30.0d | **4d** | **F** | recency ≤ 7 fires, despite a 30-day average |
| Nutella Ferrero Food Service (3KG) | 3 | 30.0d | **2d** | **F** | same — sold this week |
| Oatbedient Artisan Oatmilk Barista | 0 | — | — | **N** | no sale in the window |
| Acc Caramel Syrup (1KG) | 0 | — | — | **N** | no sale in the window |

> ⚠️ **Reproducibility caveat — state this if challenged.** ABC is
> time-invariant: it reads the whole ledger, so the numbers above are exact and
> reproducible forever. **FSN is time-*dependent*** — `recency` is measured
> against the current date, so classes shift as the calendar moves. That is
> correct behaviour, not a bug; the date above is stamped for that reason.

**To see F flip live:** widen the window to Annually, or scan a product in via
Stock In to record today's movement — it hits the `recency ≤ 7` arm immediately.

---

## 3. EOQ — Economic Order Quantity

**Question:** *How many units should one purchase order contain?*

### Basis — the Harris classical lot-size model (1913)

Two costs oppose each other:

- **Ordering cost (S)** — delivery, paperwork, receiving labour. Paid **per
  order**, so ordering small amounts often is expensive.
- **Holding cost (H)** — capital tied up, spoilage, space. Paid **per unit per
  year**, so ordering rarely in bulk is expensive.

EOQ is the order size where the two curves cross at their minimum.

> **Primary source (confident):** F. W. Harris, *"How Many Parts to Make When"*,
> Factory and Industrial Management, 1913.

### Formula (as implemented)

```text
EOQ = √( 2·D·S / H )

D = annual demand (units/year, from the ledger)
S = ordering cost per order  → 50  (constant, as implemented)
H = 0.20 × C                 (capital-carrying rate of 20%)
C = product.price
```

> **Honest modelling note — say this before a panel finds it.** `C` is the
> **selling price**, because the seeded catalog ships with `cost = NULL` for
> every product. In production, once costs are entered, holding cost should be
> derived from *cost*, not price — price is a revenue figure and capital is tied
> up in what the goods cost. The formula takes `C` as a parameter precisely so
> this is a one-line change.

### Worked example — Da Vinci Caramel Sauce (2L)

```text
D = 42 cases/year          (ledger total for this product)
C = ₱1,070                 H = 0.20 × 1,070 = ₱214
S = ₱50

EOQ = √(2 × 42 × 50 / 214) = √19.6 ≈ 4 cases per order
```

**Interpretation:** don't buy a pallet at once (holding cost soars on a
perishable) and don't buy one case daily (delivery cost soars) — order in
**~4-case batches**.

| Product | D | C | H | EOQ | Stock on hand | Turnover |
|---|---|---|---|---|---|---|
| Da Vinci Caramel Sauce (2L) | 42 | ₱1,070 | ₱214 | **4** | 190 | 0.22× |
| Nutella Ferrero Food Service (3KG) | 37 | ₱1,855 | ₱371 | **3** | 321 | 0.12× |
| Oatbedient Artisan Oatmilk Barista | 4 | ₱130 | ₱26 | **4** | 240 | **0.02×** |

Oatbedient is the one to point at: **0.02×/yr** — a ₱520 product sitting on 240
units of shelf. That is a number a panel can see is *obviously* wrong for a
healthy business, and the system reports it without being asked.

> **Model assumptions (fair to state at a defense):** demand is constant and
> known; costs are linear; no quantity discounts. Real cafés deviate — which is
> exactly why EOQ is paired with Safety Stock (buffer against variability) and
> FSN (reclassifies as behaviour changes).

---

## 4. ROP + Safety Stock, and the Critical Level

**Question:** *At what stock level must replenishment be triggered?*

### ROP + Safety Stock (as implemented)

```text
leadTimeDays = 7
ROP          = ⌈ (D / 365) × leadTimeDays ⌉
safetyStock  = ⌈ √D × 0.1 ⌉
```

For Da Vinci Caramel Sauce: `ROP = ⌈0.115⌉ = 1`, `SS = ⌈√42 × 0.1⌉ = ⌈0.65⌉ = 1`.

> **State the limitation:** a 7-day lead time and a 10%-of-demand buffer are
> *parameters*, not derived facts — the business has not supplied real supplier
> lead times. They are exposed as named constants precisely so they can be
> replaced with measured values.

### Critical Level — the per-product threshold (what the badges actually use)

Before this, every product shared one flat **80-unit** threshold — wrong in both
directions: a fast-moving milk selling 40/day hits empty long before an 80-unit
alert fires, while a display piece raises a false alarm forever. The critical
level is therefore derived per product from its own FSN classification.

### Formula (`backend/src/critical-level.js`, exact)

```text
cycleDemand  = ratePerDay × LEAD_TIME_DAYS[class]
safetyStock  = ⌈ cycleDemand × SERVICE_FACTOR[class] ⌉
demandLevel  = ⌈ cycleDemand ⌉ + safetyStock

criticalLevel = clamp( max(demandLevel, CLASS_FLOOR[class]), MIN_LEVEL, MAX_LEVEL )
```

| Class | Lead time (days) | Service factor | Class floor |
|---|---|---|---|
| **F** Fast-moving | 7 | 0.65 | 120 |
| **S** Slow-moving | 14 | 0.50 | 60 |
| **N** Non-moving | 30 | 0.25 | 32 |

`MIN_LEVEL = 5`, `MAX_LEVEL = 5000` — the absolute clamp, so a data spike can
never produce an absurd threshold.

**Worked example — a fast mover selling 40/day** (the motivating case):

```text
cycleDemand = 40 × 7 = 280
safetyStock = ⌈280 × 0.65⌉ = 182
demandLevel = 280 + 182      = 462
criticalLevel = max(462, 120) = 462      → comfortably above the old flat 80
```

**Why it matters:** it is movement-aware, so the same alert means different
things for different products — which is exactly the criticism the flat threshold
deserved. The `CLASS_FLOOR` is what keeps a brand-new product (no sales history)
at an orderable threshold instead of zero, and the badge ladder is:

```text
qty ≤ 0              → out_of_stock
qty ≤ criticalLevel  → critical
qty ≤ ⌈level × 1.5⌉  → low_stock     (1.5× is owner-tunable; ≤1 is refused)
otherwise            → in_stock
```

> The widening factor comes from live System Settings. A factor of 1 or less is
> **rejected**, because it would collapse the "low" band onto the critical level
> and make the badge unreachable.

---

## 5. FIFO / FEFO — Stock-Lot Consumption Order

**Question:** *Which batch leaves the shelf first?*

### Basis — the two classical issue disciplines

- **FIFO** (First-In, First-Out) — consume in arrival order. Correct when value
  decays with age.
- **FEFO** (First-Expired, First-Out) — consume the batch with the **earliest
  expiry** first. Correct where the product *becomes unsellable* with age.

For a café, perishable dairy and syrups make **FEFO** the governing rule and FIFO
the fallback for non-dated stock. FEFO is standard practice in food safety and
pharmaceutical inventory management, where the expiry date is a regulatory fact
rather than a preference.

### Formula (the consumption sort, identical in both backends)

```text
sort lots by:
   1. lots WITH an expiry date, earliest first
   2. lots WITHOUT an expiry date
   3. within each group, earlier arrival first  (FIFO tiebreak)

then consume greedily down the sorted list.
```

Each consumption emits a **manifest** — `[{ expiry_date, qty }, …]` — which is
what lets a *transfer* recreate matching destination lots. **The expiry travels
with the goods**, so moving stock between branches cannot silently reset its
best-before date.

---

# PART B — Pricing & Costing (the INVENTRAK-specific algorithms)

These are not textbook inventory algorithms; they are the decisions this system
makes that a spreadsheet cannot.

## 6. Target-Margin Pricing

**Question:** *What price buys a target margin, and which products are below it?*

### Basis — gross margin on price, solved algebraically

Gross margin is defined on the **selling price**, not on cost:

```text
margin% = (price − cost) / price
```

Setting `margin = t` and solving for price gives the price that achieves it:

```text
price = cost / (1 − t/100)
```

> The common mistake is `price = cost × (1 + t)` — that yields the margin *on
> cost*, not on price, and undershoots the target. Worked: at C = ₱330 and
> t = 30%, the naive formula gives ₱429, which is a **23.1%** margin — 6.9 points
> short. The correct price is ₱471, so the mistake costs **₱42 per unit**.

### The rounding detail worth defending

The suggestion is `⌈cost / (1 − t/100)⌉` — **rounded up, not to nearest.**
Rounding to nearest lands *below* the target whenever the exact figure is
fractional (cost ₱850 at 30% → 1214.28 → **1214**, a 29.98% margin). The row
would stay flagged as under-priced forever while a reprice reported success.
Rounding up guarantees the suggestion clears the very threshold that flagged it.
`frontend-admin/src/reprice.test.js` replays the write and asserts the list
empties.

### Live result

3 costed products in the demo dataset, all below the 30% target, each with the
price that fixes it. **The margin overview also flags cost ≥ price (loss-makers)
separately** — at a 0 count today, and that count is the honest state.

---

## 7. Cost Normalization — one supplier rate → a costed catalog

**Question:** *Suppliers quote "₱___ per litre". The catalog stores per-bottle
cost. How do they connect?*

### Basis — unit normalisation onto a common basis

Products are priced and costed **per single unit**, so a 1kg bag and a 750ml
bottle are not comparable: both read "margin 40%" and neither tells you which
earns more per litre. Normalisation divides both price and cost by the same
quantity onto a common basis.

> Scaling price and cost by the *same* factor cannot change a margin
> percentage — so this is for **comparability across sizes**, not for changing
> the answer about any one product.

| Dimension | Common basis | Source fields |
|---|---|---|
| volume | per 100 ml | `750 ML`, `2 L`, `1.89 L`, `cl`, `dl` |
| weight | per 100 g | `1 KG`, `610G`, `16.5 OZ`, `lb` |
| count | per **piece** | `50PCS`, `unit = bottle/can/box` |

### The bug this design guards against — say it, it is your best point

**`kg` and `l` are both 1000.** A lookup that returns only a multiplier cannot
tell them apart, and reports a **kilogram of chocolate as a litre of syrup** —
which then gets costed at a per-litre rate and reports success. The parser
therefore carries the **dimension** with every factor, not just the number.

### Conservative by construction

A wrong parse is worse than no parse: it writes a fabricated cost and makes every
margin downstream confidently wrong. So the parser returns `null` whenever the
text is ambiguous, and unreadable products get a **blank** cost cell — which the
cost sheet already reads as *"leave this product alone"*. A bad parse degrades to
**"still uncosted"**, never to **"a made-up cost"**.

Deliberately **not** done: converting a ₱/kg figure to ₱/L (different commodities,
different densities — that would be invented, not measured), and word-form
multipacks ("dozen of 250ml" — only numeric `6 x 250ml` is recognised).

### Live result

| Dimension | Products | Reading |
|---|---|---|
| volume | 102 | ₹ per 100 ml |
| weight | 50 | per 100 g |
| count | 17 | per piece |
| **no size recorded** | **35** | excluded — the panel names this count |

169 of 204 products are readable. **The 35 without a size are reported, not
silently skipped** — adding a size to a product brings it into the rate.

---

## 8. The Three-State Cost Parse

**Question:** *In a pasted sheet, what does a blank cost cell mean?*

### Basis — ambiguity must resolve to the safe reading

A cost sheet needs three instructions — *set this*, *clear this*, *ignore this* —
and they must not collapse into each other:

| Input | Meaning | Why |
|---|---|---|
| `380` | **set** the cost to 380 | unambiguous |
| `-` / `clear` / `none` | **clear** to "not costed" | spelled out deliberately |
| *(blank)* | **leave alone** | ⚠️ the safe default |
| `abc` | **junk — report it** | never silently 0 |

**Why blank must mean "leave alone":** defaulting blank → clear is the
catastrophic reading. An admin who downloads the current cost sheet, fills in
four products, and re-uploads would **silently wipe the other 200 real costs** —
and the response would still report success.

This is mirrored exactly in the server contract (`backend/src/costing.js`), the
admin sheet (`frontend-admin/src/cost-sheet.js`) and the CLI script
(`backend/scripts/backfill-costs.js`) — one rule, three implementations, all
tested against the same cases.

**The sibling trap:** `Number('') === 0`. An unreduced cell is *junk*, not a free
product. This has been hit three times in this codebase — in the cost sheet, in
the CLI parser, and in the normalisation module. Each is now guarded and tested.

---

## 9. Immutable Costing Snapshot

**Question:** *A past order quotes a profit. The catalog changes. Which is true?*

### Basis — derived figures must be frozen at the moment of decision

An inquiry's stored `estimated_cost` is recomputed from live line subtotals, so
reprice a product today and **last month's order silently reports a different
profit**. A quote given to a customer must not be retroactively rewritten.

The system writes an immutable `costing_records` row at submission —
`UNIQUE(inquiry_id)`, never updated — carrying `total_cost, total_revenue,
cost_per_cup, suggested_selling_price, estimated_profit, cost_basis`.

> **Defensible property:** `cost_basis` distinguishes a *measured* cost from an
> *assumed* one. An uncosted product reports `cost_basis: "none"` — a null, not a
> zero. Conflating those two is what makes an uncosted catalog look like a
> business in trouble.

**Live demo:** open any submitted order, then reprice its product, then reopen the
order. The figures do not move.

---

## 10. Customer Identity Resolution

**Question:** *612 legacy sales rows carry only a free-text name. Whose are they?*

### Basis — deterministic entity resolution with a strict identity order

```
user_id  →  email  →  name  →  (nothing)
```

A candidate is matched in that order, first match wins. If none applies, the row
is **left unlinked** — the system never invents a person to make a total add up.
This is the same shared module (`backend/src/customers.js`) on both backends, so
the answer cannot differ between them.

**Why it matters:** every customer attribute used to be smeared across
`order_inquiries` (name/email/phone, once per order) and `sales_transactions`
(free-text name). "This customer's history" was **unanswerable** — two orders
from the same person typed slightly differently look like two people.

**Live result:** the 612 seeded sales resolve to **3 real customers** —
Juan Dela Cruz (₱855,968), Maria Santos (₱865,167), Jose Rizal (₱849,928), 204
sales each — via `npm run customers:backfill`: dry-run by default, idempotent,
and it re-reads before reporting success so the verification cannot report a
stale result. Those three figures sum to the ₱2,571,063 ledger total above, which
is the cheapest way to check them: if they don't add up, one of them came from a
different database.

---

# PART C — Security algorithms

## 11. The RBAC Tier Wall

**Question:** *What does "admin only" actually mean?*

### Basis — role hierarchies with least privilege, enforced server-side

```
customer <  staff <  admin <  super_admin
                        └── owner (full oversight + authorises access decisions)
```

Enforced in the **backend**, not the UI — the phone apps are thin and make no
authorisation decisions. `cost` is stripped from *every* non-admin product read
(**unconditionally**, because the public catalog is CDN-cacheable and a
role-dependent payload could be served to an anonymous visitor from a shared
cache).

**Live demo:** log in as `staff` and open the cost endpoints. 403. The button is
hidden in the UI *and* the wall holds server-side — the panel can test either.

## 12. Exponential-Backoff Login Lockout

### Basis — throttling a sustained attack harder over time

Per `(username, source-IP)`: count failures in a sliding window; on breach, lock
the account for a duration that **doubles** per successive breach, capped. A
single typo costs nothing; a sustained attack is throttled progressively. Success
clears the counter immediately.

## 13. TOTP / MFA

### Basis — RFC 6238 (time-based one-time passwords)

6-digit codes derived from `⌊(T − T₀)/X⌋` with HMAC-SHA-1, **server-verified**
with a replay window. Secrets are stored hashed; recovery codes are single-use
and hashed too, so a database leak yields neither.

> Primary source (confident): **RFC 6238**. Related: **RFC 7519** (JWT),
> **RFC 2104** (HMAC).

---

# PART D — The counter sale

## 16. One transaction, both ledgers

**Question:** *A customer walks into the café, pays, and walks out. What actually
happens in the database?*

This is the most common transaction in the business and the easiest to get
half-right, so it is worth walking through in full.

### The request

```http
POST /api/sales        Authorization: Bearer <admin/staff token>

{ "product_id": 1, "qty": 2, "location_id": 1, "customer_name": "Walk-in" }
```

### What the server does, in order

| # | Step | Why it is that way |
|---|---|---|
| 1 | **Price is read from the catalog**, never from the request body | A till device is the least trustworthy number in the chain. If the total came from the client, anyone could post `"total": 1`. |
| 2 | **`location_id` is required** | "Which shelf did this leave?" decides *which* FEFO lot is consumed and *which* low-stock alert fires. Defaulting it would hide the question instead of answering it. |
| 3 | **Availability checked before anything is written** | An oversell is refused with **409**, not allowed to drive stock negative — a negative quantity silently corrupts critical level and turnover. |
| 4 | **Customer resolved** (order: user_id → email → name) | A walk-in has no account, so name-only. This is what later groups the 612 seeded sales into real people. Guarded: customer bookkeeping never fails a sale. |
| 5 | **`sales_transactions` row inserted** | Feeds ABC, FSN, EOQ, turnover, Reports and per-customer history. |
| 6 | **Stock decremented at that location** | `stock.quantity −= qty` |
| 7 | **FEFO lot consumed** (§5) — same helper a staff stock-out uses | The expiring batch leaves the shelf first, on the most frequent sale type, not just on a scan. |
| 8 | **Low-stock alert refreshed**, `sale.recorded` audit written | The one write where money changes hands leaves a trail. |

The response reports what happened, so the till can show it. This is verbatim
output from the running server on the deterministic seed, selling 3 units of
product 1 from location 1:

```json
{ "ok": true, "total": 3210, "sale_id": 613, "location_id": 1,
  "location": "Showroom", "stock_remaining": 110 }
```

`3210 = 3 x 1070`, where `1070` is the catalog price read from the database.
Stock went **113 → 110**.

### Showing it without showing the code

**Stock Control → Till.** The screen deliberately names the batch **twice**:

- **Before** — "FEFO — this batch leaves first: Lot #613 · 3 units · expires
  2026-10-21", worked out client-side from the same ordering rule the server
  applies. Staff see the expiring syrup going out first rather than being told
  afterwards.
- **After** — the receipt replays the server's own consumption manifest:
  "Lot #4 · 2 units", plus "2 units accounted for — the ledger and the shelf
  agree", plus any low-stock alert the sale raised ("42 left, reorder at 120").

The second one is read back from the server, not recomputed, so the screen
cannot claim a batch the database did not actually consume. Overflow stock with
no covering lot is labelled **"Unbatched stock"** rather than given an invented
batch number.

### The bug this design closed — say it, it is your best point

Before this, `POST /api/sales` wrote **only the revenue row**. Verified by
running the previous commit (`HEAD~1`) against the **same seed** and comparing
it with the current one — not by reading the code:

```
BEFORE   Almond @ Showroom: 113
POST     {"product_id":1,"qty":3,"customer_name":"Maria (walk-in)"}
         {"ok":true,"total":3210}          ← revenue recorded, nothing else
AFTER    Almond @ Showroom: 113           ← unchanged
FEFO lot for that product/location: qty 113  ← not consumed
```

The old response did not even accept a `location_id`, so there was nowhere for
it to decrement. Reproduce it yourself:

```bash
git archive HEAD~1 | tar -x -C /tmp/old && cd /tmp/old/backend
INVENTRAK_DB_PATH=/tmp/old.db PORT=4002 node src/server.js
# then POST /api/sales and watch /api/inventory
```

The system was **split in half**. Every algorithm above reads
`sales_transactions`, so the *decision* half was already correct — ABC, FSN,
EOQ, turnover and per-customer history all updated on a walk-in purchase. But
the *inventory* half silently did not move, so critical level (which compares
against live stock) and turnover (which divides by it) were computed on numbers
that were already wrong. And FEFO — the rule in §5, five sections of this
document — was never consulted here, so the expiring syrup stayed on the shelf
while fresh stock was sold around it.

### The parity bug behind it

The npm-free backend keeps the lot ledger in memory and lazily synthesises lots
for stock that predates it. That backfill used to bail out **as soon as any lot
existed**, so once a single stock-in happened the untouched seeded quantities
stayed lot-less: FEFO ignored them and the shortfall fell through the
"legacy/overflow" branch with no expiry attached. It now covers only the
**shortfall** per product/location and is idempotent, so a pair that already
balances gains nothing and re-reading can never inflate the ledger.

**Both backends share one code path**, so the counter and the back-room cannot
drift — and the cross-backend contract test asserts they land on the same
number.

---

## 17. Shelf-vs-System Reconciliation (shrinkage)

**Question:** *The shelf and the ledger disagree. Which products, and how much money?*

### Basis — and the two things it refuses to pretend

Two facts constrain the whole design, and both were found by reading the
schema rather than assuming:

1. **There is no recorded opening balance.** The seeder invents per-product
   stock numbers and writes no movement rows for them. So the obvious formula
   `expected = stock − sales` is arithmetically meaningless here — it just
   echoes the seed back. Any report claiming to know the opening stock would
   be inventing it.
2. **Physical stock is only observable by counting.** No database can detect
   that a bottle walked out. Only a person on the shelf can.

Which leaves one comparison that is both computable and honest.

### Formula (`backend/src/reconciliation.js`, exact)

```text
expected_now   = counted − recorded_sales_since_the_count
unexplained    = system_now − expected_now

unexplained > 0  →  the system believes stock that is NOT on the shelf.  LOSS.
unexplained < 0  →  more is on the shelf than expected.               OVERAGE.
```

`counted` is a real stocktake. `system_qty` is **snapshotted at the moment of
the count** (`POST /api/inventory/count`), because once the stock column moves
on, the variance the counter found can no longer be computed at all.

### Worked example — verified against the running backend

```text
Mon  count 113   system said 113   variance   0     <- stocktake, everything agreed
     sale of 5 through the Till                -> system 108
     3 units leave with NO record              -> shelf is really 105
Fri  count 105   system said 108   variance  −3     <- the counter found them

REPORT  counted 105 · sales since 0 · expected 105 · system now 108
        UNEXPLAINED = +3   -> loss
        3 units x Php 1070 selling price = Php 3,210 at risk
```

### What it deliberately does not claim

- **It does not name a cause.** A unit missing from a shelf is identical in
  the data whether it was stolen, broken, or rung up on paper. The report says
  "unaccounted for" and stops. A test asserts the word "theft" never appears in
  a finding — only in the disclaimer explaining why it cannot be known.
- **It does not blame anyone.** `counted_by` is on screen for the audit trail.
- **It does not hide its own gaps.** Counts with an unusable timestamp, and
  sales whose timestamp cannot be read, are counted in the summary rather than
  quietly folded into a clean-looking total.

### The bug worth defending

Found by running it, not reading it: `sales_since_count` came back **0** for a
sale that had definitely been recorded.

SQLite's `datetime('now')` writes `2026-10-03 16:38:32` — UTC, space-separated,
**no zone marker**. `Date.parse` reads that shape as *local* time. On a UTC+8
machine (the Philippines) that is an **eight-hour error** against the ISO `Z`
rows the seeder writes, and a count can order against a sale it should follow.
Second-resolution stamps also collide with a sale made in the same second.

Both spellings are now parsed explicitly as UTC, and the count is stamped at
millisecond precision. The same-instant sale is then *included*, because
excluding it makes the physical expectation too high — **overstating** a loss
the business cannot have committed. Understating merely delays a finding;
overstating money-at-risk accuses someone of shrinkage.

---

## Verification — reproduce every number in this document

```bash
cd backend
npm run verify      # 732/732 across 56 suites
```

Every test file in `src/test/` is listed in the `npm test` script — 56 files,
all run. (Three of them had been left off the list, so 106 real tests were
being skipped without anyone noticing.)

| Claim in this doc | Suite that locks it |
|---|---|
| FSN classification + dual-backend parity | `src/test/fsn.test.js` |
| FEFO overrides FIFO; expiry travels with transfers | `src/test/fefo.test.js` |
| Counter sale: stock decrement, FEFO, oversell refusal, audit, consumed-lot manifest | `src/test/walk-in-sales.test.js` |
| Reconciliation arithmetic, sign convention, UTC stamps, tier split, cross-backend value parity | `src/test/reconciliation.test.js` |
| Reconciliation wording never names a cause | `frontend-admin/src/reconciliation.test.js` |
| Till: FEFO preview + receipt, batch labels | `frontend-admin/src/till.test.js`, `frontend-admin/src/pages/TillPage.test.jsx` |
| Settings RBAC + live effect, end-to-end flows, adjustment expiry | `src/test/settings.test.js`, `src/test/e2e-ci.test.js`, `src/test/adjustment-expiry.test.js` |
| Critical level: floors, clamps, badge ladder | `src/test/critical-level.test.js` |
| ABC endpoint parity across drivers | `src/test/contract.test.js` |
| Three-state cost parse | `src/test/costing.test.js`, `src/test/bulk-costs.test.js` |
| Normalisation never conflates kg with L | `frontend-admin/src/cost-normalize.test.js` |
| Reprice clears the under-priced list | `frontend-admin/src/reprice.test.js` |
| Customer identity order | `src/test/customers.test.js`, `src/test/backfill-scripts.test.js` |
| Maintenance scripts, Supabase + SQLite | `src/test/supabase-rest.test.js` |
| Role wall / cost confidentiality | `src/test/roles.test.js`, `src/test/security.test.js` |
| Lockout backoff | `src/test/login-lockout.test.js` |

### Reproducing the dataset figures

```bash
cd backend
INVENTRAK_DB_PATH=$(mktemp -d)/clean.db node -e "
  const {db}=require('./src/db');
  const {seedDatabase}=require('./src/seed');
  seedDatabase({db});
  console.log(db.prepare('SELECT COUNT(*) n FROM sales_transactions').get().n);   // 612
  console.log(db.prepare('SELECT ROUND(SUM(total_amount)) v FROM sales_transactions').get().v); // 2571063
"
```

The seeder uses a **fixed-seed PRNG** (`backend/src/prng.js`) and a fixed draw
order shared by the SQLite and npm-free backends, so this reproduces
**byte-identically** on any machine, any day. That is itself a defensible claim:
*the demo data is reproducible, not hand-typed.*

> **Do not compute these from `backend/data/inventrak.db`.** That file drifts as
> the app is used. The committed catalog is `backend/data/products.json`, and
> `npm run seed` is what regenerates a known state.


---

# INVENTRAK — Capstone Progress Tracker

**Overall status: ~62% of the capstone complete** (31 of 50 tracked milestones done, as of September 10, 2026).

> How to read this: the checklist below is the full project plan split into 50 concrete
> milestones. Checked items are **shipped and verified** in the live system (not just
> coded — tested and deployed). This file is the single source of truth for progress
> reports to the adviser/panel.

| Workstream | Done | Total | % |
|---|---|---|---|
| 1. Core Platform & Deployment | 6 / 6 | 100% |
| 2. Authentication & Security | 7 / 8 | 88% |
| 3. Role-Based Access & Approvals | 4 / 4 | 100% |
| 4. Inventory & Multi-Location | 4 / 6 | 67% |
| 5. QR Scanning | 6 / 6 | 100% |
| 6. Decision Support (EOQ/ROP/ABC/FSN) | 4 / 4 | 100% |
| 7. Customer Mobile App | 5 / 8 | 63% |
| 8. Notifications | 3 / 4 | 75% |
| 9. Payments | 1 / 4 | 25% |
| **10. Paper, Testing & Presentation** | **0 / 8** | **0%** |
| **TOTAL** | **32 / 50** | **64%** |

---

## 1. Core Platform & Deployment — 6/6 ✅

- [x] Backend API with all business modules (`/api/*`, Swagger docs at `/api/docs`)
- [x] Three swappable storage drivers — JSON (dev), Firestore, Supabase (live) — one interface
- [x] Deployed live on Render: `inventrak-api.onrender.com` (auto-deploys on push)
- [x] Admin dashboard deployed live: `inventrak-admin.onrender.com` (Vite build, code-split)
- [x] Public API docs site on GitHub Pages (Swagger UI)
- [x] CI pipeline: tests + catalog-drift guard + OpenAPI client regeneration on every PR

## 2. Authentication & Security — 7/8

- [x] Username/password login with bcrypt hashing + password policy
- [x] Generic "invalid username or password" errors (no user enumeration)
- [x] Failed-login lockout (anti brute-force)
- [x] Email/SMS verification codes (HMAC-keyed, persistent across redeploys)
- [x] Google sign-in (OAuth relay → Firestore/Supabase `google_sub` link, real-name usernames)
- [x] Admin MFA (TOTP) + one-time recovery codes, hashed at rest
- [x] Full OWASP hardening pass + audit log + `SECURITY.md` mapping every control to code
- [x] **Durable audit trail** — every event mirrors to a Supabase `audit_log` table, so the trail survives a redeploy (the sink is derived from the `SUPABASE_*` vars the driver already uses, so there is nothing to configure; check it with `GET /api/meta → .audit`)
- [x] **Customer Records** — the business entity behind orders and sales, distinct from a login account, resolved by user_id → email → name and enriched rather than duplicated; admin read/edit API plus an idempotent backfill of the 612 pre-existing sales rows
- [ ] External security review / penetration test write-up for the paper

## 3. Role-Based Access & Approvals — 4/4 ✅

- [x] Three roles wired end-to-end: Customer / Staff / Owner(Admin)
- [x] Maker–approver queue: staff stock adjustments stay *pending* until the owner approves
- [x] Per-account data isolation (orders, cart, notifications) — regression-tested on both backends
- [x] Role badges + demo-credential quick-fill on web and mobile for presentations

## 4. Inventory & Multi-Location — 4/6

- [x] Product catalog (204 items) synced to the real Sylver price list
- [x] Per-location stock: Showroom, Stockroom 1, Stockroom 2 (tags + consolidated totals)
- [x] FIFO stock movements ledger + full stock adjustment/transfer workflows
- [x] FEFO (First-Expired, First-Out) lot consumption — optional expiry_date per lot; expiring lots are consumed before non-expiring stock, transfers carry expiry to the destination, and an "expiring soon" admin view surfaces lots within 30 days
- [x] Low-stock alerts (auto-created, resolvable, dashboard badges)
- [ ] Barcode-based stock-in/stock-out receiving (QR scan exists; barcode import pending)
- [ ] Physical inventory count reconciliation report (variance report)

## 5. QR Scanning — 6/6

- [x] QR product identification end-to-end: scan tag → SKU/id → `GET /api/products/qr/{code}` → product
- [x] Staff mobile scanner: scan → verify-and-count panel → pending stock adjustment
- [x] Admin Scan & Stock: live QR camera (jsQR) + upload fallback + per-location counts + approval queue
- [x] Deterministic SKUs (PRD-000001) with UNIQUE index; QR generation/printing local (no third-party service)
- [x] QR location tags (printable) + in-app QR/barcode scanner routing
- [x] Scan-event audit trail (unknown payloads logged) + customer product-page redirect
- [x] OCR engine fully retired (tesseract.js/jimp removed from the dependency tree)

## 6. Decision Support — 5/5

- [x] EOQ, Reorder Point, and Safety Stock computed per product (backend)
- [x] ABC classification (drives Flash Sale picks and Recommendations)
- [x] FSN (Fast/Slow/Non-moving) movement classification — `GET /api/optimization/fsn`, admin Optimization page section, 15 backend tests
- [x] Automated low-stock alerts against computed ROP
- [x] **Costing Records** — the economics of an inquiry frozen at submission, so repricing the catalog cannot rewrite a past order's profit. Reports cost basis (exact / imputed / none), profit, and cost-per-unit; cost of goods is entered per product, inline in the table, or in bulk (admin cost sheet / CSV import) and is stripped from every public read
- [x] **Margin overview + cost work queue** — the admin can see how much of the catalog is costed, filter straight to what is left, edit a cost in place, and read back the blended margin, margin by category, and the products priced below the `COSTING_TARGET_MARGIN` policy. Uncosted products are held apart from the margin maths rather than counted as 0%
- [ ] Forecasting comparison (e.g., moving average vs. EOQ results) for the paper's analysis chapter (optional stretch — tracked under Paper workstream)

## 7. Customer Mobile App — 5/8

- [x] Full catalog: search, categories, product detail, cart, order inquiry (COD)
- [x] Stock badges (In stock / Low / Out) on cards and recommendations
- [x] Google sign-in + session persistence (survives refresh/restart)
- [x] SDK 57 upgrade — works on current iOS/Android Expo Go, cold-start retry to Render
- [x] Production APK pipeline (EAS), install guide (`APK-INSTALL.md`)
- [ ] GCash checkout inside the app (backend contract done, keys pending)
- [ ] Push notifications (in-app feed done; true push not started)
- [ ] Play Store / App Store listing (APK sideload only for now)

## 8. Notifications — 3/4

- [x] In-app notifications feed (order status timeline, per-account)
- [x] Email provider wired (Resend/SMTP) with log-mode fallback for demos
- [x] SMS provider wired (Semaphore/Twilio) with log-mode fallback
- [ ] Verified sender domain (free-tier emails currently land in spam/owner-only)

## 9. Payments — 1/4

- [x] COD order flow end-to-end (the demo path) + PayMongo GCash backend contract
- [ ] PayMongo live/test keys wired into Render
- [ ] Webhook endpoint for automatic payment confirmation
- [ ] Payment receipt/records screen for admins

## 10. Paper, Testing & Presentation — 1/8 ⬅️ *the remaining 40% lives here*

- [ ] Capstone manuscript: Chapters 1–3 (final-form)
- [ ] Capstone manuscript: Chapter 4 (methodology/system architecture) with screenshots
- [ ] Capstone manuscript: Chapter 5 (testing results — cite the 732 backend + 267 admin + 30 smoke checks)
- [ ] Company UAT sign-off document (SYLVER owner/staff testing session)
- [ ] User manual (admin + staff + customer)
- [x] Defense slide deck + printed demo script (DEMO-SCRIPT.md is the source) — deck is `docs/algorithms-deck.html`: ALGORITHMS.md generated into 45 slides with each rehearsal-table line on its own slide, one self-contained file, no install or network needed; `npm run slides` rebuilds it and `slides:check` (inside `npm run verify`) fails on any drift from the spec
- [ ] Full dress-rehearsal recording (backup if live demo fails)
- [ ] Final panel presentation

---

## Evidence bank (for the paper — everything above is verifiable)

- **Test suites:** backend `npm test` → 732/732 · admin → 267/267 (23 files) · 30-check smoke suite → 30/30 (smoke suite last run Sep 9, 2026)
- **Live deployments:** API + admin on Render, docs on GitHub Pages — all serving at time of writing
- **Live end-to-end proof:** customer order → per-account scoping → admin approval → status timeline (Sep 9, 2026)
- **Security artifacts:** `SECURITY.md` (OWASP control → code map), audit log (durable — mirrored to Supabase `audit_log`), MFA + recovery codes
- **Docs for reproducibility:** `README.md`, `AGENTS.md`, `docs/DATABASE-SPEC-MAPPING.md`, `MODULES.md`, `DEPLOY.md`, `DEMO-SCRIPT.md`, `APK-INSTALL.md`

> Tip for the progress report: workstreams 1–3 are effectively "done and defended-ready";
> the honest remaining risk is workstream 10 (the paper itself) and the PayMongo keys.


---

# INVENTRAK — Demo Script & Pre-Demo Checklist

The one-page script for tomorrow's presentation. Everything below is **live
right now** (verified Aug 18, 2026): the backend runs on Render with Firebase
Firestore, the admin dashboard and mobile web site are deployed, and the APK
talks to the live backend from any network.

> Related docs: [APK-INSTALL.md](APK-INSTALL.md) (installing on Android),
> [DEPLOY.md](DEPLOY.md) (how it's hosted),
> [docs/algorithms-deck.html](docs/algorithms-deck.html) (the defence deck this
> script is run from). This file is the *script*.

---

## 1. Pre-demo checklist (do 30 minutes before)

| # | Item | How to confirm |
|---|------|----------------|
| 1 | Backend up | Open `https://inventrak-api.onrender.com/api/openapi.json` — JSON renders |
| 2 | Admin up | Open `https://inventrak-admin.onrender.com` — login page loads. **Hard-refresh (Ctrl+Shift+R)** once to drop any cached bundle |
| 3 | Mobile web up | Open `https://inventrak-mobile.onrender.com` — app loads |
| 4 | APK installed on phone | The **latest production build** (contains the QR scanner, stock badges, and staff scan-and-count flow) — see the newest link in APK-INSTALL.md. Same signing key → updates in place |
| 5 | Internet on the demo machine + phone | Backend is hosted — no Wi-Fi pairing needed |
| 6 | Google sign-in works (optional) | Gmail button appears on the mobile login screen; test users approved in the Google Cloud console |
| 7 | Defence deck opens | Open `docs/algorithms-deck.html` from disk — 45 slides, press `→` to move, `C` for contents, `F` fullscreen. Needs no install and no network, so it works even if the demo machine is offline. Print a PDF copy with `P` as a fallback |

**Demo credentials (all verified live):**
- Web admin (desktop): `owner` / `owner123` (OWNER — full oversight), `superadmin` / `super123` (SUPER ADMIN — accounts & roles), `admin` / `admin123` (ADMIN — products & approvals)
- Inventory Staff (`staff` / `staff123`) is **MOBILE-ONLY**: the web admin refuses a staff login with a "use the mobile app" message — that's the feature, not a bug. Staff tools (QR scan, physical count, adjustment requests) live in the phone app.
- Demo customer (mobile): `customer` / `customer123`
- Google sign-in: any approved test Gmail — creates/links an account by email

**⚠️ Demo-day notes — read before the demo (both verified live Aug 15):**

1. **The verification email only reaches ONE inbox.** Resend's free
   `onboarding@resend.dev` sender delivers only to the email that owns the
   Resend account — `qjncunanan01@tip.edu.ph`. If the live signup uses any
   other address, the code never arrives (`notify.email: false` was confirmed
   against the deployed server). **For the demo, sign up with
   `qjncunanan01@tip.edu.ph`** so the code lands in front of the judges.
   (Once a real domain is verified in Resend, any inbox works.)
2. **SMS is not demo-ready yet.** The Semaphore SMS account is status
   **"Pending" with 0 credits**, so no SMS sends (no code SMS, no order-update
   SMS). Even once approved and funded, it only sends to a **real PH mobile
   number** — fake numbers like `09171234567` are rejected. The **email path is
   the one to demo**; treat SMS as "works once the account is approved + a real
   number is used".
3. **The demo customer has NO orders yet.** The seeded `customer` account has
   an empty order history (the 6 seeded inquiries belong to Juan/Maria/Paolo/
   Jerico/Bettina, not `customer`). So in Part A step 7, the history list is
   **empty until you place the order in step 6** — that's expected and is
   actually a clean way to show "new order lands here with its timeline". If
   you'd rather show history with existing orders, log in as one of the seeded
   owners instead (or pre-place an order the night before).

---

## 2. The demo flow (about 8 minutes)

### Part A — Mobile app (phone, 3–4 min)

1. **Open the app** → lands on the Home screen (product catalog — no login
   required to browse). Show the category chips and the Flash Sale carousel.
2. **Tap a product** → product detail with photo and price.
3. **Tap Add to Cart** as a guest → the app prompts you to **create an
   account or log in first** (Shopee-style gating).
4. **Create an account** (or log in with the demo customer):
   - Sign up asks for name, email, **phone (required)**, strong password,
     and the **Data Privacy consent** checkbox.
   - A **verification code** is emailed — enter it to finish signup. Per the
     demo-day notes above, use the owner email (`qjncunanan01@tip.edu.ph`)
     so the code actually arrives. (On the deployed server the code is in
     the email only — it is NOT echoed in the API response.)
   - **Google button**: sign in with a test Gmail → account auto-creates
     with your real profile name (e.g. "Jerico Cunanan").
5. **Add a product to the cart** → cart badge updates. Open the cart → shows
   qty, price, total.
6. **Checkout** → Order Inquiry form → choose **GCash** (shows the payment
   step / QR demo) or **Cash on Delivery** → place the order.
7. **Order history** (Account → Orders) → the new order appears with its
   status timeline (Placed → Approved → Delivered) as the admin updates it.
   *(The list starts empty for the `customer` demo account — see demo-day note
   3 — so this step shows exactly the order you just placed.)*
8. **Notifications** tab → shows per-account order status updates.

### Part B — Admin dashboard (desktop browser, 3–4 min)

1. **Log in** (`admin` / `admin123`).
2. **Dashboard** → KPI cards: 192 products, 57,455 stock units, sales value,
   **pending inquiries** (this number jumps when you place the phone order —
   refresh to show the count change).
3. **Products** → the 192-product catalog with photos, search bar, bulk
   price upload (CSV / paste).
4. **Inventory** → per-location stock (Showroom, Stockroom 1, Stockroom 2).
5. **Order Inquiries** → find the order you just placed on the phone.
   **Approve it** (or Fulfill) → the mobile order history timeline updates
   to "Approved" (show both screens together).
6. **Scan & Stock** (the capstone highlight) → point the camera at a printed
   product QR tag (or paste/upload one) → the tag's identifier resolves
   server-side and shows the **product with live stock at every location** —
   the answer to the company's 5–6-year manual inventory problem.
7. **Optimization** → ABC classification (which products carry the value).
8. **Reports** → the printable management report (Print / Save PDF).

### Part C — Security/quality pitch (optional, 1–2 min)

If a judge asks "how do you keep customer data separated / safe?":
- **Per-account isolation** — order history, cart, and notifications are
  scoped per account; tested by regression suites (330 backend + 27 admin
  tests on every push).
- **Auth hardening** — bcrypt-hashed passwords, 24h expiring signed tokens,
  login brute-force lockout with exponential backoff, bot honeypot, admin-only
  endpoints (sales/alerts/users) locked server-side.
- **Role-based access control (staff vs owner)** — see Part D below: staff
  can *request* stock changes but only the owner can *approve* them.
- **API contract** — an OpenAPI 3.0 spec drives generated clients for both
  frontends; contract tests assert both backends return identical shapes.

### Part D — Staff vs Owner approval workflow (the request-and-approve highlight, 2–3 min)

This is the "approval of important transactions" answer for the evaluators:
staff propose, the owner decides. Demo it as a complete loop on the live
admin dashboard.

1. **Log out** of the admin account. **Log in as `staff` / `staff123`** →
   note the orange **STAFF** badge next to the title, and the **reduced
   sidebar**: Dashboard, Inventory Levels, Stock Movement, Stock
   Adjustments, Stock Transfers, Scan & Stock, Optimization, Reports.
   Call out what staff CANNOT see — **no Products, Approvals, Order
   Inquiries, Branch Locations, or Security** (even typing the URL
   redirects back to the Dashboard).
2. **Stock Movement page** → staff see the movement **history only** (the
   "New stock movement" form is hidden — recording movements is owner-only).
3. **Stock Adjustments** → click **New adjustment** and create one, e.g.:
   product = any item, location = Showroom, **new quantity** = current + 10
   (or any correction), reason = "Staff count correction during inventory".
   Submit → it's saved as **pending**. Say: *"Staff can propose, but they
   can't apply it — it now waits for the owner."*
4. Try to open **Approvals** while logged in as staff → it's not in the
   sidebar (and the URL redirects). The staff account simply has no way to
   approve.
5. **Log out**, **log in as `admin` / `admin123`** → green **ADMIN** badge,
   full sidebar, **Approvals** is back.
6. **Approvals** → the adjustment you just created is waiting (pending
   adjustments table, alongside any pending transfers). Click **Approve** →
   the system says the change was applied to stock.
7. **Inventory Levels** → find the product → the quantity now reflects the
   new count. **Order Inquiries → Approvals** shows the request as decided.
   That's the full loop: **request → approve → stock updated**, with a
   clear audit trail (who proposed, who decided, when).

*Tip: this writes a real adjustment to the live Firestore. Approving it in
step 6 completes the flow, so the demo ends with consistent data. If you'd
rather not change stock, reject the request instead — stock stays untouched
and the audit trail still shows the decision.*

### Part E — QR tags, the verify-and-count flow & the mobile scanner (2–3 min)

The "digitise the warehouse floor" story: printed QR tags on the storage
areas and products, a scanner that identifies the item (never the count),
and a confirm-before-save step. Together they answer *"how does the count
get from the shelf into the system without retyping?"*.

1. **Print the location tags (admin)** → **Branch Locations** → **QR tags**
   button. Show the dialog: one QR per storage area (Showroom, Stockroom 1,
   Stockroom 2), each encoding `INVENTRAK:LOC:<id>:<name>`, with a
   **Print tags** button. Say: *"These stick on the physical shelves — the
   scanner below reads them."* (Close the dialog; no need to print on stage.)
2. **Scan & Stock — verify & count** (admin, the reviewer's "staff must
   review before stock updates are saved" answer) → **Scan & Stock** →
   point the camera at a printed **product QR tag** (or paste the payload).
   The tag's identifier (`INVENTRAK:PROD:<id>` / SKU) resolves server-side
   and the product appears with its live stock.
   - Under the product, show the **"Verify & record physical count"** panel:
     the identified product is shown with its details, and every location
     has a quantity field pre-filled with the current count.
   - Say: *"The QR identifies the product — it does NOT count it. Staff
     still physically verify the quantity; that distinction is deliberate
     and honest about what the technology does."*
   - Change one quantity, add a reason, **Submit corrections for approval**
     → a green message confirms each change became a **pending adjustment**.
   - Say: *"Nothing is written to stock yet — the scan only proposes. The
     owner approves from the Approvals page, so a mistyped count can never
     silently corrupt inventory."* (Optionally approve it in Approvals to
     close the loop, or leave it pending — either is fine to demo.)
3. **Mobile scanner** (phone) → open the app logged in as **`staff` /
   `staff123`** (any account works for browsing; the count flow needs a
   staff or admin-tier account — staff tools unlock for staff, admin,
   super admin and owner on the phone):
   - **Account tab** → the header shows **"Staff Account · staff tools
     unlocked"** and a **Staff Tools** section with **Scan & Count Stock**.
     The login screen has a **Fill Inventory Staff** quick-fill button so
     nobody types credentials on stage.
   - Tap it → **Scan a product** → point the camera at a printed product
     tag → the product resolves with the **verify & record physical count**
     panel: enter the counted qty per location, submit → corrections become
     pending adjustments.
   - Tap **▦ Scan a QR / barcode tag** → point at a printed location tag
     → it opens **Available Supplies filtered to that storage area**
     ("Stock levels at Showroom (scanned tag)"). Scanning a product tag
     would open that product instead.
4. **Stock badges on the catalog** (phone, any account) → the product grid
   cards and the Recommendations rows now carry small **In stock / Low
   stock / Out of stock** pills derived from live inventory — customers see
   availability before they order, and the flash-sale carousel shows the
   same signals.

*Where these features live in the code:*
- QR tags: `frontend-admin/src/pages/inventory/LocationsPage.jsx` (payload + print dialog)
- Admin QR scanner + verify-and-count: `frontend-admin/src/pages/catalog-orders/ScanStockPage.jsx`
- Mobile scanner + count flow: `mobile-client/src/screens/catalog/QrScanScreen.js`,
  `mobile-client/src/screens/account/AccountScreen.js`
- Stock badges: `mobile-client/src/screens/catalog/ProductScreen.js`,
  `mobile-client/src/screens/catalog/RecommendationScreen.js`
- Backend QR lookup: `backend/src/qr-codes.js` (tag grammar, SKU rules,
  `GET /api/products/qr/{code}`); adjustments queue: `/api/stock-adjustments`

---

## 3. If something fails mid-demo

| Symptom | Fix |
|---------|-----|
| Admin shows "0" on a card | Hard-refresh (Ctrl+Shift+R). The dashboard restored-session fix is live |
| Login fails "Invalid credentials" | Re-type `admin`/`admin123`; tokens from before the security pass are expired (by design) |
| Phone order doesn't appear in admin | Check the phone shows a success screen (order #), then refresh the admin Order Inquiries page |
| Google button errors | It needs the backend env (`GOOGLE_CLIENT_IDS` + `GOOGLE_CLIENT_SECRET`) and the test user approved in Google Cloud. Password login always works as fallback |
| Camera black on Scan & Stock | Use **paste the tag payload** instead — the lookup works the same way without the camera |
| Scan & Stock shows "QR code is not registered" | The tag isn't in the catalog (or points at a deleted product). Only printed INVENTRAK product tags resolve — print a fresh sheet from Products → QR tags and scan that |
| Phone scanner camera stays black | Allow camera permission when prompted, or use **Take photo / Upload photo** on the Scan screen instead |
| Staff count submit says "Could not submit" | The phone needs a **staff/admin** account (customers get 403). Log in as `staff`/`staff123` and confirm the backend is up |
| Verification code never arrives | You likely signed up with an address other than `qjncunanan01@tip.edu.ph` — Resend's free sender only delivers to the owner inbox. Re-register with that email, or log in with the demo customer |
| No SMS received | Semaphore is still **Pending / 0 credits** — not demo-ready. Demo the email leg instead; SMS works once approved + funded and a real number is used |

---

## 4. Live URLs (put these on a slide)

- **Backend API:** https://inventrak-api.onrender.com
- **Admin dashboard:** https://inventrak-admin.onrender.com
- **Mobile web:** https://inventrak-mobile.onrender.com
- **API docs (Swagger):** https://inventrak-api.onrender.com/api/docs
- **GitHub repo:** https://github.com/qjncunanan01-ux/INVENTRAK

_Last verified: Sep 23, 2026 — backend 369/369 tests, admin 66/66, all live
endpoints green, APK link downloadable.
New in this build: full QR product identification (scan → SKU → lookup →
verify-and-count → approval) on admin + phone, QR location tags, stock
badges on the catalog. The OCR engine has been retired._


---

# Deploying INVENTRAK to production

Goal: a **free, hosted backend running on Firebase Firestore**, with the admin
dashboard and mobile app pointed at it. The backend is a plain Node.js HTTP
server with **zero native dependencies** (`src/server_npmfree.js`) that
**auto-selects Firestore** whenever `FIREBASE_PROJECT_ID` + a service-account
credential are present — so the same code, container, tests and clients run
locally on JSON files and in production on Firestore.

Three hosts are supported. **Render** is the recommended path (free tier,
one-click from the included `render.yaml` blueprint). Railway and Cloud Run
are documented as alternates below.

```
GitHub repo ──► Render blueprint (render.yaml)
                  ├─ inventrak-api    (Node, port 4001) ──► Firebase Firestore
                  └─ inventrak-admin  (static build)  ─┐        ▲
                        ▲                              │        │
   admin dashboard ◄───┘      mobile app ── login screen API URL ─┘
```

---

## Step 0 — Firebase project + Firestore (5 minutes, once)

The one thing that requires your Google account. You're already logged into
the Firebase CLI locally (verified). The project already exists:

```bash
firebase projects:list
#   INVENTRAK  /  inventrak-6b079   ← use this one
```

In the Firebase console (console.firebase.google.com), open the **INVENTRAK**
project and check it's fully set up:

1. **Enable the Cloud Firestore API** (one click) if the project was just
   created — visit
   <https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=inventrak-6b079>
   → **Enable**. (If `firebase firestore:databases:list --project
   inventrak-6b079` lists `databases/(default)`, this is already done.)
2. **Build → Firestore Database → Create database** if no database exists yet
   (production mode is fine) — the project currently has the `(default)`
   database. A custom name (e.g. `inventrak`) also works: set
   `FIREBASE_DATABASE_ID` in the backend env and the driver targets it.
3. **Project settings → Service accounts → Generate new private key** — you
   get a `*.json` credentials file. Keep it safe; it is the key to your data.

Do **not** commit that key. You'll paste it into the host's dashboard (Step 2)
or into the env when running locally:

---

## Step 1 — Push your existing data to Firestore (optional, recommended)

If you already have products/inventory/movements/inquiries/sales/users in the
local SQLite database (`backend/data/inventrak.db`), push it once **from your
local machine** (never run the migration from the server):

```bash
cd backend
export FIREBASE_PROJECT_ID="inventrak-6b079"
export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat /path/to/serviceAccountKey.json)"
# optional, only if you created a named database instead of (default):
# export FIREBASE_DATABASE_ID="inventrak"

npm run migrate:firestore -- --dry-run   # preview the row counts
npm run migrate:firestore                # write it (REPLACES Firestore contents)
```

Skipping this step is fine: a brand-new Firestore project is **auto-seeded on
first server boot** with the product catalog + inventory from `backend/data/`
and the demo users (`admin/admin123`, `customer/customer123`) — so the admin
dashboard and mobile app work immediately, just without your old transactional
data.

**Passwords migrate as bcrypt hashes** (both backends hash; the SQLite side
has since launch). If any store still holds legacy plaintext (e.g. users
registered before the npm-free server hashed), re-hash it once — or just let
the first login upgrade each user automatically:

```bash
npm run hash:passwords -- --dry-run    # SQLite: how many plaintext users?
npm run hash:passwords                 # SQLite: re-hash them
npm run hash:passwords -- --firestore  # Firestore '@users' dataset
```

Run the SQLite pass while the backend is stopped (a second connection to the
same DB is fine either way, but stopping avoids lock contention); the
login-time auto-upgrade covers anything the script misses.

### Keeping the two databases in sync (instead of another one-shot migration)

Once both stores have real data, `npm run sync:firestore` converges them with
per-row changesets and conflict policies:

```bash
cd backend
export FIREBASE_PROJECT_ID="your-project-id"
export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat /path/to/serviceAccountKey.json)"

npm run sync:firestore -- --dry-run       # preview the changeset, touch nothing
npm run sync:firestore                    # merge both ways, apply
```

- **Conflict policy** (`--conflict=`): `last-write-wins` (default, newest
  timestamp), `keep-sqlite`, `keep-firestore`, or `skip` (report and leave
  both sides as-is).
- **One-way syncs**: `--direction=to-firestore` (SQLite wins) or
  `--direction=to-sqlite` (cloud wins). `--deletions=propagate` is only
  allowed with a one-way direction and makes the plan a mirror (absent rows
  are dropped from the target) — always review the `--dry-run` output first.
- **Password safety**: bcrypt hashes sync like any other column; conflict
  reports redact the `password` field.
- Run the SQLite-side write while the local backend is stopped (or during a
  maintenance window) — the sync opens its own `better-sqlite3` connection.

---

## Step 2 — Deploy the backend + admin to Render (free)

> **Can't access Render / no credit card?** Two no-card paths exist:
> 1. **Demo TODAY (zero accounts): Cloudflare Quick Tunnel** — run the
>    backend on your laptop and expose it publicly with one command. See
>    [Demo today: Cloudflare Quick Tunnel](#demo-today-cloudflare-quick-tunnel).
> 2. **Hosted, no credit card: Replit Deployments** — see
>    [Replit (no credit card)](#replit-no-credit-card) in Alternatives.

## Demo today: one-click launcher (double-click, no typing)

`demo-launch.bat` (repo root) starts **everything** — backend, public Cloudflare
tunnel, and admin dashboard — in one window:

1. Double-click `demo-launch.bat` (Windows). It requires only Node.js.
2. It reuses anything already running, starts the rest, downloads
   `cloudflared` automatically on first run, and prints the live summary:
   the **Public URL** (copy it for the phone), local URLs, and demo logins.
3. Close the window to stop everything.

Under the hood it runs `scripts/demo-launch.js` (zero-dependency Node
orchestrator; env-overridable: `BACKEND_PORT`, `ADMIN_PORT`, `CLOUDFLARED_BIN`).

## Demo today: Cloudflare Quick Tunnel (no account, no card)

The fastest way to a public URL with ZERO signups: Cloudflare's quick tunnels
expose a local port as an HTTPS `*.trycloudflare.com` URL — no account, no
credit card, no interstitial warning pages (unlike ngrok/localtunnel, which
break mobile apps or require tokens).

1. Start the backend locally: `cd backend && npm start` (port 4001).
2. Get the official Cloudflare binary (one-time):
   - Windows: download `cloudflared-windows-amd64.exe` from
     <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>,
     or `winget install cloudflare/cloudflared`.
   - macOS: `brew install cloudflared`. Linux: `apt install cloudflared`.
3. Expose the backend:
   ```bash
   cloudflared tunnel --url http://localhost:4001
   ```
   It prints a URL like `https://<random>.trycloudflare.com` — that's your
   live public API.
4. Mobile app — bake it in (no typing on the phone):
   ```bash
   cd mobile-client
   EXPO_PUBLIC_API_URL=https://<random>.trycloudflare.com npx expo start
   ```
   (or paste it into the login screen's API URL field — it's saved). The
   admin dashboard stays at `http://localhost:3000` on the presenting PC.

Notes: the URL changes every time the tunnel restarts (fine for a demo; use
Replit below for a stable URL). The laptop must stay on and online. Verified
live: public login/register/products all return 200 through the tunnel.

1. **Push this repo to GitHub** (`origin` is already set).
2. **render.com → New → Blueprint** → connect the GitHub repo. Render reads
   the included `render.yaml` and creates two services:
   - `inventrak-api` — the backend (Node, `node src/server_npmfree.js`)
   - `inventrak-admin` — the admin dashboard (static build)
3. **Wire in the database driver** — in the Render dashboard open
   **inventrak-api → Environment → Environment Variables** and add the keys
   for the driver you're using (precedence when multiple are set:
   Supabase > Firestore > JSON files):

   **Supabase (the current live setup):**
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co` (Project Settings → API)
   - `SUPABASE_KEY` = the **service_role** secret (Project Settings → API;
     server-side only, never ship it to a client)
   - Tables come from `backend/src/supabase-schema.sql` — paste it into the
     Supabase **SQL Editor** and run once, then seed with
     `node scripts/seed-supabase.cjs` from `backend/`.
     - Already using an older schema? The FEFO feature stores lot expiry
       inside the JSONB `data` blob, so **no ALTER TABLE is needed** — just
       redeploy the backend. (SQLite installs get the `expiry_date` column
       via an automatic migration on boot.)
   - **Durable audit trail (recommended):** Render's filesystem is ephemeral,
     so without this the Audit Trail page restarts empty after every deploy.
     Paste `backend/src/supabase-audit-migration.sql` into the Supabase
     **SQL Editor** and run it once. **That is the entire setup** — no new env
     vars and no new secret to paste. The backend derives the sink from the
     Supabase driver config it already has (`SUPABASE_URL` + `SUPABASE_KEY`),
     mirroring every audit line to the `audit_log` table and re-seeding from it
     at boot.

     Confirm it is live without opening a dashboard:

     ```bash
     curl -s https://inventrak-api.onrender.com/api/meta | jq .audit
     # {"enabled": true, "url": "https://<ref>.supabase.co/rest/v1",
     #  "table": "audit_log", "derived": true}
     ```

     `enabled: false` means the `audit_log` table is missing (run the SQL) or
     the key is an anon key. `derived: false` means `AUDIT_REMOTE_URL` is set
     explicitly — those two vars still exist as an override for pointing the
     trail at a different project than the data, and are otherwise unnecessary.

   **Firestore (alternative):**
   - `FIREBASE_PROJECT_ID` = `your-project-id` (or edit the blueprint value)
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = the **entire** service-account JSON
     from Step 0, braces included.
     (Alternative: use Render **Secret Files** to mount the JSON at e.g.
     `/etc/secrets/firebase-sa.json` and set
     `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/firebase-sa.json`.)
   Then **Manual Deploy → Deploy latest commit**.
4. **Check the API is alive and on Firestore:**
   ```bash
   curl -s https://inventrak-api.onrender.com/api/openapi.json | head -c 120
   curl -s -o /dev/null -w '%{http_code}\n' https://inventrak-api.onrender.com/api/docs
   # login proves users are on Firestore:
   curl -s -X POST https://inventrak-api.onrender.com/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"admin123"}'
   ```
5. **Admin dashboard**: open `https://inventrak-admin.onrender.com` and log
   in with `admin` / `admin123` (or a migrated user). The bundle already
   points at `https://inventrak-api.onrender.com` (set at build time in
   `render.yaml`; change it there if Render assigned a different URL and
   re-deploy).
6. **Mobile app — zero typing (recommended):** bake the deployed URL into the
   app at bundle time with an Expo public env var, so it talks to the deployed
   backend from ANY network (no LAN requirement, nothing to edit on the phone):
   ```bash
   cd mobile-client
   EXPO_PUBLIC_API_URL=https://inventrak-api.onrender.com npx expo start
   # (add --tunnel if the phone isn't on the same Wi-Fi as this PC)
   ```
   Log in with `customer` / `customer123` or register a new account. The URL
   is also editable on the login screen (persisted on the device) — that
   remains the manual fallback if you prefer it.
   **Gotcha:** a previously-saved URL on the phone (AsyncStorage) *overrides*
   the baked one — if the login screen still shows `http://<lan-ip>:4001`,
   replace it with the deployed URL once and it'll stick for the demo.

**Demo without Firebase (fastest path):** the backend auto-selects Firestore
only when `FIREBASE_PROJECT_ID` + a service account are set. Until you paste
them, the deployed API runs on the committed JSON catalog (auto-seeded:
8 products, 3 locations, the demo users) — fully demoable immediately. Data
written then lives on the container's ephemeral disk (free plan), so add
Firestore (Step 3) before collecting real data.

Free-tier notes: services sleep after ~15 min idle and wake on the next
request (first load after sleep can take a few seconds); Firestore is the
durable store, so nothing is lost while sleeping.

---

## Alternatives

### Replit (no credit card)

The only hosted option that needs **no credit card** (free Starter plan). The
repo includes a `replit.toml`:

1. replit.com → **Create** → **Import from GitHub** → pick this repo (public).
2. Click **Run** first — `replit.toml`'s `[run]` section installs deps and
   starts the server (look for `npm-free backend running on 3000` in the
   Console). If the preview stays blank, the Console tab shows the real error.
3. **Publish** (top-right of the workspace — Replit renamed "Deployments" to
   "Publish" in 2025) → you get a `https://<name>.replit.app` URL. Free
   deployments sleep on idle but wake on request.
4. Optional Firestore: **Environment** tab → add `FIREBASE_PROJECT_ID` +
   `FIREBASE_SERVICE_ACCOUNT_JSON` (same as Render Step 5).
5. Point the mobile app at it (`EXPO_PUBLIC_API_URL=... npx expo start` or
   the login-screen field). The admin dashboard can also be served by hosting
   the `frontend-admin` build on Replit (static) or any static host
   (Vercel/Netlify/GitHub Pages) with `REACT_APP_API_BASE_URL` set to the
   Replit URL.

### Railway (also free-tier friendly)

The repo includes a `railway.json` (builds `backend/Dockerfile`, health-checks
`/api/openapi.json`), so both a Git-integration deploy (Railway → New Project
→ Deploy from repo — root is detected from the config) and the CLI work:

```bash
cd backend
npx @railway/cli@latest init     # link to a project
railway variables set FIREBASE_PROJECT_ID=... FIREBASE_SERVICE_ACCOUNT_JSON=...
railway up
railway domain                  # gives you the public URL
```

The container runs `node src/server_npmfree.js` (set in the Dockerfile), so
the same Firebase auto-selection applies. Point the admin build and the mobile
bundle (`EXPO_PUBLIC_API_URL=https://<your-railway-url> npx expo start`) at
the Railway URL. If the admin dashboard is built elsewhere (e.g. Render),
update its `REACT_APP_API_BASE_URL` to the Railway URL and redeploy it.
(Note: `firebase-admin` is installed by `npm install`, so the Firestore driver
is available in the container. Railway only enforces the health check on
Hobby/Pro plans — it's ignored on free, which is fine.)

### Google Cloud Run

Requires the gcloud CLI + Docker:

```bash
cd backend
gcloud auth login
gcloud config set project your-project-id
docker build -t gcr.io/your-project-id/inventrak-api .
docker push gcr.io/your-project-id/inventrak-api
gcloud run deploy inventrak-api --image gcr.io/your-project-id/inventrak-api \
  --region us-central1 --allow-unauthenticated \
  --set-env-vars FIREBASE_PROJECT_ID=your-project-id \
  --set-secrets FIREBASE_SERVICE_ACCOUNT_JSON=firebase-sa-json:latest
```

Then point the admin and mobile at the `*.run.app` URL Cloud Run prints.

---

## Real email + SMS notifications (verification codes, order updates)

The backend already sends real messages through **Resend** (email) and
**Semaphore** (SMS, PH gateway — or Twilio as an alternative). Providers are
env-configured and fire-and-forget, so nothing breaks when they're missing —
but without keys, messages are only **logged**, not delivered. To enable real
delivery on the deployed server:

### 1. Email — generic SMTP (recommended, delivers to ANY recipient)

The backend has a **zero-dependency SMTP client** (`SMTP_HOST` + `SMTP_PORT` +
`SMTP_USER` + `SMTP_PASS` + `EMAIL_FROM`), so any provider that offers SMTP
works and delivers to **any** recipient — no domain required:

- **Gmail / Google Workspace** (fastest): enable 2-Step Verification on the
  account, create an **App Password** (myaccount.google.com → Security →
  2-Step Verification → App passwords), then:
  ```
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_USER=you@gmail.com
  SMTP_PASS=<the 16-char app password>
  EMAIL_FROM=INVENTRAK <you@gmail.com>
  ```
- **Brevo** (free tier, 300 emails/day): add + verify a sender email, then use
  their SMTP (`smtp-relay.brevo.com:587`, your Brevo login + SMTP key).
- Port convention: `587` → STARTTLS, `465` → implicit TLS (`SMTP_SECURE`
  overrides). When `SMTP_HOST` is set it takes priority over Resend.

  > **Two operational notes:** (1) if `SMTP_HOST` is unreachable, each
  > notification waits up to ~15s before logging the failure — keep the host
  > correct. (2) Always use port 465 or a STARTTLS-capable 587 server with
  > real credentials: on a plain 587 connection with no STARTTLS, `AUTH PLAIN`
  > would send the password in the clear (fine for sandbox SMTP only).

### 1b. Email (alternative) — Resend (free tier, ~100 emails/day)

1. Go to <https://resend.com> → sign up (free) → **API Keys** → create a key
   (starts with `re_`).
2. **Sender**: for testing, `EMAIL_FROM=INVENTRAK <onboarding@resend.dev>`
   works out of the box (no domain setup). To send as your own address, add a
   domain in Resend (**Domains** → add → verify DNS) and set
   `EMAIL_FROM=INVENTRAK <hello@yourdomain.com>`.

   > **Important caveat:** the free `onboarding@resend.dev` sender can only
   > deliver to **the Resend account owner's own inbox** until you verify a
   > domain. So for a live demo, register the test account with the same email
   > you used for Resend — otherwise the verification code email is rejected
   > and signup stalls. Add a verified domain (or switch to SMTP above) before
   > letting real customers register.

### 2. SMS — Semaphore (Philippines) or Twilio

**Semaphore** (recommended for PH numbers, prepaid credits):
1. <https://semaphore.co> → sign up → **Account** → **API Key**.
2. **Settings → Sender Names** → register a sender name (e.g. `INVENTRAK`,
   approval takes minutes) → set `SEMAPHORE_SENDER_NAME=INVENTRAK`.
3. Top up a small amount — each SMS is roughly ₱0.35–0.70.

**Twilio** (alternative, international): create an account, buy a number,
set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.

### 3. Wire the keys into the deployed server

In the Render dashboard: **inventrak-api → Environment → Environment
Variables** → add the keys (or fill the commented placeholders in
`render.yaml` and redeploy):

```
# Email (pick one):
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / EMAIL_FROM
# or
RESEND_API_KEY / EMAIL_FROM

# SMS:
SEMAPHORE_API_KEY
SEMAPHORE_SENDER_NAME
```

### 4. Prove it actually sends (before the demo)

```bash
cd backend
RESEND_API_KEY=re_xxx SEMAPHORE_API_KEY=xxx \
TEST_EMAIL=you@example.com TEST_PHONE=09171234567 \
EMAIL_FROM='INVENTRAK <onboarding@resend.dev>' \
SEMAPHORE_SENDER_NAME=INVENTRAK \
npm run notify:test
```

It sends a real test email + test SMS and prints `PASS`/`FAIL` per channel
(exit code 0 = all configured channels delivered). Then do the live check:
register a new account in the mobile app → you'll receive the 6-digit
verification code by email (and SMS if you added a phone).

## Google sign-in ("Continue with Google")

The mobile login screen shows a **Continue with Google** button. Sign-in runs
through the **backend OAuth relay** — the app itself carries no OAuth
credentials:

```
app → GET /api/auth/google/start?returnUrl=<app deep link>
     → 302 to accounts.google.com (backend's own https callback as redirect_uri)
     → Google consent → GET /api/auth/google/callback?code=…&state=…
     → backend exchanges the code with the web client's SECRET (server-side
       only), verifies the id_token, creates/links the account
     → 302 back to the app deep link (?token=…&username=…&email=…)
```

The relay exists because Expo Go deep links (`exp://…`) can never be
registered as Google OAuth redirect URIs (Google only accepts `https` for
web clients) and the old auth.expo.io proxy is deprecated — so the web
client's secret stays on the server, which is exactly what Google's
"OAuth 2.0 policy for keeping apps secure" requires. The backend still also
accepts an id_token directly via `POST /api/auth/google` (programmatic
clients) with the same find-or-create logic.

On first sign-in the account is auto-created with the **verified profile
name** as the username (e.g. "Jerico Cunanan", not "jericocunanan09123");
signing in with Google on an existing password account links it (same
identity, no duplicate). Usernames are sanitized (letters/digits/space
kept) and deduped, and every new Google account is `email_verified = true`.

### 1. Create the web OAuth client (Google Cloud Console, ~10 min, once)

1. Go to https://console.cloud.google.com → pick the project you want the
   client to live in (note its project id — the client and the consent
   screen must be in the SAME project).
2. **APIs & Services → OAuth consent screen** (the **Branding** tab) →
   External → app name `INVENTRAK` + your support email → save.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   → Application type **Web** → name it (e.g. `INVENTRAK Web`) → **Create** →
   copy the Client ID (`….apps.googleusercontent.com`).
   - The web client also has a **Client secret** — copy it too (used server-side).
4. Open the created client and add the **Authorized redirect URI**
   (replace the URL with your deployed API):
   ```
   https://inventrak-api.onrender.com/api/auth/google/callback
   ```
5. **OAuth consent screen → Audience** tab → **Publish app → Confirm**
   (only basic email/profile scopes are used, so no Google verification is
   required). While in **Testing** mode only accounts you list under **Test
   users** (same page) can sign in — publishing lifts that limit.

### 2. Wire it into the backend (Render)

**Service Environment Variables** (`inventrak-api` → Environment):
```
GOOGLE_CLIENT_IDS=<web-client-id>        # the web client from step 3
GOOGLE_CLIENT_SECRET=<web-client-secret> # the secret from step 3
# optional override (default: derived from the request, https on Render):
# GOOGLE_OAUTH_CALLBACK_URL=https://inventrak-api.onrender.com/api/auth/google/callback
```
`GOOGLE_CLIENT_SECRET` is the secret that makes the relay live: without it
`/api/auth/google/start` answers `501`. No build-time env vars are needed in
the mobile app — the button always works and just opens the relay URL.

### 3. Verify
- `GET /api/auth/google/start?returnUrl=exp://host/--/auth` → `302` to
  `accounts.google.com` with `redirect_uri` = your callback (else `501` if
  `GOOGLE_CLIENT_SECRET` is missing, `400` for a non-app return URL).
- App: tap **Continue with Google** → Google account chooser → back in the
  app logged in (account auto-created on first use). Works in Expo Go
  (`exp://` return) and the installed APK (`inventrak://` return).
- The new account appears in `users` (Firestore console / admin users) with
  `google_sub` set, `email_verified = true`, and the profile name as username.
- `POST /api/auth/google` returns `401` for a forged token and `501` when
  `GOOGLE_CLIENT_IDS` is unset (contract-tested on both backends); the relay
  endpoints are covered by unit + end-to-end tests (`google-relay.test.js`).

## Security hardening (do this before any public demo)

Every production deployment MUST set the token-signing secrets. Without them the
servers fall back to a **public** constant that lives in this repo — anyone who
reads the source can forge admin tokens. The server logs a loud warning at boot
when the env var is missing:

```bash
[security] NPMFREE_TOKEN_SECRET is not set — using the PUBLIC fallback secret ...
[security] JWT_SECRET is not set — using the PUBLIC fallback secret ...
```

Set both on the Render service (Service → Environment):

- `NPMFREE_TOKEN_SECRET` — HMAC key for the npm-free server (the one deployed to
  Render). Generate with `node -e "console.log('inv-'+require('crypto').randomBytes(32).toString('base64url'))"`.
- `JWT_SECRET` — key for the SQLite server (local dev / the alternate deploy).

Other hardening already built in (all covered by `backend/src/test/security.test.js`):

- **Session expiry** — API tokens expire after 24h (`TOKEN_TTL_MS` on the npm-free
  server; JWTs already expire on the SQLite server). An expired token can never
  authenticate, and the expiry is part of the signed payload (cannot be extended).
- **Registration can't escalate roles** — `role` is always `customer` server-side;
  a client that sends `role: "admin"` is ignored (contract-tested).
- **Bot honeypot** — login/register reject requests that include a `website`
  field (real clients never send it).
- **Upload restrictions** — the old OCR image-upload surface was removed with the
  OCR→QR migration; scanning submits only a short tag payload (strict grammar,
  length-capped) — no user file uploads remain on the API.
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`, CSP (`default-src 'none'` on JSON), and `Strict-Transport-Security`
  when served over HTTPS.
- **Force HTTPS** — requests arriving over plaintext (`X-Forwarded-Proto: http`,
  i.e. behind the Render proxy) are 301-redirected to https.
- **Admin MFA (two-factor)** — the **Security** page in the admin dashboard
  enrolls a TOTP secret (Google Authenticator/Authy). Once enrolled, every
  admin login needs the 6-digit code; the password alone yields only a
  short-lived challenge, never a session.
- **Server-side logout** — POST /api/auth/logout revokes the presented token's
  jti, so a captured/replayed token dies immediately (both apps call it on
  logout).
- **Demo-account gate** — set `DISABLE_DEMO_ACCOUNTS=true` to reject the
- **MFA recovery codes** — enrollment (Security page) also issues 10 single-use
  recovery codes (hashed at rest) so a lost authenticator app never locks the
  owner out; regenerate them any time from the Security page.
  seeded admin/admin123 + customer/customer123 logins with the generic error
  (OWASP: no default accounts in production). Leave unset for the demo.
- **Audit log** — login success/failure, lockouts, MFA changes and account
  events are written as structured JSON to the server console (Render → Logs),
  optionally also to a file via `AUDIT_LOG_FILE`.

- **Firestore rules** — `backend/firestore.rules` denies ALL client access; the
  apps talk only to the API (admin SDK), which bypasses rules. Deploy it once:
  `cd backend && npx firebase deploy --only firestore:rules` (or paste it in the
  Firebase console → Firestore Database → Rules).
- **Login lockout** — brute-force lockout with exponential backoff (already
  documented above; see `backend/src/login-lockout.js`).- **Secret scan CI** — `.github/workflows/ci.yml` fails the build if any private
  key / service-account / API key pattern is committed.

Known dependency advisories (tracked, not auto-fixed because the fix is breaking):

- Backend: 8 moderate — transitive via `firebase-admin → @google-cloud/storage`
  (uuid bounds-check advisory). Server-only; no non-breaking fix exists.
- Admin: remaining ~17 high — all in the CRA 5 build/dev toolchain
  (webpack-dev-server, svgo, postcss, serialize-javascript). Build-time only;
  they never ship in the static bundle. A full fix means migrating the admin
  build off CRA (e.g. Vite) — out of scope before the demo.
- Mobile: ~22 (11 high) — Expo toolchain chain; fixes exist only in unreleased
  canary versions. Upgrade Expo when a stable release ships them.

Run the whole security suite locally: `cd backend && node --test src/test/security.test.js`.

## Verification checklist

- [ ] `GET /api/openapi.json` returns the spec (200)
- [ ] `GET /api/docs` renders Swagger UI
- [ ] `POST /api/auth/login` with `admin/admin123` returns a token
- [ ] Admin dashboard loads at its URL and the Dashboard counters match
      Firestore (products, inventory, alerts)
- [ ] Mobile app logs in via the deployed API URL; an order inquiry placed on
      the phone appears in the admin Order Inquiries page
- [ ] (If configured) the login screen shows **Continue with Google** and a
      Google sign-in creates/links the account (relay: `GOOGLE_CLIENT_IDS` +
      `GOOGLE_CLIENT_SECRET` set, callback URI registered, consent screen
      published)
- [ ] Firestore console shows the `products`, `inventory`, `users` collections

## Safety / rollback

- The migration **replaces** Firestore contents with the SQLite snapshot —
  run it once, or only when you deliberately want SQLite to win. For
  ongoing convergence use `npm run sync:firestore` instead (changeset-based,
  conflict-aware; `--dry-run` previews everything).
- If anything goes wrong with Firestore, pin `DB_DRIVER=json` on the service
  to fall back to the local files (ephemeral on the free plan).
- Rotate the service-account key / regenerate it any time if it leaks.
- For a real production rollout: set `NPMFREE_TOKEN_SECRET` (HMAC signing
  key), enable a paid plan (no cold starts), and add a database-level backup.


---

# Installing the INVENTRAK APK on Android (demo guide)

This guide covers putting the **EAS-built APK** (built with
`npx eas-cli build --platform android --profile production`) onto an Android
phone for the presentation. The APK is a real app — **no Expo Go, no
internet-to-PC needed** — and it talks to the **live backend**
(`https://inventrak-api.onrender.com`, Supabase PostgreSQL) from any network.

> For the Expo Go / dev-server way instead (scan-a-QR), see the README
> "Mobile App (Expo)" section. This guide is for the standalone APK.

---

## Latest builds (staff v1.5.0 · Sep 28, 2026 — customer v1.2.0 · Sep 27)

### Customer app (INVENTRAK — `com.inventrak.mobile`)

**Direct download link:**

```
https://expo.dev/artifacts/eas/i3rggZLQMbBcygcLFInmV5GAwv1M0XufXUuTaN1fnQg.apk
```

> **v1.2.0 (customer):** the scanner now also reads **camera-friendly tag
> URLs** (`https://…/t/<id>`) — the format the admin has printed since the
> v1.1.0 era — so tags scan in-app **and** in any phone's native camera
> app (which opens the public product page). Login screen shows **v1.2.0**;
> if yours doesn't, you're on an old install — update. Same signing key →
> updates in place.
>
> Build ID: `c55a1073-0154-4d40-8ce9-c95b73b5b2a6` · Build page:
> https://expo.dev/accounts/patrickcuevas/projects/inventrak-mobile/builds/c55a1073-0154-4d40-8ce9-c95b73b5b2a6

### Staff app (INVENTRAK Staff — `com.inventrak.staff`)

**Direct download link:**

```
https://expo.dev/artifacts/eas/2Fa5HkvBxzl7fqOHrVbWBl8IToAJsGrQMRdWhwKYGYI.apk
```

> **v1.5.0 (staff):** the Requests tab is **live** — while it's open it
> polls every 15s, so the owner's approve/reject decision flips the badge
> on its own (a "Live · updated HH:MM:SS" note shows the last sync).
> Combined with v1.4.0's closed loop (submissions stamped with who counted,
> "Requested by" in the admin queue, Mine | All filter), the full
> staff → owner → staff cycle now plays out on screen with zero manual
> refreshes. Verified live end-to-end on the deployed backend.
>
> Build ID: `fd080f2f-30d4-4afb-90e1-883f3deebd12` · Build page:
> https://expo.dev/accounts/patrickcuevas/projects/inventrak-staff/builds/fd080f2f-30d4-4afb-90e1-883f3deebd12
>
> **v1.4.0 (Sep 28, superseded by v1.5.0):** the app became a **closed loop
> with the web admin**: submissions record WHO counted, the admin queue
> shows a "Requested by" column, and the Requests tab gained the
> **Mine | All** filter.
>
> Build ID: `2d368dac-5c2b-4217-b26b-e2b783f54657` · Build page:
> https://expo.dev/accounts/patrickcuevas/projects/inventrak-staff/builds/2d368dac-5c2b-4217-b26b-e2b783f54657 ·
> APK: `https://expo.dev/artifacts/eas/XBApQJmlSVXzZC6k9MmIxLWTBNHBDvNP6b-dVk1ia6Y.apk`
>
> **v1.3.0 (Sep 28, superseded by v1.4.0):** the tag scanner gains **"Enter Code Manually"** — a
> pill under the camera view (matching the app mockup) that opens a sheet
> where staff type the code printed under a tag (tag URL, `INVENTRAK:PROD:<id>`,
> or a location tag). Typed codes resolve through the exact same pipeline as
> a scan and are audit-logged the same way. The same fallback appears on the
> camera-denied screen, so a phone with a **broken camera** can still run the
> full scan-to-count workflow. Sign in with the seeded staff account
> (`staff` / `staff123`) — this app refuses admin/owner/customer accounts
> by design. It is a **separate app** from the customer one (own icon, own
> package), so both can live on the same phone.
>
> Build ID: `6ad61526-e1a7-41b2-a6bb-7eb57bb38bbd` · Build page:
> https://expo.dev/accounts/patrickcuevas/projects/inventrak-staff/builds/6ad61526-e1a7-41b2-a6bb-7eb57bb38bbd ·
> APK: `https://expo.dev/artifacts/eas/yBHzH8zbYh83fSqmrvWlKs13cCD9CMrp0WjNzi0G1Wo.apk`
>
> **v1.2.0 (Sep 27, superseded by v1.3.0):**
> `https://expo.dev/artifacts/eas/1EgLmgnDTxtunwSD8mTqDUMmlTvoCLQQqYLHTfMvcpo.apk`.
>
> **Local copies:** `INVENTRAK-production.apk` (customer, v1.2.0) and
> `INVENTRAK-staff.apk` (staff, v1.5.0) in the project folder on the desktop.

> **v1.1.0 (Sep 26, superseded):** version-badge builds **without** URL-tag
> support — they still recognize the old plain-payload tags. Customer build
> `72fdfa0d` → `https://expo.dev/artifacts/eas/jlWwuAtPb9aHOG2coTX-SV8-1XxvhaIdkrPZKdk5Bic.apk`;
> staff build `551ee380` → `https://expo.dev/artifacts/eas/y37dhg0032MJSHtEfdXD27yfiXRDJ6Ha1vC6pAE0MAw.apk`.
>
> **v1.0.0 (Sep 26, QR build):** the in-app scanner is now a **QR reader** —
> the old OCR screen is gone. **This is the build that fixes the
> "no data has been found" error when scanning the printed QR tags:** the
> previously installed APK still ran the old OCR flow, which could only read
> plain-text SYLVER labels and simply couldn't decode QR codes. Also carries
> the backend QR URL-decode fix (full `INVENTRAK:PROD:<id>` payloads now
> resolve, not just bare IDs/SKUs). Same signing key as previous installs →
> updates in place, no uninstall needed.
>
> Build ID: `4006a3ba-c767-4697-919a-0b23e7da0964` · Build page:
> https://expo.dev/accounts/patrickcuevas/projects/inventrak-mobile/builds/4006a3ba-c767-4697-919a-0b23e7da0964
>
> **v1.0.0 (Aug 15, final pre-demo — superseded by the QR build above):**
> rebuilt from latest `main` so the
> installed app carries **everything through today's quality pass** — the
> **pruned API facade** (the customer app no longer exposes admin-only
> endpoints), the **Google name fix** (real profile name, e.g.
> "Jerico Cunanan", not "Jerico + Cunanan"), the **security hardening pass**
> (24h session expiry, forge-proof signing keys), and all the UI/UX +
> scan-flow fixes. Same signing key as previous installs → updates in
> place, no uninstall needed.
>
> Build ID: `5145d163-d639-4480-b014-8f5095e1f48f` · Build page:
> https://expo.dev/accounts/patrickcuevas/projects/inventrak-mobile/builds/5145d163-d639-4480-b014-8f5095e1f48f
>
> **v1.0.0 (Aug 15, earlier build):** carried the Google name fix + security
> hardening pass. Build ID `b51bce7b-0a8c-45c9-b9a0-71942123f845`, link
> `https://expo.dev/artifacts/eas/-fg_iT66Cugeazb8wM9jk-q8k7ccuq-v0SRZOxzJsfk.apk` —
> superseded by the build above.
>
> **v1.0.0 (Aug 11, crash-fix build):** the previous build crashed on launch
> because `@expo/vector-icons` (tab bar / icons) needs `expo-font` as a direct
> native module — missing it, the standalone APK died at startup while Expo Go
> worked (Expo Go bundles the module). This build adds `expo-font` at the
> SDK-54 version, rebuilds the dependency tree from scratch (removed a
> corrupted duplicate), and passes `expo-doctor` 18/18. If you hit the crash
> on the previous build: **uninstall the old app, then install this one.**

- **Profile:** `production` (release build, same signing key as previous
  installs → updates in place, no uninstall needed)
- **Branding:** SYLVER logo — launcher icon, adaptive icon (scaled into the
  Android mask safe zone), and a white splash screen with the centered logo
- **Login screen:** clean customer login — no API server URL field, no
  "API: https://…" text in error popups; the app always uses the baked-in
  deployed backend. **"Continue with Google"** button is now always visible
  and runs the server-side Google OAuth relay (real-name usernames, see
  DEPLOY.md "Google sign-in")
- **Scan flow:** catalog camera icon → live QR scanning with the device
  camera, the camera permission is declared in the manifest, and only
  registered INVENTRAK product tags resolve — foreign QR codes get an
  explicit "not registered" alert and are audit-logged
- **Catalog layout:** category + sort chip rows keep fixed heights on narrow
  phones (no more overlapping the result counter), and every list key is
  hardened so duplicate-key warnings can't appear
- **Backend:** `https://inventrak-api.onrender.com` baked in (Supabase
  PostgreSQL)
- **Local copy:** `C:\Users\Jico\Desktop\INVENTRAK\INVENTRAK-production.apk`
  (customer, v1.2.0) and `INVENTRAK-staff.apk` (staff, v1.5.0)

> **No-install alternative:** open the customer app in any phone/desktop
> browser at the permanent hosted URL `https://inventrak-mobile.onrender.com/`
> — the same app against the same live backend, works on any network (no
> Expo Go, no dev PC, no tunnel).

---

## Step 1 — Get the APK file

You get the `.apk` from the EAS build page:

1. Open `https://expo.dev/account/patrickcuevas/builds` (log in as
   `patrickcuevas` — the account username).
2. Find the latest **production** build for this project (or just use the
   direct download link in the "Latest build" section above).
3. Click **Install** (or the download icon) — this downloads
   `INVENTRAK-<buildid>.apk` (~50–80 MB).
4. The finished build also prints a direct download link in the terminal
   where you ran the build. Either way, you end up with one `.apk` file.

You now have two ways to get that file onto the phone — pick one:

### Option A — Download straight on the phone (easiest, 1 device)
1. Send yourself the download link (email / Messenger / Google Drive).
2. Open the link **on the phone** in Chrome.
3. It downloads the APK — see Step 2 to install.

### Option B — Transfer via USB cable (no link needed)
1. Plug the phone into the PC with a USB cable.
2. On the phone, allow file transfer ("File Transfer / MTP" in the USB
   notification).
3. Copy `INVENTRAK-<buildid>.apk` into the phone's **Downloads** folder.
4. On the phone, open the **Files** app → Downloads → tap the APK.

---

## Step 2 — Allow "install from unknown sources"

The APK is not from the Play Store, so Android asks for permission once:

1. Tap the APK file to open it.
2. Android shows: *"For your security, your phone is not allowed to install
   unknown apps from this source."* → tap **Settings**.
3. In the screen that opens, enable **"Allow from this source"** (the
   Files/Chrome app you used to open the APK).
4. Go back and tap the APK **again**.

---

## Step 3 — Install

1. Read the permissions screen → **Install**.
2. Wait for the progress bar (~30 seconds).
3. Tap **Done** (not "Open" yet — we'll open it in Step 4).

> **Play Protect popup?** ("Google Play Protect can't scan this app") →
> tap **More details → Install anyway**. This is normal for any
> self-distributed APK; the app is built from your own source.

---

## Step 4 — First launch (login)

1. Open **INVENTRAK** from the app drawer — you'll see the **SYLVER logo**
   on the launcher icon and the white splash screen while the app loads.
2. You land on the **Home** screen as a guest — browse the catalog freely.
3. To place an order, log in with the demo customer:
   - **Username:** `customer`
   - **Password:** `customer123`
   - (Admin sign-in stays on the web dashboard — `admin` / `admin123`.)
4. The app talks to the **live Firestore backend** automatically (URL is
   baked in). You'll see today's flash-sale picks, real stock, and your
   orders — from any Wi-Fi or mobile data.

---

## Scanning tags with the phone's own camera app

Tags printed from the admin now encode a **URL** (e.g.
`https://inventrak-api.onrender.com/t/1`), so scanning them with the phone's
**native camera app** opens a public product page — no INVENTRAK app needed,
and no more "No usable data found" on iPhone. Scanning **inside the
INVENTRAK apps (v1.2.0+)** resolves the same tag to the product / count card
as usual — the apps unwrap the URL behind the scenes.

Very old tags that encode the plain payload (`INVENTRAK:PROD:<id>`) still
work in the apps (v1.2.0 and v1.1.0 alike), but a native camera can't act on
them — **reprint tags from the admin** (Products → QR tag, or the batch tag
sheet) to get the URL form.

---

## Step 5 — Demo checklist (before you present)

- [ ] APK installed, app opens to Home with category chips + flash sale
- [ ] Logged in as `customer` — cart, order inquiry, and history all work
- [ ] Backend is up: `curl https://inventrak-api.onrender.com/api/openapi.json`
      returns 200 (or just open the app — if products load, it's alive)
- [ ] Phone has a stable connection (demo day: airplane mode OFF)
- [ ] If the venue Wi-Fi is locked down, use **phone mobile data** instead —
      the app works on any network, that's the point of the deployed backend

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **"App not installed"** | Your phone may be on Android 5 or lower (APK needs Android 6+), or the download was corrupted — re-download and try again. |
| **"Download blocked"** / Play Protect warning | Tap **More details → Install anyway**. |
| **App opens but no products / "network request failed"** | The live backend is down or your network blocks it. Check `https://inventrak-api.onrender.com/api/openapi.json` in the phone browser — if that fails, it's the backend, not the app. |
| **Old version installed** | Uninstall the old INVENTRAK first, then install the new APK (or it may update in place if signed the same). |
| **Scanning a QR tag says an error / nothing found** | You're on the old OCR build — install the Sep 26 QR build above. The old app couldn't read QR codes at all. After installing, open the catalog → camera icon and point at a printed INVENTRAK tag. |
| **Login says "network request failed"** | Same as above — network/backend issue, not your password. |
| **I want a fresh demo state** | Use the web admin dashboard to approve/reject the pending orders before presenting. |

---

## If you rebuild later (new APK)

```bash
cd mobile-client
npx eas-cli login              # once per machine: qjncunanan01@tip.edu.ph
npx eas-cli build --platform android --profile production --non-interactive
# ~6–15 min on the free cloud; the terminal prints the download link

# Staff app (same account, its own project):
cd ../staff-client
npx eas-cli build --platform android --profile production --non-interactive
```

The `production` profile in `eas.json` already bakes
`EXPO_PUBLIC_API_URL=https://inventrak-api.onrender.com` into the build, so
a rebuild automatically points at the same live backend. The splash,
launcher icon, and adaptive icon are configured in `app.json` under
`expo-splash-screen` / `android.adaptiveIcon` — rebuild to pick up any
branding changes.


---



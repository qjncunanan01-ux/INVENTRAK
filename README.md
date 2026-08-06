# INVENTRAK - Inventory Management System

[![Tests](https://github.com/qjncunanan01-ux/INVENTRAK/actions/workflows/test.yml/badge.svg)](https://github.com/qjncunanan01-ux/INVENTRAK/actions/workflows/test.yml)
[![API Docs Deployment](https://github.com/qjncunanan01-ux/INVENTRAK/actions/workflows/docs.yml/badge.svg)](https://github.com/qjncunanan01-ux/INVENTRAK/actions/workflows/docs.yml)

A full-stack inventory management system with admin dashboard, mobile customer app, and optimization algorithms.

## Architecture

```
INVENTRAK/
├── backend/          # Node.js Express API (SQLite) + npm-free fallback
├── frontend-admin/   # React Admin Dashboard (MUI)
├── mobile-client/    # React Native Customer App (Expo)
└── .github/          # CI/CD workflows
```

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
- **Dashboard** - Summary cards + bar/pie charts (recharts) + monthly trends
- **Products** - Create, edit, soft-delete with confirmation dialogs
- **Inventory** - Location-matrix view with low-stock highlighting and filters
- **Stock Movement** - Record movements with FIFO lot visualization
- **Order Inquiries** - Review/approve/reject/fulfill with confirmation
- **Locations** - Add/delete with confirmation
- **Optimization** - ABC classification table + EOQ/ROP/Safety stock + Turnover ratio
- **Snackbar notifications** - Success/error feedback on all actions
- **JWT token management** - Automatic auth header injection via api.js helpers

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
cd backend  npm test    # 14 suites: SQLite, npm-free, contract, OpenAPI conformance,
            # Firestore store, password policy, notifications, driver selection,
            # SQLite→Firestore migration bridge, password hashing, re-hash
            # migration, bidirectional sync, the migration-catalog drift
            # guard, the login lockout suite, and the Firestore-mode auth
            # hashing e2e suite (180 tests)
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
- `.github/workflows/test.yml` — on push/PR to main:
  - Backend: OAS 3.0.3 validation, route <-> spec audit, generated-client
    freshness check, static docs freshness check, then the full test suite
  - `migration-catalog`: seeds a fresh temp SQLite DB from the committed
    catalog and fails if the migration transform output doesn't reproduce it
    (so catalog/seed/transform drift is caught before any Firestore migration)
  - Admin smoke tests + production build
  - Mobile dependency install + source validation + a Metro bundle smoke test
- `.github/workflows/docs.yml` — validates the spec and deploys the static
  Swagger UI site in `docs/` to GitHub Pages (enable Pages -> GitHub Actions)
  See [API Documentation](#api-documentation) for the live URL and local
  `docs/` instructions.

## Tech Stack

- **Backend**: Node.js, Express, SQLite (better-sqlite3), JWT, bcryptjs, Firebase Admin (optional Firestore driver), Resend/Semaphore/Twilio (optional notifications)
- **Admin**: React 18, Material UI 5, Recharts, React Router 6
- **Mobile**: React Native (Expo SDK 54), React Navigation 7, Axios
- **Infrastructure**: Docker, Docker Compose, GitHub Actions

## Repository

https://github.com/qjncunanan01-ux/INVENTRAK

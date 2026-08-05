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
- **JWT Authentication** - Real token-based auth with password hashing (bcryptjs)
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

### Running Tests
```bash
cd backend
npm test    # Runs 4 suites: SQLite + npm-free + contract + OpenAPI conformance
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
| POST | /api/auth/register | Register a new user |
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

> Both the SQLite backend (`src/app.js`) and the npm-free fallback (`src/server_npmfree.js`) expose the same endpoint surface, verified by the contract test suite.

## CI/CD

This project includes GitHub Actions for automated testing and docs:
- `.github/workflows/test.yml` — on push/PR to main:
  - Backend: OAS 3.0.3 validation, route <-> spec audit, generated-client
    freshness check, static docs freshness check, then the full test suite
  - Admin smoke tests + production build
  - Mobile dependency install + source validation
- `.github/workflows/docs.yml` — validates the spec and deploys the static
  Swagger UI site in `docs/` to GitHub Pages (enable Pages -> GitHub Actions)
  See [API Documentation](#api-documentation) for the live URL and local
  `docs/` instructions.

## Tech Stack

- **Backend**: Node.js, Express, SQLite (better-sqlite3), JWT, bcryptjs
- **Admin**: React 18, Material UI 5, Recharts, React Router 6
- **Mobile**: React Native (Expo SDK 54), React Navigation 7, Axios
- **Infrastructure**: Docker, Docker Compose, GitHub Actions

## Repository

https://github.com/qjncunanan01-ux/INVENTRAK

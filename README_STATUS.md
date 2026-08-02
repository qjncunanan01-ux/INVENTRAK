# INVENTRAK Progress Report

## Branch information

- Repository branch is `main`.
- The repository was initially created on `master` and then renamed to the modern GitHub default `main`.

## Completion status

- **Backend API (SQLite + npm-free fallback): 100%**
  - Same endpoint surface on both servers, real JWT auth, bcrypt password hashing, validation, error handling.
- **Admin dashboard pages and routing: 100%**
  - All 7 pages build cleanly and smoke tests pass.
- **Mobile app core screens and navigation: 100%**
  - Expo SDK 54 compatible dependency set, navigation, API integration.
- **Inventory optimization features: 100%**
  - EOQ, ROP, Safety Stock, ABC, Turnover, FIFO lots — demand data is dynamic, not hardcoded.
- **Integration testing / end-to-end demo: 100%**
  - 79 backend tests (SQLite suite + npm-free suite + contract tests), admin smoke tests, Docker Compose, GitHub Actions CI.

> Overall completion: **100%**

## What was added in the latest pass (OpenAPI + contract tests)

1. **OpenAPI/Swagger documentation** — `backend/openapi.json` (OpenAPI 3.0.3, 25 paths, 29 schemas) is served by **both** backends at `GET /api/openapi.json`, with an interactive Swagger UI at `GET /api/docs`.
2. **Contract test suite** — `backend/src/test/contract.test.js` boots the SQLite and npm-free servers side by side in isolated temp directories and asserts identical status codes + response body shapes for every endpoint. It caught and drove fixes for real divergences (partial-PUT column nulling, `Alert.id` types, stock-lots query params, inventory active-only merge, insufficient-stock 400s, auth 401/403 semantics, string-length password validation).
3. **npm-free parity hardening** — the fallback now mirrors the SQLite contract exactly: demo-token auth, `/api/auth/me`, pagination, movement-created alerts, protected exports, JSON-string inquiry products.
4. **Docs updated** — test counts (79), endpoint table (adds `/api/openapi.json`, `/api/docs`), and this changelog.

## What was fixed in the final pass

1. **Backend install failure** — `better-sqlite3` was bumped to `^13.0.2` (ships prebuilt binaries for Node 24, no Visual Studio / node-gyp required). Docker image updated to `node:22-alpine` and CI to Node 22 to match.
2. **Test suite** — `npm test` now runs both the SQLite suite and the npm-free suite (56 tests total). The SQLite suite was rewritten to exercise the hardened, authenticated API with correct status codes and real seeded credentials (`admin/admin123`).
3. **npm-free server parity** — `src/server_npmfree.js` now provides the full endpoint surface: products CRUD + categories, analytics summary + CSV export, sales, users, alerts, register, bulk optimization, and dynamic demand (replaces the hardcoded `D = 1000`).
4. **Seed script** — `src/seed.js` now also creates the default users and sales transactions, and skips re-seeding when products already exist.
5. **Frontend smoke tests** — added `src/App.test.js` (2 tests) plus the needed testing-library dev dependencies.
6. **Mobile dependency set** — aligned `mobile-client` with Expo SDK 54 (react-native 0.81.5, react 19.1.0, expo-status-bar ~3.0.9, react-native-screens, react-native-safe-area-context) and added the required `app.json` and `babel.config.js`.
7. **CI/CD** — `.github/workflows/test.yml` installs dependencies correctly, runs the full backend suite, runs admin smoke tests and build, and validates the mobile sources.

## Remaining / optional next steps

- Add a demo video link or release notes.
- Add `SECURITY.md` / `CONTRIBUTING.md` for open-source collaboration.

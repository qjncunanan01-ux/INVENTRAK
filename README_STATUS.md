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
  - 95 backend tests (SQLite suite + npm-free suite + contract tests + OpenAPI conformance), admin smoke tests, Docker Compose, GitHub Actions CI.

> Overall completion: **100%**

## What was added in the latest pass (OpenAPI drift guards + generated clients)

1. **OpenAPI conformance suite** — `backend/src/test/openapi.test.js` boots both backends and validates every actual response **and** request body against the schemas in `backend/openapi.json` with ajv (`npm i -D ajv ajv-formats`). This is the drift guard: even if both backends agree on a shape, a response that violates its documented schema (or an undocumented status code, or an extra undocumented field — `additionalProperties: false` is enforced) fails the build.
2. **Shared harness** — `backend/src/test/harness.js` now owns the isolated-temp-dir boot/teardown for both servers; `contract.test.js` was refactored onto it.
3. **Spec completeness** — every operation now has an `operationId` (used by client codegen + Swagger), and the spec documents the `403` responses both backends actually return (invalid token / non-admin) plus a JSON schema for the export `200`.
4. **Spec tooling scripts** — `validate-openapi.js` (validates against the official OAS 3.0.3 schema via `@apidevtools/swagger-parser`), `audit-routes.js` (asserts every code route <-> documented path coverage in both directions), `build-docs.js` (builds the static Swagger UI site in `docs/`).
5. **Generated API clients** — `frontend-admin/src/api.generated.js` and `mobile-client/src/api.generated.js` are generated from `openapi.json` (`npm run client:generate`). Both `src/api.js` facades now delegate to the generated client, replacing the hand-written fetch calls, while keeping the exact `apiGet/apiPost/apiPut/apiDelete` signatures the pages import plus one typed function per operation (`login`, `listProducts`, `getInventory`, ...). CI checks freshness with `npm run client:check`.
6. **Static docs site + GitHub Pages** — `npm run docs:build` writes a self-contained Swagger UI into `docs/`; `.github/workflows/docs.yml` validates the spec and deploys it to GitHub Pages. `test.yml` now also runs spec validation, route audit, client freshness, and docs freshness.
7. **Docs updated** — test counts (95), the new scripts, and this changelog.

## What was added in the previous pass (OpenAPI + contract tests)

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

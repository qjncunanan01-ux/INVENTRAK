# INVENTRAK Capstone Scaffold

This workspace contains scaffolded projects for the INVENTRAK capstone:

- `backend/` - Node.js backend with inventory, product, stock movement, optimization, and order inquiry APIs.
- `frontend-admin/` - React admin dashboard for inventory management and optimization.
- `mobile-client/` - React Native customer app for browsing, recommendations, costing, and inquiries.

## Quick start

### Backend

Use the npm-free server if native build tools are not available:

```bash
cd backend
node src/server_npmfree.js
```

If `better-sqlite3` is already installed and your environment supports native modules:

```bash
cd backend
npm install
npm start
```

### Admin app

```bash
cd frontend-admin
npm install
npm start
```

Environment variable support:

```bash
REACT_APP_API_BASE_URL=http://localhost:4001 npm start
```

### Mobile app

```bash
cd mobile-client
npm install
npm start
```

The mobile app is configured to use `10.0.2.2` for Android emulator and `localhost` for iOS / web.

### Integration tests

The backend includes an npm-free API server and test suite.

```bash
cd backend
npm test
```

This runs the fallback backend tests without requiring native `better-sqlite3` build tools.

## Repository

The project is available on GitHub:

https://github.com/qjncunanan01-ux/INVENTRAK

## Status and completion

A detailed progress report is included in `README_STATUS.md`, with current completion estimated at around 85% and the remaining work clearly listed.

## Upload readiness

The repository is initialized and pushed with a first commit. It includes:

- `.gitignore` to exclude `node_modules`, local build artifacts, and temp files
- `package-lock.json` for `backend`, `frontend-admin`, and `mobile-client`
- no generated build or dependency folders committed

## GitHub push instructions

If you need to update the repo later:

```bash
git add .
git commit -m "Your update message"
git push origin main
```

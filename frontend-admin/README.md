# INVENTRAK Admin Web

Owner/staff dashboard for INVENTRAK: inventory, products, approvals, Scan &
Stock (OCR), reports, and user management. Built with **Vite + React 18 +
MUI 5 + Recharts + React Router 7**.

## Run locally

```bash
cd frontend-admin
npm install
npm run dev        # → http://localhost:3000
```

The app expects the backend API at `http://localhost:4001`. To point it
elsewhere, set `REACT_APP_API_BASE_URL` (or `VITE_API_BASE_URL`) at **build/dev
time** — `vite.config.js` bakes it in (the CRA-era env name still works).

## Test

```bash
npm test           # Vitest suite (28 tests)
npm run build      # production bundle → build/ (code-split MUI/recharts/app)
```

## Deploy

Deploys to Render as a static site (`inventrak-admin.onrender.com`) via the
repo's `render.yaml` blueprint — see the root `DEPLOY.md`.

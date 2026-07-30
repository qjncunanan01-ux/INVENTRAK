# INVENTRAK - Inventory Management System

A full-stack inventory management system with admin dashboard, mobile customer app, and optimization algorithms.

## Architecture

```
INVENTRAK/
├── backend/          # Node.js Express API (SQLite)
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
- **Optimization** - ABC classification table + EOQ/ROP/Safety stock + Turnover ratio + Demand forecast
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
- **Economic Order Quantity (EOQ)** - √(2DS/H) using actual sales data (not hardcoded)
- **Reorder Point (ROP)** - Based on lead-time demand
- **Safety Stock** - Statistical safety buffer
- **ABC Classification** - Pareto-based (70/20/10) cumulative value analysis
- **Inventory Turnover Ratio** - Annual demand / average inventory
- **Demand Forecasting** - Moving average prediction
- **FIFO Lot Tracking** - Oldest stock consumed first

## Quick Start

### Prerequisites
- Node.js 18+ installed
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
# Login: admin / any password
```

### Mobile App (Expo)
```bash
cd mobile-client
npm install
npx expo start --tunnel
# Scan QR with Expo Go app (Android/iOS)
# Login: customer / any password
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
npm test    # Runs 20+ tests (both SQLite and npm-free backends)
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register a new user |
| POST | /api/auth/login | Login and get JWT token |
| GET | /api/products | List products (supports ?search=&page=&limit=) |
| GET | /api/products/:id | Get single product |
| POST | /api/products | Create product |
| PUT | /api/products/:id | Update product |
| DELETE | /api/products/:id | Soft-delete product |
| GET | /api/inventory | Get inventory per location |
| GET | /api/locations | List locations |
| POST | /api/locations | Create location |
| DELETE | /api/locations/:id | Delete location |
| POST | /api/stock-movement | Record stock movement |
| GET | /api/stock-movements | List stock movements |
| GET | /api/stock-lots | List stock lots (FIFO) |
| GET | /api/order-inquiries | List order inquiries |
| POST | /api/order-inquiries | Create order inquiry |
| PUT | /api/order-inquiries/:id | Update inquiry status |
| GET | /api/optimization/:id | EOQ/ROP/Safety for a product |
| GET | /api/optimization/abc | ABC classification |
| GET | /api/optimization/turnover | Inventory turnover ratio |
| GET | /api/optimization/forecast | Demand forecast |
| GET | /api/analytics/summary | Dashboard summary data |
| GET | /api/analytics/top-products | Top products by movement |
| GET | /api/alerts | Low stock alerts |

## CI/CD

This project includes GitHub Actions for automated testing:
- Backend tests on push/PR to main branch
- Admin build verification
- Mobile lint checks

## Tech Stack

- **Backend**: Node.js, Express, SQLite (better-sqlite3), JWT, bcryptjs
- **Admin**: React 18, Material UI 5, Recharts, Axios, React Router 6
- **Mobile**: React Native, Expo, React Navigation 7, Axios
- **Infrastructure**: Docker, Docker Compose, GitHub Actions

## Repository

https://github.com/qjncunanan01-ux/INVENTRAK

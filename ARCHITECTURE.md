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
│   │   ├── ocr.js              # Product OCR scanning
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
│   │   ├── pages/              # 14 page components
│   │   └── e2e/                # 27 Playwright E2E tests
│   ├── vite.config.js          # Vite build config
│   └── index.html              # SPA entry with CSP headers
├── mobile-client/              # Mobile app (Expo + React Native)
│   ├── src/
│   │   ├── App.js              # Navigation + session management
│   │   ├── api.js              # API client with retry logic
│   │   ├── api.generated.js    # Auto-generated from OpenAPI
│   │   ├── screens/            # 15 screen components
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

### Order Inquiries
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| customer_name | TEXT | |
| customer_email | TEXT | |
| customer_phone | TEXT | |
| products | TEXT | JSON array of items |
| estimated_cost | REAL | Total estimated |
| status | TEXT | pending/approved/fulfilled/delivered/rejected |
| user_id | INTEGER FK | Links to account |
| status_history | TEXT | JSON timeline |
| payment_* | TEXT | Payment fields |

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
- `POST /api/ocr/scan` — Product photo recognition

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
- Request body size limit (100KB, 12MB for OCR)

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

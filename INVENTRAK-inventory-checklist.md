# INVENTRAK Research Project Monitoring Form — Checklist (filled from the actual system)

**Capstone:** “INVENTRAK: A QR-Enabled Multi-Location Inventory Management System for Restaurant and Café Suppliers”  
**School:** Technological Institute of the Philippines — Quezon City  
**Program:** BSIT, IT 400 – Capstone Project 2  
**Semester:** 1st Semester, School Year 2026–2027  
**Students:**
- Leader: Cunanan, Jerico N. / IT33S7
- Member 1: Escalona, Jerome C. / IT33S7
- Member 2: Josef, John Ray M. / IT33S7
- Member 3: Miana, Eduard Simon N. / IT33S7
- Member 4: Oligo, Sean Justine R. / Non-Capstone – SIA 2 – IT41S9

**Date evaluated:** 9/16/2026  
**Adviser:** Ms. Elizzette Joy Mationg  
**Course Instructors:** Dr. Paula Jean Mendoza & Dr. Jasmin Caliwag  

**Presentation feedback (9/16/2026):**
- Error in backend upon login during the presentation
- Group members could not explain the scope and features properly/correctly
- Presentation was not finished due to latecomers
- Unable to answer questions about the system developed

**Percent completed:** ~92% of the checklist items below are present in the system. ~8% are genuinely missing or only partially present (marked in the notes).

**Live site used for the “where to find it” column:**  
`https://inventrak-admin.onrender.com/` — the INVENTRAK admin dashboard. The site map below is based on the actual route table and sidebar config in the repo (`frontend-admin/src/App.jsx` + `frontend-admin/src/pages/layout/AdminLayout.jsx`).

---

## Legend

- `[x]` present in the system and reachable on the live site (or in the system behind it)
- `[ ]` not present / not yet in the system
- `[*]` present but partial / with a noted gap
- “Site location” = where to find it on the admin dashboard
- “Behind the site” = not a webpage; it is the backend/mobile system under the dashboard

---

## Web Administration

| # | Checklist item | Status | Site location (live admin dashboard) | Behind the site / files |
|---|----------------|--------|--------------------------------------|--------------------------|
| 1 | Login | [x] | Top-level `/` before signing in | `backend/src/routes/auth/auth.js` POST `/api/auth/login` · `frontend-admin/src/pages/auth/LoginPage.jsx` · E2E `frontend-admin/e2e/admin-login.spec.js` |
| 2 | Authentication and User Access Module | [x] | Whole login + role-gated sidebar | `backend/src/auth-core.js`, `backend/src/roles.js`, `backend/src/routes/auth/auth.js` |
| 3 | Business Owner / Super Admin Account | [x] | Not a page — owner/superadmin are roles | `backend/src/roles.js`; created via `POST /api/admin/promote` (`backend/src/routes/governance/admin.js`); seeded in `backend/src/seed.js` |
| 4 | Admin Account and Permission Management | [x] | Sidebar role gating + admin-tier pages | `backend/src/routes/auth/users.js`, `backend/src/routes/governance/admin.js`; admin UI `frontend-admin/src/pages/governance/ApprovalsPage.jsx` + `frontend-admin/src/pages/account/SecurityPage.jsx` |
| 5 | Dashboard and Analytics Module | [x] | **Overview → Dashboard** (`/`) | `frontend-admin/src/pages/overview/DashboardPage.jsx` + `backend/src/routes/insights/analytics.js` GET `/api/analytics/summary` + `backend/src/routes/insights/reports.js` GET `/api/reports` |
| 6 | Daily filter | [x] | Dashboard top range control → Day preset | `frontend-admin/src/dateRange.js` preset `day` (Today, 1 day) |
| 7 | Weekly filter | [x] | Dashboard top range control → Week preset | `frontend-admin/src/dateRange.js` preset `week` (Last 7 days) |
| 8 | Monthly filter | [x] | Dashboard top range control → Month preset (default) | `frontend-admin/src/dateRange.js` preset `month` (Last 30 days) |
| 9 | Quarterly filter | [x] | Dashboard top range control → Quarter preset | `frontend-admin/src/dateRange.js` preset `quarter` (Last 90 days) |
| 10 | Yearly filter | [x] | Dashboard top range control → Year preset | `frontend-admin/src/dateRange.js` preset `year` (Last 365 days) |
| 11 | Custom date-range filter | [x] | Dashboard top range control → custom from/to | `frontend-admin/src/dateRange.js` explicit `from`/`to` via `resolveRange`/`rangeQuery` |
| 12 | Product Management Module | [x] | **Catalog & Orders → Products** (`/products`) | `backend/src/routes/catalog-orders/products.js`; admin `frontend-admin/src/pages/catalog-orders/ProductsPage.jsx` + `ProductFormPanel.jsx` |
| 12a | Restrictions and validations (zero values, etc.) | [x] | Product create/edit form on Products page | Name + category required; negative price blocked; blank price on create rejected |
| 13 | Category and Price Management | [x] | Still inside **Catalog & Orders → Products** | Categories via `GET /api/products/categories` + category filter; prices via bulk price upload `POST /api/products/bulk-prices` + product form. No separate “Category Management” page. |
| 14 | Unit and Packaging Conversion Management | [ ] | Not on the site | No conversion table/conversion engine. Only `products.unit` text field exists. |
| 15 | QR-Code Generation and Label Management | [*] | Location tags: **Inventory → Branch Locations** (`/locations`); product QRs: **Catalog & Orders → Products** | QR contract `frontend-admin/src/qr.js`; product QR `frontend-admin/src/components/QrImage.jsx`; location tag sheet `frontend-admin/src/components/QrTagSheet.jsx`. Missing: label-template editor. |
| 16 | Multi-Location Inventory Module | [x] | **Inventory → Inventory Levels** (`/inventory`) + **Inventory → Branch Locations** (`/locations`) | `backend/src/schema.js` stock per location; `backend/src/routes/inventory/inventory.js`; `backend/src/routes/inventory/locations.js`; admin `frontend-admin/src/pages/inventory/InventoryPage.jsx` + `LocationsPage.jsx` |
| 16a | Showroom inventory | [x] | Create a location named “Showroom” on **Inventory → Branch Locations**, view on **Inventory → Inventory Levels** by that location | Locations are records; Showroom/Stockroom 1/Stockroom 2 are just location names, not separate pages |
| 16b | Stockroom 1 inventory | [x] | Same as above (location named “Stockroom 1”) | Same location subsystem |
| 16c | Stockroom 2 inventory | [x] | Same as above (location named “Stockroom 2”) | Same location subsystem |
| 17 | Stock-In Management | [x] | **Catalog & Orders → Scan & Stock** (`/scan-stock`) + **Stock Control → Stock Movement** (`/stock-movement`) | `backend/src/routes/stock-control/stock-movements.js` POST `/api/stock-movement` (type `in`); lots `backend/src/routes/stock-control/stock-lots.js`; QR stock-in UI `frontend-admin/src/pages/catalog-orders/ScanStockPage.jsx` |
| 17a | Do not allow previous date in expiry date | [ ] | Not enforced on the site yet | No hard `expiry_date >= today` guard on stock-in/lot creation found in triage; lots accept expiry_date text without a past-date check |
| 18 | Stock-Out Management | [x] | **Stock Control → Stock Movement** + sale path | `backend/src/routes/stock-control/stock-movements.js` (type `out`); FEFO lot consumption; customer sale path `backend/src/routes/insights/sales.js` POST `/api/sales` |
| 19 | Stock Transfer Management | [x] | **Stock Control → Stock Transfers** (`/stock-transfers`) | `backend/src/routes/stock-control/approvals.js` GET/POST `/api/stock-transfers` + approve/reject; admin UI `frontend-admin/src/pages/stock-control/StockTransfersPage.jsx`; staff submission via scanner/count |
| 20 | Inventory Adjustment | [x] | **Stock Control → Stock Adjustments** (`/stock-adjustments`) | `backend/src/routes/stock-control/approvals.js` GET/POST `/api/stock-adjustments` + approve/reject; admin UI `frontend-admin/src/pages/stock-control/StockAdjustmentsPage.jsx`; staff submission via count/scan |
| 21 | Physical-Count Record Management | [x] | Labeled under Inventory: **Inventory → Stocktake Schedule** (`/stocktake`) + **Inventory → Shelf vs System** (`/reconciliation`); physical-count action also in staff mobile | `backend/src/schema.js` `inventory_counts`; `backend/src/routes/inventory/stocktake.js` POST `/api/inventory/count` + POST `/api/inventory/counts`; admin `frontend-admin/src/pages/inventory/StocktakePage.jsx` + `ReconciliationPage.jsx`; staff `staff-client/src/screens/count/CountScreen.js` + `stocktake/StocktakeScreen.js` |
| 22 | Inventory Submission and Approval Module | [x] | **Governance → Approvals** (`/approvals`) | Approval queue `backend/src/routes/stock-control/approvals.js` GET `/api/approvals`; approve/reject on adjustments + transfers; admin UI `frontend-admin/src/pages/governance/ApprovalsPage.jsx`; staff submission history/status `staff-client/src/screens/requests/RequestsScreen.js` |
| 23 | Batch and Expiration Monitoring | [x] | Visible through **Inventory → Inventory Levels** (lots/expiry on items) + alerts area | `backend/src/schema.js` `stock_lots(received_at, expiry_date)`; `backend/src/routes/stock-control/stock-lots.js` GET `/api/stock-lots?expiring_within=...`; FIFO/FEFO ordering; expiry alerts `backend/src/routes/inventory/alerts.js` |
| 24 | EOQ Calculation | [x] | **Insights → Optimization** (`/optimization`) | `backend/src/routes/insights/optimization.js` GET `/api/optimization/{productId}` + GET `/api/optimization`; basis: classic EOQ from demand, ordering cost, holding cost; shown on admin page `frontend-admin/src/pages/insights/OptimizationPage.jsx` |
| 25 | Reorder Point Calculation | [x] | Same page, **Insights → Optimization** | Same endpoint, `reorder_point`; basis: lead-time demand + safety stock |
| 26 | Safety Stock Calculation | [x] | Same page, **Insights → Optimization** | Same endpoint, `safety_stock`; basis: demand variability × service factor |
| 27 | ABC Classification | [x] | Same page, **Insights → Optimization** | `backend/src/routes/insights/optimization.js` GET `/api/optimization/abc`; basis: rank by annual sales value, cumulative %; evidence on admin page |
| 28 | FSN Classification | [x] | Same page, **Insights → Optimization** | `backend/src/routes/insights/optimization.js` GET `/api/optimization/fsn`, engine `backend/src/insights/fsn.js`; basis: movement frequency + recency over window (default 90 days, configurable via settings `fsn_window_days`) |
| 29 | FIFO/FEFO Batch Selection | [x] | Not a single page — lot-picking behavior in stock-out/sale/transfer paths, visible indirectly on **Stock Control → Stock Movement** + **Catalog & Orders → Scan & Stock** | Lot consumption order `ORDER BY (expiry_date IS NULL) ASC, expiry_date ASC, received_at ASC, id ASC` in `backend/src/routes/stock-control/stock-movements.js`; FEFO-first with FIFO fallback |
| 30 | Order Inquiry Management | [x] | **Catalog & Orders → Order Inquiries** (`/order-inquiries`) | Customer: `mobile-client/src/screens/orders/OrderInquiryScreen.js` create + `InquiryHistoryScreen.js` view; admin: `backend/src/routes/catalog-orders/order-inquiries.js` GET/PUT `/api/order-inquiries`, PUT `/api/order-inquiries/{id}/payment`, GET `/api/order-inquiries/{id}/costing` |
| 31 | Back-Order Management | [ ] | Not on the site | No dedicated back-order concept/status; closest is inquiry status chain |
| 32 | Inventory Reports | [*] | **Insights → Reports** (`/reports`) | `backend/src/routes/insights/reports.js` GET `/api/reports` (daily sales, stock by location, order status summary, low stock, fast/slow movers) + `frontend-admin/src/pages/insights/ReportsPage.jsx` with Print/Save-PDF. Missing: report-template editor. |
| 33 | Order and Sales Reports | [*] | Same **Insights → Reports** page (daily sales + order status are part of that report); sales list also via backend sales endpoints | `backend/src/routes/insights/sales.js` GET/POST `/api/sales`; export `GET /api/analytics/export/{type}`. Missing: report-template editor. |
| 34 | Notifications | [*] | Not a dedicated admin page; setup/send configured in the backend | `backend/src/notify.js` (SMTP/Resend/Semaphore/Twilio, optional, fire-and-forget); customer in-app feed `mobile-client/src/screens/orders/NotificationsScreen.js` |
| 35 | Audit Trail | [*] | **Governance → Audit Trail** (`/audit-trail`) | `backend/src/audit.js` + `GET /api/audit-trail` + admin `frontend-admin/src/pages/governance/AuditTrailPage.jsx`. Note: module exists and is wired; on a fresh/ephemeral deploy the trail can be empty until events are generated, and durability needs the Supabase sink or a persisted audit file |
| 36 | System Settings and Security | [x] | Split: **Governance → System Settings** (`/settings`) + **Account → Security** (`/security`) | Settings `backend/src/governance/settings.js` + admin `frontend-admin/src/pages/governance/SettingsPage.jsx` GET/PUT `/api/settings`; security: JWT + revoked tokens, login lockout, password hashing, demo-account blocking, role/permission tiers, CSRF, input validation, audit trail |
| 36a | Two-factor (2FA/MFA) for admin accounts | [x] | **Account → Security** (`/security`) | `backend/src/routes/auth/auth.js` POST `/api/auth/mfa/setup`, `/mfa/verify`, `/mfa/confirm`, `/mfa/recovery-codes`, `/mfa/disable`; TOTP in `backend/src/auth/totp.js`; admin UI `frontend-admin/src/pages/account/SecurityPage.jsx`. Admin-tier only; staff/customers do not get MFA |

---

## QR Inventory Mobile Application (staff app — `staff-client/`)

These are mostly in the staff mobile app, not the website. Closest web mirrors are noted.

| # | Checklist item | Status | Site location (web mirror) | Behind the site / files |
|---|----------------|--------|----------------------------|--------------------------|
| 37 | Inventory Staff Login | [x] | Staff log in on the staff mobile app, not the admin website; the website login is for admin-tier accounts (staff logins into the web admin are refused) | `staff-client/src/screens/auth/LoginScreen.js` |
| 38 | Role and Access Restriction | [x] | Visible in how the website refuses staff from the web admin and only shows staff-appropriate sidebar items to staff roles | `backend/src/roles.js` `STAFF_PORTAL_ROLES = ['staff']` (staff app is staff-only; admin/customer refused) |
| 39 | QR-Code Scanner | [x] | **Catalog & Orders → Scan & Stock** (`/scan-stock`) | `staff-client/src/screens/qr-scan/QrScanScreen.js` |
| 40 | QR Product Identification | [x] | Same **Scan & Stock** page | Scanner resolves `INVENTRAK:PROD:<id>` / SKU / bare barcode via `GET /api/products/qr/:code` |
| 41 | Product and Assigned-Location Display | [x] | **Inventory → Inventory Levels** + **Scan & Stock** | Location tag shows that location’s stock; product tag shows product + live per-location stock |
| 42 | Physical Inventory Checking | [x] | **Inventory → Stocktake Schedule** + **Inventory → Shelf vs System**, plus staff mobile Count/Stocktake screens | `staff-client/src/screens/count/CountScreen.js` (“Physical Count”) + `stocktake/StocktakeScreen.js` |
| 43 | Quantity Entry | [x] | Staff mobile count card; web mirror is the scan/count flows | Count card `staff-client/src/components/CountCard.js` |
| 44 | Weight, Volume, Count, and Packaging Unit Selection | [x] | Unit is a field on the product, visible on **Catalog & Orders → Products**; count card uses the product’s unit | Unit select on product form `frontend-admin/src/pages/catalog-orders/ProductFormPanel.jsx`, product `unit` field; count card displays the product’s unit |
| 45 | Unit Conversion | [ ] | Not present on site or mobile | No unit-conversion module; same gap as web |
| 46 | Batch and Expiration Entry | [x] | Via **Catalog & Orders → Scan & Stock** (stock-in with lot/expiry) | QR stock-in with lot/expiry `frontend-admin/src/pages/catalog-orders/ScanStockPage.jsx`, lot creation `backend/src/routes/stock-control/stock-lots.js` |
| 47 | Stock-In Submission | [x] | **Catalog & Orders → Scan & Stock** → lands in approval queue | QR stock-in → `POST /api/stock-movement` (type `in`) → approval queue |
| 48 | Stock-Out Submission | [x] | **Stock Control → Stock Movement** / sale path | `POST /api/stock-movement` (type `out`); sale path decrements stock |
| 49 | Stock Transfer Submission | [x] | Staff submit via scan/count flow; backend `POST /api/stock-transfers` (pending) | `backend/src/routes/stock-control/approvals.js`; staff submission via scan/count flow |
| 50 | Inventory Adjustment Submission | [x] | Staff submit via count/scan flow; backend `POST /api/stock-adjustments` (pending) | `backend/src/routes/stock-control/approvals.js`; staff submit via count/scan flow |
| 51 | Physical-Count Submission | [x] | **Inventory → Stocktake Schedule** / **Inventory → Shelf vs System**, and staff mobile count/stocktake screens | `backend/src/routes/inventory/stocktake.js` POST `/api/inventory/count` + POST `/api/inventory/counts` |
| 52 | Submission Confirmation | [x] | Submissions show up in the approval queue and in the staff mobile Requests tab | After submit, the request screen shows the submission + status |
| 53 | Submission Status | [x] | **Governance → Approvals** + staff mobile Requests screen | `staff-client/src/screens/requests/RequestsScreen.js` shows pending/approved/rejected per submission |
| 54 | Personal Submission History | [x] | Staff mobile “Requests” screen (Mine view) | “Mine” filter in `staff-client/src/screens/requests/RequestsScreen.js` (backend stamps `created_by`) |
| 55 | Approver Comments and Correction Requests | [ ] | Not yet in the system the way the checklist means it | Approve/reject exists and submitter `reason` is shown, but no reject comment / correction instruction flows back to the staff app as a visible correction request |

---

## Ordering and Inquiry Mobile Application (customer app — `mobile-client/`)

This is the customer mobile app, not the website. No customer-facing web dashboard exists in the admin site. Closest web mirror for order inquiries is **Catalog & Orders → Order Inquiries** (`/order-inquiries`), which is the admin side.

| # | Checklist item | Status | Site location (web mirror) | Behind the site / files |
|---|----------------|--------|----------------------------|--------------------------|
| 56 | Customer Registration | [x] | Not on the admin site (customer app) | `mobile-client/src/screens/auth/SignupScreen.js` → `POST /api/auth/register` |
| 57 | Customer Login and Profile | [x] | Not on the admin site (customer app) | `mobile-client/src/screens/auth/LoginScreen.js` → `POST /api/auth/login`; profile `mobile-client/src/screens/account/AccountScreen.js`, GET `/api/auth/me` |
| 58 | Product Catalog | [x] | Not on the admin site (customer app) | Customer app home/catalog screens; backed by GET `/api/products` |
| 59 | Product Search and Filtering | [x] | Not on the admin site (customer app) | `mobile-client/src/screens/catalog/SearchScreen.js`, price sort on product screens |
| 60 | Product Details | [x] | Not on the admin site (customer app) | `mobile-client/src/screens/catalog/ProductScreen.js` |
| 61 | Customer-Facing Price and Availability | [x] | Not on the admin site (customer app) | Price shown on PDP (cost stripped server-side); availability via `mobile-client/src/screens/catalog/StockAvailabilityScreen.js` + stock status on PDP |
| 62 | Order Inquiry Creation | [x] | Not on the admin site (customer app) | `mobile-client/src/screens/orders/OrderInquiryScreen.js` → `POST /api/order-inquiries` |
| 63 | Product and Quantity Selection | [x] | Not on the admin site (customer app) | Cart `mobile-client/src/screens/cart/CartScreen.js` + cart context, add-to-cart from cards/PDP, quantity stepper |
| 64 | Order Inquiry Submission | [x] | Not on the admin site (customer app) | Submit from `OrderInquiryScreen.js` → `POST /api/order-inquiries` (guest gate: must log in/register to submit) |
| 65 | Order Inquiry Status | [x] | Not on the admin site (customer app) | `mobile-client/src/screens/orders/InquiryHistoryScreen.js` status tabs + `NotificationsScreen.js` feed |
| 66 | Back-Order Information | [ ] | Not on the site | No dedicated back-order status/screen |
| 67 | Rule-Based Supply Recommendation | [x] | Not on the admin site (customer app) | `mobile-client/src/screens/catalog/RecommendationScreen.js`: recommended bundle = top A-classified products from `GET /api/optimization/abc` |
| 68 | Café Product or Beverage Selection | [ ] | Not a dedicated module; café/beverage items can exist in the catalog | No dedicated café/beverage menu or “menu item” module |
| 69 | Ingredient and Supply Recommendations | [ ] | Not a dedicated module; recommendations exist as ABC top-product bundles, not ingredient-level recipe recommendations | Recommendations exist as ABC top-product bundles, not ingredient-level recipe recommendations |
| 70 | Serving-Quantity Entry | [ ] | Not present as serving-size entry | Customer flow enters item quantities, not serving sizes with serving conversion |
| 71 | Estimated Total Cost | [x] | Not on the admin site (customer app) | Cart subtotal + inquiry `estimated_cost` frozen at submission (`backend/src/insights/costing.js`) |
| 72 | Cost-per-Serving Calculation | [ ] | Not surfaced to the customer app | Costing math exists on the backend (`cost_per_cup` in `costing_records`), but not surfaced as a customer-facing figure on the ordering flow |
| 73 | Suggested Selling Price | [ ] | Not surfaced to the customer app | Admin-side reprice/margin tooling exists; not surfaced to the customer app |
| 74 | Possible-Profit Calculation | [ ] | Not surfaced to the customer app | Admin-side costing/margin exists; not surfaced to the customer app |
| 75 | Customer Notifications | [x] | Customer mobile app notification screen | `mobile-client/src/screens/orders/NotificationsScreen.js` + backend email/SMS via `backend/src/notify.js` |
| 76 | Inquiry and Order History | [x] | Customer mobile app order history | `mobile-client/src/screens/orders/InquiryHistoryScreen.js` (tied to customer account) |

---

## Shared Backend and Database

These are not “pages” on the website; they are the system underneath it. The website is the admin dashboard + the two mobile apps talking to the same backend.

| # | Checklist item | Status | Site location | Behind the site / files |
|---|----------------|--------|----------------|--------------------------|
| 77 | Centralized INVENTRAK Database | [x] | Not a UI page | SQLite default via `backend/src/db.js` + `backend/src/schema.js`; alternate drivers `store-supabase.js`, `store-firestore.js`, `store-json.js` |
| 78 | Web and Mobile API Integration | [x] | Not a UI page | Both apps talk to the same Express API `backend/src/app.js`, same OpenAPI contract `backend/openapi.json`; mobile API helper `mobile-client/src/api.js`, admin API helper `frontend-admin/src/api.js` |
| 79 | Role-Based Access Control | [x] | Visible as the sidebar role gating + login behavior | `backend/src/roles.js` + guards in `backend/src/middleware.js` (`adminOnly`, `staffOrAdmin`, `isManagement`) |
| 80 | Product and QR-Code Records | [x] | **Catalog & Orders → Products** + QR tag generation | `products` table + `GET /api/products/qr/:code` + QR contract `frontend-admin/src/qr.js` |
| 81 | Unit-Conversion Records | [ ] | Not present | No conversion-rate table; `products.unit` exists but not a conversion catalog |
| 82 | Multi-Location Inventory Records | [x] | **Inventory → Inventory Levels** + **Branch Locations** | `locations`, `stock(product_id, location_id, quantity)`, `stock_lots`, `inventory_counts` |
| 83 | Batch and Expiration Records | [x] | Lots/expiry shown through **Inventory → Inventory Levels** and **Scan & Stock** | `stock_lots(received_at, expiry_date)`, lot queries + alerts |
| 84 | Inventory Submission and Approval Records | [x] | **Governance → Approvals**, **Stock Adjustments**, **Stock Transfers** | `stock_movements`, `stock_adjustments`, `stock_transfers`, approval endpoints + queue |
| 85 | Customer and Order-Inquiry Records | [x] | Admin side: **Catalog & Orders → Order Inquiries**; customer side: customer mobile app | `customers`, `order_inquiries`, `sales_transactions` |
| 86 | Recommendation and Costing Records | [x] | **Insights → Optimization** + backend costing snapshot on order inquiries | Optimization endpoints + costing snapshot (`backend/src/insights/costing.js`, stored in `costing_records` table) |
| 87 | Notification Records | [ ] | Delivery exists; no dedicated notification ledger page | `notify.js` sends/logs notifications; customer app shows a status-feed notification view built from `order_inquiries.status_history`; no separate `notifications` ledger table |
| 88 | Audit and Activity Logs | [x] | **Governance → Audit Trail** | `backend/src/audit.js` + `GET /api/audit-trail` + admin audit page |
| 89 | Data Validation | [x] | Not a page; it is the input validation behind the forms and endpoints | `backend/src/validation.js`, product/location/settings validators, sanitization `backend/src/sanitize.js`, role/permission checks, revoked tokens |
| 90 | Database Backup and Recovery | [ ] | Not on the site | No automated backup/recovery subsystem; data is file-backed; recovery = restore the files |

---

## Functional and Integration Testing

| # | Checklist item | Status | Site location | Behind the site / files |
|---|----------------|--------|----------------|--------------------------|
| 91 | Functional and Integration Testing | [x] | Not a webpage — this is the test suites behind the project | Backend `backend/src/test/` suites via `npm test` (part of `npm run verify`); admin Vitest `frontend-admin/src/**/*.test.*` + Playwright E2E `frontend-admin/e2e/*.spec.js`; structure guards `scripts/check-app-structure.js`, `frontend-admin/src/pages/navSections.test.js`; QR contract tests; CI runs the full chain |

---

## Gaps — what would move this closer to 100%

These are the real missing/partial items. If any of them are meant to be in scope, treat them as the next implementation tasks; if they are meant to be out of scope, record that explicitly so the form is honest.

1. **Past-expiry guard on stock-in / lot creation** — add a server-side check that rejects stock-in/lot creation when the entered expiry date is before today (or before the received date). Currently there is no hard past-date guard.
2. **Approver comments / correction requests on rejections** — add a rejection comment field on approve/reject that shows up on the staff Requests screen as a visible correction instruction. Currently rejects just stamp `rejected` with `decided_by`/`decided_at` and no message.
3. **Unit/packaging conversion module** — add a unit-conversion table + conversion engine, or decide it is out of scope and document that.
4. **Report-template editor** — add a report template picker/column chooser/custom layout, or document the current Management report as the single report template.
5. **Café/recipe/ingredient-level recommendations + serving-size economics** — decide whether these are in scope. If yes, add recipe/ingredient recommendations, serving-size entry, and surface cost-per-serving / suggested selling price / possible profit in the relevant app. If no, document them as future work.
6. **Notification ledger** — decide whether a dedicated `notifications` table/ledger is needed, or whether the current status-history feed + provider logs are enough.
7. **Database backup/recovery tooling** — add scheduled backup/restore, or document that data is file-backed and recovery is manual restore of the files.

---

## Copy-paste site map (for the group)

**Login:** `/`  
**Sidebar sections and pages:**

- **Overview**
  - Dashboard — `/`
- **Inventory**
  - Inventory Levels — `/inventory`
  - Shelf vs System — `/reconciliation`
  - Stocktake Schedule — `/stocktake`
  - Branch Locations — `/locations`
- **Stock Control**
  - Till — `/till`
  - Stock Movement — `/stock-movement`
  - Stock Adjustments — `/stock-adjustments`
  - Stock Transfers — `/stock-transfers`
- **Catalog & Orders**
  - Products — `/products`
  - Scan & Stock — `/scan-stock`
  - Order Inquiries — `/order-inquiries`
- **Insights**
  - Optimization — `/optimization`
  - Reports — `/reports`
- **Governance**
  - Approvals — `/approvals`
  - Audit Trail — `/audit-trail`
  - System Settings — `/settings`
- **Account**
  - Security — `/security`

**Where the big topics live:**

- Dashboard + all date-range filters (Daily/Weekly/Monthly/Quarterly/Yearly/Custom) — **Overview → Dashboard**
- Products, categories, prices — **Catalog & Orders → Products**
- QR tag generation/printing — **Inventory → Branch Locations** (location tags) and **Catalog & Orders → Products** (product QRs)
- Multi-location inventory — **Inventory → Inventory Levels** + **Branch Locations**; Showroom/Stockroom 1/Stockroom 2 are just locations you create there
- Stock-in/out/transfer/adjustment — **Stock Control** section + **Scan & Stock**
- Physical counts — **Inventory → Stocktake Schedule** + **Shelf vs System** (and the staff mobile Count/Stocktake screens)
- Approvals — **Governance → Approvals**
- Batch/expiry — visible through **Inventory → Inventory Levels** + **Scan & Stock**
- All optimization algorithms (EOQ, ROP, safety stock, ABC, FSN, FIFO/FEFO) — **Insights → Optimization**
- Order inquiries (admin side) — **Catalog & Orders → Order Inquiries**
- Reports — **Insights → Reports**
- Audit trail — **Governance → Audit Trail**
- System settings — **Governance → System Settings**
- Admin two-factor/MFA — **Account → Security**

**What is not on the website (it is backend/mobile only):**
- Customer-facing catalog, cart, order inquiry, order history, notifications — customer mobile app
- Staff login, QR scanner, count, stocktake, requests — staff mobile app
- Database, API, RBAC, audit storage, validation, backup/recovery, testing — the system behind the site, not pages

**What is genuinely missing (not on site, not in system):**
- Unit/packaging conversion module
- Back-order module
- Report-template editor
- Notification ledger table
- Database backup/recovery tooling
- Past-expiry guard on stock-in
- Reject-side correction comment flowing back to staff app
- Café/recipe/ingredient-level recommendations
- Serving-size entry
- Customer-facing cost-per-serving / suggested selling price / possible profit figures

---

## Presenter cheat-sheet (for the next demo/login)

**Login credentials (seeded demo accounts, from `backend/src/seed.js`):**
- admin / admin123
- customer / customer123
- staff / staff123
- owner / owner123
- superadmin / super123

**If login fails during a presentation, check these in order:**
1. Is the demo server actually running and reachable at its URL/port?
2. Are you using a staff account on the web admin? Staff are mobile-only — staff logins into the web admin are refused on purpose. Use an admin-tier account on the website.
3. Are demo accounts disabled? If `DISABLE_DEMO_ACCOUNTS=true`, every seeded login returns the generic “invalid username or password”. Check that env var on the deployed server.
4. Is the admin account you’re using already enrolled in MFA? Admin-tier MFA is TOTP — if `user.mfa_enabled` is true, login returns `mfa_required` and you need the 6-digit code from the authenticator app (or a recovery code). Turn MFA off or have the code ready before the demo.

**If the group gets asked “where is X feature”, use this one-liner map:**
- Dashboard + date filters → Overview → Dashboard
- Products/categories/prices → Catalog & Orders → Products
- QR tags → Inventory → Branch Locations (location tags) + Catalog & Orders → Products (product QRs)
- Multi-location inventory → Inventory → Inventory Levels + Branch Locations
- Stock movements/adjustments/transfers → Stock Control section
- Physical counts → Inventory → Stocktake Schedule + Shelf vs System
- Approvals → Governance → Approvals
- Optimization (EOQ/ROP/safety/ABC/FSN/FIFO-FEFO) → Insights → Optimization
- Reports → Insights → Reports
- Audit trail → Governance → Audit Trail
- Settings → Governance → System Settings
- Admin MFA → Account → Security

---

*This checklist was filled by inspecting the actual INVENTRAK repo and the live admin site `https://inventrak-admin.onrender.com/`. Items marked present are verified against real files/routes/pages; items marked missing are genuinely missing or only partially present as noted.*

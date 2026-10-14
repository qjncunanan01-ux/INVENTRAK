# INVENTRAK Capstone Checklist — Presentable Copy for the Group

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

**How to use this copy:**  
Check the items that are done. Leave the blanks for the ones that are not in the system, or mark them “out of scope” if that is the group’s decision. The “where to find it” column tells you exactly where each item lives on the live admin site.

**Live site:** https://inventrak-admin.onrender.com/

---

## Legend

- [ ] not yet checked / not in the system
- [x] present and working
- [ ] out of scope (if the group decides it is)

---

## Web Administration

| # | Feature | Status | Where to find it on the live site |
|---|---------|--------|-----------------------------------|
| 1 | Login | [ ] | Top-level page before sign in: `/` |
| 2 | Authentication and User Access Module | [ ] | Login page + role-based sidebar |
| 3 | Business Owner / Super Admin Account | [ ] | These are roles, not a separate page |
| 4 | Admin Account and Permission Management | [ ] | Visible through who can access which section; admin user/role management is in the backend and through admin-only pages |
| 5 | Dashboard and Analytics Module | [ ] | Overview → Dashboard |
| 6 | Daily filter | [ ] | Dashboard range control → Day |
| 7 | Weekly filter | [ ] | Dashboard range control → Week |
| 8 | Monthly filter | [ ] | Dashboard range control → Month |
| 9 | Quarterly filter | [ ] | Dashboard range control → Quarter |
| 10 | Yearly filter | [ ] | Dashboard range control → Year |
| 11 | Custom date-range filter | [ ] | Dashboard range control → custom from/to |
| 12 | Product Management Module | [ ] | Catalog & Orders → Products |
| 12a | Restrictions and validations (zero values, etc.) | [ ] | Product create/edit form on Products page |
| 13 | Category and Price Management | [ ] | Still inside Catalog & Orders → Products (no separate Category Management page) |
| 14 | Unit and Packaging Conversion Management | [ ] | Not in the system |
| 15 | QR-Code Generation and Label Management | [ ] | Location tags: Inventory → Branch Locations; product QRs: Catalog & Orders → Products |
| 16 | Multi-Location Inventory Module | [ ] | Inventory → Inventory Levels + Branch Locations |
| 16a | Showroom inventory | [ ] | Create a location named “Showroom” in Branch Locations, then view it in Inventory Levels |
| 16b | Stockroom 1 inventory | [ ] | Same idea — location named “Stockroom 1” |
| 16c | Stockroom 2 inventory | [ ] | Same idea — location named “Stockroom 2” |
| 17 | Stock-In Management | [ ] | Catalog & Orders → Scan & Stock + Stock Control → Stock Movement |
| 17a | Do not allow previous date in expiry date | [ ] | Not enforced yet |
| 18 | Stock-Out Management | [ ] | Stock Control → Stock Movement + sale path |
| 19 | Stock Transfer Management | [ ] | Stock Control → Stock Transfers |
| 20 | Inventory Adjustment | [ ] | Stock Control → Stock Adjustments |
| 21 | Physical-Count Record Management | [ ] | Inventory → Stocktake Schedule + Inventory → Shelf vs System |
| 22 | Inventory Submission and Approval Module | [ ] | Governance → Approvals |
| 23 | Batch and Expiration Monitoring | [ ] | Visible through Inventory → Inventory Levels and Catalog & Orders → Scan & Stock |
| 24 | EOQ Calculation | [ ] | Insights → Optimization |
| 25 | Reorder Point Calculation | [ ] | Insights → Optimization |
| 26 | Safety Stock Calculation | [ ] | Insights → Optimization |
| 27 | ABC Classification | [ ] | Insights → Optimization |
| 28 | FSN Classification | [ ] | Insights → Optimization |
| 29 | FIFO/FEFO Batch Selection | [ ] | Lot-picking behavior in stock-out/sale/transfer paths; visible indirectly in Stock Control → Stock Movement and Catalog & Orders → Scan & Stock |
| 30 | Order Inquiry Management | [ ] | Catalog & Orders → Order Inquiries |
| 31 | Back-Order Management | [ ] | Not in the system |
| 32 | Inventory Reports | [ ] | Insights → Reports |
| 33 | Order and Sales Reports | [ ] | Insights → Reports (and backend sales endpoints) |
| 34 | Notifications | [ ] | Not a dedicated admin page; setup/send is in the backend; customer notification feed is in the customer mobile app |
| 35 | Audit Trail | [ ] | Governance → Audit Trail |
| 36 | System Settings and Security | [ ] | Governance → System Settings + Account → Security |
| 36a | Two-factor / 2FA for admin accounts | [ ] | Account → Security |

---

## QR Inventory Mobile Application (staff app)

| # | Feature | Status | Where to find it |
|---|---------|--------|------------------|
| 37 | Inventory Staff Login | [ ] | Staff mobile app login screen |
| 38 | Role and Access Restriction | [ ] | Staff app is staff-only; web admin refuses staff logins |
| 39 | QR-Code Scanner | [ ] | Staff mobile QR scan tab; web mirror: Catalog & Orders → Scan & Stock |
| 40 | QR Product Identification | [ ] | Same QR scan flow |
| 41 | Product and Assigned-Location Display | [ ] | Staff mobile scan/count flows; web mirror: Inventory Levels + Scan & Stock |
| 42 | Physical Inventory Checking | [ ] | Staff mobile Count tab + Stocktake tab; web mirror: Inventory → Stocktake Schedule + Shelf vs System |
| 43 | Quantity Entry | [ ] | Staff mobile count card |
| 44 | Weight, Volume, Count, and Packaging Unit Selection | [ ] | Product unit field; count card uses the product’s unit |
| 45 | Unit Conversion | [ ] | Not in the system |
| 46 | Batch and Expiration Entry | [ ] | Staff mobile scan flow; web mirror: Catalog & Orders → Scan & Stock |
| 47 | Stock-In Submission | [ ] | Staff mobile scan/count submission; lands in approval queue |
| 48 | Stock-Out Submission | [ ] | Staff mobile submission; stock-out path |
| 49 | Stock Transfer Submission | [ ] | Staff mobile submission; web mirror: Stock Control → Stock Transfers |
| 50 | Inventory Adjustment Submission | [ ] | Staff mobile submission; web mirror: Stock Control → Stock Adjustments |
| 51 | Physical-Count Submission | [ ] | Staff mobile count/stocktake submission; web mirror: Inventory → Stocktake Schedule + Shelf vs System |
| 52 | Submission Confirmation | [ ] | Staff mobile Requests tab |
| 53 | Submission Status | [ ] | Staff mobile Requests tab; web mirror: Governance → Approvals |
| 54 | Personal Submission History | [ ] | Staff mobile Requests tab (Mine view) |
| 55 | Approver Comments and Correction Requests | [ ] | Not in the system the way the checklist means it |

---

## Ordering and Inquiry Mobile Application (customer app)

| # | Feature | Status | Where to find it |
|---|---------|--------|------------------|
| 56 | Customer Registration | [ ] | Customer mobile app signup |
| 57 | Customer Login and Profile | [ ] | Customer mobile app login + account screen |
| 58 | Product Catalog | [ ] | Customer mobile app home/catalog |
| 59 | Product Search and Filtering | [ ] | Customer mobile app search screen |
| 60 | Product Details | [ ] | Customer mobile app product screen |
| 61 | Customer-Facing Price and Availability | [ ] | Customer mobile app product detail + stock availability screen |
| 62 | Order Inquiry Creation | [ ] | Customer mobile app order inquiry screen |
| 63 | Product and Quantity Selection | [ ] | Customer mobile app cart |
| 64 | Order Inquiry Submission | [ ] | Customer mobile app order inquiry submit |
| 65 | Order Inquiry Status | [ ] | Customer mobile app order history/notifications |
| 66 | Back-Order Information | [ ] | Not in the system |
| 67 | Rule-Based Supply Recommendation | [ ] | Customer mobile app recommendation screen |
| 68 | Café Product or Beverage Selection | [ ] | Not a dedicated module; café/beverage items can exist in the catalog |
| 69 | Ingredient and Supply Recommendations | [ ] | Not in the system as ingredient-level recipe recommendations |
| 70 | Serving-Quantity Entry | [ ] | Not in the system as serving-size entry |
| 71 | Estimated Total Cost | [ ] | Customer cart subtotal + inquiry estimated cost at submission |
| 72 | Cost-per-Serving Calculation | [ ] | Not surfaced to the customer app |
| 73 | Suggested Selling Price | [ ] | Not surfaced to the customer app |
| 74 | Possible-Profit Calculation | [ ] | Not surfaced to the customer app |
| 75 | Customer Notifications | [ ] | Customer mobile app notification screen |
| 76 | Inquiry and Order History | [ ] | Customer mobile app order history |

---

## Shared Backend and Database

| # | Feature | Status | Where to find it |
|---|---------|--------|------------------|
| 77 | Centralized INVENTRAK Database | [ ] | Not a webpage; it is the backend database |
| 78 | Web and Mobile API Integration | [ ] | Not a webpage; both apps talk to the same backend API |
| 79 | Role-Based Access Control | [ ] | Visible as the sidebar role gating + login behavior |
| 80 | Product and QR-Code Records | [ ] | Catalog & Orders → Products + QR tag generation |
| 81 | Unit-Conversion Records | [ ] | Not in the system |
| 82 | Multi-Location Inventory Records | [ ] | Inventory → Inventory Levels + Branch Locations |
| 83 | Batch and Expiration Records | [ ] | Visible through Inventory Levels + Scan & Stock |
| 84 | Inventory Submission and Approval Records | [ ] | Governance → Approvals + Stock Adjustments + Stock Transfers |
| 85 | Customer and Order-Inquiry Records | [ ] | Admin side: Catalog & Orders → Order Inquiries; customer side: customer mobile app |
| 86 | Recommendation and Costing Records | [ ] | Insights → Optimization + backend costing snapshot on order inquiries |
| 87 | Notification Records | [ ] | Delivery exists; no dedicated notification ledger page |
| 88 | Audit and Activity Logs | [ ] | Governance → Audit Trail |
| 89 | Data Validation | [ ] | Not a page; it is the input validation behind the forms and endpoints |
| 90 | Database Backup and Recovery | [ ] | Not in the system as automated tooling |

---

## Functional and Integration Testing

| # | Feature | Status | Where to find it |
|---|---------|--------|------------------|
| 91 | Functional and Integration Testing | [ ] | Not a webpage; it is the test suites behind the project |

---

## Website map (for the group)

**Login:** `/`

**Sidebar sections and pages:**

- Overview
  - Dashboard — `/`
- Inventory
  - Inventory Levels — `/inventory`
  - Shelf vs System — `/reconciliation`
  - Stocktake Schedule — `/stocktake`
  - Branch Locations — `/locations`
- Stock Control
  - Till — `/till`
  - Stock Movement — `/stock-movement`
  - Stock Adjustments — `/stock-adjustments`
  - Stock Transfers — `/stock-transfers`
- Catalog & Orders
  - Products — `/products`
  - Scan & Stock — `/scan-stock`
  - Order Inquiries — `/order-inquiries`
- Insights
  - Optimization — `/optimization`
  - Reports — `/reports`
- Governance
  - Approvals — `/approvals`
  - Audit Trail — `/audit-trail`
  - System Settings — `/settings`
- Account
  - Security — `/security`

**Where the big topics live:**

- Dashboard + all date filters → Overview → Dashboard
- Products, categories, prices → Catalog & Orders → Products
- QR tags → Inventory → Branch Locations (location tags) + Catalog & Orders → Products (product QRs)
- Multi-location inventory → Inventory → Inventory Levels + Branch Locations
- Stock movements/adjustments/transfers → Stock Control section + Scan & Stock
- Physical counts → Inventory → Stocktake Schedule + Shelf vs System
- Approvals → Governance → Approvals
- Optimization (EOQ, ROP, safety stock, ABC, FSN, FIFO/FEFO) → Insights → Optimization
- Reports → Insights → Reports
- Audit trail → Governance → Audit Trail
- Settings → Governance → System Settings
- Admin two-factor/MFA → Account → Security

**What is not on the website (backend/mobile only):**
- Customer catalog, cart, order inquiry, order history, notifications — customer mobile app
- Staff login, QR scanner, count, stocktake, requests — staff mobile app
- Database, API, RBAC, audit storage, validation, backup/recovery, testing — the system behind the site, not pages

---

## Items the group still has to decide about

These are the real missing/partial items. For each one, decide: in scope → add it; out of scope → mark it out of scope so the form is honest.

1. Past-expiry guard on stock-in / lot creation — should the system reject an expiry date that is before today?
2. Approver comments / correction requests on rejections — should a reject show a correction message to the staff member?
3. Unit/packaging conversion module — is it in scope, or out of scope?
4. Report-template editor — is the current Management report enough, or do you want a template picker/column chooser?
5. Café/recipe/ingredient-level recommendations + serving-size economics — in scope or out of scope?
6. Notification ledger — do you need a dedicated notifications table, or is the status-history feed + provider logs enough?
7. Database backup/recovery tooling — do you want scheduled backup/restore, or is manual file restore enough?

---

## Presenter cheat-sheet (for the next demo)

**Login credentials (seeded demo accounts):**
- admin / admin123
- customer / customer123
- staff / staff123
- owner / owner123
- superadmin / super123

**If login fails during a presentation, check these in order:**
1. Is the demo server actually running and reachable at its URL/port?
2. Are you using a staff account on the web admin? Staff are mobile-only — staff logins into the web admin are refused on purpose. Use an admin-tier account on the website.
3. Are demo accounts disabled? If demo accounts are disabled, every seeded login returns the generic “invalid username or password”.
4. Is the admin account you’re using already enrolled in MFA? Admin MFA is TOTP — if MFA is enabled, login asks for the 6-digit code from the authenticator app (or a recovery code). Turn MFA off or have the code ready before the demo.

**If you get asked “where is X feature”, use this one-liner map:**
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

*This copy is based on the live admin site https://inventrak-admin.onrender.com/ and the INVENTRAK repo. Items are left as blanks so the group can check them during the presentation or decide they are out of scope.*

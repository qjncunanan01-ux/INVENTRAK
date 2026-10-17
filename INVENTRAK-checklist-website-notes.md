# INVENTRAK Checklist — What Was NOT on the Website (and Beyond)

**Live site reviewed:** https://inventrak-admin.onrender.com/  
**Source of truth for “on the website”:** the admin dashboard route/sidebar map in the repo (`frontend-admin/src/App.jsx` + `frontend-admin/src/pages/layout/AdminLayout.jsx`).

This note is a companion to the filled checklist. It only lists the items that were **not on the website**, in the same order as the original checklist, plus the “go beyond” notes for each.

---

## Web Administration — not on the website

- Unit and Packaging Conversion Management  
  Not on the website. No conversion table, no conversion engine. Only a product `unit` text field exists.
  - Beyond: if this is in scope, it needs a unit/packaging conversion table + conversion engine. If it is out of scope, mark it out of scope and say so on the form.

- QR-Code Generation and Label Management — label-management/template part  
  The website has QR generation and tag printing, but the label-management/template part is **not on the website**.
  - Beyond: a label-template editor would let you choose label size, layout, fields, and reprint strategy. Without it, labels are generated/printed but not managed as templates.

- Stock-In Management — “do not allow previous date in expiry date”  
  This rule is **not enforced on the website** (and not enforced in the stock-in/lot-creation path found in the repo). Lots accept an expiry date without a hard past-date check.
  - Beyond: the fix is a server-side guard that rejects stock-in/lot creation when the entered expiry date is before today (or before the received date). The website form would then show the rule naturally.

- Stock-Out Management — “why stock out? whats the need?”  
  This is **not a website feature**. It is a scope-rationale question, not a UI item.
  - Beyond: if this is meant as a real requirement, the answer is business rationale, not a screen. If it is meant as “the system should explain stock-out,” that is not present.

- Back-Order Management  
  Not on the website. No dedicated back-order concept/status/screen.
  - Beyond: if back-orders are in scope, the system needs a back-order status and a back-order list/workflow. Currently the closest thing is the order inquiry status chain.

- Inventory Reports — “add template”  
  The website has a printable Management report (Insights → Reports), but the “add template” part is **not on the website**.
  - Beyond: “add template” means a report template picker/column chooser/custom layout. Without it, there is one fixed report, not a template system.

- Order and Sales Reports — “add template”  
  Same as above: the report exists, but the “add template” part is **not on the website**.
  - Beyond: same as above — a template system or at least a documented “this is the report template” note.

- Notifications — dedicated admin notifications page  
  Not on the website. There is no dedicated admin notifications page.
  - Beyond: notifications are sent/logged in the backend (email/SMS providers), and the customer-facing notification feed is in the customer mobile app. An admin notifications view would show sent/delivered/failed notification records.

- Approver Comments and Correction Requests  
  Not on the website the way the checklist means it. Approve/reject exists, and the submitter’s own `reason` is shown, but a reject comment / correction instruction does **not** flow back to the staff app as a visible correction request.
  - Beyond: the fix is a rejection comment field on approve/reject that shows up on the staff Requests screen as a correction instruction.

---

## QR Inventory Mobile Application — not on the website

These are mobile-only items. They are **not on the website**, but that does not always mean “missing from the system.” This list separates “not on the website” from “missing from the whole system.”

- Inventory Staff Login — not on the website. This is the staff mobile app. Beyond: none; this is intentional.
- Role and Access Restriction — not on the website. This is enforced in the apps/backend. Beyond: none; this is intentional.
- QR-Code Scanner — not on the website. Website mirror is Catalog & Orders → Scan & Stock. Beyond: if the form means a web scanner, that is missing; if it means the feature exists, it does.
- QR Product Identification — not on the website. Website mirror is Catalog & Orders → Scan & Stock. Beyond: same as above.
- Product and Assigned-Location Display — not on the website. Website mirror is Inventory Levels + Scan & Stock. Beyond: same as above.
- Physical Inventory Checking — not on the website. Website mirror is Inventory → Stocktake Schedule + Shelf vs System. Beyond: the physical-count action itself is more of a mobile/staff flow.
- Quantity Entry — not on the website. Website mirror is the scan/count flows. Beyond: same as above.
- Weight, Volume, Count, and Packaging Unit Selection — not on the website as a dedicated page. Unit is a product field shown in Catalog & Orders → Products. Beyond: if this means a full unit-selection UI on the web, that is missing; if it means the product carries a unit, that exists.
- Unit Conversion — **not on the website and not in the system** as a conversion module.
- Batch and Expiration Entry — not on the website as a dedicated page. Website mirror is Catalog & Orders → Scan & Stock. Beyond: same as above.
- Stock-In Submission — not on the website as a dedicated page. Website mirror is Catalog & Orders → Scan & Stock → approval queue. Beyond: same as above.
- Stock-Out Submission — not on the website as a dedicated page. Website mirror is Stock Control → Stock Movement / sale path. Beyond: same as above.
- Stock Transfer Submission — not on the website as a dedicated page. Website mirror is Stock Control → Stock Transfers. Beyond: same as above.
- Inventory Adjustment Submission — not on the website as a dedicated page. Website mirror is Stock Control → Stock Adjustments. Beyond: same as above.
- Physical-Count Submission — not on the website as a dedicated page. Website mirror is Inventory → Stocktake Schedule + Shelf vs System. Beyond: same as above.
- Submission Confirmation — not on the website as a dedicated page. Website mirror is the approval queue + staff mobile Requests tab. Beyond: same as above.
- Submission Status — not on the website as a dedicated page. Website mirror is Governance → Approvals + staff mobile Requests tab. Beyond: same as above.
- Personal Submission History — not on the website. This is the staff mobile Requests tab (Mine view). Beyond: a web view of “my submissions” would be the website equivalent, and it is not there.
- Approver Comments and Correction Requests — **not on the website and not in the system** the way the checklist means it.
- Mobile Notifications — not on the website as a dedicated admin notifications page. The customer-facing notification feed is in the customer mobile app. Beyond: an admin notification records view is missing.

---

## Ordering and Inquiry Mobile Application — not on the website

These are customer-mobile-only items. They are **not on the website**. This list notes which are simply mobile-only and which are also missing from the whole system.

- Customer Registration — not on the website. Customer mobile app. Beyond: none; this is intentional. Customer registration exists in the system.
- Customer Login and Profile — not on the website. Customer mobile app. Beyond: none; this is intentional. Customer login/profile exists in the system.
- Product Catalog — not on the website. Customer mobile app. Beyond: none; this is intentional. The catalog exists in the system (admin side is Catalog & Orders → Products).
- Product Search and Filtering — not on the website. Customer mobile app. Beyond: none; this is intentional. Search/filter exists in the system.
- Product Details — not on the website. Customer mobile app. Beyond: none; this is intentional. Product details exist in the system.
- Customer-Facing Price and Availability — not on the website. Customer mobile app. Beyond: none; this is intentional. Price/availability exist in the system.
- Order Inquiry Creation — not on the website. Customer mobile app. Beyond: none; this is intentional. Order inquiry creation exists in the system.
- Product and Quantity Selection — not on the website. Customer mobile app cart. Beyond: none; this is intentional. Cart/quantity selection exists in the system.
- Order Inquiry Submission — not on the website. Customer mobile app. Beyond: none; this is intentional. Order inquiry submission exists in the system.
- Order Inquiry Status — not on the website. Customer mobile app. Beyond: none; this is intentional. Order status exists in the system.
- Back-Order Information — **not on the website and not in the system** as a dedicated back-order feature.
- Rule-Based Supply Recommendation — not on the website. Customer mobile app. Beyond: the recommendation exists in the system as an ABC top-product bundle. If the form means recipe/ingredient recommendations, that is missing.
- Café Product or Beverage Selection — **not on the website as a dedicated module**. Café/beverage items can exist in the catalog, but there is no dedicated café/beverage menu or “menu item” module.
- Ingredient and Supply Recommendations — **not on the website and not in the system** as ingredient-level recipe recommendations.
- Serving-Quantity Entry — **not on the website and not in the system** as serving-size entry with serving conversion.
- Estimated Total Cost — not on the website. Customer mobile app/cart. Beyond: the system does have an estimated total at submission, but not as a customer-facing “cost” page on the website.
- Cost-per-Serving Calculation — **not on the website and not surfaced to the customer app**. Costing math exists on the backend, but not as a customer-facing figure.
- Suggested Selling Price — **not on the website and not surfaced to the customer app**. Admin-side pricing tooling exists, but the customer app does not show suggested selling price.
- Possible-Profit Calculation — **not on the website and not surfaced to the customer app**. Admin-side costing/margin exists, but the customer app does not show profit.
- Customer Notifications — not on the website as a dedicated admin notifications page. Customer mobile app. Beyond: delivery exists in the system; a dedicated notification ledger is missing.
- Inquiry and Order History — not on the website. Customer mobile app. Beyond: none; this is intentional. Order history exists in the system.

---

## Shared Backend and Database — not on the website

These are **not on the website** because they are the backend/database, not website pages. This list notes which are simply backend-only and which are also missing as features.

- Centralized INVENTRAK Database — not on the website. It is the backend database. Beyond: none; this is intentional.
- Web and Mobile API Integration — not on the website. It is the backend/api. Beyond: none; this is intentional.
- Role-Based Access Control — not on the website. It is the backend role system. Beyond: none; this is intentional.
- Product and QR-Code Records — not on the website. It is the backend database. Beyond: none; this is intentional.
- Unit-Conversion Records — **not on the website and not in the system** as a conversion catalog.
- Multi-Location Inventory Records — not on the website. It is the backend database. Beyond: none; this is intentional.
- Batch and Expiration Records — not on the website. It is the backend database. Beyond: none; this is intentional.
- Inventory Submission and Approval Records — not on the website. It is the backend/database. Beyond: none; this is intentional.
- Customer and Order-Inquiry Records — not on the website. It is the backend/database. Beyond: none; this is intentional.
- Recommendation and Costing Records — not on the website. It is the backend/database + optimization/costing endpoints. Beyond: none; this is intentional. Costing records exist in the system.
- Notification Records — **not on the website and not in the system** as a dedicated notification ledger table.
- Audit and Activity Logs — not on the website as a database file. It is the backend audit system + audit endpoint. Beyond: the audit module exists, but a durable audit sink may be needed for deployment persistence.
- Data Validation — not on the website. It is the backend input validation. Beyond: none; this is intentional.
- Database Backup and Recovery — **not on the website and not in the system** as automated backup/recovery tooling.

---

## Functional and Integration Testing — not on the website

- Functional and Integration Testing — **not on the website**. It is the test suites behind the project. Beyond: none; this is intentional. Testing exists in the repo as backend tests, admin tests, E2E tests, and structure guards.

---

## Go-beyond notes (what each missing item would turn into if it were added)

Status column added after the follow-up build — see **Resolutions** below for what each one became.

1. **Unit and Packaging Conversion Management** — add a conversion table (from-unit, to-unit, rate), a conversion engine, and a UI for maintaining it. Or mark it out of scope. → **Built** (table + admin CRUD page + API).
2. **Label management/template part** — add a label template editor: label size, layout, which fields to print, batch reprint, and tag stock management. Or mark it out of scope. → **Still open** (out of scope so far).
3. **Past-expiry guard on stock-in** — add a server-side rule rejecting expiry dates before today/received date, plus a frontend validation hint. Low effort, high demo value. → **Built** (server-side, both backends).
4. **Stock-out rationale** — clarify on the form whether this is a scope explanation or a real “explain stock-out” feature. If the latter, add a stock-out reason/need field. → **Still open** (scope question).
5. **Back-Order Management** — add a back-order status and back-order list/workflow, or mark it out of scope. → **Built** (ledger + admin page + customer-facing status).
6. **Report template** — add a report template picker/column chooser/custom layout, or document the current Management report as the single report template. → **Still open**.
7. **Notifications admin page** — add an admin notifications view showing sent/delivered/failed notification records. → **Built** (ledger + admin page).
8. **Approver comments / correction requests** — add a reject comment field that shows up on the staff Requests screen as a visible correction instruction. → **Built** (end to end, both backends).
9. **Customer-facing items that are mobile-only** — decide whether a web customer portal is in scope. If yes, these become website work; if no, mark them mobile-only and keep them off the website checklist. → **Decided: mobile-only** (see Resolutions).
10. **Costing/recipe/serving economics surfaced to customers** — decide whether cost-per-serving, suggested selling price, and possible profit should be customer-facing. If yes, add the UI; if no, document them as admin-only economics. → **Decided: admin-only**, and now documented as such (see Resolutions).
11. **Notification ledger** — decide whether a dedicated `notifications` table is needed, or whether the status-history feed + provider logs are enough. → **Built** (`notification_records`, written by a recorder hook on every attempt).
12. **Database backup/recovery** — decide whether scheduled backup/restore is in scope, or whether manual file restore is enough for now. → **Built** (driver-aware export/restore + admin page + runbook below).

---

## Resolutions — what the follow-up build did, and why

### 1. Approver comments and correction requests (checklist items 8 / “not in the system”)

**Decision.** A rejection may carry a comment, and that comment has to reach the person who submitted, on the screen they already use, without inventing a new permission.

**How.** Both reject endpoints (`POST /api/stock-adjustments/:id/reject`, `POST /api/stock-transfers/:id/reject`) accept an optional `comment`. When present it is written to `correction_requests` tied to the submission, and the adjustment/transfer LISTINGS project the newest **open** correction onto the row as `correction_comment` / `correction_status`.

**Why a projection instead of a new endpoint.** `/api/correction-requests` is admin-only (it is the approver's own ledger), and the staff app already polls the adjustment listing every 15 s. Attaching the instruction to that listing means:

- no authorization is widened — the submitter sees the note on a row they were already allowed to read;
- no extra request and no new screen — the same poll that flips the badge also carries the instruction;
- resolving the correction (`POST /api/correction-requests/:id/resolve`) clears it from the listing automatically, because only OPEN corrections are projected.

**UI.** Governance → Approvals gained a per-row “Correction note (optional)” field beside Reject, plus an “Open correction requests” panel with a *Mark addressed* action. The staff app’s My Requests screen shows the note in a red “Correction needed” block and counts the rows that need action.

### 2. Back orders and what a customer may see (checklist item 5)

**Built.** `back_orders` (one row per inquiry, `open → fulfilled | cancelled`) with an admin page under Catalog & Orders.

**Authorization (important).** A back order carries the reason a customer’s ORDER fell short, so it is scoped like the inquiry itself: admin tier reads any; everyone else reads only their own inquiries (404 for an unknown inquiry, 403 when it belongs to someone else), and recording one is admin-only. Before this the list was readable by any signed-in caller, which — once the customer app started using it — would have leaked every customer’s shortage reasons to every other customer.

**Customer-facing.** The customer app’s Orders tab maps `/api/back-orders` (already scoped server-side) over the order cards and shows a Back order / Back order fulfilled block with the reason and the requested-by date.

### 3. Unit conversions, notification ledger, expiry guard

- `unit_conversions` + Catalog & Orders → Unit Conversions (linear from→to rates, identity rows refused).
- `notification_records` + Governance → Notifications. Every email/SMS attempt is recorded through a recorder hook on `notify.js`, with an honest status: `sent`, `failed`, or **`logged`** when no provider is configured. It never claims “sent” for a message that only reached stdout.
- Stock-in/lot creation refuses an expiry date before today, on both backends, at the API boundary (the app therefore shows the rule for free).

### 4. Economics are admin-only — the decision, in writing (checklist item 10)

**Decision: cost, cost-per-serving, suggested selling price, margin and possible profit stay admin-only and are NOT surfaced to customers.**

**Why.** Those figures are the business’s own margin maths. Cost-per-serving and suggested price exist to help the operator price a product; showing them to the buyer hands over the unit cost and the markup, which is commercial information the customer has no need for and the shop cannot un-disclose. Nothing in the customer journey changes — the customer sees the PRICE they pay (`estimated_cost`, line prices), which is the only figure that was ever theirs.

**Where it lives.** Costs and the frozen per-inquiry costing snapshot (`costing_records`, `backend/src/insights/costing.js`) are admin-tier: `GET /api/order-inquiries/:id/costing` is scoped to admins or the inquiry’s owner, and the admin console’s costing panel is behind the admin tier. `GET /api/meta` publishes the margin POLICY (`costing.target_margin_percent`) so the console grades against the server’s target rather than a hardcoded 30 — a policy number, not a customer-facing one.

**What “surfacing it to customers” would cost.** It is not a UI-only change: it would require a deliberate product decision that unit cost and margin are public, plus a customer-tier projection of the costing snapshot (today’s snapshot is admin-shaped). Marked here as **out of scope, deliberately** rather than half-done.

### 5. Database backup and recovery (checklist item 12)

**Built.** `GET /api/admin/backup` returns one self-describing JSON snapshot; `POST /api/admin/restore` puts one back. Governance → Backup & Restore drives both (Download snapshot · choose file · inspect the summary · Restore).

**Driver-aware, by design.** A snapshot carries `format` / `version` / `driver` and is restorable only into a backend running the SAME driver:

- `sqlite` (the Express backend) exports every table; a restore runs in ONE transaction with deferred foreign keys, so a snapshot with dangling references is rejected and the live database is left exactly as it was.
- `json` / `supabase` / `firestore` (the npm-free backend) exports the store’s datasets; a restore rewrites them and re-hydrates the in-memory state.

A cross-driver restore is refused with a plain reason rather than half-applied — the row shapes genuinely differ, so it would be corruption, not migration.

**Runbook.**

1. Governance → Backup & Restore → **Download snapshot** (admin tier). Keep the file off the server: backend deploys wipe the container filesystem, so a snapshot stored inside it is not a backup.
2. To recover: open the same page, choose the file, check the summary shows the expected `driver` and table/row counts, then **Restore now**. The button is disabled if the driver does not match this server.
3. The snapshot contains password hashes — that is what makes logins restorable. Treat the file as a secret.
4. Both actions are audited (`backup.exported`, `backup.restored`), so Governance → Audit Trail shows who took or applied a snapshot.

**Limits, stated honestly.** There is no scheduler. Backups happen when an admin takes one — “automated backup” is still out of scope, and this is a manual tool that makes the manual step safe and repeatable. The upload body is capped by `BACKUP_MAX_BODY_BYTES` (64 MB default, env-overridable) on that one route; every other endpoint keeps the 100 KB cap.

### 6. Mobile-only customer surfaces (checklist item 9)

**Decided: the customer experience stays mobile-only.** There is no web customer portal, so catalog browsing, cart, order inquiry, payment and order history are not “missing from the website” — they are the customer app. The measurable consequence is that no customer-tier page was added to the admin console, and the console’s customer/order views remain admin-tier oversight surfaces.

---

This is the same order as your original checklist, with each “not on the website” item called out explicitly, plus the “go beyond” note for each one, and a **Resolutions** section recording what was built, what was decided, and what is still open.

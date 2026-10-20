# Capstone panel revisions — status after the branding pass

Audited against the panel comments and the approved Scope and Limitations.
Every line below was checked in the code, not assumed. "Verified" means a
command was run and its output read; where a check was not run, it says so.

Legend: **DONE** · **PRESENT** (already in the codebase, unchanged by this pass)
· **MISSING** (not implemented) · **BLOCKED** (needs business approval)

---

## A. Branding and UI (Part 2 + 3) — DONE this pass

| Item | Status | Evidence |
|---|---|---|
| Official Sylver logos used | DONE | `frontend-admin/public/sylver-*.png`, `mobile-client/assets/`, `staff-client/assets/`; login page + sidebar + both app login screens |
| INVENTRAK kept as the software name | DONE | Both names labelled separately on the login page and sidebar |
| Company name + tagline | DONE | `company` export in all three `theme.js`; tagline rendered on web login, sidebar, both app logins |
| Green-and-brown palette, centralized | DONE | `brand` token block in each `theme.js`; charts, chips, buttons, tables read tokens |
| No distorted logos | DONE | Rendered with `object-fit: contain` / `resizeMode="contain"`; icon generated at 1024×1024 with the symbol's aspect preserved |
| Readable contrast | DONE | Fill-vs-ink rule documented in `docs/branding.md` §1; lime fills carry `#263326` text, dark fills carry white |

Details, asset provenance and the "why not transparent" note: [branding.md](branding.md).

---

## B. Order lifecycle (Parts 6–13)

| Panel comment | Status | What the code actually does |
|---|---|---|
| "Cart per transaction, not per item" | PRESENT | `POST /api/order-inquiries` stores all lines under one inquiry (`backend/src/routes/catalog-orders/order-inquiries.js`), `normalizeLines` groups them |
| "No restriction on bulk orders?" | PARTIAL | Checkout now caps each product at 10,000 units and 500 lines per inquiry, and explains that larger quantities and product-specific terms require store confirmation. Actual minimums, bulk discounts, and company policy still need Sylver's approval. |
| "No stock yet, can still continue to add in the cart" | DONE | Customer add controls check live availability, checkout sends product IDs and the backend re-checks aggregate stock. Admin fulfillment checks the selected location again. |
| Status vocabulary | PARTIAL | `pending/approved/rejected/fulfilled/delivered` + `cancelled`. Still not the panel's `reviewed/confirmed` wording — renaming existing statuses is a data migration, tracked below |
| "Status > Rejected > Reason needs to specify" | **DONE** | `PUT /api/order-inquiries/{id}` refuses a rejection with no reason (400, names the field), stores `rejection_reason`, and records `by` + `reason` in the timeline. Admin dialog requires the text before Confirm is enabled |
| "Client can't cancel the order" | **DONE** | `POST /api/order-inquiries/{id}/cancel` — owner or admin tier only, pending/approved only (409 otherwise), records reason + timestamp, idempotent, notifies the business. Cancel button appears on the customer's own order cards |
| "Pickup / courier not stated" | **DONE** | `fulfillment_method` (`pickup` default / `courier`, courier requires an address) on submit, stored, shown on the admin row + details and on the customer's order card; the checkout explains what each option means |
| Terms and conditions | PARTIAL | Checkout displays and records acknowledgement of versioned operational terms for ordering, stock, pickup/courier, cancellation, GCash verification, and demo card payment. Store-specific return, refund, fee, and credit terms still need business approval. |
| "Notifications per transaction, not per piece" | DONE | Submission and every order status event are one inquiry-level email/SMS plus one in-app card. Payment reference submission and admin verification also appear as one payment event for that inquiry. |

### Contract + schema changes made for the three DONE items

- **One rule set, two backends.** `backend/src/catalog-orders/inquiry-lifecycle.js`
  holds the assignable statuses, the legal transitions, the mandatory-reason
  rule and the fulfilment validation. The SQLite route and
  `server_npmfree.js` both call it — neither keeps its own copy.
- **New columns on `order_inquiries`** (additive, nullable except the default):
  `fulfillment_method` (default `pickup`), `rejection_reason`, `cancelled_at`,
  `cancellation_reason`. `schema.js` has them for fresh databases; `db.js`
  adds them to existing ones on boot. No destructive change, no backfill — an
  old inquiry legitimately has no reason and reads back as a pickup.
- **Statuses are constrained now.** A decided inquiry (`rejected`, `delivered`,
  `cancelled`) is terminal; `cancelled` is not settable through `PUT` (that is
  how a cancellation without a record would happen).
- **Stock changes on fulfillment.** When an admin marks an inquiry fulfilled,
  the admin selects a location and the backend checks availability, consumes
  FEFO lots, records sale and movement rows, and updates stock in one SQLite
  transaction. The npm-free backend applies the same location and stock rules.
  Pending/approved cancellation releases nothing because stock is not reserved.
- **Clients regenerated** from `backend/openapi.json` (`cancelOrderInquiry` is
  now in all three `api.generated.js`).

Still needs business input: Sylver's actual MOQ, bulk discount, delivery-fee,
refund/return, and credit terms. The app describes its own limits and workflow
without inventing those commercial policies.

---

## C. Inventory, algorithms, roles (Parts 14–23) — PRESENT, not re-verified

Multi-location inventory (Showroom / Stockroom 1 / Stockroom 2), stock-in/out/
transfer/adjustment approval, EOQ/ROP/safety-stock/ABC/FSN/FIFO/FEFO, and the
role tiers (`ADMIN_TIER`, `MANAGEMENT_TIER`) all exist. **This pass did not
re-run the algorithm or stock-sync tests** — the backend was not modified, so
they were not re-executed. They remain covered by `cd backend && npm run verify`.

---

## D. Scope conflicts to raise, not silently implement (Part 18)

- **Card / GCash**: card now has an explicit demo transaction that stores a
  `CARD-DEMO-*` reference and does not collect card details or charge a card.
  GCash customers submit their receipt reference; only an admin can mark it
  paid. PayMongo checkout remains optional when configured. There is no
  automatic GCash webhook, real card capture, refund flow, or debt tracking.
- **Firebase**: the system is not on Firebase Authentication. Auth is
  username/password + JWT (`backend/src/auth-core.js`), and storage is
  SQLite / Supabase / Firestore behind one driver interface. Firestore exists as
  a driver (`store-firestore.js`), not as the primary database. The paper's
  description should match that.

---

## E. Verification performed for this pass

| Check | Command | Result |
|---|---|---|
| Backend full gate | `cd backend && npm run verify` | **786/786 pass** (docs:validate + spec:audit + workflows:check + client:check + slides:check + tests) |
| Lifecycle suite (both backends) | `node --test src/test/order-lifecycle.test.js` | **12/12 pass** |
| Legacy-DB migration | `node --test src/test/migrations-lifecycle.test.js` | **3/3 pass** (pre-lifecycle table upgraded in place, rows preserved) |
| Admin unit tests | `cd frontend-admin && npm test` | **293/293 pass** (incl. the new 6-test rejection/cancellation suite) |
| Admin production build | `npm run build` | built ✓ |
| CI e2e set | `npx playwright test e2e/admin-login.spec.js e2e/order-flow.spec.js` | **27/27 pass** |
| Visual regression | `npx playwright test e2e/visual-regression.spec.js` | **16/16 pass** |
| Customer app bundle | `cd mobile-client && npx expo export --platform android` | exported ✓ |
| Staff app bundle | `cd staff-client && npx expo export --platform android` | exported ✓ |
| App structure | `npm run structure:check` (both apps) | ✓ |

One pre-existing test was repaired rather than worked around:
`scheduled-backup.test.js` asserted that **zero** pushes land after
`stopScheduler()`, but a push already in flight when `stop()` is called still
finishes — deliberately, so a shutdown never discards a snapshot it started.
The assertion now allows that single in-flight write (an interval still ticking
at 25 ms would add several in an 80 ms window), with the reasoning recorded in
the test. It had failed once under a loaded full-suite run and then passed three
times in isolation.

Not run: repo `npm run lint` (pre-existing ESLint v9 config gap, unrelated to
any change here).

## F. Attached-paper follow-up

The follow-up updates titles to show pack size where present, adds guards for
invalid cart items, adds field validation and versioned checkout acknowledgement,
shows submission/payment events in the customer notification feed, and updates
stock plus the sale ledger when an admin fulfills an order. Existing brand assets,
rejection reasons, cancellation, pickup/courier selection, and transaction-level
cart behavior were already present from the preceding pass.

Client generation succeeded with `node scripts/generate-client.js`. The
`npm run client:generate` wrapper could not start because the local npm shim
points to a missing `npm-cli.js`. No backend, admin, or Expo test/build command
was run for this follow-up.

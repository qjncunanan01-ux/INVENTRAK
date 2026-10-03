# Database Spec → Implementation Mapping

Maps the 23-table centralized database specification against what INVENTRAK actually
runs, states why each divergence exists, and lists what is genuinely missing.

Last verified against production on **2026-10-03**.

---

## 1. The verdict in one paragraph

Supabase **is** the live production datastore, and it does serve all three platforms
from one consistent set of records. But it is **not** shaped like the specification.
The spec describes 23 normalized relational tables. Production runs **13 tables, every
one of which has the identical three-column shape**:

```sql
id   INTEGER PRIMARY KEY,
idx  INTEGER NOT NULL DEFAULT 0,
data JSONB NOT NULL DEFAULT '{}'
```

Nine of the 23 entities are fully present. Seven are present but inlined — the data is
real and queryable, it just does not have its own table. Seven are absent.

### Proof of the live state

```
GET /api/health    → {"driver":"supabase","products":205}
GET /api/locations → Showroom, Stockroom 1, Stockroom 2
```

The three inventory locations in the spec are exactly the three in production.

### Why it looks like this

This is not accidental drift, and it is worth understanding before changing anything.

The **npm-free backend** (`server_npmfree.js`, used when Node has no npm packages
available) persists state as JSON files under `backend/data/`. When the Supabase
driver was added, [store-supabase.js](../backend/src/store-supabase.js) mapped those
JSON collections **one-to-one** into tables:

```js
const TABLES = {
  'products.json':          'products',
  'inventory.json':         'inventory',        // ← stock AND locations merged
  'stock_movements.json':   'movements',
  'order_inquiries.json':   'inquiries',
  'stock_adjustments.json': 'stock_adjustments',
  'stock_transfers.json':   'stock_transfers',
  '@users':                 'users',
  '@sales':                 'sales',
  '@alerts':                'alerts',
  '@lots':                  'stock_lots',
  // …
};
```

So the Supabase schema is a **document store mirrored onto Postgres**. That inheritance
explains the shape of almost every divergence below. Notably, SQLite's `stock` and
`locations` tables collapsed into one `inventory` collection because the JSON file
never separated them.

There is also a **second, normalized schema** — [schema.js](../backend/src/schema.js) —
used by the Express/SQLite backend. It has real typed columns and foreign keys, and it
is closer to the spec than the Supabase one. Keeping two schemas in sync across three
storage drivers is why the spec's structure was not adopted wholesale.

---

## 2. The mapping table

| # | Spec table | Status | Where it actually lives |
|---|---|---|---|
| 1 | Users | ✅ Present | `users` — `schema.js` / Supabase `users` |
| 2 | Roles | ⚠️ Inlined | `users.role` TEXT enum |
| 3 | Products | ✅ Present | `products` |
| 4 | Categories | ⚠️ Inlined | `products.category` TEXT; `GET /api/products/categories` |
| 5 | QR Codes | ⚠️ Inlined | `qr-codes.js` — code, not a table |
| 6 | Inventory Locations | ✅ Present | `locations` (SQLite) / `inventory_meta` (Supabase) |
| 7 | Stock Records | ✅ Present | `stock` — `UNIQUE(product_id, location_id)` |
| 8 | Stock Movements | ✅ Present | `stock_movements` |
| 9 | Stock Transfers | ✅ Present | `stock_transfers` — full pending/approve/reject lifecycle |
| 10 | Stock Adjustments | ✅ Present | `stock_adjustments` — full pending/approve/reject lifecycle |
| 11 | Batch Records | ✅ Present | `stock_lots` — FIFO/FEFO ledger |
| 12 | Recipes | ❌ Absent | — |
| 13 | Recipe Requirements | ❌ Absent | — |
| 14 | Recommendation Rules | ❌ Absent | — (see §6 — naming collision) |
| 15 | Order Inquiries | ✅ Present | `order_inquiries` |
| 16 | Order Items | ⚠️ Inlined | `order_inquiries.products` TEXT blob, normalized by `product-lines.js` |
| 17 | Costing Records | ✅ Present | `costing_records` — immutable snapshot per inquiry (`backend/src/costing.js`) |
| 18 | Customer Records | ✅ Present | `customers` + `customer_id` on inquiries and sales (`backend/src/customers.js`) |
| 19 | Customer Purchase History | ⚠️ Partial | `sales_transactions`, keyed on `customer_name` TEXT |
| 20 | Reports | ❌ Absent | Computed live at `GET /api/reports` + CSV export |
| 21 | Notifications | ⚠️ Partial | `inventory_alerts` — stock alerts only, no `user_id` |
| 22 | Approval Logs | ⚠️ Inlined | `status`/`decided_by`/`decided_at` on the request rows |
| 23 | Activity Logs | ⚠️ Dormant | `audit.js` → `audit_log` — **code complete, env vars unset** |

**Totals: 11 present · 7 inlined or partial · 5 absent.**

---

## 3. The inlined ones — why this is a defensible choice

These are not omissions. Each is a deliberate trade. Where the trade is worth defending
out loud, the argument is given.

### QR Codes — no table, and the code is better for it

There is no QR registry. [qr-codes.js](../backend/src/qr-codes.js) parses a deterministic
grammar instead:

```
INVENTRAK:PROD:<id>                 product tag
INVENTRAK:LOC:<id>:<url-encoded>    storage-area tag
```

`GET /api/products/qr/{code}` resolves the identifier to a live product record. The
security properties are stated in that file and hold:

- **The QR authorizes nothing.** It only names a product. Auth, role, product status,
  location, quantity and the approval workflow are all enforced server-side.
- **No quantity, price, cost or personal data is ever encoded**, so a lost tag leaks
  nothing and a reprint never goes stale.

A `qr_codes` table would introduce a synchronization problem the current design simply
does not have: every product rename, deactivate, or SKU change would need the registry
updated, and any drift means a printed tag resolves to the wrong product.

**Gap worth acknowledging:** the spec's `QR Label Status` and `Date Generated` imply
tracking *label printing* — which tags have been printed, which are damaged and need
reprinting. That is real and currently untracked. It is a small addition, and it is the
one part of the QR table worth building.

### Order Items — a value object, deliberately not a table

Line items are stored as a JSON blob in `order_inquiries.products` and normalized on
read by [product-lines.js](../backend/src/product-lines.js) into
`{ id, name, qty, unit_price, original_price, subtotal }`.

Each item has **no independent lifecycle**. An order item cannot exist without its
inquiry, is never queried across inquiries, and is never referenced by any other table.
Making it relational would add a join to every read for no query it enables. Classic
N1-until-proven-otherwise.

**When this would flip:** if you ever need "which products were ordered together" or
per-product demand analytics across orders, it stops being a value object. The ABC and
FSN classifications already aggregate movements, so it has not been needed yet.

### Roles — an enum, not a table

Four roles (`superadmin`, `owner`, `admin`, `staff`, plus `customer`) are a TEXT column
validated in application code and enforced by `staff-roles.test.js` and `roles.test.js`.
There is no admin UI for creating roles, no role metadata, and no per-role permission
matrix. A table would be scaffolding for a level of configurability the product does not
have — see the YAGNI ladder in [agent-skills/yagni-minimal-change.md](agent-skills/yagni-minimal-change.md).

### Categories — derived, not declared

`GET /api/products/categories` returns the distinct `products.category` values. A
category row cannot exist without products, and there is no category lifecycle. Same
argument as Order Items.

### Approval Logs — denormalized onto the request

Approvals live on the rows they approve: `status`, `decided_by`, `decided_at`, `reason`.
This gives a correct audit of *what was decided* without a second table. The gap is
that approval is only tracked for **adjustments and transfers** — a generic
`approval_logs` table keyed on `reference_id` + `transaction_type` would also cover
order-inquiry approvals.

### Activity Logs — code complete, not switched on

[audit.js](../backend/src/audit.js) mirrors every security-relevant event to a remote
`audit_log` table and re-seeds from it on boot. The table DDL is in
[supabase-audit-migration.sql](../backend/src/supabase-audit-migration.sql). The sink
needs **no env vars** — it derives itself from `SUPABASE_URL` + `SUPABASE_KEY`, which
`inventrak-api` already has for the storage driver. Running that one SQL file is the
entire remaining setup. Verify with `GET /api/meta` → `.audit.enabled`.

---

## 4. The absent ones — what is genuinely missing

| Spec table | Consequence of not having it |
|---|---|
| **Reports** | Reports are generated on demand and never persisted. There is no record of *who generated which report, when*. |
| **Recipes** | No café drink recipe entity. |
| **Recipe Requirements** | No ingredient explosion — cannot compute true cost-per-cup from a recipe. |
| **Recommendation Rules** | No rule-based recommendation engine. |

### Partial ones

**Customer Purchase History** — `sales_transactions` carries `customer_name` as free
text and has no `customer_id` or `order_inquiry_id`. Purchase history therefore cannot
be joined per customer reliably; name collisions merge unrelated customers.

**Notifications** — `inventory_alerts` covers low-stock and best-before alerts only. It
has no `user_id`. Order-status notifications exist as a feature (email/SMS via
`notify.js`, plus an in-app feed) but are derived from the order's `status_history`
rather than stored as notification rows.

---

## 5. Build plan, ordered smallest-first

Ordered by value-per-unit-of-risk. Phases 1–2 are the ones worth doing.

### Phase 1 — days, not weeks

**1a. Activate the durable audit trail.** *Enables Activity Logs (table 23).*
Run `supabase-audit-migration.sql` in the Supabase SQL Editor — that is the whole
setup, no env vars. The sink derives itself from `SUPABASE_URL`/`SUPABASE_KEY`, so
the service_role key is never pasted into a second place. The code is already
written and tested (`meta-and-audit.test.js`); this is one SQL run plus a redeploy.
**Highest value per effort in the entire project** — it is the difference between a
demo and a system.

**1b. QR label registry.** *Enables the missing half of table 5.*
A `qr_codes` table holding `(product_id, code, label_status, generated_at)` — printing
state only, not product data. Resolves the gap without reintroducing the sync problem
described in §3.

### Phase 2 — about a week

**2a. Customer Records.** *DONE — enables table 18; unblocks the rest.*
A `customers` table distinct from `users` (a customer does not need an account —
guest checkout is first-class), with `customer_id` FK on `order_inquiries` and
`sales_transactions`. Identity is resolved by a shared
user_id → email → name rule (`backend/src/customers.js`), and an existing row is
enriched rather than duplicated. `npm run customers:backfill` links the
pre-existing sales (612 rows → 3 customers in the demo dataset; dry run by
default, idempotent). It targets Supabase when `SUPABASE_URL` + `SUPABASE_KEY`
are set — the seeded sales live there, not in SQLite — and PATCHes rows one at a
time rather than flushing a table, so a crash mid-run cannot empty one. Admin-only
`GET /api/customers` and
`GET /api/customers/:id` answer "this customer's history", which the old schema
could not.

**2b. Order Items as real rows.** *Promotes table 16 from value object to table.*
Only worth doing *after* 2a, and only if per-product cross-order analytics is actually
wanted. Requires an OpenAPI change and `npm run client:generate`.

**2c. Costing Records.** *DONE — enables table 17.*
`costing_records` snapshots `(total_cost, total_revenue, target_quantity,
cost_per_cup, suggested_selling_price, estimated_profit, cost_basis, …)` at
submission, `UNIQUE(inquiry_id)`, and never rewrites it. A new nullable
`products.cost` (COGS) supplies the cost basis that did not previously exist
anywhere; it is stripped from every public product read and readable only through
`GET /api/products/costs` (admin tier). Historical profit no longer drifts with
the catalog.

**2d. Reports metadata.** *Enables table 20.*
One row per generated report: `(report_type, date_range, generated_by, file_format,
generated_at)`. Cheap, and it satisfies "the Reports Table stores generated report
information" literally.

### Phase 3 — the largest feature, and only if it's wanted

**3a. Recipes + Recipe Requirements + Recommendation Rules.** *Enables tables 12, 13, 14.*
This is a genuinely new capability, not a refactor: café drink definitions, ingredient
explosion per serving, and a rule engine that maps a recipe plus a condition to
recommendations. See §6 before starting — the module name is already taken.

---

## 6. Decide before building: the "Recommendations" collision

The spec's **Recommendation Rules** table and INVENTRAK's existing **Recommendations**
feature are different things wearing the same name.

| | Spec's recommendation rules | INVENTRAK's Recommendations |
|---|---|---|
| Basis | A rule: recipe + product category + condition | ABC classification value |
| Source | `recommendation_rules` table | `/api/optimization` — EOQ, ROP, safety stock, FSN |
| Screen | not built | `mobile-client/src/screens/RecommendationScreen.js` |
| Purpose | "Given this drink recipe and this condition, recommend these supplies" | "These are your highest-value products" |

Anyone who reads the spec and then demos the app will notice. It needs an explicit
decision, and it is a product decision, not a technical one:

1. **Keep ABC recommendations, document the deviation.** Cheapest. Rename the screen to
   "Optimization Insights" or similar so the two meanings stop competing, and state in
   the write-up that the spec's rule-based module was scoped out.
2. **Build the recipe recommender as the real Recommendations module** and rename the
   existing one. Correct if the recipe engine is a rubric requirement.
3. **Build it as a separate "Menu & Recipes" module** alongside the existing one. Both
   exist, no collision — but two recommendation surfaces is product bloat.

Recommendation: **option 1 or 3, decided by whether the rubric names recipes
explicitly.**

---

## 7. Field-level gaps

Columns named in the spec that no current table carries:

| Spec table | Missing field | Note |
|---|---|---|
| Users | Full Name, Account Status, Date Updated | `users` has no `full_name` or `updated_at` |
| Products | Reorder Level | ROP is **computed** by the optimization module, not stored |
| QR Codes | *(whole table)* | See §3 |
| Stock Records | Base Unit, Reorder Point, Safety Stock | ROP/safety stock computed; `products.unit` exists |
| Stock Movements | Reference Number | No linkage column to an inquiry or transfer |
| Batch Records | Batch Number, Status | `stock_lots` has `received_at` + `expiry_date` only |
| Stock Adjustments | Previous Quantity | Derivable from `stock` at decision time, not snapshotted |
| Order Inquiries | Cost Per Cup, Suggested Selling Price, Estimated Profit | Computed on read; see Costing Records |
| Customer Records | *(whole table)* | **Added** — `customers`, plus `customer_id` on inquiries and sales |
| Products | Cost of Goods | **Added** — `products.cost`, nullable; stripped from all public reads |
| Notifications | User ID | Alerts are broadcast, not per-user |

The Reorder Level / Reorder Point / Safety Stock pattern is worth calling out: the spec
treats them as stored columns, INVENTRAK derives them from real movement and sales
data via `routes/optimization.js`. **Storing them would make them stale immediately**;
deriving them is why the EOQ figures in the admin console respond to actual sales.
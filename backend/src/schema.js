// SQLite schema DDL — the single source of truth for the database layout.
// Both db.js (the live backend) and scripts/check-migration-catalog.js (the CI
// drift guard, which builds a FRESH temp database) exec this exact DDL, so a
// fresh database always matches the production schema, including the
// UNIQUE(product_id, location_id) constraint on stock and the
// customer_phone column on order_inquiries that older databases get via
// additive migrations in db.js.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  role TEXT DEFAULT 'customer',
  email TEXT,
  phone TEXT,
  email_verified INTEGER DEFAULT 1,
  google_sub TEXT,
  mfa_secret TEXT,
  mfa_enabled INTEGER DEFAULT 0,
  mfa_recovery TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE,
  name TEXT,
  category TEXT,
  brand TEXT,
  description TEXT,
  size TEXT,
  unit TEXT,
  price REAL,
  -- Cost of goods (what the café pays). NULLABLE and optional: a product with
  -- no cost simply is not costed, and the costing snapshot records that
  -- honestly (cost_basis) instead of inventing a number. Distinct from price,
  -- which is what the customer pays.
  cost REAL,
  status TEXT DEFAULT 'active',
  image TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  location_id INTEGER,
  quantity REAL DEFAULT 0,
  FOREIGN KEY(product_id) REFERENCES products(id),
  FOREIGN KEY(location_id) REFERENCES locations(id),
  UNIQUE(product_id, location_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  qty REAL,
  type TEXT,
  src_location INTEGER,
  dst_location INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  user TEXT
);

CREATE TABLE IF NOT EXISTS stock_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  location_id INTEGER,
  qty REAL,
  received_at TEXT DEFAULT (datetime('now')),
  expiry_date TEXT
);

CREATE TABLE IF NOT EXISTS order_inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  products TEXT,
  estimated_cost REAL,
  notes TEXT,
  delivery_address TEXT,
  -- Fulfilment preference chosen at checkout: 'pickup' or 'courier'. A
  -- PREFERENCE, not a courier booking — selecting 'courier' additionally
  -- requires delivery_address (enforced by catalog-orders/inquiry-lifecycle).
  fulfillment_method TEXT DEFAULT 'pickup',
  payment_method TEXT DEFAULT 'cod',
  payment_status TEXT DEFAULT 'unpaid',
  payment_reference TEXT,
  payment_customer_reference TEXT,
  payment_updated_at TEXT,
  payment_url TEXT,
  payment_qr TEXT,
  payment_provider TEXT,
  user_id INTEGER,
  -- Links the inquiry to the Customer Record it belongs to. Guests have a
  -- customer row too (they just have no account), so this is only NULL for
  -- orders with no usable identity at all.
  customer_id INTEGER,
  status_history TEXT,
  status TEXT DEFAULT 'pending',
  -- Rejection: a reason is REQUIRED when status becomes 'rejected', so the
  -- customer is told why instead of seeing a bare red chip.
  rejection_reason TEXT,
  -- Cancellation (customer-initiated): who/when/why, kept even though the
  -- status itself is 'cancelled'.
  cancelled_at TEXT,
  cancellation_reason TEXT,
  terms_version TEXT,
  terms_accepted_at TEXT,
  fulfillment_location_id INTEGER,
  inventory_committed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  qty REAL,
  unit_price REAL,
  total_amount REAL,
  transaction_date TEXT DEFAULT (datetime('now')),
  customer_name TEXT,
  -- Links the sale to a Customer Record. NULL on seeded/historical rows, which
  -- carry only a free-text name (backfill with scripts/backfill-customers.js).
  customer_id INTEGER,
  order_inquiry_id INTEGER,
  FOREIGN KEY(product_id) REFERENCES products(id)
);

-- Stocktake counts: what a person physically saw on a shelf.
--
-- This table exists because PHYSICAL STOCK IS ONLY OBSERVABLE BY COUNTING. No
-- database can tell that a bottle walked out; only someone on the shelf can.
-- There is also no recorded opening balance anywhere in this schema — the
-- seeder invents stock numbers and writes no movement rows for them — so
-- "expected = stock - sales" would only echo the seed back. The count is
-- therefore the anchor the reconciliation hangs off (see reconciliation.js).
--
-- system_qty is a SNAPSHOT of what the system believed at the moment of the
-- count, recorded alongside the physical figure. Without it the variance the
-- counter found could not be computed later, once the stock column has moved
-- on. See backend/src/reconciliation.js for the arithmetic.
CREATE TABLE IF NOT EXISTS inventory_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  counted_qty REAL NOT NULL,
  system_qty REAL NOT NULL,
  counted_at TEXT DEFAULT (datetime('now')),
  counted_by TEXT,
  note TEXT,
  FOREIGN KEY(product_id) REFERENCES products(id),
  FOREIGN KEY(location_id) REFERENCES locations(id)
);

CREATE INDEX IF NOT EXISTS inventory_counts_product_idx
  ON inventory_counts(product_id, location_id);

-- Customer Records: the business entity behind orders and sales.
--
-- Distinct from the users table, which holds ACCOUNTS (login, role, password). Guest
-- checkout is first-class, so a customer does not need an account — user_id is
-- an optional link, null for walk-ins. Everything else (business_name,
-- contact_number, email, address) previously lived smeared across
-- order_inquiries and sales_transactions, once per order, which made "this
-- customer's history" unanswerable. See backend/src/customers.js for the
-- resolve-or-create identity rule.
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  business_name TEXT,
  contact_number TEXT,
  email TEXT,
  address TEXT,
  -- Optional link to the account this customer signs in with.
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Email is the most stable identifier a café customer gives, so it is unique
-- when present. A partial index, because NULL/'' (walk-ins with no email) must
-- not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email
  ON customers (lower(email)) WHERE email IS NOT NULL AND email <> '';

CREATE TABLE IF NOT EXISTS inventory_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  location_id INTEGER,
  alert_type TEXT,
  threshold REAL,
  current_qty REAL,
  status TEXT DEFAULT 'active',
  -- Best-before alerts only: the lot date the alert is warning about.
  -- NULL for low_stock alerts.
  expiry_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY(product_id) REFERENCES products(id),
  FOREIGN KEY(location_id) REFERENCES locations(id)
);

-- Password reset codes: SHA-256 hash of the code (never the raw code), the
-- user it belongs to, and its expiry. Single-use: the row is deleted the
-- moment the code is redeemed. Because SCHEMA is re-executed on every boot
-- with CREATE TABLE IF NOT EXISTS, existing databases get the table for free
-- (no separate additive migration needed).
CREATE TABLE IF NOT EXISTS password_resets (
  code_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Signup email/SMS verification codes: same shape as password_resets (SHA-256
-- hash at rest, single-use, TTL). A user created by register starts with
-- email_verified = 0 and must redeem one of these to become verified; the
-- welcome email is only sent after verification.
CREATE TABLE IF NOT EXISTS verification_codes (
  code_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Stock adjustment requests: an admin proposes a corrected quantity at a
-- location (inventory count, damaged goods, shrinkage) with a reason. It is
-- created PENDING and only changes stock after an admin APPROVES it (the
-- 'approval of important transactions' workflow); REJECTED requests leave
-- stock untouched. Approving records the change as an 'adjustment' movement
-- in stock_movements so the ledger stays complete.
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  new_qty REAL NOT NULL,
  reason TEXT,
  -- Best-before date recorded during the physical count (nullable, ISO
  -- YYYY-MM-DD). On approval it becomes the reset lot's expiry_date, so
  -- FEFO consumption and best-before alerts pick it up automatically.
  expiry_date TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  decided_at TEXT,
  decided_by TEXT,
  FOREIGN KEY(product_id) REFERENCES products(id),
  FOREIGN KEY(location_id) REFERENCES locations(id)
);

-- Stock transfer requests: an admin proposes moving qty of a product between
-- two locations. PENDING until approved; approval performs the transfer and
-- records a 'transfer' movement; rejection leaves stock untouched.
CREATE TABLE IF NOT EXISTS stock_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  src_location INTEGER NOT NULL,
  dst_location INTEGER NOT NULL,
  qty REAL NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  decided_at TEXT,
  decided_by TEXT,
  FOREIGN KEY(product_id) REFERENCES products(id),
  FOREIGN KEY(src_location) REFERENCES locations(id),
  FOREIGN KEY(dst_location) REFERENCES locations(id)
);

-- Costing snapshot: the economics of one order inquiry FROZEN at submission.
--
-- Why a table at all: the inquiry's estimated_cost is the total the CUSTOMER
-- PAYS, and it is recomputed from line subtotals. That makes it a function of
-- today's catalog -- reprice a product and last month's order silently reports
-- a different (wrong) profit. This row is written once and never rewritten, so
-- the figures a customer was quoted stay true forever. See backend/src/costing.js.
--
-- UNIQUE(inquiry_id) enforces "one snapshot per inquiry" in the database, not
-- just in application code. cost_basis records how much is real:
--   'exact'   every priced line had a known unit cost
--   'imputed' some did; the rest were estimated from the blended cost ratio
--   'none'    nothing could be costed, so the money fields are NULL
CREATE TABLE IF NOT EXISTS costing_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL,
  total_cost REAL,
  total_revenue REAL,
  -- "A cup" is one ordered unit: the sum of the line quantities.
  target_quantity REAL,
  cost_per_cup REAL,
  suggested_selling_price REAL,
  estimated_profit REAL,
  cost_basis TEXT DEFAULT 'none',
  lines_priced INTEGER DEFAULT 0,
  lines_total INTEGER DEFAULT 0,
  margin_percent REAL,
  computed_at TEXT DEFAULT (datetime('now')),
  UNIQUE(inquiry_id),
  FOREIGN KEY(inquiry_id) REFERENCES order_inquiries(id)
);

-- Unit / packaging conversion catalog (Web Administration → Unit and Packaging
-- Conversion Management). One linear row per (from_unit -> to_unit) pair; the
-- UNIQUE constraint keeps the catalog from holding two conflicting rates for
-- the same pair. Units are stored lowercased/trimmed by the route layer so
-- 'KG' and 'kg' are the same unit. Identity rows (kg -> kg) are rejected in
-- code, not here, because the error needs to reach the caller.
CREATE TABLE IF NOT EXISTS unit_conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_unit TEXT NOT NULL,
  to_unit TEXT NOT NULL,
  rate REAL NOT NULL,
  note TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(from_unit, to_unit)
);

-- Notification ledger (Web Administration → admin notifications view). Every
-- notification ATTEMPT is recorded here with its channel and best-effort
-- delivery status, so an admin has a sent/delivered/logged/failed view instead
-- of hunting through server logs. 'logged' means no provider was configured
-- (the message went to stdout only) -- stated honestly rather than as 'sent'.
CREATE TABLE IF NOT EXISTS notification_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT,
  subject TEXT,
  status TEXT DEFAULT 'attempted',
  detail TEXT,
  related_id INTEGER,
  related_type TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS notification_records_created_idx
  ON notification_records(created_at);

-- Back orders (Web Administration → Back-Order Management). One row per order
-- inquiry that could not be fully fulfilled, carrying the reason and the date
-- the customer wants it by. A back order is conceptually an inquiry-level
-- status, but persisting it as its own row lets the admin view treat "back
-- ordered" as a real workflow (open -> fulfilled/cancelled) instead of a
-- label smeared across the inquiry history.
CREATE TABLE IF NOT EXISTS back_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL,
  reason TEXT,
  requested_by_date TEXT,
  status TEXT DEFAULT 'open',
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  -- One back order per inquiry. Deliberately NOT a FOREIGN KEY: the npm-free
  -- ledger keys by inquiry id without requiring the inquiry row to exist yet
  -- (an admin may record a back order as soon as a shortfall is known), and
  -- the two backends must accept the same input.
  UNIQUE(inquiry_id)
);

-- Approver comments / correction requests (Approvals queue feedback loop).
-- When an admin rejects a submission with a comment, the comment is stored
-- here linked to the submission so the staff app can show it as a visible
-- correction instruction before the staff member resubmits.
CREATE TABLE IF NOT EXISTS correction_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  submission_type TEXT,
  comment TEXT NOT NULL,
  requested_by TEXT,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS correction_requests_submission_idx
  ON correction_requests(submission_type, submission_id);
`;

module.exports = SCHEMA;

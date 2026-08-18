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
  name TEXT,
  category TEXT,
  brand TEXT,
  description TEXT,
  size TEXT,
  unit TEXT,
  price REAL,
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
  received_at TEXT DEFAULT (datetime('now'))
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
  payment_method TEXT DEFAULT 'cod',
  payment_status TEXT DEFAULT 'unpaid',
  payment_reference TEXT,
  payment_url TEXT,
  payment_qr TEXT,
  payment_provider TEXT,
  user_id INTEGER,
  status_history TEXT,
  status TEXT DEFAULT 'pending',
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
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS inventory_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  location_id INTEGER,
  alert_type TEXT,
  threshold REAL,
  current_qty REAL,
  status TEXT DEFAULT 'active',
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
`;

module.exports = SCHEMA;

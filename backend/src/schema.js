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
`;

module.exports = SCHEMA;

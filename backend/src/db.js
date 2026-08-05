const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Allow tests to point at an isolated database file.
const dbPath = process.env.INVENTRAK_DB_PATH || path.join(dataDir, 'inventrak.db');
const db = new Database(dbPath);

db.exec(`
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
`);

// Migration for databases created before the UNIQUE(product_id, location_id)
// constraint existed on `stock`. Without the constraint, INSERT OR IGNORE in
// the stock-movement handlers never ignores, so every movement inserted a
// duplicate row that then absorbed the same UPDATE — corrupting per-location
// counts and totals. Rebuild the table with the constraint, merging any
// duplicate rows by summing their quantities.
const stockIndexes = db.prepare("PRAGMA index_list('stock')").all();
const hasUniqueStockPair = stockIndexes.some((i) => i.origin === 'u');

if (!hasUniqueStockPair) {
  db.transaction(() => {
    db.exec(`
      ALTER TABLE stock RENAME TO stock_legacy;
      CREATE TABLE stock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        location_id INTEGER,
        quantity REAL DEFAULT 0,
        FOREIGN KEY(product_id) REFERENCES products(id),
        FOREIGN KEY(location_id) REFERENCES locations(id),
        UNIQUE(product_id, location_id)
      );
      INSERT INTO stock (product_id, location_id, quantity)
        SELECT product_id, location_id, SUM(quantity)
        FROM stock_legacy
        GROUP BY product_id, location_id;
      DROP TABLE stock_legacy;
    `);
  })();
}

module.exports = { db };

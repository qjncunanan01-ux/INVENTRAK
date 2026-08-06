const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const SCHEMA = require('./schema');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Allow tests to point at an isolated database file.
const dbPath = process.env.INVENTRAK_DB_PATH || path.join(dataDir, 'inventrak.db');
const db = new Database(dbPath);

// Fresh databases get the full current layout from src/schema.js (including
// the UNIQUE stock constraint and the customer_phone column); the migrations
// below only upgrade databases created before those existed.
db.exec(SCHEMA);

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

// Migration: order inquiries may carry a customer phone number for SMS status
// updates (added after launch). Additive, so existing databases are untouched
// apart from the new nullable column.
const inquiryColumns = db.prepare("PRAGMA table_info(order_inquiries)").all();
const hasPhone = inquiryColumns.some((c) => c.name === 'customer_phone');
if (!hasPhone) {
  db.exec('ALTER TABLE order_inquiries ADD COLUMN customer_phone TEXT');
}

module.exports = { db };

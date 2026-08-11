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

// Migrations: order inquiries gained a customer phone number (SMS status
// updates), then a delivery address + payment method (checkout). Additive, so
// existing databases are untouched apart from the new nullable columns.
const inquiryColumns = db.prepare("PRAGMA table_info(order_inquiries)").all();
if (!inquiryColumns.some((c) => c.name === 'customer_phone')) {
  db.exec('ALTER TABLE order_inquiries ADD COLUMN customer_phone TEXT');
}
if (!inquiryColumns.some((c) => c.name === 'delivery_address')) {
  db.exec('ALTER TABLE order_inquiries ADD COLUMN delivery_address TEXT');
}
if (!inquiryColumns.some((c) => c.name === 'payment_method')) {
  db.exec("ALTER TABLE order_inquiries ADD COLUMN payment_method TEXT DEFAULT 'cod'");
}
// Checkout ownership + progress timeline: user_id links an inquiry to the
// account that placed it (per-account history scoping); status_history is the
// JSON timeline of status changes (Placed -> Approved -> Delivered) shown on
// the mobile cards. Additive.
if (!inquiryColumns.some((c) => c.name === 'user_id')) {
  db.exec('ALTER TABLE order_inquiries ADD COLUMN user_id INTEGER');
}
if (!inquiryColumns.some((c) => c.name === 'status_history')) {
  db.exec('ALTER TABLE order_inquiries ADD COLUMN status_history TEXT');
}
// Payment step (GCash/card): payment_status/reference/url/qr/provider are
// added by the checkout handler after the inquiry is inserted. Additive.
if (!inquiryColumns.some((c) => c.name === 'payment_status')) {
  db.exec("ALTER TABLE order_inquiries ADD COLUMN payment_status TEXT DEFAULT 'unpaid'");
}
if (!inquiryColumns.some((c) => c.name === 'payment_reference')) {
  db.exec('ALTER TABLE order_inquiries ADD COLUMN payment_reference TEXT');
}
if (!inquiryColumns.some((c) => c.name === 'payment_url')) {
  db.exec('ALTER TABLE order_inquiries ADD COLUMN payment_url TEXT');
}
if (!inquiryColumns.some((c) => c.name === 'payment_qr')) {
  db.exec('ALTER TABLE order_inquiries ADD COLUMN payment_qr TEXT');
}
if (!inquiryColumns.some((c) => c.name === 'payment_provider')) {
  db.exec('ALTER TABLE order_inquiries ADD COLUMN payment_provider TEXT');
}

// Google sign-in: users table gains a nullable google_sub (Google's stable
// account id) so OAuth-created accounts can be matched/linked by identity.
// Additive, like the columns above.
const googleUserColumns = db.prepare('PRAGMA table_info(users)').all();
if (!googleUserColumns.some((c) => c.name === 'google_sub')) {
  db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
}

// Product images (supplier photo library -> /images/* served by both backends).
const productColumns = db.prepare('PRAGMA table_info(products)').all();
if (!productColumns.some((c) => c.name === 'image')) {
  db.exec('ALTER TABLE products ADD COLUMN image TEXT');
}

// Migration: users gained email verification + an optional phone number for
// SMS codes (signup verification). Existing rows default to VERIFIED (1) so
// accounts created before verification existed are never locked out; only new
// registrations start unverified. Additive.
const userColumns = db.prepare('PRAGMA table_info(users)').all();
const userNames = new Set(userColumns.map((c) => c.name));
if (!userNames.has('email_verified')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 1');
}
if (!userNames.has('phone')) {
  db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
}

module.exports = { db };

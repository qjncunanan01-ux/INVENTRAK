const path = require('node:path');
const fs = require('node:fs');
const { db: liveDb } = require('./db');
const { hashPassword } = require('./password-hash');
const { DEMO_SEED, SEED_EPOCH, mulberry32, DEMO_LOCATIONS, DEMO_CUSTOMERS } = require('./prng');

const DEFAULT_PRODUCTS_FILE = path.join(__dirname, '..', 'data', 'products.json');

// Seed a SQLite connection from a product catalog JSON file. Deterministic:
// the same fixed-seed PRNG and draw order as the npm-free fallback, so a fresh
// seed always produces IDENTICAL stock and sales.
//
// Call with NO arguments to seed the live backend connection (server.js, the
// test harness). Pass { db, productsFile } to seed a DIFFERENT connection or
// catalog — scripts/check-migration-catalog.js (the CI catalog drift guard)
// and scripts/sync-sylver-catalog.js both rely on that. Those options were
// briefly dropped in a refactor, which made both scripts silently seed the
// live database instead of their own temp DB and left it empty.
function seedDatabase({ db: dbOverride, productsFile = DEFAULT_PRODUCTS_FILE } = {}) {
  const conn = dbOverride || liveDb;
  const adminExists = conn.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hashedPw = hashPassword('admin123');
    conn.prepare('INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)').run('admin', hashedPw, 'admin', 'admin@inventrak.com');
  }

  const custExists = conn.prepare('SELECT id FROM users WHERE username = ?').get('customer');
  if (!custExists) {
    const hashedPw = hashPassword('customer123');
    conn.prepare('INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)').run('customer', hashedPw, 'customer', 'customer@example.com');
  }

  const staffExists = conn.prepare('SELECT id FROM users WHERE username = ?').get('staff');
  if (!staffExists) {
    const hashedPw = hashPassword('staff123');
    conn.prepare('INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)').run('staff', hashedPw, 'staff', 'staff@inventrak.com');
  }

  const insertDemoUser = conn.prepare('INSERT OR IGNORE INTO users (username, password, role, email) VALUES (?, ?, ?, ?)');
  insertDemoUser.run('owner', hashPassword('owner123'), 'owner', 'owner@inventrak.com');
  insertDemoUser.run('superadmin', hashPassword('super123'), 'super_admin', 'superadmin@inventrak.com');

  const existing = conn.prepare('SELECT COUNT(*) as count FROM products').get();
  if (existing.count > 0) return;

  if (!fs.existsSync(productsFile)) {
    console.warn(`[seed] product catalog not found at ${productsFile} — seeding users only`);
    return;
  }
  const products = JSON.parse(fs.readFileSync(productsFile, 'utf8'));

  if (!products.length) return;

  const insertProduct = conn.prepare('INSERT INTO products (name, category, brand, description, size, unit, price, status, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const getLocation = conn.prepare('SELECT id FROM locations WHERE name = ?');
  const insertLocation = conn.prepare('INSERT INTO locations (name) VALUES (?)');
  const insertStock = conn.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)');
  const insertLot = conn.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)');
  const insertSales = conn.prepare('INSERT INTO sales_transactions (product_id, qty, unit_price, total_amount, transaction_date, customer_name) VALUES (?, ?, ?, ?, ?, ?)');

  const locations = DEMO_LOCATIONS;
  const customers = DEMO_CUSTOMERS;

  conn.transaction(() => {
    for (const name of locations) {
      if (!getLocation.get(name)) insertLocation.run(name);
    }

    const rand = mulberry32(DEMO_SEED);
    for (const p of products) {
      const result = insertProduct.run(
        p['Product Name'] || p.name,
        p['Category'] || p.category,
        p['Brand'] || p.brand || '',
        p['Description'] || '',
        p['Size'] || p.size || '',
        p['Unit'] || p.unit || '',
        p['Price'] || p.price || 0,
        'active',
        p['Image'] || p.image || null,
      );
      const pid = result.lastInsertRowid;

      for (const name of locations) {
        const locId = getLocation.get(name).id;
        const qty = Math.floor(rand() * 160) + 20;
        insertStock.run(pid, locId, qty);
        insertLot.run(pid, locId, qty, new Date().toISOString());
      }

      const price = p['Price'] || p.price || 1;
      const fsnRoll = rand();
      const isFsnRare = fsnRoll >= 0.85;

      for (const cust of customers) {
        const saleQty = isFsnRare ? (Math.floor(rand() * 2) + 1) : (Math.floor(rand() * 15) + 1);
        const daysAgo = isFsnRare ? 90 + Math.floor(rand() * 90) : Math.floor(rand() * 45);
        const date = new Date(SEED_EPOCH - daysAgo * 86400000).toISOString();
        insertSales.run(pid, saleQty, price, saleQty * price, date, cust);
      }
    }
  })();

  // Refresh alerts after seeding. Only for the LIVE connection: alert-helpers
  // binds the global db, so refreshing after seeding a caller-supplied temp
  // connection would silently touch the wrong database.
  if (!dbOverride) {
    const { refreshAlerts } = require('./alert-helpers');
    refreshAlerts();
  }
}

module.exports = { seedDatabase };
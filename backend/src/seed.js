const path = require('path');
const fs = require('fs');
const { hashPassword } = require('./password-hash');
const { DEMO_SEED, SEED_EPOCH, mulberry32, DEMO_LOCATIONS, DEMO_CUSTOMERS } = require('./prng');

const DEFAULT_PRODUCTS_FILE = path.join(__dirname, '..', 'data', 'products.json');

// Seed a SQLite database (any connection — the live backend, a temp DB for
// the CI catalog check, etc.) from a product catalog JSON file. Deterministic:
// the same fixed-seed PRNG and draw order as app.js seedDatabase and the
// npm-free fallback, so a fresh seed always produces IDENTICAL stock and sales.
//
// Users are always ensured, even when products were already seeded (admin/
// admin123 + customer/customer123 logins must work). Returns { seeded } —
// seeded=false when products already existed and product/stock/sales seeding
// was skipped.
function seedDatabase({ db, productsFile = DEFAULT_PRODUCTS_FILE } = {}) {
  if (!db) throw new Error('seedDatabase requires a db connection');
  if (!fs.existsSync(productsFile)) {
    throw new Error(`products.json not found at ${productsFile}. Please add the product catalog JSON to seed.`);
  }

  const products = JSON.parse(fs.readFileSync(productsFile, 'utf8'));

  const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, password, role, email) VALUES (?, ?, ?, ?)');
  insertUser.run('admin', hashPassword('admin123'), 'admin', 'admin@inventrak.com');
  insertUser.run('customer', hashPassword('customer123'), 'customer', 'customer@example.com');

  const existingProducts = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  if (existingProducts > 0) return { seeded: false };

  const insertProduct = db.prepare('INSERT INTO products (name, category, brand, description, size, unit, price, status, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const getLocation = db.prepare('SELECT id FROM locations WHERE name = ?');
  const insertLocation = db.prepare('INSERT INTO locations (name) VALUES (?)');
  const insertStock = db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)');
  const insertLot = db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)');
  const insertSales = db.prepare('INSERT INTO sales_transactions (product_id, qty, unit_price, total_amount, transaction_date, customer_name) VALUES (?, ?, ?, ?, ?, ?)');

  // Deterministic demo data: same fixed-seed PRNG and draw order as app.js
  // seedDatabase and the npm-free fallback.
  const locations = DEMO_LOCATIONS;
  const customers = DEMO_CUSTOMERS;
  const rand = mulberry32(DEMO_SEED);

  db.transaction(() => {
    for (const loc of locations) {
      if (!getLocation.get(loc)) insertLocation.run(loc);
    }

    for (const p of products) {
      const res = insertProduct.run(
        p['Product Name'] || p.name,
        p['Category'] || p.category,
        p['Brand'] || p.brand || '',
        p['Description'] || '',
        p['Size'] || p.size || '',
        p['Unit'] || p.unit || '',
        p['Price'] || p.price || 0,
        // Respect an explicitly-inactive catalog row; the catalog drift guard
        // (migrate:check) would otherwise fail on it because the transform
        // would flip it back to active.
        p.status && p.status !== 'active' ? p.status : 'active',
        p['Image'] || p.image || null
      );

      const pid = res.lastInsertRowid;
      // Draws 1-3: location stock.
      for (const loc of locations) {
        const locId = getLocation.get(loc).id;
        const qty = Math.floor(rand() * 160) + 20;
        insertStock.run(pid, locId, qty);
        insertLot.run(pid, locId, qty, new Date().toISOString());
      }

      // Draws 4-9: sales history (2 draws per customer).
      const price = p['Price'] || p.price || 1;
      for (const cust of customers) {
        const saleQty = Math.floor(rand() * 15) + 1;
        const daysAgo = Math.floor(rand() * 90);
        const date = new Date(SEED_EPOCH - daysAgo * 86400000).toISOString();
        insertSales.run(pid, saleQty, price, saleQty * price, date, cust);
      }
    }
  })();

  return { seeded: true };
}

if (require.main === module) {
  const { db } = require('./db');
  try {
    const { seeded } = seedDatabase({ db });
    if (seeded) console.log('Seeding complete.');
    else console.log('Products already seeded. Skipping product/stock/sales seeding.');
  } catch (err) {
    console.error(err && err.message);
    process.exit(1);
  }
}

module.exports = { seedDatabase };

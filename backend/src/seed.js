const path = require('path');
const fs = require('fs');
const { db } = require('./db');
const bcrypt = require('bcryptjs');

const productsFile = path.join(__dirname, '..', 'data', 'products.json');
if (!fs.existsSync(productsFile)) {
  console.error('products.json not found in backend/data. Please add the product catalog JSON to seed.');
  process.exit(1);
}

const raw = fs.readFileSync(productsFile, 'utf8');
const products = JSON.parse(raw);

// Users are always ensured, even when products were already seeded
// (mirrors app.js seedDatabase: admin/admin123 + customer/customer123 logins must work).
const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, password, role, email) VALUES (?, ?, ?, ?)');
insertUser.run('admin', bcrypt.hashSync('admin123', 10), 'admin', 'admin@inventrak.com');
insertUser.run('customer', bcrypt.hashSync('customer123', 10), 'customer', 'customer@example.com');

const existingProducts = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
if (existingProducts > 0) {
  console.log('Products already seeded. Skipping product/stock/sales seeding.');
  process.exit(0);
}

const insertProduct = db.prepare('INSERT INTO products (name, category, brand, description, size, unit, price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const getLocation = db.prepare('SELECT id FROM locations WHERE name = ?');
const insertLocation = db.prepare('INSERT INTO locations (name) VALUES (?)');
const insertStock = db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)');
const insertLot = db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)');
const insertSales = db.prepare('INSERT INTO sales_transactions (product_id, qty, unit_price, total_amount, transaction_date, customer_name) VALUES (?, ?, ?, ?, ?, ?)');

const locations = ['Showroom', 'Stockroom 1', 'Stockroom 2'];
const customers = ['Juan Dela Cruz', 'Maria Santos', 'Jose Rizal'];

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
      'active'
    );

    const pid = res.lastInsertRowid;
    for (const loc of locations) {
      const locId = getLocation.get(loc).id;
      const qty = Math.floor(Math.random() * 160) + 20;
      insertStock.run(pid, locId, qty);
      insertLot.run(pid, locId, qty, new Date().toISOString());
    }

    const price = p['Price'] || p.price || 1;
    for (const cust of customers) {
      const saleQty = Math.floor(Math.random() * 15) + 1;
      const daysAgo = Math.floor(Math.random() * 90);
      const date = new Date(Date.now() - daysAgo * 86400000).toISOString();
      insertSales.run(pid, saleQty, price, saleQty * price, date, cust);
    }
  }
})();

console.log('Seeding complete.');

const path = require('path');
const fs = require('fs');
const { db } = require('./db');

const productsFile = path.join(__dirname, '..', 'data', 'products.json');
if (!fs.existsSync(productsFile)) {
  console.error('products.json not found in backend/data. Please add the product catalog JSON to seed.');
  process.exit(1);
}

const raw = fs.readFileSync(productsFile, 'utf8');
const products = JSON.parse(raw);

const insertProduct = db.prepare('INSERT INTO products (name, category, brand, description, size, unit, price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const getLocation = db.prepare('SELECT id FROM locations WHERE name = ?');
const insertLocation = db.prepare('INSERT INTO locations (name) VALUES (?)');
const insertStock = db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)');
const insertLot = db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at) VALUES (?, ?, ?, ?)');

const locations = ['Showroom', 'Stockroom 1', 'Stockroom 2'];

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
  }
});

console.log('Seeding complete.');

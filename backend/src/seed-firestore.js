// Seeds a Firebase (Firestore) project from the local backend/data/ JSON
// catalog. Run after configuring the Firebase env vars:
//   npm run seed:firestore
//
// Non-destructive: the reference catalog (products + inventory) is always
// synced from the local files, but operational data is never wiped —
// movements/inquiries/users/sales/alerts are only written if absent, so a
// re-seed can never destroy real orders or sales. On a brand-new project the
// server also auto-seeds from these same files on first boot.
process.env.DB_DRIVER = 'firestore';

const fs = require('fs');
const path = require('path');
const store = require('./store-firestore');
const { hashPassword } = require('./password-hash');

const dataDir = process.env.INVENTRAK_DATA_DIR || path.join(__dirname, '..', 'data');

// Catalog: always synced from local (reference data).
const CATALOG = ['products.json', 'inventory.json'];
// Operational: only written when the dataset is absent (never overwritten).
const OPERATIONAL = ['stock_movements.json', 'order_inquiries.json'];

async function main() {
  await store.init();
  for (const file of CATALOG) {
    const rows = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    store.write(file, rows);
    console.log(`  synced ${file} (${Array.isArray(rows) ? rows.length : 'n/a'} rows)`);
  }
  for (const file of OPERATIONAL) {
    if (store.read(file) === null) {
      const rows = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
      store.write(file, rows);
      console.log(`  seeded ${file} (empty)`);
    } else {
      console.log(`  kept existing ${file} (not overwritten)`);
    }
  }
  const users = store.read('@users');
  if (users === null) {
    store.write('@users', [
      { id: 1, username: 'admin', password: hashPassword('admin123'), role: 'admin', email: 'admin@inventrak.com', created_at: new Date().toISOString() },
      { id: 2, username: 'customer', password: hashPassword('customer123'), role: 'customer', email: 'customer@example.com', created_at: new Date().toISOString() },
    ]);
    console.log('  seeded demo users (admin / customer)');
  } else {
    console.log('  kept existing users (not overwritten)');
  }
  await store.flush();
  console.log('Firestore seeded successfully.');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Seeding failed:', err.message);
    process.exit(1);
  });

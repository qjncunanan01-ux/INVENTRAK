// One-way migration bridge: dumps the live SQLite database (backend/data/
// inventrak.db — the default backend) into Firebase Firestore, so Firebase
// becomes "the database of it all" without losing any real data.
//
//   npm run migrate:firestore              # push SQLite data into Firestore
//   npm run migrate:firestore -- --dry-run # preview counts, touch nothing
//
// Pipeline: dumpSnapshot(dbPath) -> transformSnapshot(snapshot) -> store.
// The transform is a pure function (no I/O), so the mapping is unit-tested
// against an in-process fake Firestore (see src/test/migrate-firestore.test.js).
//
// The store's write path converts nulls to '' (Firestore rejects null), so
// rows are pushed exactly as the server would write them; the server's read
// handlers normalize '' back to null for API parity with the SQLite backend.
const fs = require('fs');
const path = require('path');

// --- Pure snapshot of every table the npm-free server relies on ---
function dumpSnapshot(dbPath) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  try {
    const all = (sql) => db.prepare(sql).all();
    return {
      users: all('SELECT * FROM users ORDER BY id'),
      products: all('SELECT * FROM products ORDER BY id'),
      locations: all('SELECT * FROM locations ORDER BY id'),
      stock: all('SELECT * FROM stock ORDER BY id'),
      stock_movements: all('SELECT * FROM stock_movements ORDER BY id'),
      order_inquiries: all('SELECT * FROM order_inquiries ORDER BY id'),
      sales_transactions: all('SELECT * FROM sales_transactions ORDER BY id'),
      inventory_alerts: all('SELECT * FROM inventory_alerts ORDER BY id'),
    };
  } finally {
    db.close();
  }
}

// Mirrors server_npmfree.js formatProduct so migrated inventory items match
// what the server would have produced itself. No nulls (Firestore-safe).
function formatProduct(row) {
  return {
    id: row.id,
    name: row.name ?? '',
    category: row.category ?? '',
    brand: row.brand ?? '',
    description: row.description ?? '',
    size: row.size ?? '',
    unit: row.unit ?? '',
    price: row.price ?? 0,
    status: row.status ?? 'active',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Pure mapping from a SQLite snapshot into the store-shaped datasets the
// npm-free server reads. Nulls are kept (the store sanitizes them), so the
// JSON output stays a faithful copy of the database.
function transformSnapshot(s) {
  const products = (s.products || []).map((p) => {
    const out = {
      'Product Name': p.name ?? '',
      'Category': p.category ?? '',
      'Brand': p.brand ?? '',
      'Description': p.description ?? '',
      'Size': p.size ?? '',
      'Unit': p.unit ?? '',
      'Price': p.price ?? 0,
    };
    // Mirror the seed-file convention: active products carry no status key.
    // A NULL status (a partial PUT nulls the column) must NOT become 'active'
    // after migration — both backends treat null status as inactive — so map
    // it to the explicit 'inactive' string.
    if (p.status === null) out['status'] = 'inactive';
    else if (p.status && p.status !== 'active') out['status'] = p.status;
    return out;
  });

  const locationIdToName = new Map((s.locations || []).map((l) => [l.id, l.name]));
  const stockByProduct = new Map();
  (s.stock || []).forEach((r) => {
    if (!stockByProduct.has(r.product_id)) stockByProduct.set(r.product_id, []);
    stockByProduct.get(r.product_id).push(r);
  });
  const items = (s.products || []).map((p) => {
    const rows = stockByProduct.get(p.id) || [];
    const locations = {};
    rows.forEach((r) => {
      const name = locationIdToName.get(r.location_id);
      if (name !== undefined) locations[name] = r.quantity;
    });
    return {
      product: formatProduct(p),
      locations,
      total: rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0),
    };
  });

  const productNameById = new Map((s.products || []).map((p) => [p.id, p.name]));

  return {
    'products.json': products,
    'inventory.json': { locations: (s.locations || []).map((l) => l.name), items },
    'stock_movements.json': s.stock_movements || [],
    'order_inquiries.json': s.order_inquiries || [],
    '@users': s.users || [],
    '@sales': s.sales_transactions || [],
    // SQLite's GET /api/alerts JOINs product/location names — carry that
    // enrichment so the migrated data matches what the API returns.
    '@alerts': (s.inventory_alerts || []).map((a) => ({
      ...a,
      product_name: productNameById.get(a.product_id) || '',
      location_name: locationIdToName.get(a.location_id) || '',
    })),
  };
}

function countRows(data) {
  if (Array.isArray(data)) return data.length;
  if (data && Array.isArray(data.items)) return data.items.length;
  return 'n/a';
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const dbPath = process.env.INVENTRAK_DB_PATH || path.join(__dirname, '..', 'data', 'inventrak.db');

  if (!fs.existsSync(dbPath)) {
    console.error(`SQLite database not found: ${dbPath}`);
    console.error('Start the backend once (npm start) so it creates and seeds the database, then migrate.');
    process.exit(1);
  }

  const datasets = transformSnapshot(dumpSnapshot(dbPath));

  console.log(`Snapshot from ${dbPath}:`);
  Object.entries(datasets).forEach(([file, rows]) => {
    console.log(`  ${file}: ${countRows(rows)}`);
  });

  if (dryRun) {
    console.log('\nDry run — nothing written. Re-run without --dry-run to migrate to Firestore.');
    return;
  }

  console.log('\nWARNING: this REPLACES the Firestore collections with the SQLite snapshot.');
  console.log('Any data added to Firestore since the last migration will be overwritten.');

  const store = require('./store-firestore');
  await store.init();
  for (const [file, rows] of Object.entries(datasets)) {
    store.write(file, rows);
  }
  await store.flush();
  console.log('\nMigration complete — Firestore now mirrors the SQLite database.');
  console.log('The backend auto-selects Firestore on next start (Firebase env vars are set).');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err && err.message);
      process.exit(1);
    });
}

module.exports = { dumpSnapshot, transformSnapshot, main };

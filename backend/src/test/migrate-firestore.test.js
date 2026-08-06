// End-to-end tests for the SQLite → Firestore migration bridge. Uses a REAL
// temp SQLite database (via db.js's schema), the pure transform, and the
// strict in-process fake Firestore — proving that a live database can be
// pushed into Firestore and immediately served by the npm-free server with
// no data loss or null-storage crashes.
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventrak-migrate-'));
process.env.INVENTRAK_DB_PATH = path.join(tmpDir, 'source.db');
const { db } = require('../db');
const { dumpSnapshot, transformSnapshot } = require('../migrate-firestore');
const { makeFakeDb } = require('./fake-firestore');
const fsStore = require('../store-firestore');

// Seed a small but representative database: active + inactive products, two
// locations, stock across them, a stock-in movement with a NULL source
// location (the common case), an inquiry with a phone, a sale, and an alert.
db.prepare('INSERT INTO users (id, username, password, role, email, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  .run(1, 'admin', 'admin123', 'admin', 'admin@inventrak.com', '2024-01-01T00:00:00.000Z');
db.prepare('INSERT INTO products (id, name, category, brand, description, size, unit, price, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .run(1, 'Butterscotch Sauce', 'Da Vinci Gourmet Sauces', 'Da Vinci', '', '2 L', 'pcs', 1070, 'active', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
db.prepare('INSERT INTO products (id, name, category, brand, description, size, unit, price, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .run(2, 'Matcha Powder', 'Matcha', 'Da Vinci', '', '1 KG', 'pcs', 1175, 'active', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
db.prepare('INSERT INTO products (id, name, category, brand, description, size, unit, price, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .run(3, 'Old Stock', 'Legacy', '', '', '', '', 10, 'inactive', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
db.prepare('INSERT INTO products (id, name, category, brand, description, size, unit, price, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .run(4, 'Nulled Status', 'Legacy', '', '', '', '', 5, null, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
db.prepare('INSERT INTO locations (id, name) VALUES (?, ?)').run(1, 'Main');
db.prepare('INSERT INTO locations (id, name) VALUES (?, ?)').run(2, 'Backup');
db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)').run(1, 1, 50);
db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)').run(1, 2, 30);
db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)').run(2, 1, 40);
db.prepare('INSERT INTO stock_movements (id, product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .run(1, 1, 10, 'stock-in', null, 1, 'restock', '2024-02-01T00:00:00.000Z', 'admin');
db.prepare('INSERT INTO order_inquiries (id, customer_name, customer_email, customer_phone, products, estimated_cost, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .run(1, 'Ana', 'ana@example.com', '+639171234567', '["Butterscotch Sauce x1"]', 1070, 'urgent', 'pending', '2024-02-02T00:00:00.000Z');
db.prepare('INSERT INTO sales_transactions (id, product_id, qty, unit_price, total_amount, transaction_date, customer_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(1, 1, 2, 1070, 2140, '2024-02-03T00:00:00.000Z', 'Ana');
db.prepare('INSERT INTO inventory_alerts (id, product_id, location_id, alert_type, threshold, current_qty, status, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .run(1, 1, 1, 'low_stock', 80, 50, 'active', '2024-02-04T00:00:00.000Z', null);

after(() => {
  try { db.close(); } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('dumpSnapshot reads every table from the SQLite database', () => {
  const snap = dumpSnapshot(process.env.INVENTRAK_DB_PATH);
  assert.strictEqual(snap.products.length, 4);
  assert.strictEqual(snap.locations.length, 2);
  assert.strictEqual(snap.stock.length, 3);
  assert.strictEqual(snap.users.length, 1);
  assert.strictEqual(snap.order_inquiries[0].customer_phone, '+639171234567');
});

test('transformSnapshot maps a SQLite snapshot into store-shaped datasets', () => {
  const datasets = transformSnapshot(dumpSnapshot(process.env.INVENTRAK_DB_PATH));

  // Products: renamed to the JSON-file keys, inactive keeps its status.
  assert.strictEqual(datasets['products.json'][0]['Product Name'], 'Butterscotch Sauce');
  assert.strictEqual(datasets['products.json'][0]['Price'], 1070);
  assert.ok(!('status' in datasets['products.json'][0]), 'active products carry no status key');
  assert.strictEqual(datasets['products.json'][2]['status'], 'inactive');
  assert.strictEqual(datasets['products.json'][3]['status'], 'inactive', 'null status is migrated as inactive, never active');

  // Inventory: locations array + per-product items with live stock + totals.
  assert.deepStrictEqual(datasets['inventory.json'].locations, ['Main', 'Backup']);
  assert.deepStrictEqual(datasets['inventory.json'].items[0].locations, { Main: 50, Backup: 30 });
  assert.strictEqual(datasets['inventory.json'].items[0].total, 80);
  assert.strictEqual(datasets['inventory.json'].items[0].product.name, 'Butterscotch Sauce');
  assert.deepStrictEqual(datasets['inventory.json'].items[1].locations, { Main: 40 });
  assert.strictEqual(datasets['inventory.json'].items[2].total, 0, 'products without stock get an empty item');

  // Movements / inquiries / users / sales pass through faithfully.
  assert.strictEqual(datasets['stock_movements.json'][0].src_location, null);
  assert.strictEqual(datasets['order_inquiries.json'][0].customer_phone, '+639171234567');
  assert.strictEqual(datasets['@users'][0].username, 'admin');
  assert.strictEqual(datasets['@sales'][0].total_amount, 2140);

  // Alerts are enriched with the names the SQLite API returns via JOIN.
  assert.strictEqual(datasets['@alerts'][0].product_name, 'Butterscotch Sauce');
  assert.strictEqual(datasets['@alerts'][0].location_name, 'Main');
  assert.strictEqual(datasets['@alerts'][0].resolved_at, null);
});

test('migrated datasets round-trip through the Firestore store (null-safe)', async () => {
  const fake = makeFakeDb();
  fsStore._setDb(fake);
  await fsStore.init();
  const datasets = transformSnapshot(dumpSnapshot(process.env.INVENTRAK_DB_PATH));
  for (const [file, rows] of Object.entries(datasets)) fsStore.write(file, rows);
  await fsStore.flush();

  assert.strictEqual(fsStore.read('products.json').length, 4);
  assert.strictEqual(fsStore.read('products.json')[2].status, 'inactive');
  assert.strictEqual(fsStore.read('products.json')[3].status, 'inactive');
  assert.strictEqual(fsStore.read('inventory.json').items[0].total, 80);
  assert.strictEqual(fsStore.read('inventory.json').items[1].product.name, 'Matcha Powder');
  assert.strictEqual(fsStore.read('@users')[0].username, 'admin');
  assert.strictEqual(fsStore.read('@sales')[0].total_amount, 2140);
  assert.strictEqual(fsStore.read('@alerts')[0].product_name, 'Butterscotch Sauce');
  // The null src_location became '' in the PERSISTED Firestore document
  // (Firestore rejects null); the cache keeps the raw migrated rows, and the
  // server's read handler normalizes '' back to null on the wire.
  assert.strictEqual(fake._cols.get('movements').get('1').src_location, '');
  assert.strictEqual(fsStore.read('stock_movements.json')[0].src_location, null);
});

test('npm-free server serves migrated Firestore data end-to-end', async () => {
  // Migrate the SQLite data into a fresh fake Firestore.
  const fake = makeFakeDb();
  fsStore._setDb(fake);
  await fsStore.init();
  const datasets = transformSnapshot(dumpSnapshot(process.env.INVENTRAK_DB_PATH));
  for (const [file, rows] of Object.entries(datasets)) fsStore.write(file, rows);
  await fsStore.flush();

  // Boot the real server in Firestore mode against that fake cloud.
  process.env.DB_DRIVER = 'firestore';
  const { start } = require('../server_npmfree');
  const srv = await start(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const prods = await (await fetch(`${base}/api/products`)).json();
    assert.strictEqual(prods.length, 2, 'active list excludes inactive AND nulled-status products');
    assert.ok(!prods.some((p) => p.name === 'Nulled Status'), 'nulled-status product must not be active');
    assert.strictEqual(prods[0].name, 'Butterscotch Sauce');

    const inv = await (await fetch(`${base}/api/inventory`)).json();
    assert.strictEqual(inv.locations.length, 2);
    const bs = inv.items.find((i) => i.product.name === 'Butterscotch Sauce');
    assert.strictEqual(bs.total, 80);
    assert.deepStrictEqual(bs.locations, { Main: 50, Backup: 30 });

    // Migrated admin logs in (users hydrated from the cloud).
    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    assert.strictEqual(loginRes.status, 200);
    const token = (await loginRes.json()).token;

    // A stock-in movement with a NULL src_location survives the round-trip
    // as null on the wire (sanitized to '' in storage, normalized on read).
    const mv = await (await fetch(`${base}/api/stock-movements`)).json();
    assert.strictEqual(mv[0].src_location, null);
    assert.strictEqual(mv[0].notes, 'restock');

    const al = await (await fetch(`${base}/api/alerts`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    assert.strictEqual(al[0].product_name, 'Butterscotch Sauce');
    assert.strictEqual(al[0].resolved_at, null);
  } finally {
    srv.close();
    process.env.DB_DRIVER = 'json';
  }
});

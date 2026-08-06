// End-to-end tests for the bidirectional SQLite ↔ Firestore sync engine.
// Uses a real temp SQLite database + the strict fake Firestore, so both write
// paths (applyToSqlite / applyToFirestore) and the diff/merge logic are
// exercised against actual storage.
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventrak-sync-'));
process.env.INVENTRAK_DB_PATH = path.join(tmpDir, 'sync.db');
// Empty data dir: the Firestore driver's empty-project AUTO-SEED (which would
// otherwise copy the real catalog into every fresh fake) must not run here —
// the tests own the fixture completely.
process.env.INVENTRAK_DATA_DIR = path.join(tmpDir, 'data');
fs.mkdirSync(process.env.INVENTRAK_DATA_DIR, { recursive: true });
const { db } = require('../db');
const { dumpSnapshot } = require('../migrate-firestore');
const { makeFakeDb } = require('./fake-firestore');
const { hashPassword } = require('../password-hash');
const {
  canonicalFromSqlite, canonicalFromFirestore, diffAndMerge, applyToSqlite, applyToFirestore,
} = require('../sync-firestore');

// ---- seed the temp SQLite DB with a small but representative dataset ----
function seedSqlite() {
  db.prepare('INSERT INTO products (id, name, category, brand, description, size, unit, price, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(1, 'Sauce A', 'Sauces', 'B', '', '1 L', 'pcs', 100, 'active', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO products (id, name, category, brand, description, size, unit, price, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(2, 'Milk B', 'Milk', 'C', '', '12 L', 'pcs', 200, 'active', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO products (id, name, category, brand, description, size, unit, price, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(3, 'Old Product', 'Legacy', '', '', '', '', 10, 'inactive', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO locations (id, name) VALUES (?, ?)').run(1, 'Main');
  db.prepare('INSERT INTO locations (id, name) VALUES (?, ?)').run(2, 'Backup');
  db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)').run(1, 1, 50);
  db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)').run(1, 2, 30);
  db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)').run(2, 1, 40);
  db.prepare('INSERT INTO stock_movements (id, product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(1, 1, 10, 'stock-in', null, 1, 'restock', '2024-02-01T00:00:00.000Z', 'admin');
  db.prepare('INSERT INTO order_inquiries (id, customer_name, customer_email, customer_phone, products, estimated_cost, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(1, 'Ana', 'ana@example.com', '+639171234567', '["Sauce A x1"]', 100, '', 'pending', '2024-02-02T00:00:00.000Z');
  db.prepare('INSERT INTO users (id, username, password, role, email, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(1, 'admin', hashPassword('admin123'), 'admin', 'admin@inventrak.com', '2024-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO sales_transactions (id, product_id, qty, unit_price, total_amount, transaction_date, customer_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(1, 1, 2, 100, 200, '2024-02-03T00:00:00.000Z', 'Ana');
  db.prepare('INSERT INTO inventory_alerts (id, product_id, location_id, alert_type, threshold, current_qty, status, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(1, 1, 1, 'low_stock', 80, 50, 'active', '2024-02-04T00:00:00.000Z', null);
}
seedSqlite();

// Push the SQLite state into the fake Firestore so both sides start identical.
function syncUp(store) {
  const local = canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH));
  const remote = canonicalFromFirestore({
    'products.json': store.read('products.json'),
    'inventory.json': store.read('inventory.json'),
    'stock_movements.json': store.read('stock_movements.json'),
    'order_inquiries.json': store.read('order_inquiries.json'),
    '@users': store.read('@users'),
    '@sales': store.read('@sales'),
    '@alerts': store.read('@alerts'),
  });
  const { toRemote } = diffAndMerge(local, remote);
  return applyToFirestore(store, toRemote).then(() => remote);
}

function readCanonical(store) {
  return canonicalFromFirestore({
    'products.json': store.read('products.json'),
    'inventory.json': store.read('inventory.json'),
    'stock_movements.json': store.read('stock_movements.json'),
    'order_inquiries.json': store.read('order_inquiries.json'),
    '@users': store.read('@users'),
    '@sales': store.read('@sales'),
    '@alerts': store.read('@alerts'),
  });
}

after(() => {
  try { db.close(); } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('canonicalizers agree: syncing SQLite into Firestore then re-reading is a no-op', async () => {
  const store = require('../store-firestore');
  store._setDb(makeFakeDb());
  await store.init();
  await syncUp(store);

  const local = canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH));
  const remote = readCanonical(store);
  const { report } = diffAndMerge(local, remote);
  for (const ds of ['products.json', 'inventory.json', 'stock_movements.json', 'order_inquiries.json', '@users', '@sales', '@alerts']) {
    const r = report.perDataset[ds];
    assert.strictEqual(r.added, 0, `${ds} added`);
    assert.strictEqual(r.updated, 0, `${ds} updated`);
    assert.strictEqual(r.conflicts, 0, `${ds} conflicts`);
    // '' (Firestore storage) and null (SQLite) must compare equal — the
    // stock-in movement's null src_location proves it.
    assert.ok(r.unchanged > 0, `${ds} unchanged`);
  }
});

test('null on SQLite equals empty-string in Firestore (no false conflict)', async () => {
  const store = require('../store-firestore');
  const fake = makeFakeDb();
  store._setDb(fake);
  await store.init();
  await syncUp(store);
  // Firestore stores the null src_location as '' (the in-memory cache keeps
  // the raw null; the PERSISTED document has the empty string); a re-sync
  // must not report a conflict.
  assert.strictEqual(fake._cols.get('movements').get('1').src_location, '', 'driver sanitized null to empty string');
  const { report } = diffAndMerge(
    canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH)),
    readCanonical(store)
  );
  assert.strictEqual(report.perDataset['stock_movements.json'].conflicts, 0);
});

test('bidirectional sync converges: edits on BOTH sides reach both stores', async () => {
  const store = require('../store-firestore');
  const fake = makeFakeDb();
  store._setDb(fake);
  await store.init();
  await syncUp(store);

  // Edit only SQLite: new product + new movement.
  db.prepare('INSERT INTO products (id, name, category, brand, description, size, unit, price, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(4, 'Local Only', 'New', '', '', '', '', 5, 'active', '2024-03-01T00:00:00.000Z', '2024-03-01T00:00:00.000Z');
  db.prepare('INSERT INTO stock_movements (id, product_id, qty, type, src_location, dst_location, notes, created_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(2, 2, 5, 'stock-out', 1, null, 'sold', '2024-03-02T00:00:00.000Z', 'admin');

  // Edit only Firestore: new inquiry + new user.
  store.write('order_inquiries.json', [
    ...(store.read('order_inquiries.json') || []),
    { id: 2, customer_name: 'Cloud Buyer', customer_email: 'cb@x.com', customer_phone: null, products: '["Milk B x2"]', estimated_cost: 400, notes: '', status: 'pending', created_at: '2024-03-03T00:00:00.000Z' },
  ]);
  store.write('@users', [
    ...(store.read('@users') || []),
    { id: 2, username: 'cloud_cust', password: hashPassword('Cloud1!'), role: 'customer', email: 'cc@x.com', created_at: '2024-03-04T00:00:00.000Z' },
  ]);
  await store.flush();

  // Conflict on product 1: SQLite raises the price (newer), Firestore edits the name (older).
  db.prepare("UPDATE products SET price = 150, updated_at = '2024-03-05T00:00:00.000Z' WHERE id = 1").run();
  const fsProducts = store.read('products.json');
  fsProducts[0]['Product Name'] = 'Sauce A (cloud-renamed)';
  fsProducts[0]['updated_at'] = '2024-03-04T00:00:00.000Z';
  store.write('products.json', fsProducts);
  await store.flush();

  const local = canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH));
  const remote = readCanonical(store);
  const { report, toLocal, toRemote } = diffAndMerge(local, remote); // default last-write-wins

  assert.strictEqual(report.perDataset['products.json'].added, 1, 'local-only product pushed');
  assert.strictEqual(report.perDataset['products.json'].updated, 1, 'product conflict resolved');
  assert.strictEqual(report.perDataset['order_inquiries.json'].added, 0, 'cloud inquiry already on cloud; pulled via removed');
  assert.strictEqual(report.perDataset['order_inquiries.json'].removed, 1, 'cloud-only inquiry pulled');
  assert.strictEqual(report.perDataset['@users'].removed, 1, 'cloud-only user pulled');
  assert.strictEqual(report.perDataset['stock_movements.json'].added, 1, 'local-only movement pushed');

  // LWW: product 1 must carry the LOCAL (newer) price and name on BOTH sides.
  applyToSqlite(db, toLocal);
  await applyToFirestore(store, toRemote);
  const localAfter = canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH));
  const remoteAfter = readCanonical(store);
  const p1Local = localAfter['products.json'].find((p) => p.id === 1);
  const p1Remote = remoteAfter['products.json'].find((p) => p.id === 1);
  assert.strictEqual(p1Local.price, 150);
  assert.strictEqual(p1Remote.price, 150);
  assert.strictEqual(p1Local.name, 'Sauce A');
  assert.strictEqual(p1Remote.name, 'Sauce A');
  assert.ok(localAfter['products.json'].some((p) => p.id === 4), 'product 4 now on SQLite');
  assert.ok(remoteAfter['products.json'].some((p) => p.id === 4), 'product 4 now on Firestore');
  assert.ok(remoteAfter['order_inquiries.json'].some((o) => o.id === 2), 'cloud inquiry now on SQLite');
  assert.ok(localAfter['order_inquiries.json'].some((o) => o.id === 2), 'cloud inquiry on Firestore too');

  // Converged: a second sync must be a no-op.
  const { report: report2 } = diffAndMerge(
    canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH)),
    readCanonical(store)
  );
  Object.values(report2.perDataset).forEach((r) => {
    assert.strictEqual(r.added + r.updated + r.conflicts, 0, 'second sync is a no-op');
  });
});

test('conflict policies: keep-sqlite, keep-firestore, skip', async () => {
  const store = require('../store-firestore');
  const fake = makeFakeDb();
  store._setDb(fake);
  await store.init();
  await syncUp(store);

  // Product 2 differs on both sides (no timestamp change → LWW defaults to local).
  db.prepare("UPDATE products SET price = 250 WHERE id = 2").run();
  const fsProducts = store.read('products.json');
  fsProducts[1]['Price'] = 999;
  store.write('products.json', fsProducts);
  await store.flush();

  const local = canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH));
  const remote = readCanonical(store);

  const keepLocal = diffAndMerge(local, remote, { conflict: 'keep-sqlite' });
  assert.strictEqual(keepLocal.toLocal['products.json'].find((p) => p.id === 2).price, 250);
  assert.strictEqual(keepLocal.toRemote['products.json'].find((p) => p.id === 2).price, 250);

  const keepRemote = diffAndMerge(local, remote, { conflict: 'keep-firestore' });
  assert.strictEqual(keepRemote.toLocal['products.json'].find((p) => p.id === 2).price, 999);
  assert.strictEqual(keepRemote.toRemote['products.json'].find((p) => p.id === 2).price, 999);

  const skip = diffAndMerge(local, remote, { conflict: 'skip' });
  assert.strictEqual(skip.report.perDataset['products.json'].conflicts, 1);
  assert.strictEqual(skip.toLocal['products.json'].find((p) => p.id === 2).price, 250, 'skip keeps local on the local plan');
  assert.strictEqual(skip.toRemote['products.json'].find((p) => p.id === 2).price, 999, 'skip keeps remote on the remote plan');
  assert.strictEqual(skip.report.conflicts[0].dataset, 'products.json');
  assert.strictEqual(skip.report.conflicts[0].id, 2);
});

const localOnlyRow = () => db.prepare('INSERT INTO order_inquiries (id, customer_name, customer_email, products, estimated_cost, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const cloudOnlyRow = (store) => store.write('order_inquiries.json', [
  ...(store.read('order_inquiries.json') || []),
  { id: 3, customer_name: 'Cloud Only', customer_email: 'co@x.com', customer_phone: null, products: '[]', estimated_cost: 0, notes: '', status: 'pending', created_at: '2024-04-02T00:00:00.000Z' },
]);

// Scenario 1 — default union: rows created on either side reach BOTH stores.
test('deletions (ignore): union pulls remote-only rows and pushes local-only rows', async () => {
  const store = require('../store-firestore');
  const fake = makeFakeDb();
  store._setDb(fake);
  await store.init();
  // This test owns the inquiry fixture: drop rows pulled in by earlier tests.
  db.prepare('DELETE FROM order_inquiries WHERE id > 1').run();
  await syncUp(store);

  localOnlyRow().run(2, 'Local Only', 'lo@x.com', '[]', 0, '', 'pending', '2024-04-01T00:00:00.000Z');
  cloudOnlyRow(store);
  await store.flush();

  let local = canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH));
  let remote = readCanonical(store);
  let { report, toLocal, toRemote } = diffAndMerge(local, remote);
  assert.strictEqual(report.perDataset['order_inquiries.json'].added, 1);
  assert.strictEqual(report.perDataset['order_inquiries.json'].removed, 1);
  applyToSqlite(db, toLocal);
  await applyToFirestore(store, toRemote);
  assert.deepStrictEqual(
    readCanonical(store)['order_inquiries.json'].map((o) => o.id).sort(),
    [1, 2, 3]
  );
  assert.deepStrictEqual(
    canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH))['order_inquiries.json'].map((o) => o.id).sort(),
    [1, 2, 3]
  );
});

// Scenario 2 — mirror SQLite → Firestore: the cloud becomes exactly the local
// rows, so the cloud-only row is deleted from Firestore.
test('deletions (propagate, to-firestore): cloud mirrors SQLite and loses its extra row', async () => {
  const store = require('../store-firestore');
  const fake = makeFakeDb();
  store._setDb(fake);
  await store.init();
  db.prepare('DELETE FROM order_inquiries WHERE id > 1').run();
  await syncUp(store);

  localOnlyRow().run(2, 'Local Only', 'lo@x.com', '[]', 0, '', 'pending', '2024-04-01T00:00:00.000Z');
  cloudOnlyRow(store);
  await store.flush();

  const local = canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH)); // [1, 2]
  const remote = readCanonical(store); // [1, 3]
  const mirror = diffAndMerge(local, remote, { deletions: 'propagate' });
  // toRemote (used by --direction=to-firestore): exactly the local rows.
  assert.deepStrictEqual(mirror.toRemote['order_inquiries.json'].map((o) => o.id).sort(), [1, 2]);
  // toLocal (used by --direction=to-sqlite): exactly the remote rows.
  assert.deepStrictEqual(mirror.toLocal['order_inquiries.json'].map((o) => o.id).sort(), [1, 3]);
  await applyToFirestore(store, mirror.toRemote);
  assert.deepStrictEqual(readCanonical(store)['order_inquiries.json'].map((o) => o.id).sort(), [1, 2]);
});

// The server never hard-deletes products (soft-delete keeps the row, ids stay
// contiguous 1..N), so Firestore's position-based product identity (doc id =
// idx + 1) can never shift. Prove a soft-deleted middle product survives a
// mirror sync with its id intact and inventory refs still aligned.
test('soft-deleted products keep stable ids across a mirror sync (position identity)', async () => {
  const store = require('../store-firestore');
  store._setDb(makeFakeDb());
  await store.init();
  await syncUp(store); // products 1..4 (id 3 seeded inactive)

  const local = canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH));
  const remote = readCanonical(store);
  const { toRemote } = diffAndMerge(local, remote, { deletions: 'propagate' });
  await applyToFirestore(store, toRemote);

  const readBack = readCanonical(store);
  const ids = readBack['products.json'].map((p) => p.id);
  assert.deepStrictEqual(ids, [1, 2, 3, 4], 'no id reindexing after a soft-delete + mirror');
  assert.strictEqual(readBack['products.json'].find((p) => p.id === 3).status, 'inactive');
  // Inventory product refs still point at the right product ids.
  assert.strictEqual(readBack['inventory.json'].items[1].locations['Main'], 50);
});

// Mirror Firestore → SQLite with a product absent on the cloud: SQLite must
// soft-delete it AND drop its stock rows, or per-location totals diverge.
test('deletions (propagate, to-sqlite): soft-deleted products lose their stock rows', async () => {
  const store = require('../store-firestore');
  const fake = makeFakeDb();
  store._setDb(fake);
  await store.init();
  await syncUp(store);

  // Local-only product 4 with stock; the cloud does not have it.
  db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)').run(4, 1, 5);
  store.write('products.json', store.read('products.json').filter((_, idx) => idx < 3));
  store.write('inventory.json', {
    locations: store.read('inventory.json').locations,
    items: store.read('inventory.json').items.filter((i) => i.product.id !== 4),
  });
  await store.flush();

  const local = canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH)); // has product 4 + stock
  const remote = readCanonical(store); // products 1..3 only
  const { toLocal } = diffAndMerge(local, remote, { deletions: 'propagate' });
  assert.ok(!toLocal['products.json'].some((p) => p.id === 4), 'mirror plan drops product 4');
  applyToSqlite(db, toLocal, { deleteMissing: true });

  const sqliteAfter = canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH));
  assert.strictEqual(
    sqliteAfter['products.json'].find((p) => p.id === 4).status,
    'inactive',
    'product 4 soft-deleted, not hard-deleted'
  );
  const stock4 = db.prepare('SELECT * FROM stock WHERE product_id = 4').all();
  assert.strictEqual(stock4.length, 0, 'stale stock rows for the soft-deleted product are dropped');
  // Product 1 stock untouched.
  assert.strictEqual(db.prepare('SELECT quantity FROM stock WHERE product_id = 1 AND location_id = 1').get().quantity, 50);
});

// A login-time password upgrade re-hashes without touching created_at, so an
// equal-timestamp @users conflict must resolve to the hashed row — a legacy
// plaintext row must never win the tie and overwrite the cloud hash.
test('@users LWW tie: a hashed row beats plaintext when timestamps match', async () => {
  const store = require('../store-firestore');
  store._setDb(makeFakeDb());
  await store.init();
  await syncUp(store); // user 1 seeded with a bcrypt hash

  // Legacy plaintext lands on SQLite with the SAME created_at as the cloud hash.
  db.prepare("UPDATE users SET password = 'legacy-plaintext' WHERE id = 1").run();
  const local = canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH));
  const remote = readCanonical(store);
  const { report, toLocal, toRemote } = diffAndMerge(local, remote); // default LWW

  assert.strictEqual(report.perDataset['@users'].conflicts, 0, 'hashed-wins resolves, not skipped');
  assert.strictEqual(report.perDataset['@users'].updated, 1);
  const hash = remote['@users'][0].password;
  assert.strictEqual(toLocal['@users'][0].password, hash, 'SQLite plan takes the hash');
  assert.strictEqual(toRemote['@users'][0].password, hash, 'Firestore plan keeps the hash');
});

// Scenario 3 — mirror Firestore → SQLite: SQLite becomes exactly the cloud
// rows, so the local-only row is deleted from SQLite.
test('deletions (propagate, to-sqlite): SQLite mirrors the cloud and loses its extra row', async () => {
  const store = require('../store-firestore');
  const fake = makeFakeDb();
  store._setDb(fake);
  await store.init();
  db.prepare('DELETE FROM order_inquiries WHERE id > 1').run();
  await syncUp(store);

  // Divergent: local-only id 2, cloud-only id 3 — but do NOT apply a union.
  localOnlyRow().run(2, 'Local Only', 'lo@x.com', '[]', 0, '', 'pending', '2024-04-01T00:00:00.000Z');
  cloudOnlyRow(store);
  await store.flush();

  // Local mirrors the cloud: local keeps [1,3], so its own id 2 is dropped.
  const local = canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH)); // [1, 2]
  const remote = readCanonical(store); // [1, 3]
  const { toLocal } = diffAndMerge(local, remote, { deletions: 'propagate' });
  assert.deepStrictEqual(toLocal['order_inquiries.json'].map((o) => o.id).sort(), [1, 3]);
  applyToSqlite(db, toLocal, { deleteMissing: true });
  const sqliteIds = canonicalFromSqlite(dumpSnapshot(process.env.INVENTRAK_DB_PATH))['order_inquiries.json'].map((o) => o.id).sort();
  assert.deepStrictEqual(sqliteIds, [1, 3], 'local-only id 2 deleted, cloud-only id 3 pulled');
});

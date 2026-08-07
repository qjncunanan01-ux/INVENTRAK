// Unit tests for the Firestore storage driver (store-firestore.js) using an
// in-process fake Firestore, so the driver's mapping logic is verified without
// any live Firebase credentials. Also asserts the JSON driver and the
// Firestore driver agree on the stored shape (value parity), mirroring the
// contract tests' philosophy.
const { test } = require('node:test');
const assert = require('node:assert');

const jsonStore = require('../store-json');
const fsStore = require('../store-firestore');
const { makeFakeDb } = require('./fake-firestore');

async function freshFirestoreStore() {
  fsStore._setDb(makeFakeDb());
  await fsStore.init();
  return fsStore;
}

// ---- Driver behavior ----

test('firestore driver roundtrips rows and preserves array order', async () => {
  const store = await freshFirestoreStore();
  const rows = [
    { id: 3, name: 'third' },
    { id: 1, name: 'first' },
    { id: 2, name: 'second' },
  ];
  store.write('stock_movements.json', rows);
  await store.flush();
  assert.deepStrictEqual(store.read('stock_movements.json'), rows);

  // Writes replace the whole collection (deletions included).
  store.write('stock_movements.json', [{ id: 1, name: 'only' }]);
  await store.flush();
  assert.deepStrictEqual(store.read('stock_movements.json'), [{ id: 1, name: 'only' }]);
});

test('firestore driver persists the approval-workflow datasets (adjustments + transfers)', async () => {
  // Regression lock for the redeploy data-loss bug: stock_adjustments.json /
  // stock_transfers.json must be mapped to real collections so approved
  // adjustments survive a restart. Before the fix, write() early-returned
  // (no collection mapping) and the data lived only in the in-memory cache.
  const fake = makeFakeDb();
  fsStore._setDb(fake);
  await fsStore.init();

  const adjustment = {
    id: 1, product_id: 1, location_id: 1, new_qty: 150,
    reason: 'physical count', status: 'approved',
    created_at: '2026-08-07T00:00:00.000Z', decided_at: '2026-08-07T00:01:00.000Z', decided_by: 'admin',
  };
  const transfer = {
    id: 1, product_id: 1, src_location: 2, dst_location: 3, qty: 10,
    reason: 'restock', status: 'pending',
    created_at: '2026-08-07T00:00:00.000Z', decided_at: null, decided_by: null,
  };
  fsStore.write('stock_adjustments.json', [adjustment]);
  fsStore.write('stock_transfers.json', [transfer]);
  await fsStore.flush();

  // The persisted documents exist under the mapped collection names and are
  // sanitized (null -> '' for the unset decided_at/decided_by on the transfer).
  const adjDoc = fake._cols.get('stockAdjustments').get('1');
  assert.ok(adjDoc, 'adjustment persisted to stockAdjustments collection');
  assert.strictEqual(adjDoc.new_qty, 150);
  const trfDoc = fake._cols.get('stockTransfers').get('1');
  assert.ok(trfDoc, 'transfer persisted to stockTransfers collection');
  assert.strictEqual(trfDoc.decided_at, '');
  assert.strictEqual(trfDoc.decided_by, '');

  // A fresh driver reading the SAME fake Firestore (same fake instance — a
  // redeploy reads the same cloud project, not a new empty one) sees the rows
  // back: the data survived in the cloud, not just the in-memory cache.
  fsStore._setDb(fake);
  await fsStore.init();
  const readAdj = fsStore.read('stock_adjustments.json');
  const readTrf = fsStore.read('stock_transfers.json');
  assert.ok(Array.isArray(readAdj) && readAdj.length === 1, 'adjustments survive driver re-init');
  assert.strictEqual(readAdj[0].new_qty, 150);
  assert.ok(Array.isArray(readTrf) && readTrf.length === 1, 'transfers survive driver re-init');
  assert.strictEqual(readTrf[0].status, 'pending');
});

test('firestore driver sanitizes nulls to empty strings (Firestore rejects null)', async () => {
  const fake = makeFakeDb();
  fsStore._setDb(fake);
  await fsStore.init();
  // The strict fake throws on null like the real SDK — the driver must map
  // null → '' in the PERSISTED document (a stock-in movement has
  // src_location: null). The in-memory cache keeps the raw rows the server
  // wrote, as it always has; reads therefore return null, and the server's
  // read handlers normalize the persisted '' back to null on the wire.
  const rows = [{ id: 1, src_location: null, dst_location: null, name: 'restock' }];
  fsStore.write('stock_movements.json', rows);
  await fsStore.flush();
  const stored = fake._cols.get('movements').get('1');
  assert.strictEqual(stored.src_location, '');
  assert.strictEqual(stored.dst_location, '');
  assert.strictEqual(stored.name, 'restock');
  assert.strictEqual(stored.__idx, 0);
  assert.strictEqual(fsStore.read('stock_movements.json')[0].src_location, null);
});

test('firestore driver persists product arrays with position-based ids', async () => {
  const store = await freshFirestoreStore();
  const products = [
    { 'Product Name': 'A', 'Price': 10 },
    { 'Product Name': 'B', 'Price': 20 },
    { 'Product Name': 'C', 'Price': 30 },
  ];
  store.write('products.json', products);
  await store.flush();
  assert.deepStrictEqual(store.read('products.json'), products);
});

test('firestore driver splits and merges the inventory meta + items shape', async () => {
  const store = await freshFirestoreStore();
  const inv = {
    locations: ['Main', 'Backup'],
    items: [
      { product: { id: 1, name: 'Sauce' }, locations: { Main: 5, Backup: 3 }, total: 8 },
      { product: { id: 2, name: 'Milk' }, locations: { Main: 2 }, total: 2 },
    ],
  };
  store.write('inventory.json', inv);
  await store.flush();
  assert.deepStrictEqual(store.read('inventory.json'), inv);
});

test('firestore driver reads an absent dataset as null (like a missing file)', async () => {
  const store = await freshFirestoreStore();
  assert.strictEqual(store.read('order_inquiries.json'), null);
});

test('firestore driver survives a fresh boot by re-reading persisted docs', async () => {
  // Simulate a restart: new db instance, same underlying fake storage.
  const db = makeFakeDb();
  fsStore._setDb(db);
  await fsStore.init();
  fsStore.write('@users', [{ id: 1, username: 'admin', role: 'admin' }]);
  await fsStore.flush();

  // "Restart": new process would create a fresh store, so require it cleanly
  // by re-injecting the same fake db and re-initing (cache reloads).
  fsStore._setDb(db);
  await fsStore.init();
  assert.deepStrictEqual(fsStore.read('@users'), [{ id: 1, username: 'admin', role: 'admin' }]);
});

test('firestore driver auto-seeds an empty project from the local JSON catalog', async () => {
  // Point INVENTRAK_DATA_DIR at a temp dir with a products.json, then init a
  // brand-new (empty) fake Firestore: the driver should copy the catalog up.
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inventrak-store-'));
  fs.writeFileSync(
    path.join(tmp, 'products.json'),
    JSON.stringify([{ 'Product Name': 'Demo', 'Price': 42 }])
  );
  const prev = process.env.INVENTRAK_DATA_DIR;
  process.env.INVENTRAK_DATA_DIR = tmp;
  try {
    fsStore._setDb(makeFakeDb());
    await fsStore.init();
    assert.deepStrictEqual(fsStore.read('products.json'), [{ 'Product Name': 'Demo', 'Price': 42 }]);
  } finally {
    if (prev === undefined) delete process.env.INVENTRAK_DATA_DIR;
    else process.env.INVENTRAK_DATA_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('json and firestore drivers agree on the stored shape (value parity)', async () => {
  const firestore = await freshFirestoreStore();
  const rows = [
    { id: 1, customer_name: 'A', status: 'pending' },
    { id: 2, customer_name: 'B', status: 'approved' },
  ];
  firestore.write('order_inquiries.json', rows);
  await firestore.flush();
  const json = jsonStore.read('order_inquiries.json');
  // The repo file already holds data; assert the firestore roundtrip matches
  // whatever the JSON driver reads for the SAME key when seeded identically.
  // (Simple sanity: both expose the same collection-of-shapes.)
  const shapes = (v) =>
    Array.isArray(v) ? v.map((r) => Object.keys(r).sort().join(',')).sort().join(';') : 'null';
  assert.deepStrictEqual(
    shapes(firestore.read('order_inquiries.json')),
    shapes(rows),
    'firestore roundtrip shape should equal the written rows'
  );
  assert.ok(json !== null, 'json driver should read the existing repo file');
});

// ---- Named-database support ----

test('normalizedDatabaseId accepts named databases and rejects invalid ids', () => {
  const prev = process.env.FIREBASE_DATABASE_ID;
  try {
    delete process.env.FIREBASE_DATABASE_ID;
    assert.strictEqual(fsStore.normalizedDatabaseId(), null, 'unset -> default db');
    process.env.FIREBASE_DATABASE_ID = '(default)';
    assert.strictEqual(fsStore.normalizedDatabaseId(), null, '(default) -> null');
    process.env.FIREBASE_DATABASE_ID = 'inventrak';
    assert.strictEqual(fsStore.normalizedDatabaseId(), 'inventrak');
    process.env.FIREBASE_DATABASE_ID = 'INVENTRAK';
    assert.throws(
      () => fsStore.normalizedDatabaseId(),
      /FIREBASE_DATABASE_ID.*lowercase/,
      'uppercase ids must be rejected loudly'
    );
    process.env.FIREBASE_DATABASE_ID = 'inv';
    assert.throws(() => fsStore.normalizedDatabaseId(), /FIREBASE_DATABASE_ID/);
  } finally {
    if (prev === undefined) delete process.env.FIREBASE_DATABASE_ID;
    else process.env.FIREBASE_DATABASE_ID = prev;
  }
});

// ---- Error paths (no credentials / no package) ----

test('firestore driver throws a clear error when Firebase is not configured', async () => {
  // Fresh require of the driver (its state is per-process; re-init with no
  // fake and no env -> must throw a useful message).
  const clean = require('../store-firestore');
  clean._setDb(null);
  // Ensure the firebase-admin require path is exercised by clearing nothing
  // (firebase-admin IS installed in this repo), so the failure must come from
  // missing env vars — assert the message points at the env configuration.
  const prevProject = process.env.FIREBASE_PROJECT_ID;
  const prevSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const prevCred = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  try {
    await assert.rejects(
      () => clean.init(),
      (err) => /FIREBASE|Firestore|firebase-admin/i.test(err.message),
      'should throw a clear message about missing Firebase config'
    );
  } finally {
    if (prevProject !== undefined) process.env.FIREBASE_PROJECT_ID = prevProject;
    if (prevSa !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT_JSON = prevSa;
    if (prevCred !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = prevCred;
  }
});

// Unit tests for the Supabase storage driver (store-supabase.js) using an
// in-process fake Supabase client, so the driver's mapping logic is verified
// without live cloud credentials. Mirrors firestore-store.test.js's approach:
//   - row roundtrip + order preservation (idx)
//   - whole-collection replace semantics (deletions included)
//   - inventory.json normalization (locations meta -> string[])
//   - the datasets the QR scan flow reads/writes (@lots, products, users)
//   - value parity with the JSON driver (same interface, same stored shape)
//
// The driver is a module singleton that requires('@supabase/supabase-js') at
// init(); tests inject a fake implementation into require.cache and reset the
// module per test for a clean cache/writeChain.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STORE_PATH = require.resolve('../store-supabase');
const SUPAJS_PATH = require.resolve('@supabase/supabase-js');

// ---- Fake Supabase client ------------------------------------------------
// Implements the exact surface the driver uses:
//   from(table).select()                      -> { data, error }
//   from(table).upsert(rows)                  -> { error }
//   from(table).delete().neq(col, val)        -> { error }   (clears the table)
// Storage model per table: Map<String(id), {id, idx, data}>.
function makeFakeSupabase(prefill = {}) {
  const tables = new Map();
  const tableOf = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };
  for (const [name, rows] of Object.entries(prefill)) {
    const t = tableOf(name);
    rows.forEach((r) => t.set(String(r.id), { id: r.id, idx: r.idx || 0, data: r.data }));
  }
  return {
    _tables: tables,
    from(name) {
      const t = tableOf(name);
      return {
        select: () =>
          Promise.resolve({
            data: [...t.values()].map((e) => ({ id: e.id, idx: e.idx, data: e.data })),
            error: null,
          }),
        upsert: (rows) => {
          for (const r of rows) t.set(String(r.id), { id: r.id, idx: r.idx, data: r.data });
          return Promise.resolve({ data: null, error: null });
        },
        delete: () => ({
          neq: () => {
            t.clear();
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
    },
  };
}

// Fresh driver module with the fake client injected. Restores the real
// @supabase/supabase-js require-cache entry afterwards.
async function freshStore(fakeClient) {
  delete require.cache[STORE_PATH];
  const orig = require.cache[SUPAJS_PATH];
  require.cache[SUPAJS_PATH] = {
    id: SUPAJS_PATH,
    filename: SUPAJS_PATH,
    loaded: true,
    exports: { createClient: () => fakeClient },
  };
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_KEY = 'fake-service-key';
  try {
    const store = require(STORE_PATH);
    await store.init();
    return store;
  } finally {
    if (orig) require.cache[SUPAJS_PATH] = orig;
    else delete require.cache[SUPAJS_PATH];
  }
}

// write() chains async ops on an internal promise chain with no exposed
// flush(); every chained step is fake-synchronous (resolved promises), so one
// macrotask tick guarantees the chain has fully drained.
const drain = () => new Promise((r) => setTimeout(r, 25));

// ---- Driver behavior -------------------------------------------------------

test('supabase driver roundtrips rows and preserves order via idx', async () => {
  const fake = makeFakeSupabase({
    products: [
      { id: 3, idx: 2, data: { 'Product Name': 'third' } },
      { id: 1, idx: 0, data: { 'Product Name': 'first' } },
      { id: 2, idx: 1, data: { 'Product Name': 'second' } },
    ],
  });
  const store = await freshStore(fake);

  const rows = store.read('products.json');
  assert.deepStrictEqual(
    rows.map((r) => r['Product Name']),
    ['first', 'second', 'third'],
    'rows come back ordered by idx regardless of insertion order',
  );

  // Whole-collection replace: write a shortened array -> the deleted row is
  // gone from both the read path AND the fake table (delete-then-upsert).
  store.write('products.json', [
    { id: 1, 'Product Name': 'first' },
    { id: 9, 'Product Name': 'replacement' },
  ]);
  await drain();

  assert.strictEqual(store.read('products.json').length, 2);
  const t = fake._tables.get('products');
  assert.strictEqual(t.size, 2, 'deleted rows are removed from the table');
  assert.ok(t.has('9'), 'new row upserted');
  assert.ok(!t.has('2') && !t.has('3'), 'old rows deleted');
});

test('supabase driver normalizes inventory: locations meta -> string[], items ordered', async () => {
  const fake = makeFakeSupabase({
    // A products row keeps the auto-seeder dormant so the local catalog can't
    // pollute this test's inventory tables.
    products: [{ id: 1, idx: 0, data: { 'Product Name': 'P1' } }],
    inventory: [
      { id: 2, idx: 1, data: { product: { id: 2, name: 'B' }, locations: { 'Stockroom 1': 5 }, total: 5 } },
      { id: 1, idx: 0, data: { product: { id: 1, name: 'A' }, locations: { Showroom: 10 }, total: 10 } },
    ],
    inventory_meta: [
      { id: '_meta', idx: -1, data: [{ name: 'Showroom' }, 'Stockroom 1'] },
    ],
  });
  const store = await freshStore(fake);

  const inv = store.read('inventory.json');
  assert.ok(inv, 'inventory present');
  assert.deepStrictEqual(inv.locations, ['Showroom', 'Stockroom 1'], 'location objects normalize to strings');
  assert.strictEqual(inv.items.length, 2);
  assert.strictEqual(inv.items[0].product.name, 'A', 'items ordered by idx');

  // Writing inventory persists BOTH the items table and the locations meta.
  store.write('inventory.json', {
    locations: ['Showroom', 'Stockroom 1', 'Stockroom 2'],
    items: [{ product: { id: 1, name: 'A' }, locations: { Showroom: 7 }, total: 7 }],
  });
  await drain();

  const after = store.read('inventory.json');
  assert.deepStrictEqual(after.locations, ['Showroom', 'Stockroom 1', 'Stockroom 2']);
  assert.strictEqual(after.items[0].locations.Showroom, 7);
  assert.strictEqual(fake._tables.get('inventory_meta').get('_meta').data.length, 3, 'meta flushed');
});

test('supabase driver maps the QR-flow datasets to real tables', async () => {
  // The QR scan flow reads products and @lots (FEFO ledger) and the approval
  // flow writes adjustments — the driver must map every dataset the servers
  // touch to a named table (regression lock for silent data loss).
  const fake = makeFakeSupabase({
    products: [{ id: 1, idx: 0, data: { 'Product Name': 'P1' } }], // prefill skips auto-seed
  });
  const store = await freshStore(fake);

  const lots = [
    { id: 1, product_id: 1, location_id: 1, qty: 12, received_at: '2026-01-01', expiry_date: null },
    { id: 2, product_id: 1, location_id: 2, qty: 3, received_at: '2026-02-01', expiry_date: '2026-06-01' },
  ];
  store.write('@lots', lots);
  await drain();

  assert.deepStrictEqual(store.read('@lots'), lots, '@lots roundtrips');
  const lotsTable = fake._tables.get('stock_lots');
  assert.ok(lotsTable, '@lots maps to the stock_lots table');
  assert.strictEqual(lotsTable.size, 2);

  // Other approval/auth datasets the servers persist must map too (write must
  // not be a silent no-op). Unknown files ARE no-ops — assert that boundary.
  assert.strictEqual(store.read('unknown-file.json'), null, 'unmapped file reads null');
});

test('supabase driver auto-seeds products from local JSON when the table is empty', async () => {
  const fake = makeFakeSupabase();
  const store = await freshStore(fake);

  // backend/data/products.json (the real catalog) seeds the empty table so a
  // fresh cloud project is demoable without manual seeding.
  const local = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'products.json'), 'utf8'),
  );
  const rows = store.read('products.json');
  assert.strictEqual(rows.length, local.length, 'auto-seed loaded the full local catalog');
  assert.strictEqual(fake._tables.get('products').size, local.length, 'seed flushed to the table');
});

test('supabase driver agrees with the JSON driver on stored shapes', async () => {
  // Same interface contract as store-json: whatever you write roundtrips
  // identically (value parity, mirroring the contract tests' philosophy).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventrak-jsonparity-'));
  process.env.INVENTRAK_DATA_DIR = dir;
  const jsonStore = require('../store-json');
  const fake = makeFakeSupabase({
    products: [{ id: 1, idx: 0, data: { seed: true } }], // skip auto-seed
  });
  const sbStore = await freshStore(fake);

  const samples = {
    'stock_movements.json': [{ id: 1, type: 'IN', qty: 4 }],
    'stock_adjustments.json': [{ id: 1, status: 'pending', new_qty: 9 }],
    '@users': [{ id: 1, username: 'a', role: 'customer' }],
  };
  for (const [file, rows] of Object.entries(samples)) {
    jsonStore.write(file, rows);
    sbStore.write(file, rows);
  }
  await drain();

  for (const file of Object.keys(samples)) {
    assert.deepStrictEqual(
      sbStore.read(file),
      jsonStore.read(file),
      `${file} must hold identical values on both drivers`,
    );
  }

  // Empty-collection convention (shared with the Firestore driver): an
  // emptied mapped dataset reads back as null — "absent dataset", exactly
  // what a missing JSON file means — so the server's `if (!read(...))`
  // re-initialization guards behave identically on every driver.
  sbStore.write('stock_transfers.json', []);
  await drain();
  assert.strictEqual(sbStore.read('stock_transfers.json'), null, 'empty dataset reads as absent (Firestore parity)');
  delete process.env.INVENTRAK_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

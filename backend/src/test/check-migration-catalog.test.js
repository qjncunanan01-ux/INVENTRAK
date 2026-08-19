// Tests for the CI catalog drift guard (scripts/check-migration-catalog.js):
// a fresh temp SQLite DB seeded from the committed catalog must reproduce the
// committed catalog through the migration transform — exactly what the
// `migration-catalog` CI job enforces. These tests prove the guard actually
// fires on real drift (tampered inventory, product missing from inventory).
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { checkCatalog } = require('../../scripts/check-migration-catalog');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventrak-catalog-check-'));

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Copy the committed catalog into an isolated temp data dir (optionally
// mutating it) so tests never depend on — or touch — the real files.
function makeDataDir(mutate) {
  const dir = path.join(tmpDir, `catalog-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['products.json', 'inventory.json', 'stock_movements.json', 'order_inquiries.json']) {
    fs.copyFileSync(path.join(DATA_DIR, f), path.join(dir, f));
  }
  if (mutate) mutate(dir);
  return dir;
}

const dbPathFor = (name) => path.join(tmpDir, `${name}-${Math.random().toString(36).slice(2)}.db`);

test('fresh seed + transform reproduces the committed catalog (the CI pass case)', () => {
  const result = checkCatalog({ dbPath: dbPathFor('pass'), dataDir: DATA_DIR });
  assert.strictEqual(result.ok, true, JSON.stringify(result.diffs));
  // committed products / inventory items, and the catalog datasets are clean.
  const expectedCount = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'products.json'), 'utf8')).length;
  assert.strictEqual(result.counts['products.json'], expectedCount);
  assert.strictEqual(result.counts['inventory.json'], expectedCount);
  assert.strictEqual(result.counts['stock_movements.json'], 0);
  assert.strictEqual(result.counts['order_inquiries.json'], 0);
});

test('tampering a committed inventory quantity fails the check', () => {
  const dataDir = makeDataDir((dir) => {
    const inv = JSON.parse(fs.readFileSync(path.join(dir, 'inventory.json'), 'utf8'));
    inv.items[0].locations['Showroom'] = 9999; // diverges from the deterministic seed draw
    fs.writeFileSync(path.join(dir, 'inventory.json'), JSON.stringify(inv, null, 2));
  });
  const result = checkCatalog({ dbPath: dbPathFor('inv'), dataDir });
  assert.strictEqual(result.ok, false);
  assert.ok(result.diffs.some((d) => d.dataset === 'inventory.json' && d.path.includes('Showroom')), JSON.stringify(result.diffs));
});

test('adding a product to products.json without an inventory entry fails the check', () => {
  const dataDir = makeDataDir((dir) => {
    const products = JSON.parse(fs.readFileSync(path.join(dir, 'products.json'), 'utf8'));
    products.push({ 'Product Name': 'Ghost Product', 'Category': 'Legacy', 'Size': '1 L', 'Price': 1 });
    fs.writeFileSync(path.join(dir, 'products.json'), JSON.stringify(products, null, 2));
    // inventory.json deliberately NOT updated — the migration would push a
    // product the committed inventory doesn't know about.
  });
  const result = checkCatalog({ dbPath: dbPathFor('product'), dataDir });
  assert.strictEqual(result.ok, false);
  // The transform emits an inventory item for EVERY product, so the ghost
  // product surfaces as an inventory.json items count mismatch (N+1 vs N).
  const expectedPlusOne = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'products.json'), 'utf8')).length + 1;
  assert.ok(
    result.diffs.some((d) => d.dataset === 'inventory.json' && d.path === '$.items' && d.actual === `array[${expectedPlusOne}]`),
    JSON.stringify(result.diffs)
  );
});

test('normalizeProductRow maps a sparse committed row to the transform shape', () => {
  const { normalizeProductRow } = require('../../scripts/check-migration-catalog');
  const sparse = { 'Product Name': 'Butterscotch Sauce', 'Category': 'Da Vinci Gourmet Sauces', 'Size': '2 L', 'Price': 1070 };
  const normalized = normalizeProductRow(sparse);
  assert.deepStrictEqual(normalized, {
    'Product Name': 'Butterscotch Sauce',
    'Category': 'Da Vinci Gourmet Sauces',
    'Brand': '',
    'Description': '',
    'Size': '2 L',
    'Unit': '',
    'Price': 1070,
    'Image': '',
  });
  assert.ok(!('status' in normalized), 'active products carry no status key');
  assert.strictEqual(normalizeProductRow({ ...sparse, status: 'inactive' }).status, 'inactive');
  // A row with an Image key maps it through unchanged (catalog products carry
  // '/images/<file>' paths that must survive the transform).
  assert.strictEqual(normalizeProductRow({ ...sparse, Image: '/images/butterscotch.jpg' }).Image, '/images/butterscotch.jpg');
});

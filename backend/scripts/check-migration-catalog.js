// Catalog drift guard for the SQLite → Firestore migration pipeline.
//
//   npm run migrate:check
//
// Seeds a FRESH temp SQLite database from the committed product catalog
// (backend/data/products.json) using the same deterministic seed as the live
// backend, then runs the exact pipeline `npm run migrate:firestore -- --dry-run`
// uses (dumpSnapshot → transformSnapshot) and asserts the transform output
// matches the committed catalog files (products.json, inventory.json,
// stock_movements.json, order_inquiries.json).
//
// Why: the migration push converts the SQLite database into the store-shaped
// datasets the npm-free server reads. If the transform or the seed silently
// drifts from the committed catalog (a dropped field, a changed stock draw, a
// re-keyed product), the dry-run counts still print happily — but a real
// migration would push wrong data to Firestore. This job makes that drift a
// build failure instead.
//
// Exits 0 on match, 1 on mismatch (prints the first divergent path + values).
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const SCHEMA = require('../src/schema');
const { seedDatabase } = require('../src/seed');
const { dumpSnapshot, transformSnapshot } = require('../src/migrate-firestore');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');

// --- canonicalization helpers (mirror the transform's output shapes) ---

// Committed products.json rows are sparse (e.g. only Category / Product Name /
// Size / Price). The transform emits every key. Normalize the committed row
// into the transform's exact output shape so the comparison is apples-to-apples.
function normalizeProductRow(p) {
  const out = {
    'Product Name': p['Product Name'] ?? p.name ?? '',
    'Category': p['Category'] ?? p.category ?? '',
    'Brand': p['Brand'] ?? p.brand ?? '',
    'Description': p['Description'] ?? p.description ?? '',
    'Size': p['Size'] ?? p.size ?? '',
    'Unit': p['Unit'] ?? p.unit ?? '',
    'Price': p['Price'] ?? p.price ?? 0,
    'Image': p['Image'] ?? p.image ?? '',
  };
  if (p.status && p.status !== 'active') out['status'] = p.status;
  return out;
}

// Inventory item products carry created_at/updated_at timestamps that are
// regenerated at seed time (datetime('now')) — the committed inventory.json
// holds the timestamps of the day it was last regenerated. Those are NOT part
// of the contract; strip them before comparing. Everything else (id, name,
// category, brand, description, size, unit, price, status, locations, total)
// must match exactly.
function stripVolatile(product) {
  const { created_at, updated_at, ...rest } = product || {};
  return rest;
}

function normalizeInventory(inv) {
  return {
    locations: inv.locations || [],
    items: (inv.items || []).map((it) => ({
      product: stripVolatile(it.product),
      locations: it.locations || {},
      total: it.total,
    })),
  };
}

// --- structural diff (reports the FIRST divergence with a path) ---

function firstDiff(a, b, p = '$') {
  if (a === b) return null;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return { path: p, expected: b, actual: a };
  }
  if (Array.isArray(a) !== Array.isArray(b)) return { path: p, expected: b, actual: a };
  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      return { path: p, expected: `array[${b.length}]`, actual: `array[${a.length}]` };
    }
    for (let i = 0; i < a.length; i += 1) {
      const d = firstDiff(a[i], b[i], `${p}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], `${p}.${k}`);
    if (d) return d;
  }
  return null;
}

// --- the check ---

// Seeds a fresh database at dbPath and compares the migration transform's
// output against the committed catalog in dataDir. Returns
// { ok, diffs: [{dataset, path, expected, actual}], counts: {dataset: n} }.
function checkCatalog({ dbPath, productsFile, dataDir = DEFAULT_DATA_DIR } = {}) {
  if (!dbPath) throw new Error('checkCatalog requires dbPath');
  const catalogProducts = path.join(dataDir, 'products.json');
  const catalogInventory = path.join(dataDir, 'inventory.json');
  const catalogMovements = path.join(dataDir, 'stock_movements.json');
  const catalogInquiries = path.join(dataDir, 'order_inquiries.json');
  for (const f of [catalogProducts, catalogInventory, catalogMovements, catalogInquiries]) {
    if (!fs.existsSync(f)) throw new Error(`Committed catalog file missing: ${f}`);
  }

  // Build the fresh database with the exact production schema.
  const db = new Database(dbPath);
  try {
    db.exec(SCHEMA);
    seedDatabase({ db, productsFile: productsFile || catalogProducts });
  } finally {
    db.close();
  }

  // The same pipeline `npm run migrate:firestore -- --dry-run` runs.
  const datasets = transformSnapshot(dumpSnapshot(dbPath));

  const expected = {
    'products.json': (JSON.parse(fs.readFileSync(catalogProducts, 'utf8')) || []).map(normalizeProductRow),
    'inventory.json': normalizeInventory(JSON.parse(fs.readFileSync(catalogInventory, 'utf8'))),
    'stock_movements.json': JSON.parse(fs.readFileSync(catalogMovements, 'utf8')) || [],
    'order_inquiries.json': JSON.parse(fs.readFileSync(catalogInquiries, 'utf8')) || [],
  };

  const diffs = [];
  for (const dataset of Object.keys(expected)) {
    // Both sides normalized the same way: inventory items carry volatile
    // created_at/updated_at that differ between a fresh seed and the day the
    // committed inventory.json was last regenerated — strip them on BOTH sides.
    const actual = dataset === 'inventory.json' ? normalizeInventory(datasets[dataset]) : datasets[dataset];
    const d = firstDiff(actual, expected[dataset]);
    if (d) diffs.push({ dataset, ...d });
  }

  const counts = {};
  for (const [dataset, rows] of Object.entries(datasets)) {
    counts[dataset] = Array.isArray(rows) ? rows.length : (rows && Array.isArray(rows.items) ? rows.items.length : 'n/a');
  }

  return { ok: diffs.length === 0, diffs, counts };
}

if (require.main === module) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventrak-catalog-'));
  const dbPath = path.join(tmpDir, 'catalog.db');
  const dataDir = process.env.INVENTRAK_DATA_DIR || DEFAULT_DATA_DIR;
  try {
    const result = checkCatalog({ dbPath, dataDir });
    console.log(`Migration catalog check — fresh seed → transform → committed catalog (${dataDir})`);
    Object.entries(result.counts).forEach(([dataset, n]) => {
      console.log(`  ${dataset.padEnd(22)} ${n}`);
    });
    if (result.ok) {
      console.log('\nPASS: the transform reproduces the committed catalog exactly.');
    } else {
      console.log('\nFAIL: transform output diverges from the committed catalog.');
      result.diffs.forEach((d) => {
        console.log(`  ${d.dataset}${d.path}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`);
      });
      console.log('\nFix the drift (catalog vs seed/transform) before migrating to Firestore.');
    }
    // process.exitCode (not process.exit) so the finally below always runs
    // and the temp database directory is cleaned up on every path.
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { checkCatalog, normalizeProductRow, normalizeInventory, firstDiff };

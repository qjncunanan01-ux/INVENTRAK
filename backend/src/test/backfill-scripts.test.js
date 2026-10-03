// Tests for the two maintenance scripts.
//
// Both scripts write to the live catalog, so the rule this suite defends is:
// every decision they make must be COMPUTABLE and REPORTABLE before anything is
// written, and a dry run must be provably inert. The pure parts (buildPlan,
// parseSheet) are exercised directly here; the end-to-end write path is
// exercised against a throwaway SQLite copy so the repo database is never
// touched.
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildPlan, SQLITE_TABLES } = require('../../scripts/backfill-customers');
const { parseSheet, buildPlan: buildCostPlan, unitCostOf } = require('../../scripts/backfill-costs');

const tmpDirs = [];
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

// --- customer backfill ----------------------------------------------------

// A target is just an object with the four functions buildPlan calls, so the
// plan can be driven without a database at all.
function fakeTarget({ customers = [], sales = [], inquiries = [] } = {}) {
  return {
    kind: 'fake',
    label: 'fake',
    customers: () => customers,
    sales: () => sales,
    inquiries: () => inquiries,
    insertCustomer: () => {},
    link: () => {},
    close: () => {},
  };
}

test('customer backfill: an already-linked row is left alone', () => {
  const { plan } = buildPlan(fakeTarget({
    customers: [{ id: 1, name: 'Juan' }],
    sales: [{ id: 7, customer_name: 'Juan', customer_id: 1 }],
  }));
  assert.deepStrictEqual(plan, [], 'a linked row must never be re-resolved');
});

test('customer backfill: an unlinked row resolves to the existing customer by name', () => {
  const { plan } = buildPlan(fakeTarget({
    customers: [{ id: 1, name: 'Juan Dela Cruz' }],
    sales: [{ id: 7, customer_name: 'Juan Dela Cruz', customer_id: null }],
  }));
  assert.strictEqual(plan.length, 1);
  assert.strictEqual(plan[0].kind, 'sales');
  assert.strictEqual(plan[0].id, 7);
  assert.strictEqual(plan[0].customerId, 1);
});

test('customer backfill: a new customer gets an id above every existing one', () => {
  const { plan, created } = buildPlan(fakeTarget({
    customers: [{ id: 4, name: 'Juan' }],
    sales: [{ id: 1, customer_name: 'Maria Santos', customer_id: null }],
  }));
  assert.strictEqual(plan[0].customerId, 5, 'must not collide with id 4');
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].name, 'Maria Santos');
});

test('customer backfill: repeated runs produce no further new customers', () => {
  // This is what idempotence actually means here: the plan is a function of the
  // rows, so replaying it against the same catalog cannot mint a second person.
  const first = buildPlan(fakeTarget({
    customers: [{ id: 1, name: 'Juan' }],
    sales: [{ id: 1, customer_name: 'Maria', customer_id: null }, { id: 2, customer_name: 'Pedro', customer_id: null }],
  }));
  assert.strictEqual(first.created.length, 2);

  const afterFirst = [
    { id: 1, name: 'Juan' },
    ...first.created,
  ];
  const linked = first.plan.map(p => ({ id: p.id, customer_name: 'irrelevant', customer_id: p.customerId }));
  const second = buildPlan(fakeTarget({ customers: afterFirst, sales: linked }));
  assert.strictEqual(second.created.length, 0);
});

test('customer backfill: a row with no usable identity is skipped, not invented', () => {
  // resolveCustomer returns nothing for a blank name. Guessing here would put
  // anonymous walk-in sales under an arbitrary person.
  const { plan } = buildPlan(fakeTarget({
    customers: [{ id: 1, name: 'Juan' }],
    sales: [{ id: 9, customer_name: null, customer_id: null }],
  }));
  assert.deepStrictEqual(plan, []);
});

test('customer backfill: email identity wins over a shared name', () => {
  const { plan } = buildPlan(fakeTarget({
    customers: [{ id: 1, name: 'Juan', email: 'juan@example.com' }],
    inquiries: [{ id: 3, customer_name: 'Juan', customer_email: 'juan@example.com', customer_id: null }],
  }));
  assert.strictEqual(plan.length, 1);
  assert.strictEqual(plan[0].customerId, 1);
  assert.strictEqual(plan[0].kind, 'inquiries');
});

test('customer backfill: sales and inquiries are planned separately', () => {
  const { plan } = buildPlan(fakeTarget({
    customers: [{ id: 1, name: 'Juan' }],
    sales: [{ id: 1, customer_name: 'Juan', customer_id: null }],
    inquiries: [{ id: 1, customer_name: 'Juan', customer_id: null }],
  }));
  assert.deepStrictEqual(plan.map(p => p.kind).sort(), ['inquiries', 'sales']);
});

test('customer backfill: SQLite table names are mapped from plan kinds', () => {
  // The plan speaks in Supabase table names; SQLite spells them differently.
  // Getting this wrong is an immediate "no such table: sales" at write time.
  assert.deepStrictEqual(SQLITE_TABLES, { sales: 'sales_transactions', inquiries: 'order_inquiries' });
});

test('customer backfill: writes only the intended rows, on a throwaway copy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventrak-backfill-'));
  tmpDirs.push(dir);
  const dbPath = path.join(dir, 'test.db');

  // Build a miniature database with the real schema, via the real db module,
  // pointed at a temp path.
  const prevPath = process.env.INVENTRAK_DB_PATH;
  const prevData = process.env.INVENTRAK_DATA_DIR;
  process.env.INVENTRAK_DB_PATH = dbPath;
  process.env.INVENTRAK_DATA_DIR = path.join(dir, 'data');
  fs.mkdirSync(process.env.INVENTRAK_DATA_DIR, { recursive: true });
  try {
    const { db } = require('../db');
    db.prepare('INSERT INTO customers (id, name) VALUES (1, ?)').run('Juan Dela Cruz');
    db.prepare('INSERT INTO sales_transactions (id, customer_name) VALUES (1, ?)').run('Juan Dela Cruz');
    db.prepare('INSERT INTO sales_transactions (id, customer_name) VALUES (2, ?)').run('Maria Santos');
    db.close();

    const run = (...argv) => require('node:child_process').execFileSync(
      process.execPath,
      [path.join(__dirname, '..', '..', 'scripts', 'backfill-customers.js'), ...argv],
      { env: { ...process.env, INVENTRAK_DB_PATH: dbPath }, encoding: 'utf8' },
    );

    const dry = run();
    assert.match(dry, /DRY RUN/);
    assert.match(dry, /2 unlinked row\(s\)/);

    // A dry run must be inert. Re-read in a fresh process.
    const check = require('node:child_process').execFileSync(
      process.execPath,
      ['-e', `const {db}=require(${JSON.stringify(path.join(__dirname, '..', 'db'))});` +
        'process.stdout.write(String(db.prepare("SELECT COUNT(*) n FROM sales_transactions WHERE customer_id IS NOT NULL").get().n));' +
        'db.close();'],
      { env: { ...process.env, INVENTRAK_DB_PATH: dbPath }, encoding: 'utf8' },
    );
    assert.strictEqual(check, '0', 'the dry run wrote something');

    const applied = run('--apply');
    assert.match(applied, /linked 2 row\(s\)/);
    assert.match(applied, /verify: 0 row\(s\) still unlinked/);

    // Idempotent: a second apply must find nothing left to do.
    const again = run('--apply');
    assert.match(again, /nothing to do/);
  } finally {
    if (prevPath === undefined) delete process.env.INVENTRAK_DB_PATH; else process.env.INVENTRAK_DB_PATH = prevPath;
    if (prevData === undefined) delete process.env.INVENTRAK_DATA_DIR; else process.env.INVENTRAK_DATA_DIR = prevData;
  }
});

// --- cost backfill --------------------------------------------------------

test('cost sheet: a blank cost cell means leave the product alone', () => {
  // The single most dangerous default in this script would be blank -> clear:
  // a partial supplier sheet would then silently wipe every cost it did not
  // mention, and still report success.
  const rows = parseSheet('Almond Syrup,120\nBlueberry Syrup,');
  assert.strictEqual(rows[0].cost, 120);
  assert.strictEqual(rows[1].cost, 'skip');
  const products = [{ id: 1, name: 'Almond Syrup', price: 300, cost: 100 }, { id: 2, name: 'Blueberry Syrup', price: 300, cost: 90 }];
  const { plan } = buildCostPlan(rows, products);
  assert.strictEqual(plan.length, 1, 'the blank row must produce no write');
  assert.strictEqual(plan[0].id, 1);
});

test('cost sheet: an explicit clear token clears the cost', () => {
  const { plan } = buildCostPlan(parseSheet('Almond Syrup,-'), [{ id: 1, name: 'Almond Syrup', price: 300, cost: 100 }]);
  assert.strictEqual(plan.length, 1);
  assert.strictEqual(plan[0].to, null);
});

test('cost sheet: clearing an already-uncosted product is not a change', () => {
  const { plan, unchanged } = buildCostPlan(parseSheet('Almond Syrup,-'), [{ id: 1, name: 'Almond Syrup', price: 300, cost: null }]);
  assert.strictEqual(plan.length, 0);
  assert.strictEqual(unchanged, 1);
});

test('cost sheet: a currency-fragmented cell is rejoined before parsing', () => {
  // "125 ₱" splits across two columns in some exports.
  const rows = parseSheet('Almond Syrup,125 ₱');
  assert.strictEqual(rows[0].cost, 125);
});

test('cost sheet: a header row is not treated as a product', () => {
  const rows = parseSheet('Product Name,Cost\nAlmond Syrup,120');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Almond Syrup');
});

test('cost sheet: unreadable cost cells are reported, never read as zero', () => {
  // Number('') === 0, so a cell that reduces to nothing would otherwise become a
  // free product. That trap has already been hit once in this repo.
  const { junk, plan } = buildCostPlan(parseSheet('Almond Syrup,abc'), [{ id: 1, name: 'Almond Syrup', price: 300, cost: 100 }]);
  assert.deepStrictEqual(junk, ['Almond Syrup']);
  assert.strictEqual(plan.length, 0);
});

test('cost sheet: a duplicate name resolves once, and is reported', () => {
  const { plan, duplicates } = buildCostPlan(
    parseSheet('Almond Syrup,120\nAlmond Syrup,999'),
    [{ id: 1, name: 'Almond Syrup', price: 300, cost: 100 }],
  );
  assert.strictEqual(plan.length, 1);
  assert.strictEqual(plan[0].to, 120, 'the first row wins, so ordering cannot change the outcome');
  assert.strictEqual(duplicates.length, 1);
});

test('cost sheet: an unmatched name is reported separately from a duplicate', () => {
  const { skipped, duplicates } = buildCostPlan(parseSheet('Nonexistent Product,10'), []);
  assert.deepStrictEqual(skipped, ['Nonexistent Product']);
  assert.deepStrictEqual(duplicates, []);
});

test('cost sheet: a cost at or above the selling price is flagged', () => {
  const { lossMakers } = buildCostPlan(parseSheet('Almond Syrup,350'), [{ id: 1, name: 'Almond Syrup', price: 300, cost: 100 }]);
  assert.strictEqual(lossMakers.length, 1);
  assert.strictEqual(lossMakers[0].cost, 350);
});

test('cost sheet: setting the same cost it already has is not a change', () => {
  const { plan, unchanged } = buildCostPlan(parseSheet('Almond Syrup,100'), [{ id: 1, name: 'Almond Syrup', price: 300, cost: 100 }]);
  assert.strictEqual(plan.length, 0);
  assert.strictEqual(unchanged, 1);
});

test('cost sheet: matches are case- and whitespace-insensitive on the name', () => {
  const { plan } = buildCostPlan(parseSheet('  almond syrup ,120'), [{ id: 1, name: 'Almond Syrup', price: 300, cost: 100 }]);
  assert.strictEqual(plan.length, 1);
});

test('cost sheet: quoted names with embedded commas survive', () => {
  const rows = parseSheet('"Almond Syrup, Premium",120');
  assert.strictEqual(rows[0].name, 'Almond Syrup, Premium');
  const { plan } = buildCostPlan(rows, [{ id: 1, name: 'Almond Syrup, Premium', price: 300, cost: 100 }]);
  assert.strictEqual(plan.length, 1);
});

test('unit cost: all three storage spellings are read', () => {
  // SQLite stores a `cost` column; the npm-free JSON row spells it `Cost`.
  assert.strictEqual(unitCostOf({ cost: 12 }), 12);
  assert.strictEqual(unitCostOf({ Cost: 13 }), 13);
  assert.strictEqual(unitCostOf({ Cost: null }), null);
  assert.strictEqual(unitCostOf({ Cost: '' }), null);
  assert.strictEqual(unitCostOf({}), null);
});
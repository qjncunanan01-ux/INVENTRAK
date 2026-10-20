// Upgrading a database that PREDATES the order-lifecycle columns.
//
// Every other lifecycle test starts from a fresh temp database, where
// src/schema.js already contains fulfillment_method / rejection_reason /
// cancelled_at / cancellation_reason — so `CREATE TABLE IF NOT EXISTS` creates
// them and the ALTER-based migration in db.js never runs. That leaves the one
// path production actually takes (an existing deployment's file, many of them
// in the field) untested, which is how a boot-time migration breaks a live
// database instead of a CI run.
//
// This file therefore builds a LEGACY order_inquiries table with the exact
// pre-lifecycle column set, adds a row, and only THEN requires db.js, whose
// module-level migration must upgrade it in place:
//   - the four new columns appear with the documented defaults/nulls
//   - the pre-existing row survives, reading back as a pickup with no reason
//   - nothing is renamed or dropped
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventrak-migrate-'));
const dbPath = path.join(tmpDir, 'legacy.db');

// ---- Build the OLD database before the backend modules load -----------------
const legacy = new Database(dbPath);
legacy.exec(`
  CREATE TABLE order_inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    products TEXT,
    estimated_cost REAL,
    notes TEXT,
    delivery_address TEXT,
    payment_method TEXT DEFAULT 'cod',
    payment_status TEXT DEFAULT 'unpaid',
    payment_reference TEXT,
    payment_url TEXT,
    payment_qr TEXT,
    payment_provider TEXT,
    user_id INTEGER,
    customer_id INTEGER,
    status_history TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );
  INSERT INTO order_inquiries (customer_name, customer_email, status, estimated_cost, created_at)
  VALUES ('Legacy Buyer', 'legacy@example.com', 'approved', 250, '2026-09-01T00:00:00.000Z');
`);
legacy.close();

// Point the driver at that file, then let db.js run its migrations on require.
process.env.INVENTRAK_DB_PATH = dbPath;
const { db } = require('../db');

after(() => {
  try {
    db.close();
  } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('an existing database gains the lifecycle columns in place', () => {
  const cols = db.prepare('PRAGMA table_info(order_inquiries)').all().map((c) => c.name);
  for (const name of ['fulfillment_method', 'rejection_reason', 'cancelled_at', 'cancellation_reason']) {
    assert.ok(cols.includes(name), `migration must add ${name} to an existing order_inquiries table`);
  }
  // Nothing the old schema guaranteed may disappear.
  for (const name of ['id', 'customer_name', 'customer_email', 'products', 'status', 'status_history', 'created_at']) {
    assert.ok(cols.includes(name), `${name} must survive the migration`);
  }
});

test('the rows that were already there are untouched and read as legacy values', () => {
  const row = db.prepare('SELECT * FROM order_inquiries').get();
  assert.ok(row, 'the pre-existing inquiry is still there');
  assert.strictEqual(row.customer_name, 'Legacy Buyer');
  assert.strictEqual(row.status, 'approved', 'its status is not rewritten');
  assert.strictEqual(row.estimated_cost, 250);
  // A row from before fulfilment existed legitimately has no preference
  // recorded; the column default is what the API reads back.
  assert.strictEqual(row.fulfillment_method, 'pickup');
  assert.strictEqual(row.rejection_reason, null);
  assert.strictEqual(row.cancelled_at, null);
  assert.strictEqual(row.cancellation_reason, null);
});

test('the new columns are writable after the migration', () => {
  db.prepare(
    'UPDATE order_inquiries SET fulfillment_method = ?, rejection_reason = ? WHERE id = ?',
  ).run('courier', 'Out of stock.', 1);
  const row = db.prepare('SELECT * FROM order_inquiries WHERE id = 1').get();
  assert.strictEqual(row.fulfillment_method, 'courier');
  assert.strictEqual(row.rejection_reason, 'Out of stock.');
});

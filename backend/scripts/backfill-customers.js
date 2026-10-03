// Backfill customer_id on sales that predate Customer Records.
//
// WHY
// Seeded and historical sales carry only a free-text customer_name. Customer
// Records arrived after them, so those rows have customer_id = NULL and are
// invisible to per-customer aggregates. This links them by running each name
// through the SAME resolve-or-create rule the servers use (customers.js), so a
// backfilled row is indistinguishable from one recorded today.
//
// IDEMPOTENT
// Safe to re-run: it only touches rows whose customer_id IS NULL, and
// resolve-or-create reuses the same customer for the same name. Running it
// twice creates nothing new.
//
// USAGE
//   npm run customers:backfill            # dry run — reports, changes nothing
//   npm run customers:backfill -- --apply # actually writes
//
// SCOPE
// This targets the SQLite database (the path db.js resolves, honouring
// INVENTRAK_DB_PATH). A Supabase deployment keeps the same rows in the
// '@sales'/'@customers' collections; run it against a local copy or add the
// same resolveCustomer pass there. The identity rule is shared either way, so
// the result is identical — only the storage target differs.
const { db } = require('../src/db');
const { resolveCustomer } = require('../src/customers');

const apply = process.argv.includes('--apply');

function main() {
  const customers = db.prepare('SELECT * FROM customers').all();
  const orphans = db
    .prepare('SELECT id, customer_name FROM sales_transactions WHERE customer_id IS NULL')
    .all();

  if (orphans.length === 0) {
    console.log('[backfill] no unlinked sales — nothing to do.');
    return;
  }

  // Resolve everything first, then write, so a dry run reports exactly what an
  // apply would do and cannot half-apply.
  const updates = [];
  let nextId = customers.reduce((max, c) => Math.max(max, Number(c.id) || 0), 0);
  const working = customers.slice();

  for (const row of orphans) {
    const { customer, created } = resolveCustomer(working, { name: row.customer_name });
    if (!customer) continue;
    if (customer.id == null) customer.id = ++nextId;
    updates.push({ saleId: row.id, customerId: Number(customer.id) });
    if (created) {
      db.prepare(
        `INSERT INTO customers (id, name, business_name, contact_number, email, address, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        customer.id, customer.name, customer.business_name, customer.contact_number,
        customer.email, customer.address, customer.user_id, customer.created_at, customer.updated_at,
      );
    }
  }

  const distinct = new Set(updates.map((u) => u.customerId)).size;
  console.log(`[backfill] ${orphans.length} unlinked sale(s) -> ${distinct} Customer Record(s).`);
  if (!apply) {
    console.log('[backfill] DRY RUN — pass --apply to write.');
    return;
  }

  const link = db.prepare('UPDATE sales_transactions SET customer_id = ? WHERE id = ? AND customer_id IS NULL');
  db.transaction(() => {
    for (const u of updates) link.run(u.customerId, u.saleId);
  })();
  console.log(`[backfill] linked ${updates.length} sale(s).`);
}

main();
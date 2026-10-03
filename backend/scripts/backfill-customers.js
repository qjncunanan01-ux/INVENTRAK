// Backfill customer_id on sales and order inquiries that predate Customer Records.
//
// WHY
// Seeded and historical rows carry only a free-text customer_name. Customer
// Records arrived after them, so those rows have customer_id = NULL and are
// invisible to per-customer aggregates. This links them by running each row
// through the SAME resolve-or-create rule the servers use (src/customers.js), so
// a backfilled row is indistinguishable from one recorded today.
//
// IDEMPOTENT
// Safe to re-run: it only touches rows whose customer_id IS NULL, and
// resolve-or-create reuses the same customer for the same identity. Running it
// twice creates nothing new and reports "nothing to do".
//
// USAGE
//   npm run customers:backfill            # dry run — reports, changes nothing
//   npm run customers:backfill -- --apply # actually writes
//
// TARGET
//   SUPABASE_URL + SUPABASE_KEY set -> the live Supabase deployment, which is
//     where the 612 seeded sales actually live. Each linked row is PATCHed
//     individually; the customers table is only ever appended to.
//   otherwise -> the SQLite database db.js resolves, honouring
//     INVENTRAK_DB_PATH.
//
// The identity rule is the shared module either way, so the RESULT is identical
// on both targets — only the storage differs. That is why running this locally
// against a copy is a valid rehearsal for the production run.
const { resolveCustomer } = require('../src/customers');
const { requireConfig, readAll, patchRow, insertRows } = require('./supabase-rest');

const apply = process.argv.includes('--apply');

function log(...a) { console.log('[backfill]', ...a); }

// --------------------------------------------------------------- SQLite target

// The plan speaks in kinds ('sales' / 'inquiries') so both targets can share it,
// but SQLite spells those tables differently. Map once, here.
const SQLITE_TABLES = { sales: 'sales_transactions', inquiries: 'order_inquiries' };

function sqliteTarget() {
  let db;
  try {
    ({ db } = require('../src/db'));
  } catch (err) {
    throw new Error(
      `SQLite target unavailable (${err.message}). Set SUPABASE_URL and SUPABASE_KEY to target Supabase instead.`,
    );
  }
  return {
    kind: 'sqlite',
    label: `SQLite (${process.env.INVENTRAK_DB_PATH || 'default'})`,
    customers: () => db.prepare('SELECT * FROM customers').all(),
    // Only real columns are named here. sales_transactions never had
    // customer_email/customer_phone — it was seeded with a name only — so asking
    // for them is an instant "no such column" and no backfill at all.
    sales: () => db.prepare('SELECT id, customer_name, customer_id FROM sales_transactions').all(),
    inquiries: () => db.prepare('SELECT id, customer_name, customer_email, customer_phone, user_id, customer_id FROM order_inquiries').all(),
    insertCustomer: (c) => db.prepare(
      `INSERT INTO customers (id, name, business_name, contact_number, email, address, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(c.id, c.name, c.business_name, c.contact_number, c.email, c.address, c.user_id, c.created_at, c.updated_at),
    link: (kind, id, customerId) => {
      const table = SQLITE_TABLES[kind];
      if (!table) throw new Error(`unknown row kind "${kind}"`);
      db.prepare(`UPDATE ${table} SET customer_id = ? WHERE id = ? AND customer_id IS NULL`).run(customerId, id);
    },
    // SQLite reads through on every call, so there is nothing to refresh.
    reload: async () => {},
    close: () => { try { db.close(); } catch {} },
  };
}

// ------------------------------------------------------------- Supabase target

async function supabaseTarget() {
  const cfg = requireConfig();
  if (!cfg) return null;
  const { rest, headers } = cfg;
  // The JSONB row IS the record, exactly as the npm-free server reads it, so
  // the same resolveCustomer call handles it unchanged.
  const cache = {};
  const reload = async () => {
    cache.customers = await readAll(rest, headers, 'customers');
    cache.sales = await readAll(rest, headers, 'sales');
    cache.inquiries = await readAll(rest, headers, 'inquiries');
  };
  await reload();
  const unwrap = (rows) => (rows || []).map(r => ({ ...r.data, id: r.id }));
  return {
    kind: 'supabase',
    label: `Supabase (${process.env.SUPABASE_URL})`,
    customers: () => unwrap(cache.customers),
    sales: () => unwrap(cache.sales),
    inquiries: () => unwrap(cache.inquiries),
    // Re-read before verifying. Without this the post-run check re-plans
    // against the rows captured BEFORE the writes and reports every sale still
    // unlinked after a perfectly successful apply — which reads, to whoever ran
    // it, like the backfill failed.
    reload,
    async insertCustomer(c) {
      const { id, ...data } = c;
      await insertRows(rest, headers, 'customers', [{ id, idx: id, data }]);
    },
    link: async (table, id, customerId) => {
      // Read-then-write rather than a JSONB merge: the row is small, and this
      // keeps the script working on any Supabase version without the jsonb_set
      // syntax varying underneath us.
      const [row] = await readAll(rest, headers, table, 'id,data', `&id=eq.${encodeURIComponent(id)}`);
      if (!row) throw new Error(`${table} id=${id} vanished mid-run`);
      await patchRow(rest, headers, table, id, { ...row.data, customer_id: customerId });
    },
    close: () => {},
  };
}

// ---------------------------------------------------------------------- plan

// Resolve everything up front so a dry run reports exactly what an apply would
// do, and cannot half-apply.
function buildPlan(target) {
  const customers = target.customers();
  let nextId = customers.reduce((max, c) => Math.max(max, Number(c.id) || 0), 0);
  const working = customers.map(c => ({ ...c }));
  const plan = [];

  const consider = (kind, rows, idField = 'id') => {
    for (const row of rows) {
      if (row.customer_id !== null && row.customer_id !== undefined && row.customer_id !== '') continue;
      const { customer, created } = resolveCustomer(working, {
        user_id: row.user_id,
        email: row.customer_email || row.email,
        name: row.customer_name || row.name,
        phone: row.customer_phone || row.contact_number,
      });
      // No usable identity: leave the row unlinked rather than invent a person.
      if (!customer) continue;
      if (customer.id == null) customer.id = ++nextId;
      plan.push({ kind, id: row[idField], customerId: Number(customer.id), created });
    }
  };

  const sales = target.sales().filter(s => s.customer_id === null || s.customer_id === undefined || s.customer_id === '');
  const inquiries = target.inquiries().filter(o => o.customer_id === null || o.customer_id === undefined || o.customer_id === '');
  consider('sales', sales);
  consider('inquiries', inquiries);

  return { plan, working, created: working.filter(c => c.id > customers.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0)) };
}

async function main() {
  const target = (await supabaseTarget()) || sqliteTarget();
  try {
    log(`target: ${target.label}`);

    const { plan, created } = buildPlan(target);

    const orphans = plan.length;
    const byCustomer = new Set(plan.map(p => p.customerId)).size;
    log(`${orphans} unlinked row(s) -> ${byCustomer} Customer Record(s)`);

    if (orphans === 0) {
      log('nothing to do — every sale and inquiry already has a customer.');
      return;
    }

    const existing = target.customers().length;
    log(`customers: ${existing} before, ${created.length} new`);
    for (const c of created) log(`  + ${c.name}${c.email ? ` <${c.email}>` : ''}${c.contact_number ? ` · ${c.contact_number}` : ''}`);
    const byKind = plan.reduce((acc, p) => ({ ...acc, [p.kind]: (acc[p.kind] || 0) + 1 }), {});
    log(`  linking: ${byKind.sales || 0} sale(s), ${byKind.inquiries || 0} inquiry/inquiries`);

    if (!apply) {
      log('');
      log('DRY RUN — nothing was written. Re-run with --apply to make these changes.');
      return;
    }

    log('');
    for (const c of created) await target.insertCustomer(c);
    log(`inserted ${created.length} Customer Record(s)`);
    for (const p of plan) await target.link(p.kind === 'sales' ? 'sales' : 'inquiries', p.id, p.customerId);
    log(`linked ${plan.length} row(s)`);

    // Re-read before verifying, so the check reports the state AFTER the
    // writes rather than the snapshot the plan was built from.
    await target.reload();
    const after = buildPlan(target);
    log(`verify: ${after.plan.length} row(s) still unlinked (0 is the target)`);
    if (after.plan.length > 0) {
      throw new Error(`${after.plan.length} row(s) are still unlinked after a successful apply`);
    }
  } finally {
    target.close();
  }
}

// Exported for tests: buildPlan is pure over a target, so a test can drive it
// with in-memory rows and assert the identity rule without touching a database.
module.exports = { buildPlan, sqliteTarget, supabaseTarget, SQLITE_TABLES };

if (require.main === module) {
  main().catch(err => {
    console.error('[backfill] failed:', err.message);
    process.exitCode = 1;
  });
}
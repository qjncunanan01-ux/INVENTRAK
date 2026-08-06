// Bidirectional sync between the local SQLite database and Firebase Firestore.
//
//   npm run sync:firestore                        # merge both ways, apply
//   npm run sync:firestore -- --dry-run           # show the changeset, touch nothing
//   npm run sync:firestore -- --direction=to-firestore
//   npm run sync:firestore -- --conflict=keep-sqlite
//   npm run sync:firestore -- --direction=to-sqlite --deletions=propagate
//
// Model: every dataset is viewed through a COMMON CANONICAL SHAPE on both
// sides, so a row is the same row on SQLite and Firestore. A sync computes a
// per-row CHANGESET — added / updated / removed / conflicting — and produces
// two write plans (toLocal, toRemote). Both directions converge to the same
// state except for rows deliberately left divergent (conflict=skip).
//
// Conflict resolution (per-row, when both sides changed the same row):
//   last-write-wins  (default) — the row with the newer timestamp wins
//                                 (created_at / updated_at / resolved_at;
//                                 a missing timestamp loses). No timestamps
//                                 on either side → local wins.
//   keep-sqlite      — the local row wins
//   keep-firestore   — the cloud row wins
//   skip             — neither side overwrites the other; the row is reported
//                      and left as-is on each side
//
// Deletions (safe by default — without tombstones an absent row is ambiguous):
//   ignore    (default) — union merge: rows seen on either side are kept on
//                          both; presence-only rows are reported as candidates
//   propagate — only valid with a one-way --direction; the plans are MIRRORS:
//               toRemote (used by --direction=to-firestore) contains exactly
//               the local rows (rows absent locally are dropped from the
//               cloud write), and toLocal (used by --direction=to-sqlite)
//               contains exactly the remote rows (rows absent remotely are
//               dropped from the SQLite write). Review the dry-run first.
//
// Scope: the default SQLite backend (backend/data/inventrak.db) ↔ Firestore.
// The npm-free JSON-file mode is an ephemeral fallback and is not synced.
const path = require('path');
const fs = require('fs');
const { isHashed } = require('./password-hash');

// Datasets: canonical key + timestamp used for last-write-wins. Inventory is
// special-cased (locations array + per-product items) in its own handlers.
// Product identity on Firestore is ARRAY POSITION (doc id = idx + 1, the same
// convention the npm-free server uses) — that is safe because products are
// never hard-deleted anywhere (soft-delete keeps the row, ids stay contiguous
// 1..N), so sortById keeps position == id.
const DATASETS = {
  'products.json': { updated: 'updated_at' },
  'stock_movements.json': { updated: 'created_at' },
  'order_inquiries.json': { updated: 'created_at' },
  '@users': { updated: 'created_at' },
  '@sales': { updated: 'transaction_date' },
  '@alerts': { updated: (r) => r.resolved_at || r.created_at },
};
const ORDER = [
  'products.json', 'inventory.json', 'stock_movements.json',
  'order_inquiries.json', '@users', '@sales', '@alerts',
];

// ---------- canonical helpers ----------

// Firestore cannot store null, so the driver writes '' — treat '' and null as
// the same "unset" value when comparing and merging. Drops undefined and
// non-finite numbers. Recursive (nested inventory locations objects).
function unset(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  if (Array.isArray(v)) return v.map(unset);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = unset(val);
    return out;
  }
  return v;
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

function keyOf(row) {
  return row && row.id !== undefined ? row.id : null;
}

// Products: active/missing → 'active'; anything else ('inactive', null, '') →
// 'inactive' (both backends treat a nulled status as not-active).
function canonStatus(s) {
  return s === 'active' || s === undefined ? 'active' : 'inactive';
}

// ---------- canonicalize SQLite (snapshot from migrate-firestore dumpSnapshot) ----------

function canonicalFromSqlite(snap) {
  const s = snap || {};
  const locationNameById = new Map((s.locations || []).map((l) => [l.id, l.name]));

  const products = (s.products || []).map((p) => unset({
    id: p.id,
    name: p.name,
    category: p.category,
    brand: p.brand,
    description: p.description,
    size: p.size,
    unit: p.unit,
    price: p.price,
    status: canonStatus(p.status),
    updated_at: p.updated_at,
  }));

  const productById = new Map((s.products || []).map((p) => [p.id, p]));
  const locations = (s.locations || []).map((l) => l.name);
  const items = {}; // productId -> { locations: {name: qty} }
  (s.stock || []).forEach((r) => {
    const name = locationNameById.get(r.location_id);
    if (name === undefined) return;
    if (!items[r.product_id]) items[r.product_id] = { locations: {} };
    items[r.product_id].locations[name] = r.quantity;
  });

  return {
    'products.json': products,
    'inventory.json': {
      locations,
      items,
    },
    'stock_movements.json': (s.stock_movements || []).map((m) => unset({
      id: m.id, product_id: m.product_id, qty: m.qty, type: m.type,
      src_location: m.src_location, dst_location: m.dst_location,
      notes: m.notes, created_at: m.created_at, user: m.user,
    })),
    'order_inquiries.json': (s.order_inquiries || []).map((o) => unset({
      id: o.id, customer_name: o.customer_name, customer_email: o.customer_email,
      customer_phone: o.customer_phone, products: o.products,
      estimated_cost: o.estimated_cost, notes: o.notes, status: o.status,
      created_at: o.created_at,
    })),
    '@users': (s.users || []).map((u) => unset({
      id: u.id, username: u.username, password: u.password, role: u.role,
      email: u.email, created_at: u.created_at,
    })),
    '@sales': (s.sales_transactions || []).map((t) => unset({
      id: t.id, product_id: t.product_id, qty: t.qty, unit_price: t.unit_price,
      total_amount: t.total_amount, transaction_date: t.transaction_date,
      customer_name: t.customer_name,
    })),
    // product_name/location_name are derived via JOIN on SQLite; keep them in
    // the canonical so Firestore rows stay comparable, and drop them on the
    // SQLite write (they are not stored columns).
    '@alerts': (s.inventory_alerts || []).map((a) => unset({
      id: a.id, product_id: a.product_id, location_id: a.location_id,
      alert_type: a.alert_type, threshold: a.threshold, current_qty: a.current_qty,
      status: a.status, created_at: a.created_at, resolved_at: a.resolved_at,
      product_name: (productById.get(a.product_id) || {}).name,
      location_name: locationNameById.get(a.location_id),
    })),
  };
}

// ---------- canonicalize Firestore (store.read results) ----------

function canonicalFromFirestore(read) {
  const products = (read['products.json'] || []).map((r, idx) => unset({
    id: idx + 1,
    name: r['Product Name'],
    category: r['Category'],
    brand: r['Brand'],
    description: r['Description'],
    size: r['Size'],
    unit: r['Unit'],
    price: r['Price'],
    status: canonStatus(r.status),
    updated_at: r.updated_at,
  }));

  const inv = read['inventory.json'] || { locations: [], items: [] };
  const items = {};
  (inv.items || []).forEach((item) => {
    if (item && item.product && item.product.id !== undefined) {
      items[item.product.id] = { locations: item.locations || {} };
    }
  });

  const mk = (rows, shape) => (rows || []).map((r) => unset(shape(r)));

  return {
    'products.json': products,
    'inventory.json': { locations: inv.locations || [], items },
    'stock_movements.json': mk(read['stock_movements.json'], (m) => ({
      id: m.id, product_id: m.product_id, qty: m.qty, type: m.type,
      src_location: m.src_location, dst_location: m.dst_location,
      notes: m.notes, created_at: m.created_at, user: m.user,
    })),
    'order_inquiries.json': mk(read['order_inquiries.json'], (o) => ({
      id: o.id, customer_name: o.customer_name, customer_email: o.customer_email,
      customer_phone: o.customer_phone, products: o.products,
      estimated_cost: o.estimated_cost, notes: o.notes, status: o.status,
      created_at: o.created_at,
    })),
    '@users': mk(read['@users'], (u) => ({
      id: u.id, username: u.username, password: u.password, role: u.role,
      email: u.email, created_at: u.created_at,
    })),
    '@sales': mk(read['@sales'], (t) => ({
      id: t.id, product_id: t.product_id, qty: t.qty, unit_price: t.unit_price,
      total_amount: t.total_amount, transaction_date: t.transaction_date,
      customer_name: t.customer_name,
    })),
    '@alerts': mk(read['@alerts'], (a) => ({
      id: a.id, product_id: a.product_id, location_id: a.location_id,
      alert_type: a.alert_type, threshold: a.threshold, current_qty: a.current_qty,
      status: a.status, created_at: a.created_at, resolved_at: a.resolved_at,
      product_name: a.product_name, location_name: a.location_name,
    })),
  };
}

// ---------- diff + merge ----------

// inventory rows are { id: productId, locations, updated_at } so the generic
// per-row machinery can be reused; totals are derived, never compared.
function inventoryToRows(inv, updatedById) {
  return Object.entries(inv.items || {}).map(([pid, v]) => unset({
    id: Number(pid),
    locations: v.locations,
    updated_at: (updatedById.get(Number(pid)) || {}).updated_at,
  }));
}

function rowsToInventory(locations, rows) {
  const items = {};
  rows.forEach((r) => { items[r.id] = { locations: r.locations || {} }; });
  return { locations, items };
}

function resolveConflict(localRow, remoteRow, { conflict, updated, preferHashed = false }) {
  switch (conflict) {
    case 'keep-sqlite':
      return localRow;
    case 'keep-firestore':
      return remoteRow;
    case 'skip':
      return null; // signal: keep each side as-is
    case 'last-write-wins':
    default: {
      // @users: a login-time password upgrade re-hashes without touching
      // created_at, so equal timestamps must not let a legacy plaintext row
      // overwrite the hashed side (or vice versa) — the hashed row wins.
      if (preferHashed) {
        const lh = isHashed(localRow.password);
        const rh = isHashed(remoteRow.password);
        if (lh && !rh) return localRow;
        if (rh && !lh) return remoteRow;
      }
      const lt = typeof updated === 'function' ? updated(localRow) : localRow[updated];
      const rt = typeof updated === 'function' ? updated(remoteRow) : remoteRow[updated];
      if (lt && rt) return lt >= rt ? localRow : remoteRow;
      if (rt) return remoteRow; // remote has a timestamp, local does not → remote is newer
      return localRow; // neither has one (or only local does) → local wins
    }
  }
}

// Returns { report, toLocal, toRemote }.
//   toLocal  — canonical datasets to write into SQLite
//   toRemote — canonical datasets to write into Firestore
// Under 'skip' a conflicting row keeps its own side's value in each plan.
function diffAndMerge(local, remote, { conflict = 'last-write-wins', deletions = 'ignore' } = {}) {
  const report = { perDataset: {}, conflicts: [], deleted: [] };
  const toLocal = {};
  const toRemote = {};

  for (const ds of ORDER) {
    if (ds === 'inventory.json') continue; // handled below

    const cfg = DATASETS[ds];
    const localRows = local[ds] || [];
    const remoteRows = remote[ds] || [];
    const localMap = new Map(localRows.map((r) => [keyOf(r), r]));
    const remoteMap = new Map(remoteRows.map((r) => [keyOf(r), r]));

    let added = 0, updated = 0, removed = 0, conflicts = 0, unchanged = 0;
    // added   = rows only on the LOCAL side (pushed up by default)
    // removed = rows only on the REMOTE side (pulled down by default; dropped
    //           from the target under --deletions=propagate)
    const outLocal = [];
    const outRemote = [];

    const keys = new Set([...localMap.keys(), ...remoteMap.keys()]);
    keys.forEach((k) => {
      const lr = localMap.get(k);
      const rr = remoteMap.get(k);
      if (lr === undefined) {
        // Only on the remote side.
        removed += 1;
        report.deleted.push({ dataset: ds, id: k, side: 'sqlite-missing' });
        if (deletions === 'propagate') outLocal.push(rr); // SQLite-mirror plan pulls it; the Firestore-mirror plan drops it
        else { outLocal.push(rr); outRemote.push(rr); } // union: pull into SQLite
        return;
      }
      if (rr === undefined) {
        // Only on the local side.
        added += 1;
        if (deletions === 'propagate') {
          outRemote.push(lr); // Firestore-mirror plan pushes it; the SQLite-mirror plan drops it
          report.deleted.push({ dataset: ds, id: k, side: 'firestore-missing' });
        } else { outLocal.push(lr); outRemote.push(lr); } // union: push it up
        return;
      }
      if (stableStringify(lr) === stableStringify(rr)) {
        unchanged += 1;
        outLocal.push(lr);
        outRemote.push(rr);
        return;
      }
      const winner = resolveConflict(lr, rr, { conflict, updated: cfg.updated, preferHashed: ds === '@users' });
      if (winner === null) {
        conflicts += 1;
        report.conflicts.push({ dataset: ds, id: k, local: lr, remote: rr });
        outLocal.push(lr); // each side keeps its own
        outRemote.push(rr);
      } else {
        updated += 1;
        outLocal.push(winner);
        outRemote.push(winner);
      }
    });

    report.perDataset[ds] = { added, updated, removed, conflicts, unchanged, total: outLocal.length };
    toLocal[ds] = outLocal;
    toRemote[ds] = outRemote;
  }

  // --- inventory (special): union of locations + per-product item merge ---
  const localInv = local['inventory.json'] || { locations: [], items: {} };
  const remoteInv = remote['inventory.json'] || { locations: [], items: {} };
  const localUpd = new Map((local['products.json'] || []).map((p) => [p.id, p]));
  const remoteUpd = new Map((remote['products.json'] || []).map((p) => [p.id, p]));

  const locations = [...localInv.locations];
  remoteInv.locations.forEach((name) => {
    if (!locations.includes(name)) locations.push(name);
  });

  const localRows = inventoryToRows(localInv, localUpd);
  const remoteRows = inventoryToRows(remoteInv, remoteUpd);
  const localMap = new Map(localRows.map((r) => [r.id, r]));
  const remoteMap = new Map(remoteRows.map((r) => [r.id, r]));
  const outLocal = [];
  const outRemote = [];
  let added = 0, updated = 0, removed = 0, conflicts = 0, unchanged = 0;

  const keys = new Set([...localMap.keys(), ...remoteMap.keys()]);
  keys.forEach((k) => {
    const lr = localMap.get(k);
    const rr = remoteMap.get(k);
    if (lr === undefined) {
      removed += 1;
      report.deleted.push({ dataset: 'inventory.json', id: k, side: 'sqlite-missing' });
      if (deletions === 'propagate') outLocal.push(rr);
      else { outLocal.push(rr); outRemote.push(rr); }
      return;
    }
    if (rr === undefined) {
      added += 1;
      if (deletions === 'propagate') {
        outRemote.push(lr);
        report.deleted.push({ dataset: 'inventory.json', id: k, side: 'firestore-missing' });
      } else { outLocal.push(lr); outRemote.push(lr); }
      return;
    }
    if (stableStringify(lr.locations) === stableStringify(rr.locations)) {
      unchanged += 1;
      outLocal.push(lr);
      outRemote.push(rr);
      return;
    }
    const winner = resolveConflict(lr, rr, { conflict, updated: 'updated_at' });
    if (winner === null) {
      conflicts += 1;
      report.conflicts.push({ dataset: 'inventory.json', id: k, local: lr, remote: rr });
      outLocal.push(lr);
      outRemote.push(rr);
    } else {
      updated += 1;
      outLocal.push(winner);
      outRemote.push(winner);
    }
  });

  report.perDataset['inventory.json'] = { added, updated, removed, conflicts, unchanged, total: outLocal.length };
  toLocal['inventory.json'] = rowsToInventory(locations, outLocal);
  toRemote['inventory.json'] = rowsToInventory(locations, outRemote);

  // Cap the conflict examples printed in reports (never passwords).
  report.conflicts.forEach((c) => {
    if (c.dataset === '@users' && c.local && c.remote) {
      c.local = { ...c.local, password: '***' };
      c.remote = { ...c.remote, password: '***' };
    }
  });

  return { report, toLocal, toRemote };
}

// ---------- apply to SQLite ----------

function applyToSqlite(db, canonical, { deleteMissing = false } = {}) {
  const byId = (rows) => rows.filter((r) => r.id !== null);

  // Products: upsert by id (ids stay stable across the sync).
  const upsertProduct = db.prepare(
    `INSERT INTO products (id, name, category, brand, description, size, unit, price, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, category=excluded.category, brand=excluded.brand,
       description=excluded.description, size=excluded.size, unit=excluded.unit,
       price=excluded.price, status=excluded.status, updated_at=excluded.updated_at`
  );
  for (const p of byId(canonical['products.json'])) {
    upsertProduct.run(p.id, p.name, p.category, p.brand, p.description, p.size, p.unit, p.price, p.status, p.updated_at);
  }

  // Locations: ensure every name exists (never deletes).
  const getLoc = db.prepare('SELECT id FROM locations WHERE name = ?');
  const addLoc = db.prepare('INSERT INTO locations (name) VALUES (?)');
  const inv = canonical['inventory.json'] || { locations: [], items: {} };
  inv.locations.forEach((name) => { if (!getLoc.get(name)) addLoc.run(name); });
  const locId = new Map(inv.locations.map((name, i) => [name, getLoc.get(name).id]));

  // Stock: rebuild for every product present in the merged inventory.
  const delStock = db.prepare('DELETE FROM stock WHERE product_id = ?');
  const addStock = db.prepare('INSERT INTO stock (product_id, location_id, quantity) VALUES (?, ?, ?)');
  Object.entries(inv.items || {}).forEach(([pid, item]) => {
    const productId = Number(pid);
    delStock.run(productId);
    Object.entries(item.locations || {}).forEach(([name, qty]) => {
      const lid = locId.get(name);
      if (lid) addStock.run(productId, lid, qty);
    });
  });

  // Movements / inquiries / users / sales / alerts: upsert by id.
  const upsertMovement = db.prepare(
    `INSERT INTO stock_movements (id, product_id, qty, type, src_location, dst_location, notes, created_at, user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       product_id=excluded.product_id, qty=excluded.qty, type=excluded.type,
       src_location=excluded.src_location, dst_location=excluded.dst_location,
       notes=excluded.notes, created_at=excluded.created_at, user=excluded.user`
  );
  for (const m of byId(canonical['stock_movements.json'])) {
    upsertMovement.run(m.id, m.product_id, m.qty, m.type, m.src_location, m.dst_location, m.notes, m.created_at, m.user);
  }

  const upsertInquiry = db.prepare(
    `INSERT INTO order_inquiries (id, customer_name, customer_email, customer_phone, products, estimated_cost, notes, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       customer_name=excluded.customer_name, customer_email=excluded.customer_email,
       customer_phone=excluded.customer_phone, products=excluded.products,
       estimated_cost=excluded.estimated_cost, notes=excluded.notes,
       status=excluded.status, created_at=excluded.created_at`
  );
  for (const o of byId(canonical['order_inquiries.json'])) {
    upsertInquiry.run(o.id, o.customer_name, o.customer_email, o.customer_phone, o.products, o.estimated_cost, o.notes, o.status, o.created_at);
  }

  const upsertUser = db.prepare(
    `INSERT INTO users (id, username, password, role, email, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       username=excluded.username, password=excluded.password, role=excluded.role,
       email=excluded.email, created_at=excluded.created_at`
  );
  for (const u of byId(canonical['@users'])) {
    upsertUser.run(u.id, u.username, u.password, u.role, u.email, u.created_at);
  }

  const upsertSale = db.prepare(
    `INSERT INTO sales_transactions (id, product_id, qty, unit_price, total_amount, transaction_date, customer_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       product_id=excluded.product_id, qty=excluded.qty, unit_price=excluded.unit_price,
       total_amount=excluded.total_amount, transaction_date=excluded.transaction_date,
       customer_name=excluded.customer_name`
  );
  for (const t of byId(canonical['@sales'])) {
    upsertSale.run(t.id, t.product_id, t.qty, t.unit_price, t.total_amount, t.transaction_date, t.customer_name);
  }

  const upsertAlert = db.prepare(
    `INSERT INTO inventory_alerts (id, product_id, location_id, alert_type, threshold, current_qty, status, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       product_id=excluded.product_id, location_id=excluded.location_id,
       alert_type=excluded.alert_type, threshold=excluded.threshold,
       current_qty=excluded.current_qty, status=excluded.status,
       created_at=excluded.created_at, resolved_at=excluded.resolved_at`
  );
  for (const a of byId(canonical['@alerts'])) {
    upsertAlert.run(a.id, a.product_id, a.location_id, a.alert_type, a.threshold, a.current_qty, a.status, a.created_at, a.resolved_at);
  }

  // Mirror mode (--deletions=propagate, one-way direction): rows absent from
  // the authoritative side are deleted here. Products are SOFT-deleted only
  // (their ids are referenced by stock/movements and stay stable); locations
  // are never auto-deleted (stock safety).
  if (deleteMissing) {
    const delNotIn = (table, rows) => {
      const ids = byId(rows).map((r) => r.id);
      if (ids.length === 0) {
        db.prepare(`DELETE FROM ${table}`).run();
        return;
      }
      const ph = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM ${table} WHERE id NOT IN (${ph})`).run(...ids);
    };
    delNotIn('stock_movements', canonical['stock_movements.json']);
    delNotIn('order_inquiries', canonical['order_inquiries.json']);
    delNotIn('users', canonical['@users']);
    delNotIn('sales_transactions', canonical['@sales']);
    delNotIn('inventory_alerts', canonical['@alerts']);
    const productIds = byId(canonical['products.json']).map((r) => r.id);
    if (productIds.length === 0) {
      db.prepare("UPDATE products SET status = 'inactive'").run();
      db.prepare('DELETE FROM stock').run();
    } else {
      const ph = productIds.map(() => '?').join(',');
      db.prepare(`UPDATE products SET status = 'inactive' WHERE id NOT IN (${ph})`).run(...productIds);
      // Soft-deleted products keep their stock rows unless cleaned up; drop
      // them so per-location totals can't diverge from the authoritative side.
      db.prepare(`DELETE FROM stock WHERE product_id NOT IN (${ph})`).run(...productIds);
    }
  }
}

// ---------- apply to Firestore ----------

function sortById(rows) {
  return [...rows].sort((a, b) => (keyOf(a) || 0) - (keyOf(b) || 0));
}

// canonical product row → npm-free JSON row (mirrors migrate-firestore).
function jsonProduct(p) {
  const out = {
    'Product Name': p.name,
    'Category': p.category,
    'Brand': p.brand,
    'Description': p.description,
    'Size': p.size,
    'Unit': p.unit,
    'Price': p.price,
    'updated_at': p.updated_at,
  };
  if (p.status === 'inactive') out['status'] = 'inactive';
  return out;
}

function applyToFirestore(store, canonical) {
  store.write('products.json', sortById(canonical['products.json']).map(jsonProduct));

  const inv = canonical['inventory.json'] || { locations: [], items: {} };
  const items = Object.entries(inv.items || {})
    .map(([pid, item]) => ({ product: { id: Number(pid) }, locations: item.locations || {} }))
    .sort((a, b) => a.product.id - b.product.id);
  store.write('inventory.json', { locations: inv.locations, items });

  store.write('stock_movements.json', sortById(canonical['stock_movements.json']));
  store.write('order_inquiries.json', sortById(canonical['order_inquiries.json']));
  store.write('@users', sortById(canonical['@users']));
  store.write('@sales', sortById(canonical['@sales']));
  store.write('@alerts', sortById(canonical['@alerts']));
  return store.flush();
}

// ---------- CLI ----------

function printReport(report) {
  console.log('Per dataset  (removed = rows present only on the other side):');
  for (const [ds, r] of Object.entries(report.perDataset)) {
    console.log(
      `  ${ds.padEnd(22)} added=${r.added} updated=${r.updated} conflicts=${r.conflicts} removed=${r.removed} unchanged=${r.unchanged}`
    );
  }
  if (report.conflicts.length) {
    console.log(`\nConflicts (${report.conflicts.length}):`);
    report.conflicts.slice(0, 10).forEach((c) => {
      console.log(`  ${c.dataset} id=${c.id}`);
      console.log(`    sqlite:    ${JSON.stringify(c.local)}`);
      console.log(`    firestore: ${JSON.stringify(c.remote)}`);
    });
    if (report.conflicts.length > 10) console.log(`  … and ${report.conflicts.length - 10} more`);
  }
  if (report.deleted.length) {
    console.log(`\nPresence-only rows (${report.deleted.length}): pulled by default; dropped from the target with --deletions=propagate`);
    report.deleted.slice(0, 10).forEach((d) => console.log(`  ${d.dataset} id=${d.id} (${d.side})`));
    if (report.deleted.length > 10) console.log(`  … and ${report.deleted.length - 10} more`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const pick = (flag, fallback) => {
    const hit = argv.find((a) => a.startsWith(`${flag}=`));
    return hit ? hit.slice(flag.length + 1) : fallback;
  };
  const direction = pick('--direction', 'both');
  const conflict = pick('--conflict', 'last-write-wins');
  const deletions = pick('--deletions', 'ignore');

  if (!['both', 'to-firestore', 'to-sqlite'].includes(direction)) {
    console.error('--direction must be both | to-firestore | to-sqlite');
    process.exit(1);
  }
  if (deletions === 'propagate' && direction === 'both') {
    console.error('--deletions=propagate requires a one-way --direction (deletions are ambiguous without tombstones).');
    process.exit(1);
  }

  const dbPath = process.env.INVENTRAK_DB_PATH || path.join(__dirname, '..', 'data', 'inventrak.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`SQLite database not found: ${dbPath}`);
    process.exit(1);
  }

  // Read the local side. dumpSnapshot opens its own readonly connection from
  // dbPath; no separate connection is needed here.
  const { dumpSnapshot } = require('./migrate-firestore');
  let local = canonicalFromSqlite(dumpSnapshot(dbPath));

  // Read the cloud side.
  const store = require('./store-firestore');
  await store.init();
  const read = {};
  for (const ds of ORDER) read[ds] = store.read(ds);
  const remote = canonicalFromFirestore(read);

  const { report, toLocal, toRemote } = diffAndMerge(local, remote, { conflict, deletions });

  console.log(`Sync plan (${direction}, conflict=${conflict}, deletions=${deletions})${dryRun ? ' — DRY RUN, nothing written' : ''}`);
  printReport(report);

  if (dryRun) return;

  const writer = new Database(dbPath);
  try {
    if (direction === 'both' || direction === 'to-sqlite') {
      applyToSqlite(writer, toLocal, { deleteMissing: deletions === 'propagate' });
    }
    if (direction === 'both' || direction === 'to-firestore') {
      await applyToFirestore(store, toRemote);
    }
  } finally {
    writer.close();
  }
  console.log('\nSync applied.');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Sync failed:', err && err.message);
      process.exit(1);
    });
}

module.exports = {
  canonicalFromSqlite,
  canonicalFromFirestore,
  diffAndMerge,
  applyToSqlite,
  applyToFirestore,
  stableStringify,
  canonStatus,
};

// Database backup and recovery — export/restore on BOTH backends.
//
// The valuable property here is not "the endpoint answers 200". It is that a
// snapshot is a faithful copy: take one, change the database, put the snapshot
// back, and the change is gone while the snapshot's rows are all present. That
// is what a recovery claims, so that is what is asserted.
//
// Each test runs against the SQLite Express backend and the npm-free fallback
// because they are separate implementations of the same contract — and because
// their snapshots are legitimately different (SQLite exports tables, the store
// backend exports datasets), the cross-driver guard is tested directly by
// feeding one backend's snapshot to the other.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

test.before(async () => {
  await bootBoth();
});
test.after(() => teardown());

const SIDES = [
  ['sqlite', () => sqlite],
  ['npmfree', () => npmfree],
];

async function exportBackup(side) {
  const res = await call(side.url, '/api/admin/backup', { token: side.token.owner });
  assert.equal(res.status, 200, 'export succeeds');
  return res.json;
}

async function restore(side, snapshot, extra = {}) {
  return call(side.url, '/api/admin/restore', {
    method: 'POST',
    token: side.token.owner,
    body: { confirm: true, snapshot, ...extra },
  });
}

test('backup: the snapshot is self-describing and complete on both backends', async () => {
  for (const [label, get] of SIDES) {
    const side = get();
    const snapshot = await exportBackup(side);

    assert.equal(snapshot.format, 'inventrak-backup', `${label} format`);
    assert.equal(snapshot.version, 1, `${label} version`);
    assert.ok(['sqlite', 'json', 'supabase', 'firestore'].includes(snapshot.driver), `${label} driver`);
    assert.equal(snapshot.generated_by, 'owner', `${label} records who exported it`);
    assert.ok(typeof snapshot.created_at === 'string' && snapshot.created_at.length > 0);

    // Every table is an array of rows, and counts agrees with the rows shipped.
    const names = Object.keys(snapshot.tables);
    assert.ok(names.length > 5, `${label} exports more than a handful of tables`);
    for (const name of names) {
      assert.ok(Array.isArray(snapshot.tables[name]), `${label} ${name} is an array of rows`);
      assert.equal(snapshot.counts[name], snapshot.tables[name].length, `${label} ${name} count matches rows`);
    }
    // The datasets this system actually cannot lose.
    for (const required of ['products', 'stock_adjustments']) {
      assert.ok(names.includes(required), `${label} snapshot includes ${required}`);
    }
  }
});

test('backup: the drivers report themselves honestly (and differ)', async () => {
  const a = await exportBackup(sqlite);
  const b = await exportBackup(npmfree);
  assert.equal(a.driver, 'sqlite');
  assert.equal(b.driver, 'json');
  assert.notDeepEqual(Object.keys(a.tables).sort(), Object.keys(b.tables).sort());
});

test('backup and restore require Owner or Super Admin access', async () => {
  for (const [label, get] of SIDES) {
    const side = get();
    let r = await call(side.url, '/api/admin/backup');
    assert.equal(r.status, 401, `${label} anonymous export refused`);
    r = await call(side.url, '/api/admin/backup', { token: side.token.staff });
    assert.equal(r.status, 403, `${label} staff export refused`);
    r = await call(side.url, '/api/admin/backup', { token: side.token.admin });
    assert.equal(r.status, 403, `${label} admin export refused`);
    r = await call(side.url, '/api/admin/restore', {
      method: 'POST',
      token: side.token.staff,
      body: { confirm: true, snapshot: { format: 'inventrak-backup', version: 1, driver: 'sqlite', tables: {} } },
    });
    assert.equal(r.status, 403, `${label} staff restore refused`);
    r = await call(side.url, '/api/admin/restore', {
      method: 'POST',
      token: side.token.admin,
      body: { confirm: true, snapshot: { format: 'inventrak-backup', version: 1, driver: 'sqlite', tables: {} } },
    });
    assert.equal(r.status, 403, `${label} admin restore refused`);
  }
});

test('restore: a snapshot round-trips — the change made after it is gone', async () => {
  for (const [label, get] of SIDES) {
    const side = get();

    // 1. A row that must survive the round-trip.
    const keep = await call(side.url, '/api/stock-adjustments', {
      method: 'POST',
      token: side.token.admin,
      body: { product_id: 1, location_id: 1, new_qty: 7, reason: 'snapshot me' },
    });
    assert.equal(keep.status, 201, `${label} created the row to keep`);

    // 2. Snapshot while that row exists.
    const snapshot = await exportBackup(side);
    const snapshotIds = snapshot.tables.stock_adjustments.map((r) => r.id);

    // 3. Move on: a new row that a restore must undo.
    const extra = await call(side.url, '/api/stock-adjustments', {
      method: 'POST',
      token: side.token.admin,
      body: { product_id: 1, location_id: 1, new_qty: 3, reason: 'created after the snapshot' },
    });
    assert.equal(extra.status, 201, `${label} created the row to lose`);
    assert.ok(!snapshotIds.includes(extra.json.id), `${label} the new row is genuinely new`);

    // 4. Restore.
    const done = await restore(side, snapshot);
    assert.equal(done.status, 200, `${label} restore succeeds: ${done.text.slice(0, 300)}`);
    assert.equal(done.json.ok, true);
    assert.equal(done.json.driver, snapshot.driver);
    assert.equal(done.json.tables_restored, Object.keys(snapshot.tables).length);
    assert.equal(done.json.rows_restored, snapshotIds.length + Object.keys(snapshot.tables)
      .filter((n) => n !== 'stock_adjustments')
      .reduce((sum, n) => sum + snapshot.tables[n].length, 0));

    // 5. The listing is exactly the snapshot again.
    const list = await call(side.url, '/api/stock-adjustments', { token: side.token.admin });
    assert.equal(list.status, 200, `${label} list after restore`);
    const ids = list.json.map((r) => r.id).sort((x, y) => x - y);
    assert.deepEqual(ids, [...snapshotIds].sort((x, y) => x - y), `${label} adjustments are exactly the snapshot`);
    const kept = list.json.find((r) => r.id === keep.json.id);
    assert.ok(kept, `${label} the kept row came back`);
    assert.equal(kept.new_qty, 7, `${label} with its values intact`);
    assert.equal(kept.reason, 'snapshot me', `${label} including free text`);
  }
});

test('restore: refuses an unconfirmed, foreign-driver or malformed snapshot', async () => {
  for (const [label, get] of SIDES) {
    const side = get();
    const snapshot = await exportBackup(side);

    // No confirmation: a restore deletes everything, so it has to be deliberate.
    let r = await call(side.url, '/api/admin/restore', {
      method: 'POST',
      token: side.token.owner,
      body: { snapshot },
    });
    assert.equal(r.status, 400, `${label} requires confirm`);

    // A snapshot from the OTHER driver must be refused rather than half-applied.
    const other = await exportBackup(side === sqlite ? npmfree : sqlite);
    r = await restore(side, other);
    assert.equal(r.status, 400, `${label} refuses a foreign-driver snapshot`);
    assert.match(r.json.error, /driver/i);

    // Wrong envelope version.
    r = await restore(side, { ...snapshot, version: 99 });
    assert.equal(r.status, 400, `${label} refuses an unknown version`);

    // Not a backup at all.
    r = await restore(side, { hello: 'world' });
    assert.equal(r.status, 400, `${label} refuses a non-backup body`);

    // A table that does not exist here (a typo must not mean "delete nothing").
    r = await restore(side, { ...snapshot, tables: { ...snapshot.tables, not_a_table: [] } });
    assert.equal(r.status, 400, `${label} refuses an unknown table`);

    // A table whose rows are not an array.
    const firstTable = Object.keys(snapshot.tables)[0];
    r = await restore(side, { ...snapshot, tables: { ...snapshot.tables, [firstTable]: 'nope' } });
    assert.equal(r.status, 400, `${label} refuses non-array rows`);
  }
});

test('restore: a rejected snapshot leaves the live database untouched', async () => {
  for (const [label, get] of SIDES) {
    const side = get();
    const before = await exportBackup(side);
    const other = await exportBackup(side === sqlite ? npmfree : sqlite);

    const r = await restore(side, other);
    assert.equal(r.status, 400, `${label} refused`);

    // Same rows after the failed attempt as before it.
    const after = await exportBackup(side);
    for (const name of Object.keys(before.tables)) {
      assert.equal(
        after.tables[name].length,
        before.tables[name].length,
        `${label} ${name} was not touched by the refused restore`
      );
    }
  }
});

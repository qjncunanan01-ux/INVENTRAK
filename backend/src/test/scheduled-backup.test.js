// Scheduled backups into the durable store.
//
// The claim this suite has to prove is not "the timer exists". It is that a
// container can be wiped and still be brought back, WITHOUT an admin having
// remembered to download anything: a snapshot is pushed to the durable store on
// its own, and a restore can name a snapshot that lives there.
//
// So the tests run against a real HTTP double of the durable store (the same
// PostgREST shape audit.js talks to, so no new dependency and no network), and
// the round-trip ones go through the API a browser console uses:
//
//   1. SCHEDULE    — a timer pushes a snapshot with nobody pressing anything,
//                    and the snapshot it pushes is complete and self-describing.
//   2. RECOVERY    — change the data after a snapshot; restore `latest` from the
//                    store instead of a file; the change is gone and the
//                    snapshot's rows are back. This is the whole point.
//   3. HONESTY     — no durable store, an unreachable one, or an oversized
//                    snapshot reports WHY, because a backup that fails quietly
//                    is discovered on the day it is needed.
//   4. WINDOW      — the newest N are kept, older ones are pruned, so the
//                    schedule does not have to be switched off to stop growing.
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');

const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');
const remote = require('../governance/backup-remote');

const SIDES = [
  ['sqlite', () => sqlite],
  ['npmfree', () => npmfree],
];

// ---------------------------------------------------------------------------
// The durable store, as PostgREST: POST inserts, GET selects with the handful
// of filters this module uses (id=eq / id=in / order / limit / offset), DELETE
// removes. Every request is recorded so a test can assert what the module did
// (and did not) ask for.
// ---------------------------------------------------------------------------
function startDurableStore({ failWrites = false, ignoreOffset = false } = {}) {
  const rows = [];
  const requests = [];
  let nextId = 1;
  // Mutable so a test can make a store that was accepting writes start
  // refusing them — "the store broke AFTER a good backup" is the case where the
  // last successful backup has to survive on the record.
  const flags = { failWrites, ignoreOffset };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://durable');
    const table = url.pathname.replace(/^\/rest\/v1\//, '').split('/')[0];
    if (table !== 'backup_snapshots' && table !== 'audit_log') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `relation "${table}" does not exist` }));
      return;
    }

    if (req.method === 'POST' && table === 'backup_snapshots') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        requests.push({ method: 'POST', path: url.pathname, query: url.search });
        if (flags.failWrites) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'service unavailable' }));
          return;
        }
        const parsed = JSON.parse(body || '{}');
        const row = { id: nextId++, ...parsed };
        rows.push(row);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([row]));
      });
      return;
    }

    if (req.method === 'POST') {
      // audit_log mirroring (audit.js) — accept and forget.
      req.resume();
      req.on('end', () => {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end('[]');
      });
      return;
    }

    if (req.method === 'GET' && table === 'backup_snapshots') {
      requests.push({ method: 'GET', path: url.pathname, query: url.search });
      let found = [...rows];
      const idEq = url.searchParams.get('id');
      if (idEq && idEq.startsWith('eq.')) {
        found = found.filter((r) => String(r.id) === idEq.slice(3));
      }
      const inMatch = url.searchParams.get('id');
      if (inMatch && inMatch.startsWith('in.(')) {
        const ids = inMatch.slice(4, -1).split(',').map((s) => s.trim());
        found = found.filter((r) => ids.includes(String(r.id)));
      }
      if (/created_at\.desc/.test(url.searchParams.get('order') || '')) {
        found.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id);
      }
      // `ignoreOffset` models a store (or proxy) that mis-handles the retention
      // sweep's paging — the failure mode that must never be able to take the
      // snapshot we just pushed down with it.
      const offset = flags.ignoreOffset ? 0 : Number(url.searchParams.get('offset') || 0);
      const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined;
      found = found.slice(offset, limit === undefined ? undefined : offset + limit);
      // `select` is honoured by projection: a listing must not ship the bodies.
      const select = url.searchParams.get('select');
      const projected = select
        ? found.map((r) => Object.fromEntries(select.split(',').map((k) => [k.trim(), r[k.trim()]])))
        : found;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(projected));
      return;
    }

    if (req.method === 'DELETE' && table === 'backup_snapshots') {
      requests.push({ method: 'DELETE', path: url.pathname, query: url.search });
      const inMatch = url.searchParams.get('id') || '';
      const ids = inMatch.startsWith('in.(') ? inMatch.slice(4, -1).split(',').map((s) => s.trim()) : [];
      for (let i = rows.length - 1; i >= 0; i--) if (ids.includes(String(rows[i].id))) rows.splice(i, 1);
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        rows,
        requests,
        flags,
        failWrites: (value) => { flags.failWrites = value; },
        origin: `http://127.0.0.1:${server.address().port}`,
        rest: () => `http://127.0.0.1:${server.address().port}/rest/v1`,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Environment plumbing: this module reads its config per call (so a running
// deployment can be pointed at a store without a reload), which is what lets a
// test switch stores between cases. Everything it reads is saved and restored.
// ---------------------------------------------------------------------------
const ENV_KEYS = [
  'BACKUP_REMOTE_URL',
  'BACKUP_REMOTE_KEY',
  'BACKUP_REMOTE_TABLE',
  'BACKUP_KEEP',
  'BACKUP_INTERVAL_MINUTES',
  'BACKUP_MAX_BYTES',
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'SUPABASE_ANON_KEY',
];
let savedEnv = {};

function setEnv(patch) {
  for (const key of ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      if (patch[key] === undefined) delete process.env[key];
      else process.env[key] = patch[key];
    }
  }
}

function clearStoreEnv() {
  setEnv(Object.fromEntries(ENV_KEYS.map((k) => [k, undefined])));
}

before(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  await bootBoth();
});

after(() => {
  remote.stopScheduler();
  setEnv(savedEnv);
  // The store double is a listening socket: leaving it open would keep the
  // test process alive after the last assertion.
  if (store) store.server.close();
  teardown();
});

// A live store on the default table (BACKUP_REMOTE_TABLE unset) with the
// schedule off, so a test that wants the timer must ask for it.
let store;
beforeEach(async () => {
  remote.stopScheduler();
  if (!store) store = await startDurableStore();
  store.rows.length = 0;
  store.requests.length = 0;
  clearStoreEnv();
  setEnv({ BACKUP_REMOTE_URL: store.rest(), BACKUP_REMOTE_KEY: 'service-role-key', BACKUP_INTERVAL_MINUTES: '0' });
});

async function push(side, token = side.token.admin) {
  return call(side.url, '/api/admin/backup', { method: 'POST', token });
}

function auditLines() {
  try {
    return fs.readFileSync(process.env.AUDIT_LOG_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

describe('scheduled snapshots reach the durable store', () => {
  test('a snapshot can be pushed on demand, and it is complete and self-describing', async () => {
    for (const [label, get] of SIDES) {
      const side = get();
      store.rows.length = 0;
      const res = await push(side);
      assert.equal(res.status, 200, `${label} push: ${res.text.slice(0, 200)}`);
      assert.equal(res.json.ok, true);
      assert.equal(res.json.source, 'durable-store');
      assert.ok(res.json.bytes > 0, `${label} reports the snapshot size`);
      assert.ok(res.json.rows > 0, `${label} reports the row count`);

      assert.equal(store.rows.length, 1, `${label} stored exactly one snapshot`);
      const row = store.rows[0];
      const envelope = row.data;
      assert.equal(envelope.format, 'inventrak-backup', `${label} envelope format`);
      assert.equal(envelope.version, 1);
      assert.equal(envelope.driver, label === 'sqlite' ? 'sqlite' : 'json');
      assert.equal(envelope.generated_by, 'admin', `${label} records who took the manual snapshot`);
      assert.equal(row.driver, envelope.driver);
      assert.equal(row.bytes, Buffer.byteLength(JSON.stringify(envelope)), `${label} byte count matches the payload`);
      assert.deepEqual(row.counts, envelope.counts, `${label} stores counts beside the payload for listing`);
      assert.equal(res.json.id, row.id, `${label} answers with the id a restore can name`);
    }
  });

  test('the timer pushes one by itself, with nobody pressing anything, and stops when stopped', async () => {
    store.rows.length = 0;
    // everyMs rather than an hour: a timer that is only ever pointed at by a
    // 60-minute env value is a timer no test ever runs.
    const started = remote.startScheduler(
      () => require('../governance/backup').buildEnvelope({ driver: 'json', tables: { products: [{ id: 1 }] }, generatedBy: 'schedule' }),
      { everyMs: 25 },
    );
    assert.equal(started.started, true, 'the scheduler starts when a store is configured');

    const deadline = Date.now() + 3000;
    while (store.rows.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(store.rows.length >= 2, `the timer pushed on its own (saw ${store.rows.length})`);
    assert.equal(store.rows[0].data.generated_by, 'schedule', 'and marks it as a scheduled, not a manual, snapshot');
    assert.equal(store.rows[0].driver, 'json');

    assert.equal(remote.stopScheduler(), true);
    const settled = store.rows.length;
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(store.rows.length, settled, 'no pushes after stop()');

    const lines = auditLines().filter((l) => l.event === 'backup.pushed' && l.trigger === 'schedule');
    assert.ok(lines.length >= 1, 'every scheduled push is on the audit trail');
  });

  test('a schedule with no durable store reports OFF instead of ticking into nothing', () => {
    clearStoreEnv();
    const started = remote.startScheduler(() => ({ format: 'inventrak-backup', version: 1 }), { everyMs: 25 });
    assert.equal(started.started, false);
    assert.match(started.reason, /no durable store/i);
    assert.equal(remote.stopScheduler(), false, 'nothing was left running');
  });

  test('a store that mis-pages the retention sweep cannot make a push delete itself', async () => {
    // The sweep decides what to delete from a listing ordered newest-first with
    // an offset, so a store that ignores `offset` would hand back the newest row
    // as "older than the window" — and the backup taken a moment ago would be
    // the first thing deleted. The row just written is therefore protected.
    const naive = await startDurableStore({ ignoreOffset: true });
    try {
      setEnv({ BACKUP_REMOTE_URL: naive.rest(), BACKUP_REMOTE_KEY: 'k', BACKUP_KEEP: '2' });
      const res = await push(sqlite);
      assert.equal(res.status, 200, res.text.slice(0, 200));
      assert.ok(
        naive.rows.some((r) => String(r.id) === String(res.json.id)),
        'the snapshot just stored is still in the store',
      );
    } finally {
      naive.server.close();
    }
  });

  test('retention keeps the newest N and prunes the rest', async () => {
    setEnv({ BACKUP_KEEP: '2' });
    for (let i = 0; i < 3; i++) {
      const res = await push(sqlite);
      assert.equal(res.status, 200, `push ${i + 1}: ${res.text.slice(0, 200)}`);
    }
    assert.equal(store.rows.length, 2, 'the window holds BACKUP_KEEP snapshots');
    assert.ok(store.requests.some((r) => r.method === 'DELETE'), 'the oldest was actually deleted from the store');
    assert.ok(store.rows.every((r) => r.data), 'the survivors still carry their snapshots');
  });
});

describe('recovery without a downloaded file', () => {
  test('a snapshot restored from the store rolls the database back, on both backends', async () => {
    for (const [label, get] of SIDES) {
      const side = get();
      store.rows.length = 0;

      const keep = await call(side.url, '/api/stock-adjustments', {
        method: 'POST',
        token: side.token.admin,
        body: { product_id: 1, location_id: 1, new_qty: 7, reason: 'in the scheduled snapshot' },
      });
      assert.equal(keep.status, 201, `${label} created the row to keep`);

      const pushed = await push(side);
      assert.equal(pushed.status, 200, `${label} scheduled push: ${pushed.text.slice(0, 200)}`);

      const extra = await call(side.url, '/api/stock-adjustments', {
        method: 'POST',
        token: side.token.admin,
        body: { product_id: 1, location_id: 1, new_qty: 3, reason: 'after the snapshot' },
      });
      assert.equal(extra.status, 201, `${label} created the row to lose`);

      // No file, no uploaded body: name the snapshot by where it lives.
      const done = await call(side.url, '/api/admin/restore', {
        method: 'POST',
        token: side.token.admin,
        body: { confirm: true, snapshot_id: 'latest' },
      });
      assert.equal(done.status, 200, `${label} restore from the store: ${done.text.slice(0, 300)}`);
      assert.equal(done.json.source, 'durable-store');
      assert.equal(done.json.snapshot_id, pushed.json.id);
      assert.ok(done.json.rows_restored > 0);

      const list = await call(side.url, '/api/stock-adjustments', { token: side.token.admin });
      const ids = list.json.map((r) => r.id).sort((a, b) => a - b);
      assert.ok(ids.includes(keep.json.id), `${label} the kept row came back`);
      assert.ok(!ids.includes(extra.json.id), `${label} the row created after the snapshot is gone`);

      const lines = auditLines().filter((l) => l.event === 'backup.restored' && l.source === 'durable-store');
      assert.ok(lines.length >= 1, `${label} the recovery is on the audit trail, with its source`);
    }
  });

  test('a stored snapshot is validated exactly like an uploaded one — another driver is refused', async () => {
    store.rows.length = 0;
    // Take one from the json side...
    const pushed = await push(npmfree);
    assert.equal(pushed.status, 200);
    // ...and try to put it into the sqlite side, which stores different shapes.
    const refused = await call(sqlite.url, '/api/admin/restore', {
      method: 'POST',
      token: sqlite.token.admin,
      body: { confirm: true, snapshot_id: 'latest' },
    });
    assert.equal(refused.status, 400);
    assert.match(refused.json.error, /driver/i);

    // And the live database is untouched by the refusal.
    const list = await call(sqlite.url, '/api/stock-adjustments', { token: sqlite.token.admin });
    assert.equal(list.status, 200);
  });

  test('a restore names its source and refuses a request that names nothing', async () => {
    store.rows.length = 0;
    for (const [label, get] of SIDES) {
      const side = get();
      const res = await call(side.url, '/api/admin/restore', {
        method: 'POST',
        token: side.token.admin,
        body: { confirm: true },
      });
      assert.equal(res.status, 400, `${label} refuses a restore with neither a snapshot nor an id`);
      assert.match(res.json.error, /snapshot_id/);
    }
  });

  test('restore stays admin-only through the durable-store path', async () => {
    store.rows.length = 0;
    await push(npmfree);
    for (const [label, get] of SIDES) {
      const side = get();
      const anon = await call(side.url, '/api/admin/restore', {
        method: 'POST',
        body: { confirm: true, snapshot_id: 'latest' },
      });
      assert.equal(anon.status, 401, `${label} anonymous`);

      const staff = await call(side.url, '/api/admin/restore', {
        method: 'POST',
        token: side.token.staff,
        body: { confirm: true, snapshot_id: 'latest' },
      });
      assert.equal(staff.status, 403, `${label} staff cannot replace the database`);
    }
    // The refusals above must not have restored anything.
    const listing = await call(npmfree.url, '/api/admin/backups', { token: npmfree.token.admin });
    assert.equal(listing.status, 200);
  });

  test('what the store holds can be listed, newest first, without shipping the bodies or the key', async () => {
    store.rows.length = 0;
    const first = await push(npmfree);
    // Give the two snapshots distinct timestamps (created_at is second/ms
    // resolution; two pushes in the same millisecond would tie).
    await new Promise((r) => setTimeout(r, 5));
    const second = await push(npmfree);

    const res = await call(sqlite.url, '/api/admin/backups', { token: sqlite.token.admin });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.deepEqual(res.json.snapshots.map((s) => s.id), [second.json.id, first.json.id], 'newest first');
    const top = res.json.snapshots[0];
    assert.ok(top.bytes > 0 && top.rows > 0, 'each row carries size and shape for choosing between them');
    assert.equal(top.driver, 'json');

    assert.equal(res.json.scheduler.enabled, true);
    assert.equal(res.json.scheduler.table, 'backup_snapshots');
    assert.equal(res.json.scheduler.url, store.rest());
    assert.ok(!res.text.includes('service-role-key'), 'the store key is never part of a response');

    // Metadata only: a listing that shipped every body would be a database
    // download on a page refresh.
    assert.ok(!('data' in top), 'the listing does not carry snapshot bodies');
  });
});

describe('a backup that cannot happen says so', () => {
  test('with no durable store configured, a push explains what would fix it', async () => {
    clearStoreEnv();
    for (const [label, get] of SIDES) {
      const side = get();
      const res = await push(side);
      assert.equal(res.status, 503, `${label} cannot push without a store`);
      assert.match(res.json.error, /SUPABASE_URL|BACKUP_REMOTE_URL/);

      const listing = await call(side.url, '/api/admin/backups', { token: side.token.admin });
      assert.equal(listing.status, 200, `${label} still answers "what is scheduled?"`);
      assert.equal(listing.json.ok, false);
      assert.match(listing.json.error, /no durable store/i);
      assert.deepEqual(listing.json.snapshots, []);
      assert.equal(listing.json.scheduler.enabled, false);
    }
  });

  test('a store that refuses the write surfaces the reason rather than a 200', async () => {
    const failing = await startDurableStore({ failWrites: true });
    try {
      setEnv({ BACKUP_REMOTE_URL: failing.rest(), BACKUP_REMOTE_KEY: 'k' });
      const res = await push(sqlite);
      assert.equal(res.status, 503);
      assert.match(res.json.error, /unavailable|refused/i);
      const lines = auditLines().filter((l) => l.event === 'backup.push_failed');
      assert.ok(lines.length >= 1, 'a failed snapshot is on the audit trail, not silently absorbed');
    } finally {
      failing.server.close();
    }
  });

  test('an oversized snapshot is refused with the limit named, not truncated', async () => {
    setEnv({ BACKUP_MAX_BYTES: '100' });
    const res = await push(sqlite);
    assert.equal(res.status, 503);
    assert.match(res.json.error, /over the 100-byte/);
    assert.match(res.json.error, /BACKUP_MAX_BYTES/);
    assert.equal(store.rows.length, 0, 'nothing partial was written');
  });

  test('a listing against an unreachable store reports the failure instead of an empty list', async () => {
    setEnv({ BACKUP_REMOTE_URL: 'http://127.0.0.1:1/rest/v1', BACKUP_REMOTE_KEY: 'k' });
    const res = await call(sqlite.url, '/api/admin/backups', { token: sqlite.token.admin });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, false);
    assert.match(res.json.error, /cannot reach|refused|fetch/i);
  });
});

describe('the schedule is visible where an operator looks', () => {
  test('/api/meta publishes the sink shape (never the key) on both backends', async () => {
    for (const [label, get] of SIDES) {
      const side = get();
      const res = await call(side.url, '/api/meta');
      assert.equal(res.status, 200);
      const backup = res.json.backup;
      assert.ok(backup, `${label} /api/meta carries a backup block`);
      assert.equal(backup.enabled, true);
      assert.equal(backup.table, 'backup_snapshots');
      assert.equal(backup.keep, 7, `${label} reports the retention window default`);
      assert.equal(backup.interval_minutes, 0, `${label} reports the configured period`);
      assert.ok(backup.max_bytes > 0);
      assert.equal(res.json.backup.key, undefined, 'no key is ever exposed');
      assert.ok(!res.text.includes('service-role-key'));
    }
  });

  test('the last successful backup is read from the store, not from this process\'s memory', async () => {
    // The whole reason this is a durable read: a redeploy empties the process,
    // so an in-memory "last pushed" cannot answer "when was the last backup?"
    // at the one moment the question is asked.
    for (const [label, get] of SIDES) {
      const side = get();
      store.rows.length = 0;
      const pushed = await push(side);
      assert.equal(pushed.status, 200, `${label} push`);

      const res = await call(side.url, '/api/admin/backups', { token: side.token.admin });
      assert.equal(res.status, 200);
      const last = res.json.last_backup;
      assert.ok(last, `${label} the listing carries a last_backup block`);
      assert.equal(last.configured, true);
      assert.equal(last.last_backup_at, store.rows[0].created_at, `${label} names the newest stored snapshot`);
      assert.equal(Number(last.snapshot_id), Number(pushed.json.id), `${label} names the id a restore would use`);
      assert.ok(last.age_minutes >= 0 && last.age_minutes < 5, `${label} its age is measured, not guessed (${last.age_minutes})`);
      assert.equal(last.stale, false, `${label} a snapshot taken seconds ago is not stale`);
      assert.equal(last.rows, pushed.json.rows, `${label} reports what is inside it`);
      assert.equal(last.bytes, pushed.json.bytes, `${label} and how big it is`);
      assert.equal(last.reason, null, `${label} no reason needed when it is healthy`);
    }

    // The two backends are separate implementations of one contract: a client
    // reads this block without knowing which one answered, so the keys must
    // match exactly (the contract test's job elsewhere, asserted here too
    // because this field is new and the block is derived, not returned raw).
    const [a, b] = await Promise.all([
      call(sqlite.url, '/api/admin/backups', { token: sqlite.token.admin }),
      call(npmfree.url, '/api/admin/backups', { token: npmfree.token.admin }),
    ]);
    assert.deepEqual(
      Object.keys(a.json.last_backup).sort(),
      Object.keys(b.json.last_backup).sort(),
      'both backends report the same last_backup fields',
    );
    assert.deepEqual(Object.keys(a.json).sort(), Object.keys(b.json).sort(), 'and the same envelope keys');
  });

  test('an aging snapshot is reported as stale against a named threshold', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    store.rows.push({ id: 99, created_at: threeHoursAgo, driver: 'sqlite', bytes: 2048, counts: { products: 5 } });

    const res = await call(sqlite.url, '/api/admin/backups', { token: sqlite.token.admin });
    const last = res.json.last_backup;
    assert.equal(last.last_backup_at, threeHoursAgo);
    assert.equal(last.stale, true, 'a three-hour-old snapshot is stale');
    assert.ok(last.age_minutes >= 179, `its age is reported (${last.age_minutes})`);
    // The schedule is OFF in this suite's env (BACKUP_INTERVAL_MINUTES=0), so
    // the hourly default is the yardstick: two periods of grace.
    assert.equal(last.stale_after_minutes, 120, 'the threshold is named, not implied');
    // The verdict is about the DATA being old, not about a push having failed.
    assert.equal(last.last_attempt_error, null);
  });

  test('a store holding nothing says so, instead of claiming "not stale"', async () => {
    store.rows.length = 0;
    const res = await call(sqlite.url, '/api/admin/backups', { token: sqlite.token.admin });
    assert.equal(res.json.ok, true, 'the store answered — it is simply empty');
    const last = res.json.last_backup;
    assert.equal(last.last_backup_at, null);
    assert.equal(last.stale, true, 'nothing to recover from is maximally stale');
    assert.match(last.reason, /no snapshot has been pushed/i);
    assert.equal(last.stale_after_minutes, 120);
  });

  test('a failed push does not erase the last successful backup', async () => {
    store.rows.length = 0;
    const good = await push(sqlite);
    assert.equal(good.status, 200);

    // The store breaks AFTER a good snapshot — the moment the record matters.
    store.failWrites(true);
    const failed = await push(sqlite);
    assert.equal(failed.status, 503, 'the failing push is reported as a failure');

    const res = await call(sqlite.url, '/api/admin/backups', { token: sqlite.token.admin });
    const last = res.json.last_backup;
    assert.equal(last.last_backup_at, store.rows[0].created_at, 'the good snapshot is still the last backup');
    assert.equal(Number(last.snapshot_id), Number(good.json.id));
    assert.equal(last.stale, false, 'and it is still fresh');
    assert.match(last.last_attempt_error, /refused|unavailable/i, 'while the failure is reported beside it');
    assert.ok(last.last_attempt_error_at, 'with when it happened');
    store.failWrites(false);
  });

  test('with no store, or an unreachable one, the verdict is unknown rather than "fine"', async () => {
    // No store configured at all: there is nothing to measure.
    clearStoreEnv();
    let res = await call(sqlite.url, '/api/admin/backups', { token: sqlite.token.admin });
    assert.equal(res.json.last_backup.configured, false);
    assert.equal(res.json.last_backup.stale, null, 'unknown, not false');
    assert.match(res.json.last_backup.reason, /no durable store/i);

    // Configured but unreachable: still unmeasurable, and said so.
    setEnv({ BACKUP_REMOTE_URL: 'http://127.0.0.1:1/rest/v1', BACKUP_REMOTE_KEY: 'k' });
    res = await call(sqlite.url, '/api/admin/backups', { token: sqlite.token.admin });
    const last = res.json.last_backup;
    assert.equal(last.configured, true, 'the store is configured — it just cannot be reached');
    assert.equal(last.stale, null, 'an unreadable store is not evidence of a fresh backup');
    assert.equal(last.last_backup_at, null);
    assert.match(last.reason, /cannot reach|refused|fetch/i);
  });

  test('the last backup is only visible to an admin', async () => {
    for (const [label, get] of SIDES) {
      const side = get();
      const anon = await call(side.url, '/api/admin/backups');
      assert.equal(anon.status, 401, `${label} anonymous`);
      const staff = await call(side.url, '/api/admin/backups', { token: side.token.staff });
      assert.equal(staff.status, 403, `${label} staff`);
    }
  });

  test('the interval and the sink are env-derived, with sane fallbacks', () => {
    clearStoreEnv();
    setEnv({ SUPABASE_URL: 'https://demo.supabase.co' });
    // Missing the key: nothing to authenticate with, so no schedule.
    assert.equal(remote.status().enabled, false);

    setEnv({ SUPABASE_KEY: 'service-role', BACKUP_INTERVAL_MINUTES: 'hourly', BACKUP_KEEP: '-3' });
    const derived = remote.status();
    assert.equal(derived.enabled, true, 'zero-config derivation from the driver config');
    assert.equal(derived.derived, true);
    assert.equal(derived.url, 'https://demo.supabase.co/rest/v1');
    assert.equal(derived.table, 'backup_snapshots');
    assert.equal(derived.interval_minutes, 60, 'junk falls back to the default period');
    assert.equal(derived.keep, 7, 'junk falls back to the default window');

    // 0 is a real setting (off), not "unset".
    setEnv({ BACKUP_INTERVAL_MINUTES: '0' });
    assert.equal(remote.status().interval_minutes, 0);
  });

  test('the scheduler starts only when a store exists, and only once', () => {
    const snapshot = () => ({ format: 'inventrak-backup', version: 1, tables: {}, counts: {} });
    const first = remote.startScheduler(snapshot, { everyMs: 100000 });
    assert.equal(first.started, true);
    const again = remote.startScheduler(snapshot, { everyMs: 100000 });
    assert.equal(again.started, true);
    assert.equal(again.alreadyRunning, true, 'a second start does not create a second timer');
    assert.equal(remote.stopScheduler(), true);
  });
});

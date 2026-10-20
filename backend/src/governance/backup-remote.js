// Scheduled backups — the copy of the database that leaves the container.
//
// Why this exists: `governance/backup.js` can produce a snapshot and the routes
// can hand it to a browser download, but that only helps an admin who REMEMBERS
// to export. A deploy wipes the container filesystem (AGENTS.md), so on the day
// the data is gone the question is not "how do I export?" but "is there a copy
// outside this container, from before it went away?" — and the honest answer
// used to be "only if someone remembered". This module pushes a snapshot to the
// durable store on a timer, keeps a rolling window of them, and reads one back
// so a wiped container can be restored without a file that no longer exists.
//
// WHERE the snapshot goes, and why it is derived rather than configured:
//
//   The durable sink is the deployment's own Supabase project, over PostgREST
//   with plain global fetch — the exact mechanism `src/audit.js` already uses
//   for the durable audit trail, so a deployment that already talks to Supabase
//   needs NO new secret and no new env var: SUPABASE_URL and SUPABASE_KEY are
//   already there to run the driver. This matters more than it looks. A backup
//   feature that needs its own credentials is a backup feature that is silently
//   off in production, because nobody pasted the key. Explicit BACKUP_REMOTE_*
//   still wins, so an operator can point snapshots at a different project.
//
//   One table has to exist, and running the SQL IS the whole setup — the exact
//   DDL, with the reasoning, is in src/supabase-backup-migration.sql (same shape
//   of prerequisite as the audit_log table). One row per snapshot: the envelope
//   lives in a jsonb `data` column exactly as the download/upload format
//   defines it, with driver, created_at, bytes and counts promoted to real
//   columns so the console can list what is on hand without downloading every
//   body. A missing table is reported with the store's own message and a
//   pointer at that file, never as a silent success.
//
// WHEN it runs: on a timer (`BACKUP_INTERVAL_MINUTES`, default hourly), started
// by the server entrypoints. The first push happens one full interval AFTER
// boot, deliberately: at boot a container may have just re-seeded itself from
// the packaged demo data, and pushing that as the newest snapshot would put an
// empty-ish seed in front of the real one an admin would later pick as
// "latest". A snapshot of a freshly seeded container is not evidence of
// anything, so the scheduler never takes one. The timer is `unref`'d so it can
// never hold a process (or a test run) open.
//
// WHAT it does not do: it does not decide when to restore. A restore stays an
// explicit admin action (`POST /api/admin/restore`), because replacing every row
// automatically on boot would turn "a bad deploy" into "a bad deploy plus
// silently destroyed recovery data".
const {
  FORMAT,
  VERSION,
} = require('./backup');

const DEFAULT_TABLE = 'backup_snapshots';
const DEFAULT_INTERVAL_MINUTES = 60;
const DEFAULT_KEEP = 7;
// A snapshot is one row in a PostgREST table, so one oversized document can
// fail the whole write. 4 MB is well past this database (the seeded demo data
// is ~350 KB) and comfortably inside the durable stores' document limits, and
// the refusal names the env var to raise rather than looking like a network
// error. Firestore's hard 1 MiB document cap is the reason the number is not
// larger: BACKUP_REMOTE_* against a Firestore-backed sink must stay under it.
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;
const WARN_EVERY_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Configuration (read per call, not at load)
//
// Read lazily for the same reason config.js's targetMarginPercent() is: an env
// var that is consulted at request time can be pointed at a test double (or
// changed on a running instance) without reloading the module, and this module
// is loaded once per process for the lifetime of the deployment.
// ---------------------------------------------------------------------------

function deriveRemoteUrl() {
  const explicit = (process.env.BACKUP_REMOTE_URL || '').trim();
  if (explicit) return explicit;
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  if (!supabaseUrl) return '';
  return `${supabaseUrl.replace(/\/+$/, '')}/rest/v1`;
}

function remoteKey() {
  return (
    process.env.BACKUP_REMOTE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim();
}

// A positive integer from the environment, or the default. `0` is a MEANINGFUL
// value for the interval (it turns the schedule off), so it is not treated as
// "unset" — while junk ("hourly") and negatives are.
//
// Unset/empty is checked BEFORE Number(), because Number('') === 0: folding
// "never configured" into the meaningful 0 would silently start every
// deployment that omits the variable with the schedule off, while the docs
// (README, the migration SQL, the /api/meta description) all say hourly.
function intFrom(raw, fallback, { allowZero = false } = {}) {
  const text = String(raw == null ? '' : raw).trim();
  if (text === '') return fallback;
  const n = Number(text);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return fallback;
  if (n === 0) return allowZero ? 0 : fallback;
  return n;
}

function config() {
  const url = deriveRemoteUrl().replace(/\/+$/, '');
  const key = remoteKey();
  return {
    url,
    key,
    enabled: Boolean(url && key),
    derived: !process.env.BACKUP_REMOTE_URL && Boolean(process.env.SUPABASE_URL),
    table: (process.env.BACKUP_REMOTE_TABLE || DEFAULT_TABLE).trim() || DEFAULT_TABLE,
    keep: intFrom(process.env.BACKUP_KEEP, DEFAULT_KEEP),
    intervalMinutes: intFrom(process.env.BACKUP_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES, { allowZero: true }),
    maxBytes: intFrom(process.env.BACKUP_MAX_BYTES, DEFAULT_MAX_BYTES),
  };
}

// ---------------------------------------------------------------------------
// Run state — the last push outcome, for /api/meta and the admin list.
// ---------------------------------------------------------------------------
const state = { lastPushedAt: null, lastError: null, lastErrorAt: null, pushed: 0 };

let lastWarnAt = 0;
function warn(message) {
  const now = Date.now();
  if (now - lastWarnAt < WARN_EVERY_MS) return;
  lastWarnAt = now;
  console.error(`[backup] ${message}`);
}

/** Public shape for GET /api/meta and the admin console. Never the key. */
function status() {
  const cfg = config();
  return {
    enabled: cfg.enabled,
    derived: cfg.derived,
    url: cfg.url || null,
    table: cfg.table,
    keep: cfg.keep,
    interval_minutes: cfg.intervalMinutes,
    max_bytes: cfg.maxBytes,
    last_pushed_at: state.lastPushedAt,
    last_pushed_ago_minutes: state.lastPushedAt
      ? Math.round((Date.now() - Date.parse(state.lastPushedAt)) / 60000)
      : null,
    last_error: state.lastError,
    pushed: state.pushed,
  };
}

// ---------------------------------------------------------------------------
// PostgREST transport
// ---------------------------------------------------------------------------

function headers(key, extra = {}) {
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra,
  };
}

// PostgREST answers a failed write with a JSON body naming the reason (a
// missing table, a missing column, a rejected payload). That text is the whole
// diagnostic value of the failure, so it is carried into the returned reason
// instead of being flattened to "HTTP 404".
async function postgrest(method, cfg, query, body) {
  const url = `${cfg.url}/${cfg.table}${query || ''}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: headers(cfg.key, method === 'POST' ? { Prefer: 'return=representation' } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, reason: `cannot reach the durable store at ${cfg.url}: ${err.message}` };
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      detail = parsed.message || parsed.hint || detail;
    } catch {
      /* keep the raw excerpt */
    }
    const hint =
      res.status === 404 || /does not exist|relation/i.test(detail)
        ? ' — does the snapshot table exist? (run src/supabase-backup-migration.sql once in the Supabase SQL editor)' +
          ` or set BACKUP_REMOTE_TABLE / SUPABASE_URL`
        : '';
    return { ok: false, reason: `durable store refused the ${method} (HTTP ${res.status}): ${detail}${hint}` };
  }
  if (!text) return { ok: true, rows: [] };
  try {
    const parsed = JSON.parse(text);
    return { ok: true, rows: Array.isArray(parsed) ? parsed : [parsed] };
  } catch {
    return { ok: true, rows: [] };
  }
}

// ---------------------------------------------------------------------------
// The last successful backup — the one durable fact an operator needs
// ---------------------------------------------------------------------------
//
// "When was the last snapshot taken, and is it getting old?" cannot be answered
// from this process. A deploy restarts the container, so an in-memory timestamp
// (state.lastPushedAt below) is empty at exactly the moment it matters, and it
// only ever knew about the pushes THIS process made. The answer lives where the
// snapshot lives: the newest row in the durable store — which is also what a
// restore would name, so "the last backup" and "what I would recover from" are
// the same thing by construction.
//
// summarizeLastBackup() interprets the listing the route has ALREADY fetched
// (newest first, so the newest snapshot is its first row) rather than issuing a
// second query: one round trip per page load, and the interpretation stays a
// pure function that can be tested without a store.
//
// STALENESS is measured against the cadence the deployment is supposed to keep,
// with one period of grace: a deploy, a cold start or a slow hour is a missed
// tick, not a failure, but two in a row is a pattern. With the timer switched
// off there is no cadence to miss, so the DEFAULT hourly period is the yardstick
// — "you asked for no schedule, and this copy is older than the default would
// have allowed" is precisely what an operator needs to be told. With no durable
// store there is nothing to measure, so `stale` is null (unknown) rather than
// false: claiming "not stale" about a copy that does not exist is the one
// answer that could get someone to skip pressing the button.
const STALE_AFTER_PERIODS = 2;

function summarizeLastBackup(listed, { now = Date.now() } = {}) {
  const cfg = config();
  const base = {
    configured: Boolean(listed && listed.enabled),
    table: cfg.table,
    interval_minutes: cfg.intervalMinutes,
    stale_after_minutes: null,
    last_backup_at: null,
    age_minutes: null,
    stale: null,
    snapshot_id: null,
    driver: null,
    rows: null,
    bytes: null,
    this_process_last_pushed_at: state.lastPushedAt,
    last_attempt_error: state.lastError,
    last_attempt_error_at: state.lastErrorAt,
    reason: null,
  };

  if (!listed || !listed.ok) {
    return {
      ...base,
      reason: (listed && listed.reason) || 'the durable store could not be read, so the last backup is unknown',
    };
  }

  const staleAfter = Math.max(cfg.intervalMinutes, DEFAULT_INTERVAL_MINUTES) * STALE_AFTER_PERIODS;
  const newest = (listed.snapshots || [])[0] || null;
  if (!newest) {
    return {
      ...base,
      stale_after_minutes: staleAfter,
      // Nothing to recover from at all: maximally stale, and said plainly.
      stale: true,
      reason: 'no snapshot has been pushed to the durable store yet',
    };
  }

  const at = Date.parse(newest.created_at);
  if (!Number.isFinite(at)) {
    return {
      ...base,
      stale_after_minutes: staleAfter,
      snapshot_id: newest.id,
      reason: `snapshot ${newest.id} has an unreadable created_at (${JSON.stringify(newest.created_at)})`,
    };
  }
  const age = Math.max(0, Math.round((now - at) / 60000));
  return {
    ...base,
    stale_after_minutes: staleAfter,
    last_backup_at: newest.created_at,
    age_minutes: age,
    stale: age > staleAfter,
    snapshot_id: newest.id,
    driver: newest.driver || null,
    rows: newest.rows === undefined ? null : newest.rows,
    bytes: newest.bytes === undefined ? null : newest.bytes,
  };
}

// ---------------------------------------------------------------------------
// The three operations: push one, list them, read one back
// ---------------------------------------------------------------------------

function byteSize(envelope) {
  return Buffer.byteLength(JSON.stringify(envelope), 'utf8');
}

/**
 * Push one snapshot to the durable store. Never throws: a scheduler that can
 * take the process down is worse than a missed snapshot. Returns
 * { ok, ... } or { ok: false, reason } — the reason is what the admin console
 * and the log show, so it names the cause.
 */
async function pushSnapshot(envelope, { trigger = 'manual' } = {}) {
  const cfg = config();
  if (!cfg.enabled) {
    return {
      ok: false,
      reason:
        'no durable store is configured — set SUPABASE_URL and SUPABASE_KEY (or BACKUP_REMOTE_URL and BACKUP_REMOTE_KEY) to keep snapshots outside this container',
    };
  }
  if (!envelope || typeof envelope !== 'object' || envelope.format !== FORMAT || envelope.version !== VERSION) {
    return { ok: false, reason: 'refusing to push: the envelope is not a current Sylver backup in the inventrak-backup format' };
  }
  const bytes = byteSize(envelope);
  if (bytes > cfg.maxBytes) {
    return {
      ok: false,
      reason: `snapshot is ${bytes} bytes, over the ${cfg.maxBytes}-byte durable-store cap — raise BACKUP_MAX_BYTES if the store can take it`,
    };
  }

  const row = {
    created_at: envelope.created_at,
    driver: envelope.driver,
    bytes,
    counts: envelope.counts || {},
    data: envelope,
  };
  const posted = await postgrest('POST', cfg, '', row);
  const result = posted.ok
    ? {
        ok: true,
        id: posted.rows[0] ? posted.rows[0].id : null,
        created_at: envelope.created_at,
        driver: envelope.driver,
        bytes,
        tables: Object.keys(envelope.tables || {}).length,
        rows: Object.values(envelope.counts || {}).reduce((sum, n) => sum + Number(n || 0), 0),
      }
    : { ok: false, reason: posted.reason };

  if (result.ok) {
    state.lastPushedAt = result.created_at;
    state.lastError = null;
    state.pushed += 1;
    // Retention runs after the push, never before it: if pruning fails, the new
    // snapshot is already safe, and the failure is reported on the next push.
    // The row just written is protected from the sweep — see pruneRemote().
    const pruned = await pruneRemote(cfg.keep, { protectId: result.id });
    result.pruned = pruned.ok ? pruned.deleted : 0;
    if (!pruned.ok) result.prune_reason = pruned.reason;
  } else {
    state.lastError = result.reason;
    state.lastErrorAt = new Date().toISOString();
  }

  const log = require('../audit');
  if (result.ok) {
    log.audit('backup.pushed', {
      trigger,
      id: result.id,
      driver: result.driver,
      bytes,
      tables: result.tables,
      rows: result.rows,
      pruned: result.pruned || 0,
    });
  } else {
    log.audit('backup.push_failed', { trigger, reason: result.reason });
    warn(`durable snapshot NOT taken (${trigger}): ${result.reason}`);
  }
  return result;
}

/**
 * The rolling window: newest `keep` snapshots stay, older ones are deleted.
 * Without this a timer either fills the store or needs an admin to clean up —
 * both of which end with the schedule switched off.
 *
 * The snapshot this process just stored is exempt from its own sweep. The whole
 * sweep rests on the store honouring `offset` (and on created_at ordering being
 * what we think it is), and a delete driven by a listing that got either wrong
 * would start with the newest row — i.e. the backup would erase itself the
 * moment it was taken, which is the worst possible way for this to fail. One
 * filter makes that unrepresentable.
 */
async function pruneRemote(keep, { protectId } = {}) {
  const cfg = config();
  if (!cfg.enabled) return { ok: false, reason: 'no durable store is configured' };
  const limit = intFrom(keep, cfg.keep);
  const listed = await postgrest('GET', cfg, `?select=id&order=created_at.desc&offset=${limit}`, undefined);
  if (!listed.ok) return { ok: false, reason: listed.reason };
  const ids = listed.rows
    .map((r) => r.id)
    .filter((id) => id !== undefined && id !== null && (protectId === undefined || String(id) !== String(protectId)));
  if (ids.length === 0) return { ok: true, deleted: 0 };
  const filter = `?id=in.(${ids.map((id) => String(id)).join(',')})`;
  const deleted = await postgrest('DELETE', cfg, filter, undefined);
  if (!deleted.ok) return { ok: false, reason: deleted.reason };
  return { ok: true, deleted: ids.length };
}

/** Metadata only — the point of a list an admin reads before choosing to restore. */
async function listSnapshots(limit = 20) {
  const cfg = config();
  if (!cfg.enabled) {
    return { ok: false, reason: 'no durable store is configured', enabled: false, table: cfg.table };
  }
  const n = intFrom(limit, 20);
  const listed = await postgrest(
    'GET',
    cfg,
    `?select=id,created_at,driver,bytes,counts&order=created_at.desc&limit=${n}`,
    undefined,
  );
  if (!listed.ok) return { ok: false, reason: listed.reason, enabled: true, table: cfg.table };
  return {
    ok: true,
    enabled: true,
    table: cfg.table,
    keep: cfg.keep,
    snapshots: listed.rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      driver: r.driver || null,
      bytes: Number(r.bytes) || 0,
      tables: Object.keys(r.counts || {}).length,
      rows: Object.values(r.counts || {}).reduce((sum, c) => sum + Number(c || 0), 0),
    })),
  };
}

/**
 * Read one snapshot back: a specific id, or the newest one ('latest'). The
 * envelope is returned exactly as stored — the caller validates it with
 * envelopeError() before anything is restored, so a snapshot from another
 * driver is refused by the same guard an upload goes through.
 */
async function fetchSnapshot(idOrLatest = 'latest') {
  const cfg = config();
  if (!cfg.enabled) return { ok: false, reason: 'no durable store is configured' };
  const query = String(idOrLatest) === 'latest'
    ? '?select=id,created_at,driver,data&order=created_at.desc&limit=1'
    : `?select=id,created_at,driver,data&id=eq.${encodeURIComponent(String(idOrLatest))}&limit=1`;
  const found = await postgrest('GET', cfg, query, undefined);
  if (!found.ok) return { ok: false, reason: found.reason };
  const row = found.rows[0];
  if (!row) {
    return {
      ok: false,
      reason:
        String(idOrLatest) === 'latest'
          ? 'the durable store holds no snapshots yet — none has been pushed (check BACKUP_INTERVAL_MINUTES and the scheduler log line)'
          : `no snapshot with id ${idOrLatest} in the durable store`,
    };
  }
  if (!row.data || typeof row.data !== 'object') {
    return { ok: false, reason: `snapshot ${row.id} has no readable data column` };
  }
  return { ok: true, id: row.id, created_at: row.created_at, envelope: row.data };
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

let timer = null;

/**
 * Run one scheduled backup through a caller-supplied snapshot function.
 *
 * The snapshot function comes from the server, not from this module, because
 * only the server knows how to read its own store (SQLite reads tables; the
 * npm-free backend reads datasets through its driver) — the same split the
 * manual routes already use.
 */
async function runScheduledBackup(snapshot, { trigger = 'schedule' } = {}) {
  let envelope;
  try {
    envelope = snapshot();
  } catch (err) {
    state.lastError = `snapshot failed: ${err.message}`;
    state.lastErrorAt = new Date().toISOString();
    const log = require('../audit');
    log.audit('backup.push_failed', { trigger, reason: state.lastError });
    warn(`could not take a snapshot (${trigger}): ${err.message}`);
    return { ok: false, reason: state.lastError };
  }
  return pushSnapshot(envelope, { trigger });
}

/**
 * Start the timer. Returns { started, reason } — a deployment with no durable
 * store gets one clear log line saying the schedule is off and why, rather than
 * a timer that fires hourly into nothing.
 *
 * `everyMs` overrides the env-derived period. Production reads
 * BACKUP_INTERVAL_MINUTES; the override exists because an hourly timer cannot
 * be exercised by a test suite that must finish in seconds, and an untested
 * timer is how "scheduled" quietly becomes "never ran".
 */
function startScheduler(snapshot, { everyMs } = {}) {
  const cfg = config();
  if (timer) return { started: true, alreadyRunning: true, intervalMinutes: cfg.intervalMinutes };
  if (!cfg.enabled) {
    const reason =
      'no durable store configured (SUPABASE_URL/SUPABASE_KEY or BACKUP_REMOTE_URL/BACKUP_REMOTE_KEY)';
    console.log(`[backup] scheduled snapshots OFF — ${reason}`);
    return { started: false, reason };
  }
  if (typeof snapshot !== 'function') {
    return { started: false, reason: 'no snapshot function supplied' };
  }

  // An explicit period wins over the env setting, including over its "off": a
  // caller that names a period has already decided the schedule should run.
  const periodMs = Number.isFinite(everyMs) && everyMs > 0 ? everyMs : cfg.intervalMinutes * 60 * 1000;
  if (!(periodMs > 0)) {
    console.log('[backup] scheduled snapshots OFF — BACKUP_INTERVAL_MINUTES=0');
    return { started: false, reason: 'BACKUP_INTERVAL_MINUTES=0' };
  }
  timer = setInterval(() => {
    runScheduledBackup(snapshot, { trigger: 'schedule' }).catch((err) => {
      warn(`scheduled snapshot failed: ${err.message}`);
    });
  }, periodMs);
  // Never hold the process open — a test run or a graceful shutdown must not
  // wait for the next tick.
  if (typeof timer.unref === 'function') timer.unref();
  console.log(
    `[backup] scheduled snapshots ON — every ${Math.round((periodMs / 60000) * 100) / 100} min into ${cfg.url}/${cfg.table}, keeping the newest ${cfg.keep}`,
  );
  return { started: true, intervalMinutes: cfg.intervalMinutes, everyMs: periodMs, table: cfg.table };
}

function stopScheduler() {
  if (!timer) return false;
  clearInterval(timer);
  timer = null;
  return true;
}

module.exports = {
  DEFAULT_TABLE,
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_KEEP,
  DEFAULT_MAX_BYTES,
  STALE_AFTER_PERIODS,
  config,
  status,
  summarizeLastBackup,
  pushSnapshot,
  pruneRemote,
  listSnapshots,
  fetchSnapshot,
  runScheduledBackup,
  startScheduler,
  stopScheduler,
};

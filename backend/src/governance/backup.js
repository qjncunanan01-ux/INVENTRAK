// Database backup and recovery — the driver-aware export/restore core.
//
// Why this exists: the durable state of this system is the whole point of it,
// and until now there was no way to take a copy or put one back. Backend
// deploys wipe the container filesystem (see AGENTS.md), so a snapshot that
// lives OUTSIDE the container is the only recovery that survives a redeploy.
// This module produces and consumes that snapshot; the routes turn it into a
// download and an upload.
//
// Driver-awareness is the design constraint, and it is why this is one module
// with a shared envelope rather than two unrelated features:
//
//   • `sqlite`  — the live database. A snapshot is every table's rows
//                 (`sqliteSnapshot` / `sqliteRestore`, implemented here).
//   • everything else (`json` / `supabase` / `firestore`) — the npm-free
//                 backend persists named datasets through a store driver, and
//                 only that backend knows how to read and re-hydrate them, so
//                 it supplies its own snapshot/restore and reuses the envelope
//                 helpers below (see server_npmfree.js).
//
// THE ENVELOPE IS THE CONTRACT. `format`, `version` and `driver` are checked
// before a single row is touched, and a snapshot is only restorable into a
// backend running the SAME driver: the row shapes are genuinely different
// across drivers, so a cross-driver "restore" would silently corrupt data
// rather than migrate it. Refusing loudly is the honest behavior.
//
// `tables` is uniformly a map of row ARRAYS on every driver. A store-level
// DATASET that is one document rather than rows (the npm-free backend's
// inventory.json, `{ locations, items }`) is carried as a single-row array so
// the contract does not grow a second, differently-shaped section.
const FORMAT = 'inventrak-backup';
const VERSION = 1;

// The SQLite handle is loaded LAZILY, and only by the functions below. This
// module is also required by the npm-free backend (which reuses the envelope
// helpers), and that backend's whole point is running with no npm packages: a
// top-level `require('../db')` would drag better-sqlite3 — and a stray
// data/inventrak.db — into a server that must not need either.
let sqliteDb = null;
function db() {
  if (!sqliteDb) sqliteDb = require('../db').db;
  return sqliteDb;
}

// Table names in a fresh/current database. `sqlite_%` is SQLite's own
// bookkeeping (including the AUTOINCREMENT counter), never business data.
function sqliteTableNames() {
  return db()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}

function sqliteColumns(table) {
  return db().prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
}

/**
 * Snapshot every SQLite table. Rows are returned exactly as stored (no
 * coercion), so a restore is a faithful round-trip rather than a re-import.
 */
function sqliteSnapshot() {
  const tables = {};
  for (const name of sqliteTableNames()) {
    tables[name] = db().prepare(`SELECT * FROM "${name}"`).all();
  }
  return tables;
}

/**
 * Replace the database contents with a snapshot.
 *
 * Foreign keys: better-sqlite3 enables FK enforcement by default, so a
 * delete-all-then-insert-all sequence would fail the moment one table is
 * emptied while another still references it. `defer_foreign_keys` postpones
 * enforcement to COMMIT, which is exactly the semantics wanted here — the
 * checks still run (a snapshot with dangling references is rejected and rolled
 * back), they just run once the whole snapshot is in place.
 *
 * Columns are read from the database's own PRAGMA, never from the payload, so
 * an unknown or hostile key in a row is ignored instead of reaching the SQL.
 */
function sqliteRestore(tables) {
  const known = sqliteTableNames();
  const unknown = Object.keys(tables).filter((name) => !known.includes(name));
  if (unknown.length) return { error: `unknown table(s) for this database: ${unknown.join(', ')}` };
  const missing = known.filter((name) => !Object.prototype.hasOwnProperty.call(tables, name));
  if (missing.length) return { error: `snapshot is missing table(s): ${missing.join(', ')}` };

  const restored = {};
  const handle = db();
  handle.pragma('defer_foreign_keys = ON');
  try {
    handle.transaction(() => {
      for (const name of known) handle.prepare(`DELETE FROM "${name}"`).run();
      for (const name of known) {
        const columns = sqliteColumns(name);
        const rows = tables[name] || [];
        if (rows.length === 0) {
          restored[name] = 0;
          continue;
        }
        let inserted = 0;
        for (const row of rows) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) {
            throw new Error(`table "${name}" contains a non-object row`);
          }
          const cols = columns.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
          if (cols.length === 0) throw new Error(`table "${name}" contains a row with no known columns`);
          const placeholders = cols.map(() => '?').join(', ');
          const values = cols.map((c) => row[c]);
          handle.prepare(`INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`).run(...values);
          inserted += 1;
        }
        restored[name] = inserted;
      }
    })();
  } catch (err) {
    // The transaction rolled back; the live database is untouched.
    return { error: `restore failed (database unchanged): ${err.message}` };
  } finally {
    handle.pragma('defer_foreign_keys = OFF');
  }
  return { restored };
}

/** Wrap a driver's tables in the versioned, self-describing envelope. */
function buildEnvelope({ driver, tables, generatedBy }) {
  const counts = {};
  for (const [name, rows] of Object.entries(tables)) counts[name] = Array.isArray(rows) ? rows.length : 0;
  return {
    format: FORMAT,
    version: VERSION,
    driver,
    created_at: new Date().toISOString(),
    generated_by: generatedBy == null ? null : String(generatedBy),
    counts,
    tables,
  };
}

/**
 * Validate an uploaded snapshot's envelope. Returns null when acceptable, or a
 * human-readable reason. Deliberately strict: every rejection here is a
 * request that would otherwise have wiped a live database.
 */
function envelopeError(payload, expectedDriver) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'body must be a JSON object';
  if (payload.format !== FORMAT) return `body is not a ${FORMAT} snapshot (format: ${JSON.stringify(payload.format)})`;
  if (payload.version !== VERSION) return `unsupported snapshot version ${JSON.stringify(payload.version)} (this build reads version ${VERSION})`;
  if (payload.driver !== expectedDriver) {
    return `snapshot was taken from the "${payload.driver}" driver but this server runs "${expectedDriver}"; restore it on a matching backend`;
  }
  const tables = payload.tables;
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) return 'snapshot has no tables object';
  for (const [name, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) return `snapshot table "${name}" is not an array of rows`;
  }
  return null;
}

/** The canonical restore response, shared so both backends answer identically. */
function restoreResult({ driver, restored }) {
  const names = Object.keys(restored || {});
  const total = names.reduce((sum, n) => sum + restored[n], 0);
  return {
    ok: true,
    driver,
    tables_restored: names.length,
    rows_restored: total,
    restored: restored || {},
    message: `Restored ${names.length} table(s), ${total} row(s) from the snapshot`,
  };
}

module.exports = {
  FORMAT,
  VERSION,
  sqliteTableNames,
  sqliteSnapshot,
  sqliteRestore,
  buildEnvelope,
  envelopeError,
  restoreResult,
};

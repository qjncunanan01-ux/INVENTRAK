// Firestore storage driver for the npm-free server (DB_DRIVER=firestore).
//
// Exposes the same synchronous read/write interface as store-json.js so the
// server code is driver-agnostic. Because the server's request handlers read
// synchronously but Firestore is async, this driver keeps an in-memory cache
// of every collection (loaded once at init) and syncs each mutation to
// Firestore through a serialized write queue.
//
// How data is stored: each JSON dataset maps to a Firestore collection and
// each array element becomes a document whose ID preserves the array-position
// semantics the npm-free server relies on (product ids = index + 1, etc.):
//   products.json          -> collection 'products'      doc id = idx + 1
//   inventory.json         -> collection 'inventory'     doc id = product.id
//                            (+ a '_meta' doc holding the locations array)
//   stock_movements.json   -> collection 'movements'     doc id = row.id
//   order_inquiries.json   -> collection 'inquiries'     doc id = row.id
//   '@users' / '@sales' / '@alerts' (in-memory datasets) -> collections
//   'users' / 'sales' / 'alerts'                         doc id = row.id
//
// First boot on an EMPTY project auto-seeds only the CORE catalog (products +
// inventory) from the local backend/data/ JSON files, so `npm run
// start:firestore` just works against a brand-new Firebase project. The
// transactional datasets (movements, inquiries, users, sales, alerts) always
// start empty — never copied from local state.
const fs = require('fs');
const path = require('path');

// Datasets that may be auto-seeded from the local JSON files on an empty
// project. Everything else intentionally starts from a clean slate.
const AUTO_SEED_LOCAL = new Set(['products.json', 'inventory.json']);

const COLLECTIONS = {
  'products.json': 'products',
  'inventory.json': 'inventory',
  'stock_movements.json': 'movements',
  'order_inquiries.json': 'inquiries',
  // Approval-workflow datasets: adjustments + transfers are persisted just
  // like movements, so an APPROVED stock change survives a redeploy (without
  // this mapping the Firestore driver's write() early-returns and the data
  // would live only in the in-memory cache — silently lost on restart).
  'stock_adjustments.json': 'stockAdjustments',
  'stock_transfers.json': 'stockTransfers',
  '@users': 'users',
  '@sales': 'sales',
  '@alerts': 'alerts',
  // Ephemeral code datasets: verification + password-reset codes persist so an
  // issued code survives a redeploy. (Without the mapping write() early-returns
  // and the codes live only in the in-memory cache — silently lost on restart,
  // breaking in-flight signups/resets mid-deploy.)
  '@verificationCodes': 'verificationCodes',
  '@resetTokens': 'resetTokens',
};

let db = null; // injected fake (tests) or real firebase-admin Firestore
let fakeDb = null;
const cache = {};
let writeChain = Promise.resolve();
let ready = false;

// The Firestore EMULATOR runs in single-project mode bound to ONE project id
// (from the firebase CLI's `--project` flag, GCLOUD_PROJECT, or the top-level
// "project" field in firebase.json). The driver must request THAT project, or
// the emulator prints "Multiple projectIds are not recommended" and the
// backend's data lands in a different namespace than the emulator UI/export
// show. firebase.json is the single source of truth (same file the launchers
// read the emulator port from), with env overrides on top.
function emulatorProjectId() {
  const envId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT;
  if (envId) return envId;
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8')
    );
    if (cfg && cfg.project) return cfg.project;
  } catch {}
  return 'demo-inventrak'; // last-resort fallback for zero-config runs
}

function collectionFor(file) {
  return COLLECTIONS[file];
}

// True once init() has loaded the cache (so the server can refuse to serve
// requests against an uninitialized cache in Firestore mode).
function isReady() {
  return ready;
}

// Optional named-database support: Firestore allows multiple databases per
// project (e.g. 'inventrak'). The driver uses '(default)' unless
// FIREBASE_DATABASE_ID is set. Database IDs must be '(default)' or lowercase
// letters/digits/hyphens; reject anything else loudly so a typo can't
// silently target a different database. Returns null for the default DB.
function normalizedDatabaseId() {
  const id = process.env.FIREBASE_DATABASE_ID || process.env.FIRESTORE_DATABASE_ID;
  if (!id) return null;
  if (id === '(default)') return null;
  if (!/^[a-z][a-z0-9-]{3,}$/.test(id)) {
    throw new Error(
      `Invalid FIREBASE_DATABASE_ID "${id}" — use '(default)' or lowercase letters/digits/hyphens (e.g. 'inventrak').`
    ); // >= 4 chars per Firestore's database-id rules
  }
  return id;
}

// Test hook: inject a fake Firestore (implements collection/orderBy/get/
// listDocuments/doc/batch) and force a cache reload on next init().
function _setDb(instance) {
  fakeDb = instance;
  db = null;
}

async function readCollection(colName, file) {
  const snap = await db.collection(colName).orderBy('__idx').get();
  const docs = [];
  snap.forEach((d) => docs.push(d));
  if (docs.length === 0) return null; // absent dataset (matches JSON "file missing")
  if (file === 'inventory.json') {
    const metaDoc = docs.find((d) => d.id === '_meta');
    const locations = (metaDoc && metaDoc.data() && metaDoc.data().locations) || [];
    const items = docs
      .filter((d) => d.id !== '_meta')
      .sort((a, b) => a.data().__idx - b.data().__idx)
      .map((d) => {
        const { __idx, ...rest } = d.data();
        return rest;
      });
    return { locations, items };
  }
  return docs
    .sort((a, b) => a.data().__idx - b.data().__idx)
    .map((d) => {
      const { __idx, ...rest } = d.data();
      return rest;
    });
}

// Firestore documents cannot store null / undefined / non-finite numbers
// (the SDK throws on set()). The server handlers write null for "no value"
// (e.g. a stock-in movement's src_location), so map null → '' here and drop
// undefined keys; the server's read handlers normalize '' back to null for
// API parity with the SQLite backend. Arrays/objects are sanitized
// recursively (nested product objects in inventory items included).
function sanitize(v) {
  if (v === null) return '';
  if (v === undefined) return undefined;
  if (typeof v === 'number' && !Number.isFinite(v)) return 0;
  if (Array.isArray(v)) return v.map(sanitize);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      const s = sanitize(val);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return v;
}

// Full-collection sync (atomic batch): upsert every row (with __idx to keep
// order stable), delete documents that no longer exist.
async function syncCollection(colName, file, rows) {
  const col = db.collection(colName);
  const existingRefs = await col.listDocuments();
  const wantIds = new Set();
  const batch = db.batch();

  const put = (id, idx, row) => {
    batch.set(col.doc(String(id)), { __idx: idx, ...sanitize(row) });
    wantIds.add(String(id));
  };

  if (file === 'inventory.json') {
    const meta = (rows && rows.locations) || [];
    const items = (rows && rows.items) || [];
    batch.set(col.doc('_meta'), { __idx: -1, locations: sanitize(meta) });
    wantIds.add('_meta');
    items.forEach((item, idx) => {
      const id = (item && item.product && item.product.id) || idx + 1;
      put(id, idx, item);
    });
  } else {
    (rows || []).forEach((row, idx) => {
      const id = row && row.id !== undefined ? row.id : idx + 1;
      put(id, idx, row);
    });
  }

  existingRefs.forEach((ref) => {
    if (!wantIds.has(ref.id)) batch.delete(ref);
  });

  await batch.commit();
}

function tryReadLocal(file) {
  if (file.startsWith('@')) return null; // users/sales/alerts have no JSON file
  try {
    const dataDir = process.env.INVENTRAK_DATA_DIR || path.join(__dirname, '..', 'data');
    return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  } catch {
    return null;
  }
}

// Connect (real or fake) and load every collection into the cache. On an
// empty project, seed from the local JSON catalog so first boot is usable.
async function init() {
  if (!db) {
    if (fakeDb) {
      db = fakeDb;
    } else {
      let admin;
      try {
        admin = require('firebase-admin');
      } catch {
        throw new Error(
          'firebase-admin is not installed — run `npm install firebase-admin` (only needed for the Firestore driver).'
        );
      }
      const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
      const databaseId = normalizedDatabaseId();
      // admin.initializeApp() throws if the default app already exists; guard
      // so re-init in a single process (tests, migrate-then-serve) is a no-op.
      if (admin.apps.length === 0) {
        if (emulatorHost) {
          // Emulator mode: the firebase-admin SDK auto-routes Firestore calls
          // to FIRESTORE_EMULATOR_HOST and needs NO credentials — this makes
          // the full Firestore driver runnable locally with `npm run
          // emulators:start` + `npm run start:firestore:emulator`, zero cloud
          // setup. Use the SAME project the emulator is bound to (firebase.json
          // or env), so single-project mode is satisfied and backend, emulator
          // UI and emulators:export all share one namespace.
          admin.initializeApp({ projectId: emulatorProjectId() });
        } else {
          // Real cloud: FIREBASE_PROJECT_ID is REQUIRED — never default it
          // here, or a missing id would silently target the wrong project.
          const projectId = process.env.FIREBASE_PROJECT_ID;
          const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
          const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
          if (!projectId) {
            throw new Error('FIREBASE_PROJECT_ID env var is required for the Firestore driver.');
          }
          if (!saJson && !credPath) {
            throw new Error(
              'Firestore driver needs FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS (path to a service-account JSON).'
            );
          }
          let cred;
          try {
            cred = saJson ? JSON.parse(saJson) : require(credPath);
            // Render (and some env-var UIs) collapse literal backslash-n sequences
            // in the private_key field.  Restore them to actual newlines so the
            // crypto layer can parse the PEM block.
            if (cred && cred.private_key && !cred.private_key.includes('\n')) {
              cred.private_key = cred.private_key.replace(/\\n/g, '\n');
            }
          } catch (err) {
            throw new Error('Failed to load Firebase service account credentials: ' + err.message);
          }
          admin.initializeApp({ credential: admin.credential.cert(cred), projectId });
        }
      }
      // Named databases: admin.firestore({ databaseId }) targets a specific
      // DB in the project (emulator and real cloud both honor it); the
      // '(default)' database needs no argument.
      db = databaseId ? admin.firestore({ databaseId }) : admin.firestore();
    }
  }
  const files = Object.keys(COLLECTIONS);
  for (const file of files) {
    let value = await readCollection(COLLECTIONS[file], file);
    if (value === null && AUTO_SEED_LOCAL.has(file)) {
      // Empty project: seed the core catalog from the local JSON files.
      const local = tryReadLocal(file);
      if (local !== null) {
        await syncCollection(COLLECTIONS[file], file, local);
        value = local;
      }
    }
    cache[file] = value;
  }
  ready = true;
}

// Synchronous read (cache-backed once init() has run).
function read(file) {
  return cache[file] !== undefined ? cache[file] : null;
}

// Full-collection sync with a short retry: a transient network blip shouldn't
// silently leave the cloud behind the cache. Failures that exhaust retries are
// logged loudly (the cache still serves reads, and the next write to the same
// collection re-syncs the full state).
async function syncWithRetry(colName, file, rows, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await syncCollection(colName, file, rows);
      return true;
    } catch (err) {
      if (attempt === attempts) {
        console.error(`[firestore] sync of ${colName} failed after ${attempts} attempts: ${err && err.message}`);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  return false;
}

// Synchronous write: update the cache immediately, persist asynchronously
// (serialized so later writes never race earlier ones).
function write(file, rows) {
  cache[file] = rows;
  const colName = collectionFor(file);
  if (!db || !colName) return;
  writeChain = writeChain.then(() => syncWithRetry(colName, file, rows));
}

function flush() {
  return writeChain;
}

module.exports = {
  read,
  write,
  init,
  flush,
  isReady,
  _setDb,
  collectionFor,
  sanitize,
  normalizedDatabaseId,
};

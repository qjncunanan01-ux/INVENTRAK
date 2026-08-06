// Unit tests for the npm-free server's storage-driver selection
// (resolveDriver / firestoreConfigured). The driver must auto-select Firestore
// whenever Firebase credentials exist — "Firebase as the database of it all" —
// while still honoring explicit pins and the CLI flag.
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Pin the module to JSON mode and isolate its data dir BEFORE requiring the
// server (both are read at module load, and the JSON-mode bootstrap would
// otherwise write into the repo's real data directory).
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'inventrak-driver-'));
process.env.INVENTRAK_DATA_DIR = tmpData;
fs.writeFileSync(path.join(tmpData, 'products.json'), '[]');
fs.writeFileSync(path.join(tmpData, 'order_inquiries.json'), '[]');
fs.writeFileSync(path.join(tmpData, 'stock_movements.json'), '[]');
process.env.DB_DRIVER = 'json';

const { resolveDriver, firestoreConfigured } = require('../server_npmfree');

after(() => {
  fs.rmSync(tmpData, { recursive: true, force: true });
});

test('resolveDriver defaults to json with no Firebase config', () => {
  assert.strictEqual(resolveDriver({ env: {}, argv: [] }), 'json');
});

test('resolveDriver respects an explicit DB_DRIVER=firestore pin', () => {
  assert.strictEqual(resolveDriver({ env: { DB_DRIVER: 'firestore' }, argv: [] }), 'firestore');
});

test('resolveDriver lets DB_DRIVER=json override Firebase creds (escape hatch)', () => {
  const env = { DB_DRIVER: 'json', FIREBASE_PROJECT_ID: 'p', FIREBASE_SERVICE_ACCOUNT_JSON: '{}' };
  assert.strictEqual(resolveDriver({ env, argv: [] }), 'json');
});

test('resolveDriver auto-selects firestore when project id + service account JSON exist', () => {
  const env = { FIREBASE_PROJECT_ID: 'my-proj', FIREBASE_SERVICE_ACCOUNT_JSON: '{}' };
  assert.strictEqual(resolveDriver({ env, argv: [] }), 'firestore');
});

test('resolveDriver auto-selects firestore via GOOGLE_APPLICATION_CREDENTIALS path', () => {
  const env = { FIREBASE_PROJECT_ID: 'my-proj', GOOGLE_APPLICATION_CREDENTIALS: '/keys/sa.json' };
  assert.strictEqual(resolveDriver({ env, argv: [] }), 'firestore');
});

test('resolveDriver does not auto-select on partial config (project id only)', () => {
  assert.strictEqual(resolveDriver({ env: { FIREBASE_PROJECT_ID: 'p' }, argv: [] }), 'json');
  assert.strictEqual(resolveDriver({ env: { FIREBASE_SERVICE_ACCOUNT_JSON: '{}' }, argv: [] }), 'json');
});

test('resolveDriver --firestore flag beats DB_DRIVER=json', () => {
  assert.strictEqual(resolveDriver({ env: { DB_DRIVER: 'json' }, argv: ['--firestore'] }), 'firestore');
});

test('firestoreConfigured requires BOTH project id and a credential', () => {
  assert.strictEqual(firestoreConfigured({ env: {} }), false);
  assert.strictEqual(firestoreConfigured({ env: { FIREBASE_PROJECT_ID: 'p' } }), false);
  assert.strictEqual(firestoreConfigured({ env: { FIREBASE_PROJECT_ID: 'p', FIREBASE_SERVICE_ACCOUNT_JSON: '{}' } }), true);
  assert.strictEqual(firestoreConfigured({ env: { FIREBASE_PROJECT_ID: 'p', GOOGLE_APPLICATION_CREDENTIALS: '/k.json' } }), true);
});

test('resolveDriver auto-selects firestore when the emulator host is set (zero credentials)', () => {
  assert.strictEqual(firestoreConfigured({ env: { FIRESTORE_EMULATOR_HOST: 'localhost:8085' } }), true);
  assert.strictEqual(resolveDriver({ env: { FIRESTORE_EMULATOR_HOST: 'localhost:8085' }, argv: [] }), 'firestore');
  // The emulator still honors an explicit DB_DRIVER=json escape hatch.
  assert.strictEqual(resolveDriver({ env: { DB_DRIVER: 'json', FIRESTORE_EMULATOR_HOST: 'localhost:8085' }, argv: [] }), 'json');
});

// Cleanup script for the LIVE Firestore demo data created during live
// walkthrough testing. Removes ONLY the known test artifacts, guarded by
// name/username matches so it can never delete a document that doesn't match
// the expected test values (safe to re-run before every demo).
//
//   products : doc '9'  (Live Test Product 9000)          + its orphaned
//   inventory: doc '9'  (stock row for product 9)           inventory row
//   inquiries: docs 4,5,6,7  (E2E Tester / Guest Demo / Demo Walkthrough / Checkout Demo)
//   users    : docs 4,5,7,8,9 (e2e_i7vdmg, demo_walkthrough, keytest_*,
//                              mailtest_*, htmltest_*)
//
// Seeded demo data (products 1-8, inquiries 1-3 Juan/Maria/Paolo, users 1-2
// admin/customer) and real accounts (demo_phone, Patrickcuevas) are NEVER
// touched.
//
// IMPORTANT: the deployed npm-free server keeps an in-memory cache of every
// collection, so after running this you must restart/redeploy the server for
// its cache to reload from the (now clean) Firestore state.
//
// Usage:
//   node scripts/cleanup-demo-data.js --sa "C:\path\to\service-account.json" [--apply]
//
//   --apply  actually delete (default is a dry run that prints what it would do)
//   --sa     path to the Firebase service-account JSON (or set
//            FIREBASE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS)
//   --project  project id (default: FIREBASE_PROJECT_ID env, required)
const fs = require('fs');

const APPLY = process.argv.includes('--apply');
const SA_FLAG = process.argv.indexOf('--sa');
const SA_PATH = SA_FLAG >= 0 ? process.argv[SA_FLAG + 1] : null;
const PROJ_FLAG = process.argv.indexOf('--project');
const PROJECT_ID = PROJ_FLAG >= 0
  ? process.argv[PROJ_FLAG + 1]
  : process.env.FIREBASE_PROJECT_ID;

// Expected test artifacts: doc id -> { collection, matcher (field/value or /re/) }
const TARGETS = [
  { col: 'products', id: '9', field: 'Product Name', match: /Live Test Product/ },
  { col: 'inventory', id: '9', field: 'product', match: (v) => v && v.id === 9 },
  { col: 'inquiries', id: '4', field: 'customer_name', match: /E2E Tester/ },
  { col: 'inquiries', id: '5', field: 'customer_name', match: /Guest Demo/ },
  { col: 'inquiries', id: '6', field: 'customer_name', match: /Demo Walkthrough/ },
  { col: 'inquiries', id: '7', field: 'customer_name', match: /Checkout Demo/ },
  { col: 'users', id: '4', field: 'username', match: /^e2e_/ },
  { col: 'users', id: '5', field: 'username', match: /^demo_walkthrough$/ },
  { col: 'users', id: '7', field: 'username', match: /^keytest_/ },
  { col: 'users', id: '8', field: 'username', match: /^mailtest_/ },
  { col: 'users', id: '9', field: 'username', match: /^htmltest_/ },
];

function matches(target, doc) {
  // Raw Firestore docs use the JSON-file key shape ('Product Name'), but
  // some collections are written with lowercase API keys — fall back.
  const v = target.field === 'product'
    ? doc.product
    : doc[target.field] !== undefined ? doc[target.field] : doc.name;
  if (typeof target.match === 'function') return target.match(v);
  if (v === undefined || v === null) return false;
  if (target.match instanceof RegExp) return target.match.test(String(v));
  return v === target.match;
}

async function main() {
  if (!PROJECT_ID) {
    console.error('Missing project id — set FIREBASE_PROJECT_ID or pass --project.');
    process.exit(1);
  }
  let cred;
  if (SA_PATH) cred = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
  else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) cred = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) cred = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  else {
    console.error('No credentials — pass --sa <path> or set FIREBASE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }

  const admin = require('firebase-admin');
  if (admin.apps.length === 0) {
    admin.initializeApp({ credential: admin.credential.cert(cred), projectId: PROJECT_ID });
  }
  const db = admin.firestore();

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | project: ${PROJECT_ID}\n`);

  const deleted = [];
  const skipped = [];
  for (const target of TARGETS) {
    const ref = db.collection(target.col).doc(target.id);
    const snap = await ref.get();
    if (!snap.exists) {
      skipped.push(`${target.col}/${target.id} (already gone)`);
      continue;
    }
    const data = snap.data();
    if (!matches(target, data)) {
      skipped.push(`${target.col}/${target.id} (NO MATCH: ${JSON.stringify(data[target.field] || data)} — left alone)`);
      continue;
    }
    console.log(`${APPLY ? 'DELETING' : 'would delete'}  ${target.col}/${target.id}  (${data[target.field] && data[target.field].name || data[target.field] || ''})`);
    if (APPLY) {
      await ref.delete();
      deleted.push(`${target.col}/${target.id}`);
    }
  }

  console.log(`\n${APPLY ? 'Deleted' : 'Would delete'}: ${deleted.length} | skipped/kept: ${skipped.length}`);
  if (!APPLY) {
    console.log('Dry run only — re-run with --apply to commit.');
    skipped.forEach((s) => console.log('  keep:', s));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Cleanup failed:', err.message);
  process.exit(1);
});

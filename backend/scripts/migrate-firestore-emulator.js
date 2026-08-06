// Cross-platform launcher for migrating the local SQLite database into the
// Firestore EMULATOR (no credentials, no cloud):
//
//   npm run migrate:firestore:emulator [-- --dry-run]
//
// The plain equivalent `FIRESTORE_EMULATOR_HOST=localhost:8085 npm run
// migrate:firestore` is bash-only syntax; this sets the env var in JS so it
// works on Windows cmd/PowerShell too. Requires the emulator to be running
// (npm run emulators:start). The emulator port is read from firebase.json
// (single source of truth); extra CLI flags pass through (e.g. --dry-run).
const fs = require('fs');
const path = require('path');

let port = '8085';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8'));
  port = String(cfg.emulators && cfg.emulators.firestore && cfg.emulators.firestore.port) || port;
} catch {}
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || `localhost:${port}`;

const { main } = require('../src/migrate-firestore');
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err && err.message);
    process.exit(1);
  });

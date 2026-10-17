// Re-records e2e/fixtures/visual-api.json — the API responses the visual
// regression suite replays.
//
// Run it whenever the recorded data needs to move on (the demo catalogue
// changed shape, a page started calling a new endpoint, the fixture file was
// deleted). It drives the SAME flows as the normal suite, so whatever those
// pages request is what gets recorded — there is no list of endpoints to keep in
// sync by hand.
//
// Requirements: the backend running with its demo data. Against the local
// default:
//
//   cd backend && npm run seed && npm start
//   cd frontend-admin && npm run test:visual:record
//
// A plain `npx playwright test` never records: the recording path is gated on
// VISUAL_RECORD, which only this script sets.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Same resolution order as vite.config.js, so this checks the API the built
// bundle will actually talk to.
const API_BASE =
  process.env.REACT_APP_API_BASE_URL || process.env.VITE_API_BASE_URL || 'http://localhost:4001';

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

async function requireBackend() {
  try {
    const res = await fetch(`${API_BASE}/api/meta`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`Backend OK at ${API_BASE}/api/meta`);
  } catch (err) {
    fail(
      `No backend answering at ${API_BASE} (${err.message}).\n`
      + 'The recording needs live data. Start it first:\n'
      + '  cd backend && npm run seed && npm start',
    );
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: PKG_ROOT,
    stdio: 'inherit',
    // npx/npm are .cmd shims on Windows.
    shell: process.platform === 'win32',
    env: { ...process.env, VISUAL_RECORD: '1' },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await requireBackend();

// The suite runs against the production bundle via `vite preview`, so it has to
// be fresh (a stale build would record the requests of an older app).
run('npm', ['run', 'build']);
run('npx', ['playwright', 'test', 'visual-regression', '--workers=1']);

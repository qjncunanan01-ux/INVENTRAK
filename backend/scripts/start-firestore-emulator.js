// Cross-platform launcher for the Firestore-emulator backend:
//
//   npm run start:firestore:emulator
//
// Points the Firestore driver at the local emulator (FIRESTORE_EMULATOR_HOST,
// which the firebase-admin SDK honors automatically — no service account
// needed) and boots the npm-free server in Firestore mode. Requires the
// emulator to be running first (npm run emulators:start). A plain `env VAR=x
// node ...` prefix would only work on bash, so the env var is set here in JS.
const fs = require('fs');
const path = require('path');
const net = require('net');

// The emulator port lives in firebase.json (single source of truth), so
// changing it there cannot silently drift from this launcher.
function emulatorPort() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8'));
    return String(cfg.emulators && cfg.emulators.firestore && cfg.emulators.firestore.port);
  } catch {
    return '8085';
  }
}
const port = emulatorPort();

// Pre-flight: fail fast with a friendly message when the emulator isn't up.
function emulatorUp(host, portNum) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port: portNum });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}

(async () => {
  const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST || `localhost:${port}`).split(':');
  if (!(await emulatorUp(host, Number(portStr)))) {
    console.error(`Firestore emulator not reachable at ${host}:${portStr}.`);
    console.error('Start it first with: npm run emulators:start');
    process.exit(1);
  }
  process.env.FIRESTORE_EMULATOR_HOST = `${host}:${portStr}`;
  process.env.DB_DRIVER = 'firestore';
  process.env.PORT = process.env.PORT || '4001';

  const { start } = require('../src/server_npmfree');
  await start();
  console.log(`[firestore:emulator] npm-free backend running on ${process.env.PORT}`);
})().catch((err) => {
  console.error(`[firestore:emulator] failed to start: ${err.message}`);
  process.exit(1);
});

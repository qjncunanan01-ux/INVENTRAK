// Start the backend DETACHED, print the pid, then exit cleanly.
//
// Usage:
//   node .c/freebuff/start-backend.cjs           # start (default port 4001)
//   INVENTRAK_PORT=5100 node .c/freebuff/start-backend.cjs
//   node .c/freebuff/start-backend.cjs --kill    # stop the previously started instance
//
// Detached-process tradeoff (by design): the child outlives this launcher so
// interactive shells and CI steps can return immediately. To keep that safe
// for parents that DO want to clean up, the pid is (a) printed on stdout and
// (b) persisted in .c/freebuff/backend.pid, which `--kill` consumes.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const scriptDir = __dirname;
const pidFile = path.join(scriptDir, 'backend.pid');
const logDir = path.join(scriptDir, 'logs');
fs.mkdirSync(logDir, { recursive: true });
const stdout = fs.openSync(path.join(logDir, 'backend-stdout.log'), 'a');
const stderr = fs.openSync(path.join(logDir, 'backend-stderr.log'), 'a');

// --- Repo-root resolution (review fix: no __dirname-as-cwd assumption). ---
// Walk up from this script until backend/src/server_npmfree.js exists.
function findRepoRoot() {
  let dir = scriptDir;
  for (let depth = 0; depth < 6; depth += 1) {
    if (fs.existsSync(path.join(dir, 'backend', 'src', 'server_npmfree.js'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  console.error('Could not locate backend/src/server_npmfree.js walking up from ' + scriptDir);
  process.exit(1);
}
const repoRoot = findRepoRoot();

// --- Port configuration (review fix: not hardcoded). ---
const PORT = String(process.env.INVENTRAK_PORT || '4001');
const healthUrl = `http://localhost:${PORT}/api/health`;

if (process.argv.includes('--kill')) {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (!Number.isFinite(pid)) throw new Error('pid file is empty or corrupt');
    process.kill(pid);
    fs.unlinkSync(pidFile);
    console.log('killed pid=' + pid);
  } catch (e) {
    console.error('kill failed: ' + e.message + ' (is the backend running?)');
    process.exit(1);
  }
  process.exit(0);
}

// --kill-port: reap whatever process actually LISTENS on the port (the stale-
// instance case a pid file cannot know about). Prints the pid it killed so an
// operator/CI log can audit exactly what was terminated.
if (process.argv.includes('--kill-port')) {
  const { execSync } = require('child_process');
  try {
    const out = execSync(
      `netstat -ano -p tcp | findstr "LISTENING" | findstr ":${PORT} "`,
      { encoding: 'utf8' }
    );
    const pid = parseInt(out.trim().split(/\s+/).pop(), 10);
    if (!Number.isFinite(pid)) throw new Error('could not parse listener pid');
    process.kill(pid);
    console.log('killed port-owner pid=' + pid + ' (was listening on ' + PORT + ')');
  } catch (e) {
    console.error('kill-port failed: ' + (e.message || e).trim() + ' (nothing listening on ' + PORT + '?)');
    process.exit(1);
  }
  process.exit(0);
}

const proc = spawn('node', [path.join(repoRoot, 'backend', 'src', 'server_npmfree.js')], {
  stdio: ['ignore', stdout, stderr],
  detached: true,
  env: { ...process.env, PORT },
  cwd: repoRoot,
});
proc.unref();
fs.writeFileSync(pidFile, String(proc.pid));
console.log('pid=' + proc.pid + ' port=' + PORT);

// Give startup a moment, then probe the health endpoint so callers get a
// quick signal (they should still poll themselves for full readiness).
setTimeout(() => {
  http.get(healthUrl, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => console.log('health=' + (res.statusCode === 200 ? 'ok' : res.statusCode) + ' body=' + data.slice(0, 200)));
  }).on('error', (e) => console.log('health=err ' + e.message));
}, 1500).unref();

#!/usr/bin/env node
/**
 * INVENTRAK one-click demo launcher (safety net for demo day).
 *
 * Starts everything needed for the presentation with a single double-click
 * (via demo-launch.bat): backend + admin dashboard + public Cloudflare tunnel.
 * Reuses anything already running; falls back gracefully when pieces are
 * missing. Zero npm dependencies — pure Node.
 *
 * Usage:  node scripts/demo-launch.js      (or double-click demo-launch.bat)
 */
'use strict';

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const ADMIN = path.join(ROOT, 'frontend-admin');
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 4001);
const ADMIN_PORT = Number(process.env.ADMIN_PORT || 3000);
const CF_BIN = process.env.CLOUDFLARED_BIN || path.join(ROOT, '.freebuff', 'cloudflared.exe');
const CF_URL =
  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
const TUNNEL_STARTUP_MS = 20_000;

const children = new Set();
let summary = [];

function log(msg) {
  console.log(msg);
}

function isPortUp(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/api/openapi.json', timeout: timeoutMs }, (res) => {
      req.destroy();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: opts.cwd || ROOT,
    shell: true,
    env: { ...process.env, ...(opts.env || {}) },
    stdio: 'pipe',
  });
  children.add(child);
  let out = '';
  child.stdout.on('data', (d) => {
    const s = d.toString();
    out += s;
    if (opts.onStdout) opts.onStdout(s);
  });
  child.stderr.on('data', (d) => {
    const s = d.toString();
    if (opts.onStderr) opts.onStderr(s);
  });
  child.on('exit', () => children.delete(child));
  return child;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function lanIP() {
  try {
    const nets = os.networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const net of list || []) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
  } catch (_) {
    /* ignore */
  }
  return 'localhost';
}

async function startBackend() {
  if (await isPortUp(BACKEND_PORT)) {
    log(`  ✓ backend already running on :${BACKEND_PORT} (reusing)`);
    summary.push(`Backend    http://localhost:${BACKEND_PORT}   (already running)`);
    return;
  }
  // Prefer the full SQLite server (seeded demo data); fall back to the
  // zero-native-dependency server if better-sqlite3 isn't available.
  for (const entry of ['src/server.js', 'src/server_npmfree.js']) {
    const script = path.join(BACKEND, entry);
    if (!fs.existsSync(script)) continue;
    log(`  ▶ starting backend: node ${entry} (port ${BACKEND_PORT})`);
    const child = run('node', [entry], {
      cwd: BACKEND,
      env: { PORT: String(BACKEND_PORT) },
      onStdout: (s) => { if (/running on/.test(s)) log('  ✓ backend booted'); },
    });
    let up = false;
    for (let i = 0; i < 12; i++) {
      await wait(1000);
      if (await isPortUp(BACKEND_PORT)) { up = true; break; }
      if (child.exitCode !== null && !children.has(child)) break; // crashed
    }
    if (up) {
      summary.push(`Backend    http://localhost:${BACKEND_PORT}`);
      return;
    }
    log(`  ✗ ${entry} did not boot, trying next...`);
    try { child.kill(); } catch (_) { /* ignore */ }
  }
  log('  ✗ could not start any backend — run "cd backend && npm install" first');
}

async function ensureCloudflared() {
  if (fs.existsSync(CF_BIN)) return true;
  log('  ▶ downloading Cloudflare tunnel binary (~50 MB, one-time)...');
  try {
    execSync(`curl -sL "${CF_URL}" -o "${CF_BIN}"`, { timeout: 240_000 });
    return fs.existsSync(CF_BIN) && fs.statSync(CF_BIN).size > 10_000_000;
  } catch (_) {
    return false;
  }
}

async function startTunnel() {
  if (!(await ensureCloudflared())) {
    log('  ✗ cloudflared unavailable — falling back to LAN-only mode');
    summary.push(`Public URL  (none) — phone must be on same Wi-Fi: http://${lanIP()}:${BACKEND_PORT}`);
    return null;
  }
  log('  ▶ starting Cloudflare tunnel (public URL)...');
  let publicUrl = null;
  const child = run(`"${CF_BIN}"`, ['tunnel', '--url', `http://localhost:${BACKEND_PORT}`], {
    onStdout: (s) => {
      const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !publicUrl) {
        publicUrl = m[0];
        log(`  ✓ public URL: ${publicUrl}`);
        summary.push(`Public URL ${publicUrl}   (works from any network)`);
      }
    },
    onStderr: (s) => {
      const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !publicUrl) {
        publicUrl = m[0];
        log(`  ✓ public URL: ${publicUrl}`);
        summary.push(`Public URL ${publicUrl}   (works from any network)`);
      }
    },
  });
  for (let i = 0; i < TUNNEL_STARTUP_MS / 500; i++) {
    if (publicUrl) break;
    if (!children.has(child)) break;
    await wait(500);
  }
  if (!publicUrl) {
    summary.push(`Public URL  (tunnel slow) — phone same Wi-Fi: http://${lanIP()}:${BACKEND_PORT}`);
  }
  return publicUrl;
}

async function startAdmin() {
  if (await isPortUp(ADMIN_PORT, '127.0.0.1')) {
    log(`  ✓ admin dashboard already running on :${ADMIN_PORT} (reusing)`);
    summary.push(`Admin      http://localhost:${ADMIN_PORT}   (already running)`);
    return;
  }
  log(`  ▶ starting admin dashboard (first build can take ~30-60s)...`);
  run('npx react-scripts start', [], {
    cwd: ADMIN,
    env: { PORT: String(ADMIN_PORT), CI: 'false', REACT_APP_API_BASE_URL: `http://localhost:${BACKEND_PORT}` },
  });
  for (let i = 0; i < 90; i++) {
    await wait(1000);
    if (await isPortUp(ADMIN_PORT, '127.0.0.1')) {
      log('  ✓ admin dashboard up');
      summary.push(`Admin      http://localhost:${ADMIN_PORT}`);
      return;
    }
  }
  log('  ✗ admin dashboard did not come up in 90s (check frontend-admin/node_modules)');
  summary.push('Admin      (failed to start — see log above)');
}

function printSummary(publicUrl) {
  const box = (t) => `  ${'='.repeat(72)}\n  ${t}`;
  console.log('\n\n' + box('INVENTRAK — DEMO DAY LAUNCHER'));
  console.log('  ' + '='.repeat(72) + '\n');
  for (const line of summary) console.log(`  ${line}`);
  console.log(`  Mobile     ${publicUrl ? `scan QR from Expo (EXPO_PUBLIC_API_URL=${publicUrl})` : `Expo + phone on same Wi-Fi (http://${lanIP()}:${BACKEND_PORT})`}`);
  console.log('\n  Demo logins   admin / admin123   ·   customer / customer123');
  console.log('  Phone tip     bake the Public URL: EXPO_PUBLIC_API_URL=<url> npx expo start');
  console.log('\n  All windows are running — close this window to stop everything.\n');
}

async function main() {
  log('INVENTRAK demo launcher — starting everything for you...\n');
  await startBackend();
  const publicUrl = await startTunnel();
  await startAdmin();
  printSummary(publicUrl);

  const shutdown = () => {
    log('\nStopping demo services...');
    for (const c of children) { try { c.kill(); } catch (_) { /* ignore */ } }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  log('(press Ctrl+C to stop)');
}

main().catch((e) => {
  console.error('Launcher error:', e);
  process.exit(1);
});

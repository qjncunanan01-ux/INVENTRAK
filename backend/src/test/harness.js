// Shared test harness: boots the SQLite backend and the npm-free fallback side
// by side in isolated temp directories so the repo data is never touched.
//
// IMPORTANT: this module must be required BEFORE requiring the backend modules
// (they read process.env at load time). It performs the env setup as a module
// side effect, so requiring it in a test file is sufficient.
//
// Both backends seed from the same products.json, so their state is
// comparable. The npm-free fallback starts from a clean slate (its inventory
// is auto-generated on first boot, matching the SQLite seeder's 3 locations).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ---- Isolate state BEFORE requiring the backend modules (they read the env
// ---- at load time).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventrak-test-'));
const dataDir = path.join(__dirname, '..', '..', 'data');

process.env.INVENTRAK_DB_PATH = path.join(tmpDir, 'test.db');
process.env.INVENTRAK_DATA_DIR = path.join(tmpDir, 'data');
fs.mkdirSync(process.env.INVENTRAK_DATA_DIR, { recursive: true });
// Share the same product catalog with the SQLite seeder.
fs.copyFileSync(
  path.join(dataDir, 'products.json'),
  path.join(process.env.INVENTRAK_DATA_DIR, 'products.json')
);
fs.writeFileSync(path.join(process.env.INVENTRAK_DATA_DIR, 'order_inquiries.json'), '[]');
fs.writeFileSync(path.join(process.env.INVENTRAK_DATA_DIR, 'stock_movements.json'), '[]');

const { app, seedDatabase } = require('../app');
const { db } = require('../db');
const { createServer } = require('../server_npmfree');

let sqlite = { url: '', token: { admin: null, customer: null, invalid: 'not-a-real-token' } };
let npmfree = { url: '', token: { admin: null, customer: null, invalid: 'not-a-real-token' } };
let sqliteServer;
let npmfreeServer;

async function bootBoth() {
  seedDatabase();
  sqliteServer = app.listen(0);
  sqlite.url = `http://127.0.0.1:${sqliteServer.address().port}`;
  npmfreeServer = createServer(0);
  npmfree.url = `http://127.0.0.1:${npmfreeServer.address().port}`;

  for (const side of [sqlite, npmfree]) {
    const adminRes = await fetch(`${side.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    if (adminRes.status !== 200) {
      throw new Error('admin login should succeed on boot');
    }
    side.token.admin = (await adminRes.json()).token;

    const customerRes = await fetch(`${side.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'customer', password: 'customer123' }),
    });
    if (customerRes.status !== 200) {
      throw new Error('customer login should succeed on boot');
    }
    side.token.customer = (await customerRes.json()).token;
  }
}

function teardown() {
  try { sqliteServer && sqliteServer.close(); } catch {}
  try { npmfreeServer && npmfreeServer.close(); } catch {}
  // Release the SQLite file handle before deleting the temp dir (Windows).
  try { db.close(); } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function call(url, pathname, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${url}${pathname}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, contentType: res.headers.get('content-type') || '' };
}

// Normalizes a JSON value to a shape signature: object keys (sorted) with the
// shape of each value, and arrays reduced to the SET of element shapes so that
// ordering and counts do not matter — only structure and types.
function shapeOf(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'empty-array';
    const shapes = new Set(v.map(shapeOf));
    return `array[${[...shapes].sort().join(',')}]`;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${k}:${shapeOf(v[k])}`).join(',')}}`;
  }
  return typeof v;
}

// Fires the same request at both backends and asserts status + body shape match.
async function both(label, pathname, { method = 'GET', auth = null, body } = {}) {
  const doCall = async (side) =>
    call(side.url, pathname, { method, body, token: auth ? side.token[auth] : null });
  const a = await doCall(sqlite);
  const b = await doCall(npmfree);
  if (a.status !== b.status) {
    throw new Error(`${label}: status ${a.status} vs ${b.status}`);
  }
  const sa = shapeOf(a.json);
  const sb = shapeOf(b.json);
  if (sa !== sb) {
    throw new Error(`${label}:\n  sqlite:  ${sa}\n  npmfree: ${sb}`);
  }
  return { a, b };
}

module.exports = { sqlite, npmfree, bootBoth, teardown, call, shapeOf, both };

// END-TO-END RECOVERY DRILL — the disaster, rehearsed against a REAL server.
//
// backup-restore.test.js proves the envelope round-trips inside one process.
// This file tests the thing an operator actually does after a bad deploy, and
// it is deliberately harsher about every step:
//
//   populate → snapshot → WIPE the database → restart and prove the data is
//   really gone → restore from the snapshot file → prove the admin console and
//   BOTH phone APIs answer off the recovered rows.
//
// Why real child processes instead of ./harness: a wipe means deleting the
// database itself. The harness's servers live inside this test process holding
// the SQLite handle open — the delete would fail outright on Windows, and even
// where it succeeded the "restart" would not be the cold process a redeploy
// produces. So the drill spawns the real entrypoints (src/server.js and
// src/server_npmfree.js) with their own state directories and stops them
// around the wipe. The one thing it fixes by hand is JWT_SECRET: a deployment
// has a constant secret, and "the signing key changed" is a different failure
// from the one under test.
//
// THE MARKERS ARE THE POINT. A cold boot re-seeds the packaged demo catalogue
// and the demo accounts, so "the admin can log in after a wipe" proves nothing
// at all — it would pass with the restore removed entirely. Everything asserted
// after the restore is a row that exists ONLY in the snapshot: a product, a
// customer account with its own password, and the order inquiry that account
// submitted. Each of the three also belongs to a different client, which is how
// one drill covers the admin console and both phone apps:
//
//   product        → admin console + staff app + customer app catalogues
//   customer login → customer app (the password HASH came back, not just rows)
//   inquiry        → customer app's own order history
//
// Driven against both local drivers because their snapshots are genuinely
// different implementations (`sqlite` exports tables, the npm-free backend
// exports store datasets) and a wipe is driver-specific: one deletes a .db
// file, the other a data directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ORDER_TERMS_VERSION } = require('../catalog-orders/order-terms');

const BACKEND_ROOT = path.join(__dirname, '..', '..');

// Each deployment declares where its durable state lives, so the drill can
// delete exactly that and nothing else. `state` is what a redeploy takes away.
const DRIVERS = [
  {
    name: 'sqlite',
    script: 'src/server.js',
    state: (dir) => path.join(dir, 'data'),
    env: (dir) => ({ INVENTRAK_DB_PATH: path.join(dir, 'data', 'inventrak.db') }),
    // SQLite owns its users table, so a customer account and its password hash
    // are genuinely part of the snapshot and genuinely have to come back.
    accountsInSnapshot: true,
  },
  {
    name: 'json',
    script: 'src/server_npmfree.js',
    state: (dir) => path.join(dir, 'data'),
    env: () => ({ DB_DRIVER: 'json' }),
    // The npm-free fallback keeps ACCOUNTS in memory: its virtual '@users'
    // dataset is persisted by the Firestore/Supabase drivers only (see the
    // readJSON/writeJSON note in server_npmfree.js, and README's "the npm-free
    // JSON-file mode is an ephemeral fallback"). Its snapshot is data-only, so
    // no restore can bring an account back. The drill asserts that documented
    // behavior instead of quietly passing, and verifies the recovered DATA
    // through the same phone endpoints with the re-seeded demo account.
    accountsInSnapshot: false,
  },
];

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function http(url, pathname, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${url}${pathname}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON bodies are kept in `text` for the failure message.
  }
  return { status: res.status, json, text };
}

async function login(url, username, password) {
  return http(url, '/api/auth/login', { method: 'POST', body: { username, password } });
}

/** Boot the real entrypoint against an isolated state directory. */
async function startServer(driver, dir) {
  // An EMPTY data directory is what exists after a wipe: the directory is part
  // of the deployment, the files in it are not. The store driver writes its
  // datasets into it and does not create it, so the drill recreates it here
  // rather than pretending the restart has somewhere to write.
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  const port = await freePort();
  const child = spawn(process.execPath, [driver.script], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      // Constant across the restart, exactly as a deployment's secret is.
      JWT_SECRET: 'recovery-drill-secret',
      NPMFREE_TOKEN_SECRET: 'recovery-drill-secret',
      // The audit trail lives beside the data (audit.js derives it from
      // INVENTRAK_DATA_DIR), so the wipe takes it too — which is what happens
      // to a container's filesystem.
      INVENTRAK_DATA_DIR: path.join(dir, 'data'),
      ...driver.env(dir),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  child.stdout.on('data', (chunk) => log.push(String(chunk)));
  child.stderr.on('data', (chunk) => log.push(String(chunk)));

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`${driver.name} server exited with code ${child.exitCode}:\n${log.join('')}`);
    }
    try {
      const res = await fetch(`${url}/api/meta`);
      if (res.ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`${driver.name} server never answered /api/meta:\n${log.join('')}`);
    }
    await new Promise((resolve) => { setTimeout(resolve, 150); });
  }

  return {
    url,
    log,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      await exited;
      clearTimeout(timer);
    },
  };
}

/**
 * One full drill. Returns the numbers it observed so the test can assert them
 * (the summary line is printed for a human reading the CI log).
 */
async function runDrill(driver) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `inventrak-drill-${driver.name}-`));
  // The snapshot is written OUTSIDE the state directory: recovering from a
  // file that the wipe also deleted is not recovery.
  const snapshotFile = path.join(dir, 'snapshot.json');
  const stateDir = driver.state(dir);
  const stamp = `${driver.name}-${Date.now()}`;
  const marker = `Drill marker ${stamp}`;
  const account = { username: `drill-${stamp}`, password: 'DrillPass123!' };
  let server = null;

  try {
    // --- 1. POPULATE a running system ---------------------------------------
    server = await startServer(driver, dir);
    let admin = await login(server.url, 'admin', 'admin123');
    assert.equal(admin.status, 200, `${driver.name}: admin signs in on a fresh boot`);
    let owner = await login(server.url, 'owner', 'owner123');
    assert.equal(owner.status, 200, `${driver.name}: owner signs in on a fresh boot`);

    const product = await http(server.url, '/api/products', {
      method: 'POST',
      token: admin.json.token,
      body: { name: marker, category: 'Recovery Drill', price: 42, unit: 'pcs', sku: `DRL-${Date.now()}` },
    });
    assert.equal(product.status, 201, `${driver.name}: marker product created (${product.text.slice(0, 200)})`);

    const registered = await http(server.url, '/api/auth/register', {
      method: 'POST',
      body: {
        username: account.username,
        password: account.password,
        email: `${account.username}@example.com`,
        phone: '09171234567',
      },
    });
    assert.equal(registered.status, 200, `${driver.name}: marker account registered (${registered.text.slice(0, 200)})`);

    const customer = await login(server.url, account.username, account.password);
    assert.equal(customer.status, 200, `${driver.name}: the new customer can sign in`);

    const inquiry = await http(server.url, '/api/order-inquiries', {
      method: 'POST',
      token: customer.json.token,
      body: {
        customer_name: marker,
        customer_email: `${account.username}@example.com`,
        notes: marker,
        products: [{ product_id: product.json.id, quantity: 2 }],
        terms_accepted: true,
        terms_version: ORDER_TERMS_VERSION,
      },
    });
    assert.equal(inquiry.status, 201, `${driver.name}: marker inquiry submitted (${inquiry.text.slice(0, 200)})`);

    // --- 2. SNAPSHOT while all of that exists -------------------------------
    const frozen = await http(server.url, '/api/admin/backup', { token: owner.json.token });
    assert.equal(frozen.status, 200, `${driver.name}: snapshot downloaded`);
    const snapshot = frozen.json;
    assert.equal(snapshot.format, 'inventrak-backup', `${driver.name}: envelope format`);
    assert.equal(snapshot.driver, driver.name, `${driver.name}: envelope names its driver`);
    const shipped = JSON.stringify(snapshot.tables);
    assert.ok(shipped.includes(marker), `${driver.name}: the snapshot carries the marker product`);
    if (driver.accountsInSnapshot) {
      assert.ok(shipped.includes(account.username), `${driver.name}: the snapshot carries the marker account`);
    } else {
      assert.ok(
        !shipped.includes(`"username":"${account.username}"`),
        `${driver.name}: this driver's snapshot is data-only — no account rows in it`,
      );
    }
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot));
    const snapshotRows = Object.values(snapshot.counts).reduce((sum, n) => sum + n, 0);

    // --- 3. WIPE: stop, delete the state, start a cold server ---------------
    await server.stop();
    fs.rmSync(stateDir, { recursive: true, force: true });
    assert.ok(!fs.existsSync(stateDir), `${driver.name}: the database directory is gone`);
    assert.ok(fs.existsSync(snapshotFile), `${driver.name}: the snapshot file survived the wipe`);

    server = await startServer(driver, dir);
    admin = await login(server.url, 'admin', 'admin123');
    assert.equal(admin.status, 200, `${driver.name}: the demo admin is back — the seeder re-creates demo data, which is exactly why the demo data cannot prove recovery`);
    owner = await login(server.url, 'owner', 'owner123');
    assert.equal(owner.status, 200, `${driver.name}: the management account is back for restore`);

    // Searched by name, and without page/limit so the endpoint answers with a
    // bare array — the marker is unique, so an empty result means gone.
    const afterWipe = await http(server.url, `/api/products?search=${encodeURIComponent(marker)}`, { token: admin.json.token });
    assert.equal(afterWipe.status, 200, `${driver.name}: catalogue readable after the wipe`);
    assert.deepEqual(afterWipe.json, [], `${driver.name}: the marker product is really gone`);

    const gone = await login(server.url, account.username, account.password);
    assert.equal(gone.status, 401, `${driver.name}: the marker account is really gone`);

    // --- 4. RESTORE from the file that outlived the database ----------------
    const restored = await http(server.url, '/api/admin/restore', {
      method: 'POST',
      token: owner.json.token,
      body: { confirm: true, snapshot: JSON.parse(fs.readFileSync(snapshotFile, 'utf8')) },
    });
    assert.equal(restored.status, 200, `${driver.name}: restore succeeds (${restored.text.slice(0, 300)})`);
    assert.equal(restored.json.source, 'upload', `${driver.name}: the restore names its source`);
    assert.equal(restored.json.tables_restored, Object.keys(snapshot.tables).length, `${driver.name}: every dataset came back`);
    assert.equal(restored.json.rows_restored, snapshotRows, `${driver.name}: every snapshot row was inserted`);

    // --- 5. RECOVERED: the admin console ------------------------------------
    admin = await login(server.url, 'admin', 'admin123');
    assert.equal(admin.status, 200, `${driver.name}: admin console login after recovery`);

    const products = await http(server.url, `/api/products?search=${encodeURIComponent(marker)}`, { token: admin.json.token });
    assert.equal(products.status, 200, `${driver.name}: admin catalogue loads`);
    const recovered = products.json.find((p) => p.name === marker);
    assert.ok(recovered, `${driver.name}: the marker product is back in the admin catalogue`);
    assert.equal(Number(recovered.id), Number(product.json.id), `${driver.name}: with its original id`);

    // The dashboard's own read, the approval queue's inventory read and the
    // users list the console's account screen uses.
    for (const [label, pathname] of [
      ['dashboard summary', '/api/analytics/summary'],
      ['inventory levels', '/api/inventory'],
      ['user accounts', '/api/users'],
    ]) {
      const res = await http(server.url, pathname, { token: admin.json.token });
      assert.equal(res.status, 200, `${driver.name}: ${label} loads off the recovered data`);
    }

    // The customer's order is business data on every driver, so it has to be
    // back in the console's list whichever one is running.
    const inquiries = await http(server.url, '/api/order-inquiries', { token: admin.json.token });
    assert.equal(inquiries.status, 200, `${driver.name}: admin inquiry list loads`);
    assert.ok(
      JSON.stringify(inquiries.json).includes(String(inquiry.json.id)),
      `${driver.name}: the recovered inquiry is back in the admin console`,
    );

    if (driver.accountsInSnapshot) {
      const users = await http(server.url, '/api/users', { token: admin.json.token });
      assert.ok(
        JSON.stringify(users.json).includes(account.username),
        `${driver.name}: the recovered account is listed in the admin console`,
      );
    }

    // --- 6. RECOVERED: the staff phone app ----------------------------------
    const staff = await login(server.url, 'staff', 'staff123');
    assert.equal(staff.status, 200, `${driver.name}: staff app login after recovery`);
    const staffProducts = await http(server.url, `/api/products?search=${encodeURIComponent(marker)}`, { token: staff.json.token });
    assert.equal(staffProducts.status, 200, `${driver.name}: staff catalogue loads`);
    assert.ok(
      staffProducts.json.some((p) => p.name === marker),
      `${driver.name}: the staff app sees the recovered product`,
    );
    for (const [label, pathname] of [
      ['My Requests (counts)', '/api/stock-adjustments'],
      ['My Requests (transfers)', '/api/stock-transfers'],
      ['scan-to-count lookup', `/api/products?search=${encodeURIComponent(marker)}`],
    ]) {
      const res = await http(server.url, pathname, { token: staff.json.token });
      assert.equal(res.status, 200, `${driver.name}: staff ${label} loads off the recovered data`);
      assert.ok(Array.isArray(res.json), `${driver.name}: staff ${label} answers with a list`);
    }

    // --- 7. RECOVERED: the customer phone app -------------------------------
    // On a driver that snapshots accounts this is the strongest assertion in
    // the drill: the login only succeeds if the users table came back WITH its
    // password hash intact. On the data-only driver there is no account to
    // restore, so the app is exercised with the re-seeded demo customer — the
    // recovered rows it reads are still the point.
    const customerCreds = driver.accountsInSnapshot
      ? account
      : { username: 'customer', password: 'customer123' };
    const backIn = await login(server.url, customerCreds.username, customerCreds.password);
    assert.equal(
      backIn.status,
      200,
      driver.accountsInSnapshot
        ? `${driver.name}: the customer signs in with the password from the snapshot`
        : `${driver.name}: customer app login after recovery`,
    );
    const customerProducts = await http(server.url, `/api/products?search=${encodeURIComponent(marker)}`, { token: backIn.json.token });
    assert.equal(customerProducts.status, 200, `${driver.name}: customer catalogue loads`);
    assert.ok(
      customerProducts.json.some((p) => p.name === marker),
      `${driver.name}: the customer app sees the recovered product`,
    );
    const history = await http(server.url, '/api/order-inquiries', { token: backIn.json.token });
    assert.equal(history.status, 200, `${driver.name}: customer order history loads`);
    assert.ok(history.json, `${driver.name}: customer order history answers JSON`);
    if (driver.accountsInSnapshot) {
      assert.ok(
        JSON.stringify(history.json).includes(String(inquiry.json.id)),
        `${driver.name}: the customer's own recovered inquiry is in that history`,
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      `[drill:${driver.name}] wiped ${stateDir} and recovered ${restored.json.tables_restored} dataset(s), `
      + `${restored.json.rows_restored} row(s); admin console + staff app + customer app all verified`,
    );
    return { snapshotRows, restoredRows: restored.json.rows_restored };
  } finally {
    if (server) await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// One test per driver, sequentially: each drill stops and starts real servers,
// and two at once would only make a failure harder to read.
for (const driver of DRIVERS) {
  test(`recovery drill (${driver.name}): populated → wiped → restored → admin console and both phone APIs work`, async () => {
    const result = await runDrill(driver);
    assert.equal(result.restoredRows, result.snapshotRows, `${driver.name}: restored rows equal the snapshot`);
  });
}

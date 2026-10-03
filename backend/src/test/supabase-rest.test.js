// The Supabase path of the two maintenance scripts, exercised end to end.
//
// WHY THIS EXISTS SEPARATELY
// Both scripts grew a Supabase target addressed through the shared
// supabase-rest.js helper, and that wiring was at one point only
// syntax-checked. The SQLite tests cannot reach it, and no CI job runs against
// the real project — so a wrong query string, a missing auth header, or a
// helper that quietly fell back to a table flush would have failed exclusively
// in production, against the live catalog, on the one path nothing exercises.
//
// So this stands up a server that speaks the same PostgREST shape the real one
// does, points the scripts at it through SUPABASE_URL/SUPABASE_KEY, and runs
// them as child processes — the same way `npm run customers:backfill -- --apply`
// runs them.
//
// The properties defended here are the ones SQLite cannot show:
//   - reads send the SELECT the script asked for
//   - every request is authenticated
//   - a write PATCHes exactly ONE named row, leaving other fields intact
//   - NO request is ever a DELETE — the whole reason this helper bypasses
//     store-supabase.js is that its delete-all flush could empty a table if a
//     script died mid-write
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const { requireConfig } = require('../../scripts/supabase-rest');

const tmpDirs = [];
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

// Node's fetch pools connections, and server.close() only stops NEW ones — it
// waits on the idle keep-alive sockets the child processes left open. Without
// this the suite hangs after its last test instead of exiting, which looks like
// a failure in the file that happens to run next.
function stop(server) {
  server.closeAllConnections();
  server.close();
}

const SCRIPT = (name) => path.join(__dirname, '..', '..', 'scripts', name);

// The repo ships no data/product-costs.csv — that file is the supplier's to
// provide, so these tests write their own into a temp dir rather than depending
// on a file that is not there.
function makeCsv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventrak-csv-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'costs.csv');
  fs.writeFileSync(file, 'Product Name,Cost\nSyrup A,120\nSyrup B,240\n');
  return file;
}

// A minimal PostgREST stand-in. `state.tables` is { name: [ {id, idx, data} ] }
// and every request is recorded, so a test can assert not just what ended up
// in the tables but what the script TRIED to do.
function startPostgrest(tables) {
  const state = { tables, requests: [], authHeaders: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const table = url.pathname.replace(/^\/rest\/v1\//, '');
    state.authHeaders.push({ apikey: req.headers.apikey, authorization: req.headers.authorization });

    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET') {
      state.requests.push({ method: 'GET', table, select: url.searchParams.get('select'), query: url.search });
      return send(200, state.tables[table] || []);
    }

    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { return send(400, { message: 'bad json' }); }

      if (req.method === 'PATCH') {
        const id = Number(String(url.searchParams.get('id') || '').replace('eq.', ''));
        state.requests.push({ method: 'PATCH', table, id, body });
        const row = (state.tables[table] || []).find(r => r.id === id);
        if (!row) return send(404, { message: 'not found' });
        // The scripts only ever send { data }, so replacing that column is
        // faithful to what PostgREST would do to it.
        Object.assign(row, body);
        return send(200, []);
      }

      if (req.method === 'POST') {
        state.requests.push({ method: 'POST', table, body });
        const rows = Array.isArray(body) ? body : [body];
        if (!state.tables[table]) state.tables[table] = [];
        const start = state.tables[table].length;
        rows.forEach((r, i) => state.tables[table].push({ ...r, id: r.id ?? start + i + 1 }));
        return send(201, rows);
      }

      // Recorded rather than rejected, so a test can assert it never happened.
      if (req.method === 'DELETE') {
        state.requests.push({ method: 'DELETE', table, body: null });
        state.tables[table] = [];
        return send(200, []);
      }

      return send(405, { message: 'unsupported' });
    });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

// ASYNC ON PURPOSE. The stand-in PostgREST server lives in THIS process, and
// the script under test runs as a child that calls back into it. execFileSync
// blocks the event loop, so the server could never answer the child's request
// and the two would deadlock until the runner timed out. spawn() keeps the loop
// free, which is the only reason this test can work at all in-process.
function runScript(script, args, url) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT(script), ...args], {
      env: { ...process.env, SUPABASE_URL: url, SUPABASE_KEY: 'test-key' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve(stdout);
      const err = new Error(`${script} exited ${code}`);
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });
  });
}

const writes = (state) => state.requests.filter(r => r.method !== 'GET');

test('requireConfig returns null when the project is not configured', () => {
  // The fallback branch: with no SUPABASE_URL the scripts target SQLite
  // instead, and must not build a URL pointing at "undefined".
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_KEY;
  try {
    assert.strictEqual(requireConfig(), null);
  } finally {
    if (saved.url !== undefined) process.env.SUPABASE_URL = saved.url;
    if (saved.key !== undefined) process.env.SUPABASE_KEY = saved.key;
  }
});

test('cost backfill: reads the catalog with the expected SELECT', async() => {
  const { server, state, url } = await startPostgrest({
    products: [
      { id: 1, idx: 0, data: { 'Product Name': 'Syrup A', Price: 500, Cost: null } },
      { id: 2, idx: 1, data: { 'Product Name': 'Syrup B', Price: 800, Cost: null } },
    ],
  });
  try {
    await runScript('backfill-costs.js', ['--apply', '--file', makeCsv()], url);
    const get = state.requests.find(r => r.method === 'GET' && r.table === 'products');
    assert.ok(get, 'the catalog is read over REST');
    assert.strictEqual(get.select, 'id,idx,data', 'the helper sends the SELECT the script asked for');
    assert.match(get.query, /order=idx\.asc/, 'ordering is preserved through the helper');
  } finally {
    stop(server);
  }
});

test('cost backfill: writes one row at a time and never flushes a table', async() => {
  const { server, state, url } = await startPostgrest({
    products: [
      { id: 1, idx: 0, data: { 'Product Name': 'Syrup A', Price: 500, Cost: null } },
      { id: 2, idx: 1, data: { 'Product Name': 'Syrup B', Price: 800, Cost: null } },
    ],
  });
  try {
    await runScript('backfill-costs.js', ['--apply', '--file', makeCsv()], url);

    const patches = state.requests.filter(r => r.method === 'PATCH');
    assert.ok(patches.length > 0, 'costs are written');
    for (const p of patches) {
      assert.strictEqual(p.table, 'products', 'only the products table is written');
      assert.ok(Number.isInteger(p.id), `PATCH ${p.id} names exactly one row`);
      assert.ok(p.body && typeof p.body.data === 'object', 'the row is patched as JSONB');
    }

    // The reason this helper exists at all. store-supabase.js caches a table and
    // rewrites it with a delete-all; a script that died mid-write could leave
    // the catalog empty. These scripts must never issue a DELETE.
    assert.strictEqual(writes(state).filter(r => r.method === 'DELETE').length, 0, 'no table flush');

    // ...and the point of PATCH-per-row: fields nobody asked about survive.
    const row = state.tables.products.find(r => r.data['Product Name'] === 'Syrup A');
    assert.ok(row, 'the row still exists');
    assert.strictEqual(row.data.Price, 500, 'the price is untouched');
    assert.ok('Cost' in row.data, 'the cost is written into the JSONB');

    assert.ok(
      state.authHeaders.every(h => h.apikey === 'test-key' && /Bearer test-key/.test(h.authorization || '')),
      'every request carries the project key',
    );
  } finally {
    stop(server);
  }
});

test('cost backfill: a dry run against Supabase sends no writes at all', async() => {
  const { server, state, url } = await startPostgrest({
    products: [{ id: 1, idx: 0, data: { 'Product Name': 'Syrup A', Price: 500, Cost: null } }],
  });
  try {
    const out = await runScript('backfill-costs.js', ['--file', makeCsv()], url);
    assert.match(out, /DRY RUN/);
    assert.strictEqual(writes(state).length, 0, 'a dry run is inert against the live project too');
  } finally {
    stop(server);
  }
});

test('customer backfill: appends new customers and links sales by PATCH', async() => {
  const { server, state, url } = await startPostgrest({
    customers: [{ id: 1, idx: 0, data: { name: 'Juan Dela Cruz' } }],
    sales: [
      { id: 10, idx: 9, data: { customer_name: 'Juan Dela Cruz', customer_id: null, total_amount: 500 } },
      { id: 11, idx: 10, data: { customer_name: 'Maria Santos', customer_id: null, total_amount: 700 } },
    ],
    inquiries: [],
  });
  try {
    const out = await runScript('backfill-customers.js', ['--apply'], url);
    assert.match(out, /target: Supabase/);

    const inserts = writes(state).filter(r => r.method === 'POST' && r.table === 'customers');
    assert.strictEqual(inserts.length, 1, 'exactly one new customer, appended rather than merged');
    assert.match(inserts[0].body[0].data.name, /Maria Santos/);

    const links = writes(state).filter(r => r.method === 'PATCH' && r.table === 'sales');
    assert.strictEqual(links.length, 2, 'both sales are linked individually');

    // The link reads the row and PATCHes the merged JSONB precisely so the rest
    // of the sale is not lost — the property a bare {customer_id} patch would
    // have destroyed.
    const linked = state.tables.sales.find(r => r.id === 10);
    assert.ok(linked.data.customer_id, 'customer_id is set');
    assert.strictEqual(linked.data.total_amount, 500, 'the rest of the sale survives');
    assert.strictEqual(linked.data.customer_name, 'Juan Dela Cruz', 'and so does the original name');

    assert.strictEqual(writes(state).filter(r => r.method === 'DELETE').length, 0, 'no table flush');
    assert.strictEqual(state.tables.customers.length, 2, 'the existing customer is not duplicated');
    assert.match(out, /verify: 0 row\(s\) still unlinked/, 'the run verifies its own work');
  } finally {
    stop(server);
  }
});

test('customer backfill: a second run is a no-op against Supabase', async() => {
  const { server, state, url } = await startPostgrest({
    customers: [{ id: 1, idx: 0, data: { name: 'Juan Dela Cruz' } }],
    sales: [{ id: 10, idx: 9, data: { customer_name: 'Juan Dela Cruz', customer_id: null } }],
    inquiries: [],
  });
  try {
    await runScript('backfill-customers.js', ['--apply'], url);
    const afterFirst = writes(state).length;
    assert.ok(afterFirst > 0, 'the first run does work');
    const second = await runScript('backfill-customers.js', ['--apply'], url);
    assert.match(second, /nothing to do/);
    assert.strictEqual(writes(state).length, afterFirst, 'and the second run writes nothing');
  } finally {
    stop(server);
  }
});

test('the scripts report a REST failure instead of silently doing nothing', async() => {
  // A wrong table or a rejected key must surface. A maintenance script that
  // prints "0 updated" and exits 0 on a 404 is how a catalog quietly stays
  // uncosted for a month.
  const server = http.createServer((req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'relation "products" does not exist' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(
      runScript('backfill-costs.js', ['--file', makeCsv()], url),
      err => /failed/.test(String(err.stderr || err.message || '')),
      'a 404 from the project is an error, not a successful zero',
    );
  } finally {
    stop(server);
  }
});
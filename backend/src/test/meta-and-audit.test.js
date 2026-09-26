// GET /api/meta build identity + durable audit persistence.
//
// Meta: both backends must expose the same public build shape (name, version,
// commit, driver, time) so any client surface can display what it is running
// against — the QR rollout proved "which build am I on?" must be a glance,
// not an investigation.
//
// Audit durability: audit() mirrors every line to a remote sink (Supabase
// REST) when AUDIT_REMOTE_URL/AUDIT_REMOTE_KEY are set, and reSeedFromRemote()
// pulls the snapshot back into the local file at boot (dedup by the entry's
// `t`), so the file-reading /api/audit-trail endpoint survives Render's
// ephemeral filesystem across deploys.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

before(async () => {
  await bootBoth();
});

after(() => {
  teardown();
});

describe('GET /api/meta — build identity', () => {
  for (const side of [sqlite, npmfree]) {
    test(`${side.label || 'backend'}: public (no token), same shape, sane values`, async () => {
      const res = await call(side.url, '/api/meta');
      assert.equal(res.status, 200);
      assert.equal(res.json.ok, true);
      assert.equal(res.json.name, 'inventrak-backend');
      assert.equal(typeof res.json.time, 'string');
      // commit is null locally (no RENDER_GIT_COMMIT) — but if present it
      // must look like a git sha.
      if (res.json.commit !== null && res.json.commit !== undefined) {
        assert.match(String(res.json.commit), /^[0-9a-f]{7,40}$/);
      }
      assert.ok(['sqlite', 'json', 'firestore', 'supabase'].includes(res.json.driver));
    });

    test(`${side.label || 'backend'}: GIT_COMMIT env is surfaced`, async () => {
      // The handler reads the env at request time; set + restore around the call.
      const prev = process.env.GIT_COMMIT;
      process.env.GIT_COMMIT = 'abc1234def5678';
      try {
        const res = await call(side.url, '/api/meta');
        assert.equal(res.status, 200);
        assert.equal(res.json.commit, 'abc1234def5678');
      } finally {
        if (prev === undefined) delete process.env.GIT_COMMIT;
        else process.env.GIT_COMMIT = prev;
      }
    });
  }

  test('sqlite and npm-free meta shapes match', async () => {
    const a = await call(sqlite.url, '/api/meta');
    const b = await call(npmfree.url, '/api/meta');
    assert.equal(a.status, b.status);
    assert.deepEqual(
      Object.keys(a.json).sort(),
      Object.keys(b.json).sort(),
    );
  });
});

describe('durable audit trail — remote sink + re-seed', () => {
  // Minimal Supabase-REST-shaped fake: POST inserts (returns 201), GET with
  // select=... returns stored rows ascending. Enough to exercise audit.js's
  // mirroring and re-seed logic over real HTTP.
  function startFakeSupabase() {
    const rows = [];
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST' && url.pathname === '/rest/v1/audit_log') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            rows.push({ created_at: parsed.created_at, data: parsed.data });
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end('[]');
          } catch (e) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/rest/v1/audit_log') {
        const asc = [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(asc));
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });
    return new Promise((resolve) => {
      server.listen(0, () => resolve({ server, port: server.address().port, rows }));
    });
  }

  // audit.js snapshots env + file path at require time, so each scenario
  // loads a fresh copy of the module from a pristine require cache.
  function freshAuditModule({ remoteUrl, remoteKey, logFile }) {
    delete require.cache[require.resolve('../audit')];
    if (remoteUrl === undefined) delete process.env.AUDIT_REMOTE_URL;
    else process.env.AUDIT_REMOTE_URL = remoteUrl;
    if (remoteKey === undefined) delete process.env.AUDIT_REMOTE_KEY;
    else process.env.AUDIT_REMOTE_KEY = remoteKey;
    if (logFile === undefined) delete process.env.AUDIT_LOG_FILE;
    else process.env.AUDIT_LOG_FILE = logFile;
    return require('../audit');
  }

  test('audit() mirrors entries to the remote sink and reSeedFromRemote() restores them into the file (dedup by t)', async () => {
    const { server, port, rows } = await startFakeSupabase();
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-durability-'));
    const isolatedFile = path.join(isolatedDir, 'audit.log');
    const prevUrl = process.env.AUDIT_REMOTE_URL;
    const prevKey = process.env.AUDIT_REMOTE_KEY;
    const prevFile = process.env.AUDIT_LOG_FILE;
    try {
      const auditModule = freshAuditModule({
        remoteUrl: `http://127.0.0.1:${port}/rest/v1`,
        remoteKey: 'test-service-key',
        logFile: isolatedFile,
      });

      auditModule.audit('test.durability', { actor: 'tester', username: 'tester' });
      // The mirror is async fire-and-forget — poll the fake until it lands.
      const deadline = Date.now() + 3000;
      while (rows.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal(rows.length, 1, 'the audit line should reach the remote sink');
      assert.equal(rows[0].data.event, 'test.durability');
      assert.ok(rows[0].data.t, 'entry carries its timestamp');

      // Pretend the container was wiped: empty the local file, then re-seed
      // from the remote snapshot.
      fs.writeFileSync(isolatedFile, '');
      const seedResult = await auditModule.reSeedFromRemote();
      assert.equal(seedResult.ok, true);
      const lines = fs.readFileSync(isolatedFile, 'utf8').split('\n').filter(Boolean);
      assert.equal(lines.length, 1);
      assert.equal(JSON.parse(lines[0]).event, 'test.durability');

      // Idempotent: re-seeding again must NOT duplicate the entry.
      const again = await auditModule.reSeedFromRemote();
      assert.equal(again.appended, 0);
      const lines2 = fs.readFileSync(isolatedFile, 'utf8').split('\n').filter(Boolean);
      assert.equal(lines2.length, 1);
    } finally {
      freshAuditModule({ remoteUrl: prevUrl, remoteKey: prevKey, logFile: prevFile });
      server.close();
    }
  });

  test('without AUDIT_REMOTE_* everything behaves exactly as before (file only)', async () => {
    const prevUrl = process.env.AUDIT_REMOTE_URL;
    const prevKey = process.env.AUDIT_REMOTE_KEY;
    const prevFile = process.env.AUDIT_LOG_FILE;
    try {
      const auditModule = freshAuditModule({ remoteUrl: undefined, remoteKey: undefined, logFile: undefined });
      const result = await auditModule.reSeedFromRemote();
      assert.equal(result.ok, false, 're-seed reports it is not configured');
      // audit() still writes the local file (harness tmp audit.log).
      auditModule.audit('test.file.only', { actor: 'tester' });
      const lines = fs.readFileSync(auditModule.AUDIT_LOG_FILE, 'utf8').split('\n').filter(Boolean);
      const last = JSON.parse(lines[lines.length - 1]);
      assert.equal(last.event, 'test.file.only');
    } finally {
      freshAuditModule({ remoteUrl: prevUrl, remoteKey: prevKey, logFile: prevFile });
    }
  });
});

// Audit logging (OWASP Logging & Auditing): every login outcome is recorded
// as structured JSON. Tests the module itself (console + file sinks) and the
// live integration — a failed login on each backend must emit an
// `auth.login.failed` audit line, and a successful one `auth.login.success`.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

before(async () => {
  await bootBoth();
});
after(() => {
  teardown();
});

// Capture console.log during a request and return the captured [audit] lines.
async function captureAudit(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => {
    lines.push(args.map(String).join(' '));
    orig(...args);
  };
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return lines.filter((l) => l.startsWith('[audit] ')).map((l) => JSON.parse(l.slice('[audit] '.length)));
}

test('failed and successful logins are audited on both backends', async () => {
  for (const side of [sqlite, npmfree]) {
    const failed = await captureAudit(() =>
      call(side.url, '/api/auth/login', {
        method: 'POST',
        body: { username: 'nobody-here', password: 'Wrong!Pass1' },
      })
    );
    const failEvent = failed.find((e) => e.event === 'auth.login.failed');
    assert.ok(failEvent, 'failed login emits auth.login.failed');
    assert.strictEqual(failEvent.username, 'nobody-here');
    assert.ok(failEvent.t, 'timestamp present');

    const ok = await captureAudit(() =>
      call(side.url, '/api/auth/login', {
        method: 'POST',
        body: { username: 'customer', password: 'customer123' },
      })
    );
    const okEvent = ok.find((e) => e.event === 'auth.login.success');
    assert.ok(okEvent, 'successful login emits auth.login.success');
    assert.strictEqual(okEvent.username, 'customer');
  }
});

test('audit module writes JSONL to AUDIT_LOG_FILE', () => {
  // Load the module fresh against a temp file so the env var is honored.
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-file-')), 'audit.log');
  process.env.AUDIT_LOG_FILE = file;
  delete require.cache[require.resolve('../audit')];
  const { audit } = require('../audit');
  audit('test.event', { userId: 7, username: 'alice' });
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.strictEqual(parsed.event, 'test.event');
  assert.strictEqual(parsed.username, 'alice');
  assert.ok(parsed.t);
  // Never log secrets: the module takes only scalars; assert the shape has no
  // password/token/code keys even when a caller slips them in — we do NOT
  // spread arbitrary keys with those names.
  audit('test.redact', { password: 'hunter2', token: 'abc', code: '123456' });
  const second = JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n')[1]);
  assert.strictEqual(second.password, undefined, 'password never logged');
  assert.strictEqual(second.token, undefined, 'token never logged');
  assert.strictEqual(second.code, undefined, 'code never logged');
  delete require.cache[require.resolve('../audit')];
  delete process.env.AUDIT_LOG_FILE;
});

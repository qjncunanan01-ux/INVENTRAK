const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../auth-core');
const { adminOnly } = require('../../middleware');
const { audit } = require('../../audit');
const cache = require('../../cache');
const {
  sqliteSnapshot,
  sqliteRestore,
  buildEnvelope,
  envelopeError,
  restoreResult,
} = require('../../governance/backup');
const remote = require('../../governance/backup-remote');

// Database backup and recovery (Web Administration → Database Backup and
// Recovery). Admin-tier only: a snapshot is a full copy of every table —
// including password hashes — and a restore overwrites all of it, so the
// blast radius is the largest in the API.
//
// The password hashes are NOT stripped. A backup that cannot restore logins is
// not a backup, and the caller is already an admin on this server; the file is
// the thing that has to be protected, which is what the audit line and the
// admin-only gate are for.
//
// Three ways in and out, and the difference between them is the whole feature:
//
//   GET  /api/admin/backup    download a snapshot  — requires an admin who
//                                                    remembers to press it
//   POST /api/admin/backup    push one to the durable store now — the manual
//                                                    half of the timer
//   GET  /api/admin/backups   what the durable store already holds, so a
//                                                    restore does not depend on
//                                                    a file that no longer exists
//
// The timer itself lives in src/governance/backup-remote.js and is started by
// the server entrypoint (src/server.js), so it runs in production and not in a
// test that boots the app object.

const DRIVER = 'sqlite';

function snapshotNow(generatedBy) {
  return buildEnvelope({ driver: DRIVER, tables: sqliteSnapshot(), generatedBy });
}

// GET /api/admin/backup — download a full snapshot of the database.
router.get('/backup', authenticateToken, adminOnly, (req, res) => {
  const snapshot = snapshotNow(req.user.username);
  audit('backup.exported', {
    userId: req.user.id,
    username: req.user.username,
    tables: Object.keys(snapshot.tables).length,
  });
  res.json(snapshot);
});

// POST /api/admin/backup — take a snapshot now and put it in the durable store.
//
// This is the same work the schedule does, on demand, and it exists so the
// schedule can be verified the moment it is configured instead of an hour
// later. It is additive: a snapshot is a NEW row, so this can never overwrite
// the copy an admin is relying on.
router.post('/backup', authenticateToken, adminOnly, async (req, res) => {
  try {
    const result = await remote.pushSnapshot(snapshotNow(req.user.username), {
      trigger: 'manual',
    });
    if (!result.ok) {
      // 503, not 400: the request was well formed, this server simply has no
      // durable store that can take the snapshot. The reason says which env
      // vars would fix it.
      return res.status(503).json({ ok: false, error: result.reason });
    }
    audit('backup.pushed_manual', {
      userId: req.user.id,
      username: req.user.username,
      id: result.id,
      bytes: result.bytes,
      rows: result.rows,
    });
    res.json({ ok: true, source: 'durable-store', ...result, message: `Snapshot stored (${result.bytes} bytes, ${result.rows} rows)` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/admin/backups — what the durable store holds right now.
//
// Answers the question a restore actually starts with ("what can I go back
// to?") before anything destructive is attempted. It reports rather than
// throws: "the schedule is off" and "the store is unreachable" are states an
// operator needs to read, not errors to be swallowed by a console.
router.get('/backups', authenticateToken, adminOnly, async (req, res) => {
  try {
    const listed = await remote.listSnapshots(20);
    res.json({
      ok: listed.ok,
      error: listed.ok ? null : listed.reason,
      scheduler: remote.status(),
      // The headline an operator reads first: when the newest snapshot in the
      // store was taken and whether it is getting old. Derived from the listing
      // above, so it costs no extra round trip and cannot disagree with the
      // list it sits next to.
      last_backup: remote.summarizeLastBackup(listed),
      snapshots: listed.snapshots || [],
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, snapshots: [] });
  }
});

// POST /api/admin/restore — replace the database contents from a snapshot.
//
// The snapshot travels under an explicit `confirm: true` flag. A restore
// deletes every row in every table before inserting, so an accidental POST (a
// retried request, a mis-wired client) must not be able to do it: the caller
// has to say so.
//
// Two SOURCES, one code path. Either an uploaded snapshot (`snapshot`) or one
// already in the durable store (`snapshot_id: "latest"` or a stored id), which
// is what makes recovery possible after the container — and with it the
// downloaded file — is gone. Both are validated by the same envelopeError(),
// so a snapshot from another driver is refused however it arrives.
router.post('/restore', authenticateToken, adminOnly, async (req, res) => {
  try {
    const body = req.body || {};
    if (body.confirm !== true) {
      return res.status(400).json({ error: 'confirm: true is required to restore a backup' });
    }

    let payload = body.snapshot;
    let source = 'upload';
    let snapshotId = null;
    if (!payload && body.snapshot_id !== undefined && body.snapshot_id !== null) {
      const fetched = await remote.fetchSnapshot(body.snapshot_id);
      if (!fetched.ok) return res.status(400).json({ error: fetched.reason });
      payload = fetched.envelope;
      source = 'durable-store';
      snapshotId = fetched.id;
    }
    if (!payload) {
      return res.status(400).json({
        error: 'body must carry `snapshot` (an uploaded snapshot) or `snapshot_id` ("latest" or a snapshot id from GET /api/admin/backups)',
      });
    }

    const reason = envelopeError(payload, DRIVER);
    if (reason) return res.status(400).json({ error: reason });

    const result = sqliteRestore(payload.tables);
    if (result.error) return res.status(400).json({ error: result.error });

    // Every cached GET response was computed from the pre-restore rows.
    cache.invalidate();
    audit('backup.restored', {
      userId: req.user.id,
      username: req.user.username,
      tables: Object.keys(result.restored).length,
      rows: Object.values(result.restored).reduce((sum, n) => sum + n, 0),
      snapshotAt: payload.created_at || null,
      source,
      snapshotId,
    });
    res.json({ ...restoreResult({ driver: DRIVER, restored: result.restored }), source, snapshot_id: snapshotId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

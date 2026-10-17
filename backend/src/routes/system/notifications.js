const express = require('express');
const router = express.Router();
const { db } = require('../../db');
const { authenticateToken } = require('../../auth-core');
const { adminOnly } = require('../../middleware');
const { setNotificationRecorder } = require('../../notify');

// Persist one notification-ledger row. Mirrors the npm-free ledger's shape so
// GET /api/notifications answers identically on either backend.
function insertNotificationRecord({ event, channel, recipient, subject, status, detail, related_id, related_type }) {
  db.prepare(
    `INSERT INTO notification_records (event, channel, recipient, subject, status, detail, related_id, related_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(event || ''),
    String(channel || ''),
    recipient == null ? null : String(recipient),
    subject == null ? null : String(subject),
    status == null ? 'attempted' : String(status),
    detail == null ? null : String(detail),
    related_id == null ? null : Number(related_id) || null,
    related_type == null ? null : String(related_type)
  );
}

// Register at require time (app.js loads this router at boot) so the notify
// layer records every attempt into the SQLite ledger. Without this the ledger
// would exist but stay permanently empty.
setNotificationRecorder(insertNotificationRecord);

// GET /api/notifications -- paginated ledger, newest first (admin only).
router.get('/', authenticateToken, adminOnly, (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 200));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const where = [];
  const params = [];
  if (req.query.event) {
    where.push('event = ?');
    params.push(req.query.event);
  }
  if (req.query.channel) {
    where.push('channel = ?');
    params.push(req.query.channel);
  }
  if (req.query.status) {
    where.push('status = ?');
    params.push(req.query.status);
  }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM notification_records${clause}`).get(...params).n;
  const rows = db
    .prepare(`SELECT * FROM notification_records${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  // Return the page in ascending id order (like the npm-free ledger does), so
  // the caller can render top-to-bottom without re-sorting.
  res.json({ rows: rows.reverse(), total, limit, offset });
});

// GET /api/notifications/:id -- one record (admin only).
router.get('/:id', authenticateToken, adminOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM notification_records WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Notification record not found' });
  res.json(row);
});

// Attached for tests: the harness boots both backends in one process, where the
// module-global notify recorder is shared, so a test re-registers the recorder
// that belongs to the side it is exercising.
router.insertNotificationRecord = insertNotificationRecord;

module.exports = router;

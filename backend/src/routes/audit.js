const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly } = require('../middleware');
const { audit, AUDIT_LOG_FILE } = require('../audit');
const fs = require('fs');

// GET /api/audit-trail
router.get('/', authenticateToken, adminOnly, (req, res) => {
  try {
    const auditFile = AUDIT_LOG_FILE;
    const parseLimit = (raw, fallback) => { const n = Number.parseInt(raw, 10); return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : fallback; };
    const status = (req.query.status || '').toString();
    const limit = parseLimit(req.query.limit, 200);
    const offset = (() => { const n = Number.parseInt(req.query.offset, 10); return Number.isFinite(n) && n >= 0 ? n : 0; })();

    if (!fs.existsSync(auditFile)) {
      return res.json({ data: [], pagination: { total: 0, limit, offset } });
    }

    let logs = fs.readFileSync(auditFile, 'utf8').split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean).reverse();

    if (status) {
      const lower = status.toLowerCase();
      logs = logs.filter((e) =>
        (e.details && typeof e.details === 'object' && e.details.status && String(e.details.status).toLowerCase() === lower) ||
        (e.event || '').toLowerCase() === `order.status.${lower}`
      );
    }

    const total = logs.length;
    res.json({ data: logs.slice(offset, offset + limit), pagination: { total, limit, offset } });
  } catch (err) {
    console.error('Audit trail error:', err);
    res.status(500).json({ error: 'Failed to load audit trail' });
  }
});

module.exports = router;
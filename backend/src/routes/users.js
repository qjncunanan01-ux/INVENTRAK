const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly } = require('../middleware');
const { audit } = require('../audit');
const { hashPassword } = require('../password-hash');
const { validate } = require('../validation');
const { sanitizeObject } = require('../sanitize');
const cache = require('../cache');

// GET /api/users
router.get('/', authenticateToken, adminOnly, (req, res) => {
  const users = db.prepare('SELECT id, username, role, email, email_verified, google_sub, created_at FROM users ORDER BY id').all()
    .map((u) => ({ ...u, email_verified: !!u.email_verified, google_sub: u.google_sub || null }));
  res.json(users);
});

module.exports = router;
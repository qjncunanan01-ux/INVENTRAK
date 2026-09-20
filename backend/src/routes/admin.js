const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly, isManagement } = require('../middleware');
const { ASSIGNABLE_BY_ADMIN, ASSIGNABLE_BY_MANAGEMENT, isKnownRole } = require('../middleware');
const { audit } = require('../audit');
const { hashPassword } = require('../password-hash');
const { validate } = require('../validation');

// POST /api/admin/promote
router.post('/promote', authenticateToken, adminOnly, validate({ username: { required: true, maxLength: 50 } }), (req, res) => {
  const { username, role } = req.body;
  const actorIsManagement = isManagement(req.user);

  if (role === undefined) {
    const result = db.prepare('UPDATE users SET role = ? WHERE username = ? AND role = ?').run('admin', username, 'customer');
    if (result.changes === 0) return res.status(404).json({ error: 'Customer not found or already an admin' });
    const user = db.prepare('SELECT id, username, role, email FROM users WHERE username = ?').get(username);
    audit('auth.role_change', { actor: req.user.username, actorRole: req.user.role, target: username, role: 'admin' });
    return res.json({ ok: true, user });
  }

  const target = String(role);
  if (!isKnownRole(target)) return res.status(400).json({ error: `Unknown role: ${target}` });
  const allowed = actorIsManagement ? ASSIGNABLE_BY_MANAGEMENT : ASSIGNABLE_BY_ADMIN;
  if (!allowed.includes(target)) return res.status(403).json({ error: `Only an Owner or Super Admin can assign the ${target} role` });

  const result = db.prepare('UPDATE users SET role = ? WHERE username = ?').run(target, username);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  const user = db.prepare('SELECT id, username, role, email FROM users WHERE username = ?').get(username);
  audit('auth.role_change', { actor: req.user.username, actorRole: req.user.role, target: username, role: target });
  res.json({ ok: true, user });
});

module.exports = router;
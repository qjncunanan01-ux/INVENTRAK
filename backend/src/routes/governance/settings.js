const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../auth-core');
const { managementOnly, isManagement } = require('../../middleware');
const settings = require('../../governance/settings');
const { audit } = require('../../audit');

// GET /api/settings
router.get('/', authenticateToken, managementOnly, (req, res) => res.json(settings.getSettings()));

// PUT /api/settings
router.put('/', authenticateToken, (req, res) => {
  if (!isManagement(req.user)) return res.status(403).json({ error: 'Owner or Super Admin access required' });
  const result = settings.updateSettings(req.body);
  if (!result.ok) return res.status(400).json({ error: 'Validation failed', details: result.errors });
  audit('system.settings.updated', { userId: req.user.id, username: req.user.username, keys: Object.keys(req.body || {}) });
  res.json({ ok: true, settings: result.settings, message: 'Settings saved' });
});

module.exports = router;

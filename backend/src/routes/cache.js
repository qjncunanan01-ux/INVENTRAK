const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../auth-core');
const { adminOnly } = require('../middleware');
const cache = require('../cache');

// GET /api/cache/stats — in-memory cache statistics (admin only). Kept at
// /api/cache/stats (NOT /api/health/cache/stats) to match the OpenAPI spec,
// the npm-free fallback, and the generated clients. Lives in its own router
// because the health router has no '/cache/stats' subpath in the contract.
router.get('/stats', authenticateToken, adminOnly, (req, res) => {
  try { res.json(cache.stats()); } catch { res.status(500).json({ error: 'Failed to load cache stats' }); }
});

module.exports = router;

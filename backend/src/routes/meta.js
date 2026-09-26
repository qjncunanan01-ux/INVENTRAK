const express = require('express');
const router = express.Router();

// GET /api/meta — public build/driver identity (no auth: nothing sensitive).
//
// Why it exists: during the QR rollout a stale APK and a stale browser tab
// both masqueraded as "the system is broken". Every client surface can now
// display what it is running against, so "which build am I on?" is a glance,
// not an investigation. The git commit comes from Render's automatic
// RENDER_GIT_COMMIT (falls back to GIT_COMMIT, then null for local runs).
//
// This endpoint intentionally mirrors the npm-free server's /api/meta handler
// (same shape) — the contract test asserts both stay identical.

// Accepts the bare sha, "sha:<sha>" (GitHub Actions), or "refs/heads/main"
// (commit-ish) and returns just the short-ish sha, or null.
function normalizeCommit(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^[0-9a-f]{7,40}$/i.test(value)) return value.toLowerCase();
  if (/^sha:[0-9a-f]{7,40}$/i.test(value)) return value.slice(4).toLowerCase();
  return null;
}

router.get('/meta', (req, res) => {
  res.json({
    ok: true,
    name: 'inventrak-backend',
    version: require('../../package.json').version || null,
    commit: normalizeCommit(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT),
    driver: 'sqlite',
    startedAt: process.env.INVENTRAK_STARTED_AT || null,
    time: new Date().toISOString(),
  });
});

module.exports = router;

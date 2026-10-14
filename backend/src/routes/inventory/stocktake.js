const express = require('express');
const router = express.Router();
const { db } = require('../../db');
const { authenticateToken } = require('../../auth-core');
const { adminOnly } = require('../../middleware');
const { schedule } = require('../../inventory/stocktake');
const { refreshStocktakeAlerts } = require('../../inventory/alert-helpers');
const settings = require('../../governance/settings');

// GET /api/stocktake — the recount board.
//
// "Which shelves are due to be walked, and how far behind are they?"
//
// Computed ON READ rather than by a background timer, on purpose:
//
//   · There is no cron in this codebase and no guarantee the process is even
//     alive — the free deployment tier sleeps, and a timer that never fires is
//     indistinguishable from one that was never set. A board computed from the
//     request is right whenever somebody is looking at it.
//   · Computing here also refreshes the stale_count flags, so the same pass
//     that powers this screen is what makes the shelves appear on the existing
//     Alerts page. One source, no drift between the board and the badge count.
//
// The arithmetic lives in src/stocktake.js, pure over arrays, so this route only
// supplies rows — the npm-free backend computes the identical board from its own
// store, and the tests assert both agree.
router.get('/', authenticateToken, adminOnly, (req, res) => {
  const cycleDays = settings.getStocktakeCycleDays();

  const locations = db.prepare('SELECT id, name FROM locations ORDER BY name').all();
  const stock = db.prepare('SELECT product_id, location_id, quantity FROM stock').all();
  const counts = db.prepare('SELECT product_id, location_id, counted_at FROM inventory_counts').all();

  const board = schedule({ locations, stock, counts, cycleDays });
  // Same pass, so the Alerts page and this board can never disagree.
  refreshStocktakeAlerts(Date.parse(board.summary.computed_at));

  res.json({ ...board, cycle_days: cycleDays });
});

module.exports = router;
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken, signToken } = require('../auth-core');
const { adminOnly, staffOrAdmin } = require('../middleware');
const { criticalLevels, criticalLevelFromMap, stockStatus } = require('../critical-level');
const settings = require('../settings');

function resolveLocation(value) {
  if (!value && value !== 0) return null;
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && Number.isInteger(numeric)) return numeric;
  const row = db.prepare('SELECT id FROM locations WHERE name = ?').get(value);
  return row ? row.id : null;
}

// GET /api/inventory
router.get('/', (req, res) => {
  const { location, low_stock } = req.query;

  const products = db.prepare('SELECT * FROM products WHERE status = ?').all('active');
  const locations = db.prepare('SELECT * FROM locations').all();

  const levelMap = criticalLevels();

  let items = products.map((p) => {
    let stocks;
    if (location) {
      const locId = resolveLocation(location);
      stocks = db.prepare('SELECT l.name, s.quantity FROM stock s JOIN locations l ON s.location_id = l.id WHERE s.product_id = ? AND s.location_id = ?').all(p.id, locId);
    } else {
      stocks = db.prepare('SELECT l.name, s.quantity FROM stock s JOIN locations l ON s.location_id = l.id WHERE s.product_id = ?').all(p.id);
    }

    const total = stocks.reduce((acc, item) => acc + item.quantity, 0);
    const detail = {};
    stocks.forEach((stock) => { detail[stock.name] = stock.quantity; });

    const info = criticalLevelFromMap(levelMap, p.id);

    return {
      product: p,
      locations: detail,
      total,
      critical_level: info.criticalLevel,
      movement_class: info.classification,
      movement_label: info.movementLabel,
      stock_status: stockStatus(total, info.criticalLevel, settings.getLowStockMultiplier()),
    };
  });

  if (low_stock === 'true') {
    items = items.filter((item) => item.total < item.critical_level);
  }

  res.json({ locations, items });
});

module.exports = router;
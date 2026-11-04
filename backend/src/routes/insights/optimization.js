const express = require('express');
const router = express.Router();
const { db } = require('../../db');
const { authenticateToken } = require('../../auth-core');
const { managementOnly } = require('../../middleware');
const { classifyFsnCatalog, parseFsnWindow } = require('../../insights/fsn');
const settings = require('../../governance/settings');
const { calculateReplenishment, classifyAbc } = require('../../insights/replenishment');

// Optimization uses sales history and product prices to produce business
// insights, so all endpoints require an Owner or Super Admin session.
router.use(authenticateToken, managementOnly);

// GET /api/optimization/fsn
router.get('/fsn', (req, res) => {
  const windowDays = parseFsnWindow(req.query.window, { defaultWindow: settings.getFsnWindowDays() });
  const now = new Date();

  const products = db.prepare('SELECT id, name, price FROM products WHERE status = ?').all('active');
  const cutoff = new Date(now.getTime() - windowDays * 86400000).toISOString();
  const sales = db.prepare('SELECT product_id, qty, transaction_date FROM sales_transactions WHERE transaction_date >= ?').all(cutoff);

  const result = classifyFsnCatalog(products, sales, { windowDays, now });
  res.json(result);
});

// GET /api/optimization/:productId
router.get('/:productId', (req, res) => {
  const pid = req.params.productId;

  if (pid === 'abc') {
    const products = db.prepare('SELECT id, name, price FROM products WHERE status = ?').all('active');
    const sales = db.prepare('SELECT product_id, qty, total_amount, transaction_date FROM sales_transactions').all();
    return res.json(classifyAbc(products, sales, settings.getInventoryAlgorithmSettings()));
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND status = ?').get(pid, 'active');
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const sales = db.prepare('SELECT qty, transaction_date FROM sales_transactions WHERE product_id = ?').all(pid);
  const currentStock = db.prepare('SELECT COALESCE(SUM(quantity), 0) as total FROM stock WHERE product_id = ?').get(pid);
  res.json(calculateReplenishment({
    product,
    sales,
    stock: currentStock.total,
    settings: settings.getInventoryAlgorithmSettings(),
  }));
});

// GET /api/optimization
router.get('/', (req, res) => {
  const products = db.prepare('SELECT id, name, price, cost FROM products WHERE status = ?').all('active');
  const sales = db.prepare('SELECT product_id, qty, transaction_date FROM sales_transactions').all();
  const stockRows = db.prepare('SELECT product_id, SUM(quantity) as total FROM stock GROUP BY product_id').all();
  const salesByProduct = new Map();
  for (const row of sales) {
    const list = salesByProduct.get(Number(row.product_id)) || [];
    list.push(row);
    salesByProduct.set(Number(row.product_id), list);
  }
  const stockByProduct = new Map(stockRows.map(row => [Number(row.product_id), Number(row.total) || 0]));
  const algorithmSettings = settings.getInventoryAlgorithmSettings();
  const results = products.map(product => {
    const metrics = calculateReplenishment({
      product,
      sales: salesByProduct.get(Number(product.id)) || [],
      stock: stockByProduct.get(Number(product.id)) || 0,
      settings: algorithmSettings,
    });
    return {
      productId: product.id,
      productName: product.name,
      eoq: metrics.EOQ,
      ROP: metrics.ROP,
      safetyStock: metrics.safetyStock,
      annualDemand: metrics.annualDemand,
      turnoverRatio: metrics.turnoverRatio,
    };
  });

  res.json(results);
});

module.exports = router;

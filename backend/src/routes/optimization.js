const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly } = require('../middleware');
const { classifyFsnCatalog, parseFsnWindow } = require('../fsn');
const settings = require('../settings');

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
    const salesData = db.prepare('SELECT product_id, SUM(qty) as total_qty, SUM(total_amount) as total_value FROM sales_transactions GROUP BY product_id').all();

    const salesMap = {};
    salesData.forEach((sale) => { salesMap[sale.product_id] = { qty: sale.total_qty, value: sale.total_value }; });

    const arr = products.map((product) => {
      const sales = salesMap[product.id] || { qty: 0, value: 0 };
      const annualValue = sales.value > 0 ? sales.value : (product.price || 1) * 12;
      return { id: product.id, name: product.name, value: annualValue, annualQty: sales.qty };
    });

    arr.sort((a, b) => b.value - a.value);
    const total = arr.reduce((sum, item) => sum + item.value, 0);
    let cum = 0;

    const result = arr.map((item) => {
      cum += item.value;
      const pct = total > 0 ? (cum / total) * 100 : 0;
      let classification = 'C';
      if (pct <= 70) classification = 'A';
      else if (pct <= 90) classification = 'B';
      return { ...item, classification };
    });

    return res.json(result);
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const salesData = db.prepare('SELECT SUM(qty) as total_qty FROM sales_transactions WHERE product_id = ?').get(pid);
  const annualDemand = salesData?.total_qty > 0 ? salesData.total_qty : 1000;

  const orderingCost = 50;
  const holdingCostRate = 0.2;
  const C = product.price || 1;
  const H = holdingCostRate * C;
  const D = annualDemand;
  const S = orderingCost;

  const EOQ = Math.sqrt((2 * D * S) / H);
  const leadTimeDays = 7;
  const dailyDemand = D / 365;
  const ROP = Math.ceil(dailyDemand * leadTimeDays);
  const safetyStock = Math.ceil(Math.sqrt(D) * 0.1);

  const currentStock = db.prepare('SELECT SUM(quantity) as total FROM stock WHERE product_id = ?').get(pid);
  const avgInventory = currentStock?.total || 1;
  const turnover = annualDemand / avgInventory;

  res.json({
    EOQ: Math.round(EOQ),
    ROP,
    safetyStock,
    annualDemand,
    turnoverRatio: Math.round(turnover * 100) / 100,
    avgInventory: Math.round(avgInventory),
  });
});

// GET /api/optimization
router.get('/', (req, res) => {
  const products = db.prepare('SELECT id, name, price FROM products WHERE status = ?').all('active');

  const results = products.map((product) => {
    const salesData = db.prepare('SELECT SUM(qty) as total_qty FROM sales_transactions WHERE product_id = ?').get(product.id);
    const annualDemand = salesData?.total_qty > 0 ? salesData.total_qty : 100;
    const C = product.price || 1;
    const H = 0.2 * C;
    const EOQ = Math.sqrt((2 * annualDemand * 50) / H);
    const currentStock = db.prepare('SELECT SUM(quantity) as total FROM stock WHERE product_id = ?').get(product.id);
    const avgInv = currentStock?.total || 1;
    return { productId: product.id, productName: product.name, eoq: Math.round(EOQ), annualDemand, turnoverRatio: Math.round((annualDemand / avgInv) * 100) / 100 };
  });

  res.json(results);
});

module.exports = router;
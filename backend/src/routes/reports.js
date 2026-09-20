const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly } = require('../middleware');
const { parseDateRange, rangeDays } = require('../date-range');
const { criticalLevels, criticalLevelFromMap } = require('../critical-level');

// GET /api/reports — printable management report (admin only). Lives in its
// own router because /api/analytics and /api/reports were accidentally BOTH
// mounted on the analytics router, exposing undocumented aliases
// (/api/analytics, /api/reports/summary, /api/reports/export/{type}).
router.get('/', authenticateToken, adminOnly, (req, res) => {
  const generated_at = new Date().toISOString();
  const { from, to } = parseDateRange(req.query, { defaultDays: 14 });
  const rangeClause = "date(transaction_date) >= date(?) AND date(transaction_date) <= date(?)";

  const dailySales = db.prepare(`SELECT substr(transaction_date, 1, 10) as date, COUNT(*) as transactions, SUM(total_amount) as value FROM sales_transactions WHERE ${rangeClause} GROUP BY date ORDER BY date ASC`).all(from, to);
  const days = rangeDays({ from, to });

  const stockByLocation = db.prepare(`SELECT l.name as location, COALESCE(SUM(s.quantity), 0) as total FROM locations l LEFT JOIN stock s ON s.location_id = l.id GROUP BY l.id ORDER BY l.id`).all();

  const statusRows = db.prepare('SELECT status, COUNT(*) as count FROM order_inquiries GROUP BY status').all();
  const orderStatusSummary = { pending: 0, approved: 0, rejected: 0, fulfilled: 0, delivered: 0 };
  statusRows.forEach((r) => { if (orderStatusSummary[r.status] !== undefined) orderStatusSummary[r.status] = r.count; });

  const levelMap = criticalLevels();
  const lowStock = db.prepare(`SELECT p.id, p.name, SUM(s.quantity) as total FROM stock s JOIN products p ON s.product_id = p.id WHERE p.status = ? GROUP BY p.id ORDER BY total ASC`).all('active')
    .filter((r) => r.total < criticalLevelFromMap(levelMap, r.id));

  const fastMovers = db.prepare(`SELECT p.name, SUM(t.qty) as qty_sold, SUM(t.total_amount) as value FROM sales_transactions t JOIN products p ON t.product_id = p.id WHERE p.status = ? GROUP BY t.product_id ORDER BY qty_sold DESC LIMIT 10`).all('active');

  const slowMovers = db.prepare(`SELECT p.name, COALESCE(SUM(t.qty), 0) as qty_sold FROM products p LEFT JOIN sales_transactions t ON t.product_id = p.id WHERE p.status = ? GROUP BY p.id ORDER BY qty_sold ASC, p.name ASC LIMIT 10`).all('active');

  const summary = {
    total_products: db.prepare("SELECT COUNT(*) as c FROM products WHERE status = 'active'").get().c,
    total_stock: db.prepare('SELECT COALESCE(SUM(quantity), 0) as t FROM stock').get().t,
    total_sales: db.prepare('SELECT COALESCE(SUM(total_amount), 0) as t FROM sales_transactions').get().t,
    transactions: db.prepare('SELECT COUNT(*) as c FROM sales_transactions').get().c,
    customers_served: db.prepare(`SELECT COUNT(DISTINCT oi.user_id) as c FROM order_inquiries oi WHERE oi.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id = oi.user_id AND u.role = 'customer')`).get().c,
    customers_paid: db.prepare('SELECT COUNT(DISTINCT customer_name) as c FROM sales_transactions').get().c,
    customers_registered: db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'customer'").get().c,
    pending_approvals: db.prepare("SELECT COUNT(*) as c FROM stock_adjustments WHERE status = 'pending'").get().c + db.prepare("SELECT COUNT(*) as c FROM stock_transfers WHERE status = 'pending'").get().c,
  };

  res.json({ generated_at, days, range: { from, to }, dailySales, stockByLocation, orderStatusSummary, lowStock, fastMovers, slowMovers, summary });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../auth-core');
const { adminOnly } = require('../middleware');
const { criticalLevels, criticalLevelFromMap } = require('../critical-level');
const settings = require('../settings');
const { audit } = require('../audit');

// GET /api/analytics/summary
router.get('/summary', authenticateToken, adminOnly, (req, res) => {
  const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE status = ?').get('active').count;
  const totalStock = db.prepare('SELECT SUM(quantity) as total FROM stock').get().total || 0;

  const levelMap = criticalLevels();
  const lowStockItems = db.prepare('SELECT p.id as id, SUM(s.quantity) as total FROM stock s JOIN products p ON s.product_id = p.id WHERE p.status = ? GROUP BY p.id').all('active')
    .filter((row) => row.total < criticalLevelFromMap(levelMap, row.id)).length;

  const totalLocations = db.prepare('SELECT COUNT(*) as count FROM locations').get().count;
  const pendingInquiries = db.prepare("SELECT COUNT(*) as count FROM order_inquiries WHERE status = 'pending'").get().count;
  const totalSales = db.prepare('SELECT SUM(total_amount) as total FROM sales_transactions').get().total || 0;
  const totalMovements = db.prepare('SELECT COUNT(*) as count FROM stock_movements').get().count;
  const activeAlerts = db.prepare("SELECT COUNT(*) as count FROM inventory_alerts WHERE status = 'active'").get().count;

  const topProducts = db.prepare('SELECT p.id, p.name, SUM(s.quantity * p.price) as stock_value FROM stock s JOIN products p ON s.product_id = p.id WHERE p.status = ? GROUP BY p.id ORDER BY stock_value DESC LIMIT 5').all('active');

  const monthlyMovements = db.prepare("SELECT strftime('%Y-%m', created_at) as month, type, COUNT(*) as count FROM stock_movements GROUP BY month, type ORDER BY month DESC LIMIT 12").all();

  const dashboardLevelMap = criticalLevels();
  const lowStockList = db.prepare(`SELECT p.id, p.name, SUM(s.quantity) as total FROM stock s JOIN products p ON s.product_id = p.id WHERE p.status = ? GROUP BY p.id ORDER BY total ASC LIMIT 60`).all('active')
    .filter((r) => r.total < criticalLevelFromMap(dashboardLevelMap, r.id)).slice(0, 20);

  const stockByLocation = db.prepare(`SELECT l.name as location, COALESCE(SUM(s.quantity), 0) as total FROM locations l LEFT JOIN stock s ON s.location_id = l.id GROUP BY l.id ORDER BY total DESC`).all();

  const fastMovingProducts = db.prepare(`SELECT p.id, p.name, SUM(t.qty) as qty_sold, SUM(t.total_amount) as value FROM sales_transactions t JOIN products p ON t.product_id = p.id WHERE p.status = ? GROUP BY t.product_id ORDER BY qty_sold DESC LIMIT 5`).all('active');

  const slowMovingProducts = db.prepare(`SELECT p.id, p.name, COALESCE(SUM(t.qty), 0) as qty_sold FROM products p LEFT JOIN sales_transactions t ON t.product_id = p.id WHERE p.status = ? GROUP BY p.id ORDER BY qty_sold ASC, p.name ASC LIMIT 5`).all('active');

  const dailySalesValue = db.prepare(`SELECT substr(transaction_date, 1, 10) as date, SUM(total_amount) as value FROM sales_transactions WHERE transaction_date >= datetime('now', '-7 days') GROUP BY date ORDER BY date ASC`).all();

  const transactionCount = db.prepare('SELECT COUNT(*) as count FROM sales_transactions').get().count;
  const customersServed = db.prepare(`SELECT COUNT(DISTINCT oi.user_id) as count FROM order_inquiries oi WHERE oi.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id = oi.user_id AND u.role = 'customer')`).get().count;
  const customersPaid = db.prepare('SELECT COUNT(DISTINCT customer_name) as count FROM sales_transactions').get().count;
  const customersRegistered = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'customer'").get().count;

  const statusRows = db.prepare('SELECT status, COUNT(*) as count FROM order_inquiries GROUP BY status').all();
  const orderStatusSummary = { pending: 0, approved: 0, rejected: 0, fulfilled: 0, delivered: 0 };
  statusRows.forEach((r) => { if (orderStatusSummary[r.status] !== undefined) orderStatusSummary[r.status] = r.count; });

  const thisMonth = new Date().toISOString().substring(0, 7);
  const monthlySalesValue = db.prepare(`SELECT COALESCE(SUM(total_amount), 0) as total FROM sales_transactions WHERE transaction_date LIKE ? || '%'`).get(thisMonth).total;
  const monthlyTransactions = db.prepare(`SELECT COUNT(*) as count FROM sales_transactions WHERE transaction_date LIKE ? || '%'`).get(thisMonth).count;

  const orderStatusCounts = { ...orderStatusSummary };

  res.json({
    totalProducts, totalStock, lowStockItems, totalLocations, pendingInquiries,
    totalSales, totalMovements, activeAlerts, topProducts, monthlyMovements,
    lowStockList, stockByLocation, fastMovingProducts, slowMovingProducts,
    dailySalesValue, transactionCount, customersServed, customersPaid,
    customersRegistered, orderStatusSummary, monthlySalesValue, monthlyTransactions,
    orderStatusCounts,
  });
});

// GET /api/analytics/export/:type
router.get('/export/:type', authenticateToken, adminOnly, (req, res) => {
  const { type } = req.params;
  const format = req.query.format || 'json';

  let data;
  switch (type) {
    case 'products':
      data = db.prepare('SELECT * FROM products WHERE status = ?').all('active');
      break;
    case 'inventory':
      data = db.prepare('SELECT p.name as product, l.name as location, s.quantity FROM stock s JOIN products p ON s.product_id = p.id JOIN locations l ON s.location_id = l.id WHERE p.status = ? ORDER BY p.name, l.name').all('active');
      break;
    case 'movements':
      data = db.prepare('SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 1000').all();
      break;
    default:
      return res.status(404).json({ error: 'Export type not found. Use: products, inventory, movements' });
  }

  if (format === 'csv') {
    const headers = Object.keys(data[0] || {}).join(',');
    const rows = data.map((row) => Object.values(row).map((value) => `"${value}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${type}-${Date.now()}.csv`);
    return res.send(`${headers}\n${rows}`);
  }
  res.json(data);
});module.exports = router;
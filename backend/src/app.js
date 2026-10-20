const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { db } = require('./db');
const { seedDatabase } = require('./seed');
const { BACKUP_MAX_BODY_BYTES } = require('./config');
const settings = require('./governance/settings');
const { audit, AUDIT_LOG_FILE } = require('./audit');
const cache = require('./cache');
const { handleTagPageLookup, renderTagPageHtml } = require('./catalog-orders/qr-codes');

// Import route modules
const authRoutes = require('./routes/auth/auth');
const productsRoutes = require('./routes/catalog-orders/products');
const inventoryRoutes = require('./routes/inventory/inventory');
const stockMovementsRoutes = require('./routes/stock-control/stock-movements');
const stockLotsRoutes = require('./routes/stock-control/stock-lots');
const orderInquiriesRoutes = require('./routes/catalog-orders/order-inquiries');
const optimizationRoutes = require('./routes/insights/optimization');
const analyticsRoutes = require('./routes/insights/analytics');
const reportsRoutes = require('./routes/insights/reports');
const cacheRoutes = require('./routes/system/cache');
const locationsRoutes = require('./routes/inventory/locations');
const alertsRoutes = require('./routes/inventory/alerts');
const stocktakeRoutes = require('./routes/inventory/stocktake');
const salesRoutes = require('./routes/insights/sales');
const customersRoutes = require('./routes/catalog-orders/customers');
const usersRoutes = require('./routes/auth/users');
const adminRoutes = require('./routes/governance/admin');
const healthRoutes = require('./routes/system/health');
const metaRoutes = require('./routes/system/meta');
const settingsRoutes = require('./routes/governance/settings');
const approvalsRoutes = require('./routes/stock-control/approvals');
const scanEventsRoutes = require('./routes/stock-control/scan-events');
const auditRoutes = require('./routes/governance/audit');
const unitConversionsRoutes = require('./routes/stock-control/unit-conversions');
const backOrdersRoutes = require('./routes/catalog-orders/back-orders');
const correctionRequestsRoutes = require('./routes/stock-control/correction-requests');
const notificationsRoutes = require('./routes/system/notifications');
const backupRoutes = require('./routes/governance/backup');

const app = express();

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
}));
// A database restore uploads a whole snapshot, which is an order of magnitude
// larger than any other request body (and larger than the default limit, so
// every restore would 413). Registered BEFORE the global parser, which then
// sees the body already read and skips it. Only this one admin-only path gets
// the wide limit — everything else stays capped at the 100 KB default.
app.use('/api/admin/restore', bodyParser.json({ limit: BACKUP_MAX_BODY_BYTES }));
app.use(bodyParser.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'microphone=(), geolocation=()');
  if (req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('Content-Security-Policy', req.path.startsWith('/api/docs') ? "frame-ancestors 'none'" : "default-src 'none'; frame-ancestors 'none'");
  next();
});

// Force HTTPS behind proxy
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
});

// Static images
app.use('/images', express.static(path.join(__dirname, '..', 'images')));

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/stock-movement', stockMovementsRoutes);
app.use('/api/stock-movements', stockMovementsRoutes);
app.use('/api/stock-lots', stockLotsRoutes);
app.use('/api/order-inquiries', orderInquiriesRoutes);
app.use('/api/optimization', optimizationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/stocktake', stocktakeRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/health', healthRoutes);
app.use('/api', metaRoutes);
app.use('/api/cache', cacheRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api', approvalsRoutes);
app.use('/api', scanEventsRoutes);
app.use('/api/audit-trail', auditRoutes);
app.use('/api/unit-conversions', unitConversionsRoutes);
app.use('/api/back-orders', backOrdersRoutes);
app.use('/api/correction-requests', correctionRequestsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/admin', backupRoutes);

// GET /t/:code — public, camera-friendly tag page (the URL printed on QR
// tags). Read-only product view so a phone's NATIVE camera app opens real
// content instead of "No usable data found" for a plain-text payload.
// Mounted in app.js rather than the products router because it must render
// HTML with its own CSP (the API's default-src 'none' would strip it).
app.get('/t/:code', async (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM products').all();
    const stockLookup = (productId) => {
      const rows = db.prepare('SELECT l.name, s.quantity FROM stock s JOIN locations l ON s.location_id = l.id WHERE s.product_id = ?').all(productId);
      const locations = {};
      let total = 0;
      for (const r of rows) { locations[r.name] = Number(r.quantity) || 0; total += Number(r.quantity) || 0; }
      return { locations, total };
    };
    const result = await handleTagPageLookup(req, res, (r, code, body) => r.status(code).json(body), {
      code: req.params.code,
      products,
      stockLookup,
    });
    const html = renderTagPageHtml(result);
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https:; style-src 'unsafe-inline'; frame-ancestors 'none'");
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(result.status).send(html);
  } catch (err) {
    console.error('Tag page error:', err);
    res.status(500).send('Tag page error');
  }
});

// Swagger/OpenAPI
const openapiFile = path.join(__dirname, '..', 'openapi.json');
const swaggerUiHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><title>Sylver's API Docs</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" /></head>
<body style="margin:0"><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>window.onload = function () { window.ui = SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui', deepLinking: true }); };</script></body></html>`;

app.get('/api/openapi.json', (req, res) => {
  const spec = require('fs').existsSync(openapiFile) ? JSON.parse(fs.readFileSync(openapiFile, 'utf8')) : null;
  if (!spec) return res.status(500).json({ error: 'openapi.json not found' });
  res.json(spec);
});

app.get('/api/docs', (req, res) => res.type('html').send(swaggerUiHtml));

// 404 fallback
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handling
app.use((err, req, res, next) => {
  if (err && err.status === 400) return res.status(400).json({ error: 'Invalid JSON' });
  if (err && err.status === 413) return res.status(413).json({ error: 'Payload Too Large' });
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = { app, seedDatabase };

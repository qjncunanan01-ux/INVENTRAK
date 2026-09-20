const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { db } = require('./db');
const { seedDatabase } = require('./seed');
const settings = require('./settings');
const { audit, AUDIT_LOG_FILE } = require('./audit');
const cache = require('./cache');

// Import route modules
const authRoutes = require('./routes/auth');
const productsRoutes = require('./routes/products');
const inventoryRoutes = require('./routes/inventory');
const stockMovementsRoutes = require('./routes/stock-movements');
const stockLotsRoutes = require('./routes/stock-lots');
const orderInquiriesRoutes = require('./routes/order-inquiries');
const optimizationRoutes = require('./routes/optimization');
const analyticsRoutes = require('./routes/analytics');
const reportsRoutes = require('./routes/reports');
const cacheRoutes = require('./routes/cache');
const locationsRoutes = require('./routes/locations');
const alertsRoutes = require('./routes/alerts');
const salesRoutes = require('./routes/sales');
const usersRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const healthRoutes = require('./routes/health');
const settingsRoutes = require('./routes/settings');
const approvalsRoutes = require('./routes/approvals');
const ocrRoutes = require('./routes/ocr');
const auditRoutes = require('./routes/audit');

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
app.use('/api/sales', salesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/cache', cacheRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api', approvalsRoutes);
app.use('/api', ocrRoutes);
app.use('/api/audit-trail', auditRoutes);

// Swagger/OpenAPI
const openapiFile = path.join(__dirname, '..', 'openapi.json');
const swaggerUiHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><title>INVENTRAK API Docs</title>
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
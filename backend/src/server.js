const { app, seedDatabase } = require('./app');
const { db } = require('./db');
const { reSeedFromRemote } = require('./audit');

// Build identity for GET /api/meta (first-boot time of this container).
process.env.INVENTRAK_STARTED_AT = new Date().toISOString();
seedDatabase();
// Durable audit trail: best-effort remote snapshot re-seed before serving
// (a no-op unless AUDIT_REMOTE_* is configured). Never blocks boot.
reSeedFromRemote().catch(() => {});
const PORT = process.env.PORT || 4001;
const server = app.listen(PORT, () => console.log(`Backend server running on ${PORT}`));

function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed');
    db.close();
    console.log('Database connection closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

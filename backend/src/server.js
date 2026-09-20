const { app, seedDatabase } = require('./app');
const { db } = require('./db');

seedDatabase();
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

// JSON-file storage driver for the npm-free server (default; zero deps).
//
// The npm-free server persists each dataset as a whole JSON file under
// backend/data/ (or INVENTRAK_DATA_DIR when set by tests). The Firestore
// driver (store-firestore.js) exposes the exact same read/write interface, so
// the server code never knows which driver is active.
const fs = require('fs');
const path = require('path');

const dataDir = process.env.INVENTRAK_DATA_DIR || path.join(__dirname, '..', 'data');

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  } catch {
    return null;
  }
}

function write(file, rows) {
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(rows, null, 2), 'utf8');
}

// JSON driver needs no async init and is always ready.
function init() {
  return Promise.resolve();
}

function isReady() {
  return true;
}

module.exports = { read, write, init, isReady };

const { criticalLevelMap, criticalLevelFromMap, stockStatus } = require('./critical-level');
const { refreshAlerts } = require('./alert-helpers');

const SCAN_KINDS = ['location', 'product', 'barcode', 'unknown'];

module.exports = {
  criticalLevelMap,
  criticalLevelFromMap,
  stockStatus,
  refreshAlerts,
  SCAN_KINDS,
};
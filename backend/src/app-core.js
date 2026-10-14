const { criticalLevelMap, criticalLevelFromMap, stockStatus } = require('./inventory/critical-level');
const { refreshAlerts } = require('./inventory/alert-helpers');

const SCAN_KINDS = ['location', 'product', 'barcode', 'unknown'];

module.exports = {
  criticalLevelMap,
  criticalLevelFromMap,
  stockStatus,
  refreshAlerts,
  SCAN_KINDS,
};
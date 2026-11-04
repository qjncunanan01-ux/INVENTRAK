'use strict';

function compareLots(a, b, policy = 'FEFO') {
  const normalizedPolicy = String(policy || 'FEFO').toUpperCase();
  if (normalizedPolicy === 'FIFO') {
    return compareText(a.received_at, b.received_at) || Number(a.id) - Number(b.id);
  }

  const aDated = a.expiry_date != null;
  const bDated = b.expiry_date != null;
  if (aDated !== bDated) return aDated ? -1 : 1;
  if (aDated) {
    const expiryOrder = compareText(a.expiry_date, b.expiry_date);
    if (expiryOrder) return expiryOrder;
  }
  return compareText(a.received_at, b.received_at) || Number(a.id) - Number(b.id);
}

function compareText(a, b) {
  const left = a == null ? '' : String(a);
  const right = b == null ? '' : String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function lotOrderSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return {
    FEFO: `(${prefix}expiry_date IS NULL) ASC, ${prefix}expiry_date ASC, ${prefix}received_at ASC, ${prefix}id ASC`,
    FIFO: `${prefix}received_at ASC, ${prefix}id ASC`,
  };
}

module.exports = { compareLots, lotOrderSql };

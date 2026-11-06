'use strict';

const { calculateReplenishment } = require('./replenishment');
const { criticalLevelFromMap } = require('../inventory/critical-level');

// Advisory reorder list shared by the SQLite and npm-free servers. It never
// creates a purchase order: Sylver must confirm supplier, pack size, price and
// quantity before placing an order.
function buildReorderSuggestions({
  products = [],
  sales = [],
  stockByProduct = new Map(),
  criticalLevels,
  settings,
  now = new Date(),
} = {}) {
  const salesByProduct = new Map();
  for (const sale of sales) {
    const id = Number(sale && sale.product_id);
    if (!Number.isInteger(id) || id < 1) continue;
    const rows = salesByProduct.get(id) || [];
    rows.push(sale);
    salesByProduct.set(id, rows);
  }

  const items = [];
  for (const product of products) {
    const id = Number(product && product.id);
    if (!Number.isInteger(id) || id < 1) continue;
    const rawStock = stockByProduct instanceof Map
      ? stockByProduct.get(id)
      : stockByProduct[id];
    const onHand = Math.max(0, Number(rawStock) || 0);
    const metrics = calculateReplenishment({
      product,
      sales: salesByProduct.get(id) || [],
      stock: onHand,
      settings,
      now,
    });
    const criticalLevel = criticalLevelFromMap(criticalLevels, id);
    const triggerLevel = Math.max(criticalLevel, metrics.ROP);
    if (onHand > triggerLevel) continue;

    const hasDemandHistory = metrics.annualDemand > 0;
    const shortage = Math.max(0, Math.ceil(triggerLevel - onHand));
    const recommendedQuantity = hasDemandHistory
      ? Math.max(1, metrics.EOQ, shortage)
      : null;

    items.push({
      product_id: id,
      product_name: String(product.name || `Product ${id}`),
      on_hand: onHand,
      critical_level: criticalLevel,
      reorder_point: metrics.ROP,
      trigger_level: triggerLevel,
      safety_stock: metrics.safetyStock,
      economic_order_quantity: metrics.EOQ,
      annual_demand: metrics.annualDemand,
      lead_time_days: metrics.assumptions.leadTimeDays,
      recommended_quantity: recommendedQuantity,
      recommendation_basis: hasDemandHistory ? 'eoq' : 'manual_review',
      urgency: onHand <= 0 ? 'out_of_stock' : onHand <= criticalLevel ? 'critical' : 'reorder',
    });
  }

  items.sort((a, b) => {
    const urgency = { out_of_stock: 0, critical: 1, reorder: 2 };
    return urgency[a.urgency] - urgency[b.urgency] ||
      (a.on_hand / Math.max(1, a.trigger_level)) - (b.on_hand / Math.max(1, b.trigger_level)) ||
      a.product_name.localeCompare(b.product_name);
  });

  return {
    generated_at: now.toISOString(),
    count: items.length,
    items,
  };
}

module.exports = { buildReorderSuggestions };

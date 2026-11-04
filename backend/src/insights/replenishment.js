'use strict';

const DEFAULTS = Object.freeze({
  eoq_ordering_cost: 50,
  eoq_annual_holding_rate: 0.2,
  reorder_lead_time_days: 7,
  safety_stock_z_score: 1.65,
  abc_a_threshold_percent: 70,
  abc_b_threshold_percent: 90,
});

function numeric(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function configWithDefaults(config = {}) {
  return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, numeric(config[key], DEFAULTS[key])]));
}

function dailyDemandStats(sales, { now = new Date(), days = 365 } = {}) {
  const dayMs = 86400000;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = today - (days - 1) * dayMs;
  const daily = Array(days).fill(0);
  let total = 0;
  let earliest = null;

  for (const row of sales || []) {
    const qty = Number(row.qty);
    const at = Date.parse(row.transaction_date);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(at)) continue;
    const date = Date.UTC(new Date(at).getUTCFullYear(), new Date(at).getUTCMonth(), new Date(at).getUTCDate());
    const index = Math.floor((date - start) / dayMs);
    if (index < 0 || index >= days) continue;
    daily[index] += qty;
    total += qty;
    earliest = earliest == null || date < earliest ? date : earliest;
  }

  const mean = total / days;
  const variance = daily.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / days;
  return {
    annualDemand: total,
    dailyMean: mean,
    dailyStdDev: Math.sqrt(variance),
    historyDays: earliest == null ? 0 : Math.floor((today - earliest) / dayMs) + 1,
  };
}

function calculateReplenishment({ product, sales, stock = 0, settings, now = new Date() }) {
  const cfg = configWithDefaults(settings);
  const stats = dailyDemandStats(sales, { now, days: 365 });
  const unitCost = Number(product && product.cost) > 0
    ? Number(product.cost)
    : Number(product && product.price) > 0 ? Number(product.price) : 1;
  const annualHoldingCost = unitCost * cfg.eoq_annual_holding_rate;
  const eoq = stats.annualDemand > 0 && annualHoldingCost > 0
    ? Math.sqrt((2 * stats.annualDemand * cfg.eoq_ordering_cost) / annualHoldingCost)
    : 0;
  const leadTimeDays = Math.max(1, Math.round(cfg.reorder_lead_time_days));
  const safetyStock = Math.ceil(cfg.safety_stock_z_score * stats.dailyStdDev * Math.sqrt(leadTimeDays));
  const reorderPoint = Math.ceil(stats.dailyMean * leadTimeDays + safetyStock);
  const averageInventory = Number(stock) > 0 ? Number(stock) : 0;

  return {
    EOQ: Math.round(eoq),
    ROP: reorderPoint,
    safetyStock,
    annualDemand: stats.annualDemand,
    averageDailyDemand: Number(stats.dailyMean.toFixed(4)),
    dailyDemandStdDev: Number(stats.dailyStdDev.toFixed(4)),
    demandHistoryDays: stats.historyDays,
    turnoverRatio: averageInventory > 0 ? Math.round((stats.annualDemand / averageInventory) * 100) / 100 : 0,
    avgInventory: Math.round(averageInventory),
    assumptions: {
      orderingCost: cfg.eoq_ordering_cost,
      annualHoldingRate: cfg.eoq_annual_holding_rate,
      leadTimeDays,
      serviceLevelZScore: cfg.safety_stock_z_score,
    },
  };
}

function classifyAbc(products, sales, settings, { now = new Date() } = {}) {
  const cfg = configWithDefaults(settings);
  const cutoff = now.getTime() - 365 * 86400000;
  const totals = new Map();
  for (const sale of sales || []) {
    const at = Date.parse(sale.transaction_date);
    if (!Number.isFinite(at) || at < cutoff) continue;
    const id = Number(sale.product_id);
    const qty = Number(sale.qty) || 0;
    const value = Number(sale.total_amount) || 0;
    const row = totals.get(id) || { qty: 0, value: 0 };
    row.qty += qty;
    row.value += value;
    totals.set(id, row);
  }

  const rows = (products || []).map(product => {
    const salesRow = totals.get(Number(product.id)) || { qty: 0, value: 0 };
    return { id: product.id, name: product.name, value: salesRow.value, annualQty: salesRow.qty };
  }).sort((a, b) => b.value - a.value || Number(a.id) - Number(b.id));

  const totalValue = rows.reduce((sum, row) => sum + row.value, 0);
  let cumulative = 0;
  return rows.map(row => {
    const cumulativeBefore = cumulative;
    cumulative += row.value;
    const cumulativePercent = totalValue > 0 ? (cumulative / totalValue) * 100 : 100;
    let classification = 'C';
    const cumulativeBeforePercent = totalValue > 0 ? (cumulativeBefore / totalValue) * 100 : 100;
    if (totalValue > 0 && cumulativeBeforePercent < cfg.abc_a_threshold_percent) classification = 'A';
    else if (totalValue > 0 && cumulativeBeforePercent < cfg.abc_b_threshold_percent) classification = 'B';
    return { ...row, cumulativePercent: Number(cumulativePercent.toFixed(2)), classification };
  });
}

module.exports = { DEFAULTS, configWithDefaults, dailyDemandStats, calculateReplenishment, classifyAbc };

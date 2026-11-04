'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { dailyDemandStats, calculateReplenishment, classifyAbc } = require('../insights/replenishment');
const { compareLots } = require('../stock-control/lot-allocation');
const { convertQuantity } = require('../stock-control/unit-conversion');

const now = new Date('2026-11-04T12:00:00.000Z');

test('demand history aggregates daily quantities inside the rolling 365-day window', () => {
  const stats = dailyDemandStats([
    { qty: 10, transaction_date: '2026-11-04T00:10:00.000Z' },
    { qty: 5, transaction_date: '2026-11-03T23:59:00.000Z' },
    { qty: 99, transaction_date: '2025-11-03T00:00:00.000Z' },
    { qty: -4, transaction_date: '2026-11-04T00:00:00.000Z' },
  ], { now, days: 365 });
  assert.equal(stats.annualDemand, 15);
  assert.equal(stats.historyDays, 2);
  assert.ok(stats.dailyMean > 0);
  assert.ok(stats.dailyStdDev > 0);
});

test('EOQ and ROP use catalog cost, configured ordering assumptions, and observed demand', () => {
  const sales = Array.from({ length: 365 }, (_, index) => ({
    qty: 1,
    transaction_date: new Date(Date.UTC(2025, 10, 5) + index * 86400000).toISOString(),
  }));
  const result = calculateReplenishment({
    product: { cost: 10, price: 100 },
    sales,
    stock: 42,
    now,
    settings: {
      eoq_ordering_cost: 50,
      eoq_annual_holding_rate: 0.2,
      reorder_lead_time_days: 7,
      safety_stock_z_score: 1.65,
    },
  });
  assert.equal(result.annualDemand, 365);
  assert.equal(result.EOQ, Math.round(Math.sqrt((2 * 365 * 50) / (10 * 0.2))));
  assert.equal(result.safetyStock, 0, 'constant daily demand has no variation buffer');
  assert.equal(result.ROP, 7, 'one unit daily demand times a seven-day lead time');
  assert.deepEqual(result.assumptions, {
    orderingCost: 50,
    annualHoldingRate: 0.2,
    leadTimeDays: 7,
    serviceLevelZScore: 1.65,
  });
});

test('safety stock uses demand variability and falls back to zero when there is no history', () => {
  const settings = { reorder_lead_time_days: 7, safety_stock_z_score: 1.65 };
  const result = calculateReplenishment({
    product: { cost: 10 },
    sales: [{ qty: 10, transaction_date: '2026-11-04T08:00:00Z' }],
    settings,
    now,
  });
  const mean = 10 / 365;
  const stddev = Math.sqrt(((10 - mean) ** 2 + 364 * (mean ** 2)) / 365);
  const expectedSafetyStock = Math.ceil(1.65 * stddev * Math.sqrt(7));
  assert.equal(result.safetyStock, expectedSafetyStock);
  assert.equal(result.ROP, Math.ceil(mean * 7 + expectedSafetyStock));

  const empty = calculateReplenishment({ product: { cost: 10 }, sales: [], settings, now });
  assert.equal(empty.EOQ, 0);
  assert.equal(empty.ROP, 0);
  assert.equal(empty.safetyStock, 0);
});

test('ABC puts the dominant product in A and ignores sales outside the year', () => {
  const result = classifyAbc(
    [{ id: 1, name: 'Main', price: 1 }, { id: 2, name: 'No sales', price: 1 }],
    [
      { product_id: 1, qty: 5, total_amount: 500, transaction_date: '2026-11-04T00:00:00Z' },
      { product_id: 2, qty: 99, total_amount: 9999, transaction_date: '2025-11-03T00:00:00Z' },
    ],
    { abc_a_threshold_percent: 70, abc_b_threshold_percent: 90 },
    { now },
  );
  assert.equal(result[0].classification, 'A');
  assert.equal(result[0].value, 500);
  assert.equal(result[1].classification, 'C');
  assert.equal(result[1].value, 0);
});

test('unit conversions support reciprocal rates and reject malformed rates', () => {
  const rows = [{ from_unit: 'case', to_unit: 'pcs', rate: 12 }];
  assert.equal(convertQuantity(rows, 2, 'case', 'pcs'), 24);
  assert.equal(convertQuantity(rows, 24, 'pcs', 'case'), 2);
  assert.equal(convertQuantity([{ from_unit: 'box', to_unit: 'pcs', rate: 0 }], 2, 'box', 'pcs'), null);
  assert.equal(convertQuantity(rows, 2, 'box', 'pcs'), null);
});

test('FEFO prioritizes soonest expiry while FIFO prioritizes arrival time', () => {
  const older = { id: 1, received_at: '2026-01-01', expiry_date: null };
  const dated = { id: 2, received_at: '2026-02-01', expiry_date: '2026-12-01' };
  assert.ok(compareLots(dated, older, 'FEFO') < 0);
  assert.ok(compareLots(older, dated, 'FIFO') < 0);
});

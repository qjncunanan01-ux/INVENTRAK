'use strict';

function normalizeUnit(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

// A catalog rate means: one `from_unit` equals `rate` `to_unit`s.
// Deriving the reciprocal lets one kg -> g row also support g -> kg.
function convertQuantity(rows, quantity, fromUnit, toUnit) {
  const qty = Number(quantity);
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!Number.isFinite(qty) || qty < 0 || !from || !to) return null;
  if (from === to) return qty;

  const direct = rows.find(row => normalizeUnit(row.from_unit) === from && normalizeUnit(row.to_unit) === to);
  if (direct) {
    const rate = Number(direct.rate);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const converted = qty * rate;
    return Number.isFinite(converted) ? converted : null;
  }

  const reverse = rows.find(row => normalizeUnit(row.from_unit) === to && normalizeUnit(row.to_unit) === from);
  if (reverse && Number.isFinite(Number(reverse.rate)) && Number(reverse.rate) > 0) {
    const converted = qty / Number(reverse.rate);
    return Number.isFinite(converted) ? converted : null;
  }
  return null;
}

function quantityInProductUnit({ rows, product, quantity, enteredUnit }) {
  const baseUnit = normalizeUnit(product && product.unit) || 'pcs';
  const fromUnit = normalizeUnit(enteredUnit) || baseUnit;
  const converted = convertQuantity(rows, quantity, fromUnit, baseUnit);
  if (converted === null) {
    return { ok: false, error: `No unit conversion is configured from ${fromUnit} to ${baseUnit}` };
  }
  return {
    ok: true,
    quantity: Number(converted.toPrecision(12)),
    entered_quantity: Number(quantity),
    entered_unit: fromUnit,
    base_unit: baseUnit,
  };
}

module.exports = { normalizeUnit, convertQuantity, quantityInProductUnit };

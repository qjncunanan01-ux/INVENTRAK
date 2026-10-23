const SYLVER_POLICY_DEMO = process.env.SYLVER_POLICY_DEMO === 'true';

const COMPANY_POLICY_VERSION = '2026-10-24-sylver-demo-v3';
const DISCOUNT_THRESHOLD = 5000;
const DISCOUNT_RATE = 0.03;
const PICKUP = {
  business: 'Sylver Restaurant & Café Supplier OPC',
  address: '23-B Mohawk Street, Concepcion Uno, Marikina City',
  days: 'Monday–Saturday',
  hours: '8:00 AM–5:00 PM',
};
const DELIVERY_AREAS = [
  'Marikina',
  'Antipolo and Rizal',
  'Pasig',
  'Selected areas of Quezon City',
  'Other Metro Manila areas by arrangement',
];
// The card option is a school-demo simulator only. It never collects card
// details or contacts a payment gateway.
const PAYMENT_METHODS = ['cash', 'gcash', 'bank_transfer', 'card'];

function isDiscountCategory(category) {
  return /syrup|sauce/i.test(String(category || ''));
}

function applyBulkDiscount(lines, productForId) {
  const priced = lines.map((line) => {
    const product = line.id == null ? null : productForId(Number(line.id));
    const category = product && product.category;
    const unitPrice = Number(line.unit_price);
    const subtotal = Number.isFinite(unitPrice) ? Math.round(unitPrice * Number(line.qty) * 100) / 100 : 0;
    return { ...line, category, subtotal, gross_subtotal: subtotal, bulk_discount_amount: 0 };
  });
  const eligibleSubtotal = Math.round(priced.reduce((sum, line) =>
    sum + (isDiscountCategory(line.category) ? line.gross_subtotal : 0), 0) * 100) / 100;
  const qualifies = eligibleSubtotal >= DISCOUNT_THRESHOLD;
  let remainingDiscount = qualifies ? Math.round(eligibleSubtotal * DISCOUNT_RATE * 100) / 100 : 0;
  const eligibleLines = priced.filter((line) => isDiscountCategory(line.category));
  for (let index = 0; index < eligibleLines.length; index += 1) {
    const line = eligibleLines[index];
    const share = index === eligibleLines.length - 1
      ? remainingDiscount
      : Math.round(line.gross_subtotal * DISCOUNT_RATE * 100) / 100;
    line.bulk_discount_amount = share;
    remainingDiscount = Math.max(0, Math.round((remainingDiscount - share) * 100) / 100);
  }
  const discount = qualifies ? Math.round(eligibleSubtotal * DISCOUNT_RATE * 100) / 100 : 0;
  const gross = Math.round(priced.reduce((sum, line) => sum + line.gross_subtotal, 0) * 100) / 100;
  return {
    lines: priced.map((line) => ({
      ...line,
      net_subtotal: Math.round((line.gross_subtotal - line.bulk_discount_amount) * 100) / 100,
    })),
    eligible_subtotal: eligibleSubtotal,
    discount_amount: discount,
    discount_rate: qualifies ? DISCOUNT_RATE : 0,
    total: Math.round((gross - discount) * 100) / 100,
  };
}

function planStockReservation(lines, stockRows) {
  const stock = new Map();
  for (const row of stockRows) {
    const productId = Number(row.product_id);
    const locationId = Number(row.location_id);
    if (!stock.has(productId)) stock.set(productId, []);
    stock.get(productId).push({ location_id: locationId, remaining: Number(row.quantity) || 0 });
  }
  const requested = new Map();
  for (const line of lines) {
    if (!Number.isSafeInteger(Number(line.id)) || Number(line.id) < 1) {
      return { error: 'Every demo order line must include a valid catalog product' };
    }
    if (!Number.isSafeInteger(Number(line.qty)) || Number(line.qty) < 1) {
      return { error: 'Order quantities must be positive whole numbers' };
    }
    requested.set(Number(line.id), (requested.get(Number(line.id)) || 0) + Number(line.qty));
  }
  for (const [productId, quantity] of requested) {
    const available = (stock.get(productId) || []).reduce((sum, row) => sum + row.remaining, 0);
    if (available < quantity) {
      return { error: `Not enough stock for product ${productId}`, product_id: productId, requested: quantity, available };
    }
  }
  const allocations = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    let remaining = Number(line.qty);
    let remainingNet = Math.round(Number(line.net_subtotal ?? (Number(line.unit_price) * remaining)) * 100) / 100;
    const requestedQty = remaining;
    for (const location of stock.get(Number(line.id)) || []) {
      if (remaining <= 0) break;
      const quantity = Math.min(remaining, location.remaining);
      if (quantity <= 0) continue;
      const netTotal = quantity === remaining
        ? remainingNet
        : Math.round((Number(line.net_subtotal ?? (Number(line.unit_price) * requestedQty)) * quantity / requestedQty) * 100) / 100;
      allocations.push({
        line_index: lineIndex,
        product_id: Number(line.id),
        location_id: location.location_id,
        qty: quantity,
        unit_price: quantity ? Number((netTotal / quantity).toFixed(4)) : 0,
        net_total: netTotal,
      });
      location.remaining -= quantity;
      remaining -= quantity;
      remainingNet = Math.round((remainingNet - netTotal) * 100) / 100;
    }
  }
  return { allocations };
}

function availableOrderTerms() {
  return {
    version: COMPANY_POLICY_VERSION,
    discount_threshold: DISCOUNT_THRESHOLD,
    discount_rate: DISCOUNT_RATE,
    pickup: { ...PICKUP },
    delivery_areas: [...DELIVERY_AREAS],
    payment_methods: [...PAYMENT_METHODS],
  };
}

module.exports = {
  SYLVER_POLICY_DEMO,
  COMPANY_POLICY_VERSION,
  DISCOUNT_THRESHOLD,
  DISCOUNT_RATE,
  PICKUP,
  DELIVERY_AREAS,
  PAYMENT_METHODS,
  isDiscountCategory,
  applyBulkDiscount,
  planStockReservation,
  availableOrderTerms,
};

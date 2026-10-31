const { planStockReservation } = require('./company-policy');

// Plans stock removal for one customer inquiry from a specific location.
function planOrderFulfillment(lines, locationId, { findProduct, getAvailable }) {
  const id = Number(locationId);
  if (!Number.isInteger(id) || id < 1) return { error: 'location_id must be a positive integer' };

  const grouped = new Map();
  for (const rawLine of Array.isArray(lines) ? lines : []) {
    const legacyMatch = typeof rawLine === 'string' ? rawLine.trim().match(/^(.*?)\s*x\s*(\d+)$/i) : null;
    const line = typeof rawLine === 'string'
      ? { name: legacyMatch ? legacyMatch[1].trim() : rawLine.trim(), qty: legacyMatch ? Number(legacyMatch[2]) : 1 }
      : (rawLine || {});
    const qty = Number(line.qty ?? line.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10000) {
      return { error: 'Every order line must have a whole quantity between 1 and 10000' };
    }
    const product = findProduct(line || {});
    if (!product) return { error: `Could not match order item "${String(line && line.name || 'Item')}" to an active catalog product` };
    const productId = Number(product.id);
    const current = grouped.get(productId) || {
      product,
      product_id: productId,
      qty: 0,
      unit_price: Number(line.unit_price ?? line.price) >= 0
        ? Number(line.unit_price ?? line.price)
        : Number(product.price) || 0,
    };
    current.qty += qty;
    if (current.qty > 10000) {
      return { error: `An inquiry may not exceed 10000 units of ${product.name}` };
    }
    grouped.set(productId, current);
  }

  const plan = [...grouped.values()];
  if (!plan.length) return { error: 'This inquiry has no catalog items to fulfill' };
  for (const entry of plan) {
    const available = Number(getAvailable(entry.product_id, id)) || 0;
    if (available < entry.qty) {
      return {
        error: `Insufficient stock for ${entry.product.name} at the selected location`,
        available,
        requested: entry.qty,
        product_id: entry.product_id,
      };
    }
  }
  return { plan, location_id: id };
}

// Plans stock removal without asking the admin to choose a showroom or
// stockroom. Stock rows arrive in preferred order (Showroom first, then other
// locations); the shared allocator splits items across locations as needed.
function planAutomaticOrderFulfillment(lines, { findProduct, getStockRows }) {
  const rawLines = Array.isArray(lines) ? lines : [];
  const normalizedLines = [];
  const products = new Map();
  const requestedByProduct = new Map();

  for (const rawLine of rawLines) {
    const legacyMatch = typeof rawLine === 'string' ? rawLine.trim().match(/^(.*?)\s*x\s*(\d+)$/i) : null;
    const line = typeof rawLine === 'string'
      ? { name: legacyMatch ? legacyMatch[1].trim() : rawLine.trim(), qty: legacyMatch ? Number(legacyMatch[2]) : 1 }
      : (rawLine || {});
    const qty = Number(line.qty ?? line.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10000) {
      return { error: 'Every order line must have a whole quantity between 1 and 10000' };
    }

    const product = findProduct(line);
    if (!product) return { error: `Could not match order item "${String(line.name || 'Item')}" to an active catalog product` };
    const productId = Number(product.id);
    const requested = (requestedByProduct.get(productId) || 0) + qty;
    if (requested > 10000) return { error: `An inquiry may not exceed 10000 units of ${product.name}` };
    requestedByProduct.set(productId, requested);
    products.set(productId, product);

    const rawPrice = line.unit_price ?? line.price;
    const unitPrice = rawPrice !== null && rawPrice !== undefined && Number.isFinite(Number(rawPrice)) && Number(rawPrice) >= 0
      ? Number(rawPrice)
      : Number(product.price) || 0;
    const rawSubtotal = line.net_subtotal ?? line.subtotal;
    const subtotal = rawSubtotal !== null && rawSubtotal !== undefined && Number.isFinite(Number(rawSubtotal)) && Number(rawSubtotal) >= 0
      ? Number(rawSubtotal)
      : Math.round(unitPrice * qty * 100) / 100;
    normalizedLines.push({
      id: productId,
      name: product.name,
      qty,
      unit_price: unitPrice,
      net_subtotal: subtotal,
    });
  }

  if (!normalizedLines.length) return { error: 'This inquiry has no catalog items to fulfill' };

  const allocation = planStockReservation(
    normalizedLines,
    getStockRows([...products.keys()]),
  );
  if (allocation.error) {
    const product = products.get(Number(allocation.product_id));
    return {
      ...allocation,
      ...(product ? { error: `Not enough stock for ${product.name} across all locations` } : {}),
    };
  }

  const plan = normalizedLines.map((line, lineIndex) => ({
    line_index: lineIndex,
    product_id: line.id,
    name: line.name,
    qty: line.qty,
    unit_price: line.qty ? Number((line.net_subtotal / line.qty).toFixed(4)) : 0,
    total_amount: line.net_subtotal,
  }));
  return { plan, allocations: allocation.allocations };
}

module.exports = { planOrderFulfillment, planAutomaticOrderFulfillment };

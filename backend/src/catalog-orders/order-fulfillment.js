// Plans stock removal for one customer inquiry. Allocation is explicit: the
// admin chooses the location, and every line must be available there before
// any stock, sale, or order status is written.
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

module.exports = { planOrderFulfillment };

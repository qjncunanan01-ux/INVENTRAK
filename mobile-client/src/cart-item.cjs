// Pure cart mutation used by CartContext and the headless rapid-add stress
// check. Returning null means the request is invalid or exceeds a limit.
function addCartItem({
  previous,
  product,
  qty = 1,
  available,
  maxUnits = 10000,
  maxLines = 500,
}) {
  const items = Array.isArray(previous) ? previous : [];
  const productId = Number(product && product.id);
  if (!Number.isInteger(productId) || productId < 1) return null;

  const requested = Math.floor(Number(qty) || 1);
  if (!Number.isSafeInteger(requested) || requested > maxUnits) return null;
  const quantity = Math.max(1, requested);
  const stockLimit = available === undefined ? null : Number(available);
  if (stockLimit !== null && (!Number.isFinite(stockLimit) || stockLimit < 0)) return null;
  const index = items.findIndex((item) => Number(item.product.id) === productId);

  if (index >= 0) {
    const existing = items[index];
    if (existing.qty + quantity > maxUnits) return null;
    if (stockLimit !== null && existing.qty + quantity > stockLimit) return null;
    const next = items.slice();
    next[index] = {
      ...existing,
      qty: existing.qty + quantity,
    };
    return next;
  }

  if (items.length >= maxLines) return null;
  if (stockLimit !== null && quantity > stockLimit) return null;
  return [...items, { product, qty: quantity }];
}

// Exact quantity update for the cart stepper. null means invalid or beyond
// the configured cap, allowing the screen to show the actual limit instead of
// silently changing the shopper's requested quantity.
function setCartItemQty({ previous, productId, qty, maxUnits = 10000 } = {}) {
  const items = Array.isArray(previous) ? previous : [];
  const id = Number(productId);
  const requested = Number(qty);
  if (
    !Number.isInteger(id) || id < 1 || !Number.isSafeInteger(requested)
    || requested < 0 || requested > maxUnits
  ) return null;
  if (requested === 0) return items.filter(item => Number(item && item.product && item.product.id) !== id);
  if (!items.some(item => Number(item && item.product && item.product.id) === id)) return items;
  return items.map(item => Number(item && item.product && item.product.id) === id ? { ...item, qty: requested } : item);
}

module.exports = { addCartItem, setCartItemQty };

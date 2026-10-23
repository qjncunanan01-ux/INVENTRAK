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

module.exports = { addCartItem };

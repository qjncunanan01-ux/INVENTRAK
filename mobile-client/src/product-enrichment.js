// Small helpers for customer-facing catalog data. Keep this layer grounded in
// values returned by the API; it must not invent prices, ratings, reviews, or
// store policies.

export function productTitle(product) {
  const name = String(product && product.name || 'Item').trim();
  const size = String(product && product.size || '').trim();
  return size && !name.toLowerCase().includes(size.toLowerCase()) ? `${name} (${size})` : name;
}

export function stockMapFromInventory(response) {
  const parsed = response && response.data ? response.data : response;
  const stock = {};
  (parsed && Array.isArray(parsed.items) ? parsed.items : []).forEach((item) => {
    const id = Number(item && item.product && item.product.id);
    if (!Number.isInteger(id) || id < 1) return;

    const total = Number(item.total);
    if (item.total != null && Number.isFinite(total)) {
      stock[id] = Math.max(0, total);
      return;
    }

    const locations = item.locations || {};
    const quantities = Array.isArray(locations)
      ? locations.map((location) => location.quantity)
      : Object.values(locations);
    stock[id] = quantities.reduce((sum, quantity) => sum + (Number(quantity) || 0), 0);
  });
  return stock;
}

export function similarProducts(product, products = [], limit = 4) {
  if (!product) return [];
  const id = Number(product.id);
  const category = String(product.category || '').toLowerCase();
  const brand = String(product.brand || '').toLowerCase();
  const words = String(product.name || '').toLowerCase().split(/\s+/).filter((word) => word.length > 3);

  return products
    .filter((item) => Number.isFinite(Number(item.id)) && Number(item.id) !== id)
    .map((item) => {
      let score = 0;
      if (category && String(item.category || '').toLowerCase() === category) score += 2;
      if (brand && String(item.brand || '').toLowerCase() === brand) score += 1;
      if (words.some((word) => String(item.name || '').toLowerCase().includes(word))) score += 1;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.name || '').localeCompare(String(b.item.name || '')))
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function stockStatus(total) {
  if (total === undefined || total === null) return { label: 'Stock unavailable', tone: 'unknown' };
  if (Number(total) <= 0) return { label: 'Out of stock', tone: 'out' };
  if (Number(total) < 25) return { label: 'Low stock', tone: 'low' };
  return { label: 'In stock', tone: 'ok' };
}

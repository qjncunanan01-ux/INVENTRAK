// Daily flash-sale helpers for the Home "⚡ Flash Sale" and Recommendations
// "🔥 24hr Flash Deal" carousels.
//
// Pure functions (no React, no device APIs) so they can be unit-tested
// headlessly with plain Node. The design follows Shopee's urgency pattern:
// a visible countdown to the daily refresh, after which the featured picks
// rotate to a fresh window of the value-ranked ABC list. buildFlashPicks is
// shared by BOTH screens so they always feature the exact same items.

// Milliseconds until the next LOCAL midnight — the moment the day's picks
// rotate. Same wall-clock behavior on every device.
export function msUntilDailyRefresh(from = Date.now()) {
  const d = new Date(from);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next.getTime() - from);
}

// Deterministic per-local-day seed: a new integer every local day, stable
// within the day, identical across devices (so every customer sees the same
// "today's flash sale").
export function daySeed(from = Date.now()) {
  const d = new Date(from);
  return d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate();
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

const FEATURED_SIZE = 6;

// Pick the day's featured list from the value-ranked `eligible` products
// (photo + in-stock, already sorted by ABC value descending).
//
// When more than `size` qualify, features a window of `size` whose start
// rotates each day with a STRIDE COPRIME to the number of windows — so every
// position in the ranking is eventually featured (full cycle, no stuck
// subset) while consecutive days only overlap slightly. Deterministic: the
// same local day on any device yields the same picks.
//
// When fewer than `size` qualify (ABC failed, or top picks lack photos or
// stock), tops up from the general photo pool without duplicating ids so the
// carousel always fills.
export function dailyPicks(eligible, pool = [], now = Date.now(), size = FEATURED_SIZE) {
  const picks = eligible.slice(0, size);
  if (eligible.length <= size) {
    for (const p of pool) {
      if (picks.length >= size) break;
      if (!picks.some((f) => Number(f.id) === Number(p.id))) picks.push(p);
    }
    return picks;
  }
  // Number of distinct size-windows over the ranked list.
  const windows = eligible.length - size + 1;
  let stride = 2;
  while (gcd(stride, windows) !== 1) stride += 1;
  const offset = (((daySeed(now) * stride) % windows) + windows) % windows;
  return eligible.slice(offset, offset + size);
}

// Build the stock map (productId -> total quantity across locations) from
// the inventory API shape { data: { items: [{ product: { id }, locations:
// {...} }] } }. Missing/unparseable inventory yields an empty map, which
// buildFlashPicks treats as "in stock" (same behavior as before extraction).
export function stockMapFromInventory(inv) {
  const stock = {};
  if (!inv) return stock;
  const parsed = inv && inv.data ? inv.data : inv;
  (parsed.items || []).forEach((i) => {
    const id = Number(i.product && i.product.id);
    if (!id) return;
    const locs = i.locations || {};
    stock[id] = Object.keys(locs).reduce((sum, k) => sum + (Number(locs[k]) || 0), 0);
  });
  return stock;
}

// Today's flash-sale picks, computed IDENTICALLY on every screen: enrich the
// value-ranked ABC list with catalog photo/price/category, keep photo +
// in-stock items, then rotate a deterministic window per local day (see
// dailyPicks). Home and Recommendations call this with the same API data, so
// the two carousels always feature the exact same products.
export function buildFlashPicks(abcItems, catalogItems, stockByProductId = {}, now = Date.now()) {
  const inStock = (id) => {
    const total = stockByProductId[Number(id)];
    return total === undefined || total > 0;
  };
  const eligible = abcItems
    .map((r) => {
      const p = catalogItems.find((pr) => Number(pr.id) === Number(r.id)) || {};
      return {
        id: r.id,
        name: r.name,
        classification: r.classification,
        value: r.value,
        price: Number(p.price) || 0,
        image: p.image || null,
        category: p.category || '',
      };
    })
    .filter((f) => f.image && inStock(f.id));
  // Top-up pool: any photo + in-stock catalog product (used only when fewer
  // than `size` ABC picks qualify, so the carousel always fills).
  const pool = catalogItems
    .filter((p) => p.image && inStock(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      classification: '',
      value: 0,
      price: Number(p.price) || 0,
      image: p.image || null,
      category: p.category || '',
    }));
  return dailyPicks(eligible, pool, now);
}

// Fake flash-sale price for a pick, to complete the Shopee urgency look:
// a deterministic 10-25% discount derived from the product id and the
// LOCAL DAY seed — every device shows the same deal on the same day, it is
// stable within the day (no flicker between renders), and it changes at
// midnight together with the rotation. Products without a price return null
// (the carousel then just shows the plain price).
export function dealPricing(product, now = Date.now()) {
  const original = Number(product && product.price) || 0;
  if (original <= 0) return null;
  const seed = daySeed(now) * 31 + (Number(product.id) || 0) * 13;
  const pct = 10 + (seed % 16); // 10..25
  // floor (not round) so the deal is always strictly below the original for
  // any priced item — a strike-through that shows zero savings would look
  // broken. max(1, ...) keeps the floor at one peso.
  const deal = Math.max(1, Math.floor((original * (100 - pct)) / 100));
  return { original, deal, pct };
}

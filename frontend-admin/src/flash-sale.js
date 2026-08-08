// Daily flash-sale helpers for the admin "Today's Flash Deals" card.
//
// This is an EXACT port of mobile-client/src/flash-sale.js — the same pure
// functions (day seed, rotation, stock map, deal pricing) so the admin
// dashboard surfaces EXACTLY the same picks and deal prices customers see in
// the mobile carousels. CRA cannot import outside src/, so the module is
// copied and locked against drift by a parity test (flash-sale.test.js) that
// runs both implementations over identical inputs.
//
// Pure functions (no React, no device APIs) so they can be unit-tested
// headlessly with plain Node.

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
// (photo + in-stock, already sorted by ABC value descending). See the mobile
// module for the full rotation rationale — this must stay identical.
export function dailyPicks(eligible, pool = [], now = Date.now(), size = FEATURED_SIZE) {
  const picks = eligible.slice(0, size);
  if (eligible.length <= size) {
    for (const p of pool) {
      if (picks.length >= size) break;
      if (!picks.some((f) => Number(f.id) === Number(p.id))) picks.push(p);
    }
    return picks;
  }
  const windows = eligible.length - size + 1;
  let stride = 2;
  while (gcd(stride, windows) !== 1) stride += 1;
  const offset = (((daySeed(now) * stride) % windows) + windows) % windows;
  return eligible.slice(offset, offset + size);
}

// Build the stock map (productId -> total quantity across locations) from the
// inventory API shape { data: { items: [{ product: { id }, locations:
// {...} }] } }. Missing/unparseable inventory yields an empty map, which
// buildFlashPicks treats as "in stock" (same behavior as the mobile module).
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

// Today's flash-sale picks, computed IDENTICALLY to the mobile app: enrich the
// value-ranked ABC list with catalog photo/price/category, keep photo +
// in-stock items, then rotate a deterministic window per local day. The admin
// calls this with the same three API payloads the mobile uses, so the
// dashboard mirrors the customer-facing carousels exactly.
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

// Fake flash-sale price for a pick: a deterministic 10-25% discount derived
// from the product id and the LOCAL DAY seed — every device shows the same
// deal on the same day, stable within the day, changes at midnight together
// with the rotation. Products without a price return null.
export function dealPricing(product, now = Date.now()) {
  const original = Number(product && product.price) || 0;
  if (original <= 0) return null;
  const seed = daySeed(now) * 31 + (Number(product.id) || 0) * 13;
  const pct = 10 + (seed % 16); // 10..25
  const deal = Math.max(1, Math.floor((original * (100 - pct)) / 100));
  return { original, deal, pct };
}

// "07:43:40"-style countdown for the card header (same values the mobile
// FlashCarousel shows, formatted for the admin card).
export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
